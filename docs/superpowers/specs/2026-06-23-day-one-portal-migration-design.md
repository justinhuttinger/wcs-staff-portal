# Day One Program Generator → wcs-staff-portal Migration

**Date:** 2026-06-23
**Status:** Design / awaiting approval
**Author:** Justin + Claude

## Summary

Migrate the standalone **Day One PT program generator** (`justinhuttinger/dayone`, deployed at `dayone-xe91.onrender.com`) into the **wcs-staff-portal** `auth/` Express backend (`wcs-auth-api.onrender.com`). The migration:

1. **Consolidates** the 1,085-line single-file `server.js` into a modular webhook route + service modules that reuse the portal's existing infrastructure (Anthropic SDK, GHL client, ABC Financial integration, PDFShift, SendGrid, Supabase, per-location config).
2. **Persists** every generated program in Supabase (table + Storage), replacing the ephemeral on-disk PDF cache and the `lastGeneratedPdf` global variable (which has a race when two trainers submit simultaneously).
3. **Optimizes for speed** by replacing the single ~10K-token AI call with parallel per-day generation, and replacing the 3-second-polling success page with live SSE progress + fire-on-ready delivery.

No new Render service is created; Day One becomes part of the existing auth API. The old `dayone` Render service and repo are decommissioned after cutover.

### Out of scope (explicitly deferred)
- Portal UI for browsing/re-sending past programs (data will exist in Supabase for a future build).
- Rewriting the AI prompt for better program quality, or redesigning the PDF template (output stays equivalent).
- Switching models (stays on `claude-sonnet-4-6`) or adding prompt caching.

## Current system (what we're migrating from)

Single `server.js` (1,085 lines) doing everything inline:
- `POST /webhook/generate-program` — GHL PT-Intake webhook; returns 200 immediately, then runs `generateAndSendProgram` in the background.
- `generateAndSendProgram`: fetch GHL contact → `generateProgramWithAI` (one streamed `claude-sonnet-4-6` call, `max_tokens: 16000`, with a hand-rolled 4-attempt mid-stream retry loop) → `generatePDF` (HTML template → PDFShift) → save PDF to ephemeral disk (non-fatal) → SendGrid email to client → ABC Financial document upload.
- `GET /program-success` — a polling HTML page that refreshes every 3s for up to 90s, showing "the most recent PDF" via the `lastGeneratedPdf` global var.
- `clubs-config.json` — per-club GHL location id, **GHL private-integration key (committed in plaintext)**, and ABC club number.

Known weaknesses addressed by this migration:
- God-file with no separation of concerns and no real tests.
- `lastGeneratedPdf` global var → wrong PDF shown if two trainers submit close together.
- Ephemeral disk cache → PDFs vanish on Render restart; no history.
- Secrets (GHL `pit-*` keys) committed to the repo.
- ~20–40s+ generation latency from one large sequential AI call; clunky polling UX.

## Target architecture (in wcs-staff-portal/auth)

### Route
- **`auth/src/routes/dayOneProgram.js`**, mounted in `auth/src/index.js` at **`/day-one-program`**.
  - `POST /day-one-program/webhook` — GHL trigger. Validates `contact_id` + `location.id`, resolves the club via `getLocationById`, maps intake fields, creates a `pt_programs` job row, returns `200` immediately, and kicks off generation in the background (matching today's fire-and-forget pattern). **Public** (no auth middleware — it's a GHL webhook), same as today.
  - `GET /day-one-program/status/stream?contactId=...` — **SSE** endpoint the success page subscribes to; streams progress events for the latest job of that contact.
  - `GET /day-one-program/pdf/:jobId` — streams the finished PDF bytes from Supabase Storage (used by the success page download link). Public/unguessable via uuid job id.
  - `GET /day-one-program/success?contactId=...` — the success HTML page (served by the API, public), opens the SSE connection.

### Service modules — `auth/src/services/dayOneProgram/`
- **`intake.js`** — maps the GHL webhook body → normalized `formData` (the large field-mapping block from today, incl. limitations, InBody, medical screening, day-focus fields). Pure function; unit-tested.
- **`prompts.js`** — builds the prompt fragments: shared client-context preamble, per-day workout prompt, overview prompt, terminology prompt.
- **`splits.js`** — default training-split table keyed by `daysPerWeek` (e.g. 3 → Push/Pull/Legs; 4 → Upper/Lower/Upper/Lower; 5 → PPL + Upper/Lower; 6 → PPL×2). Returns a per-day `{ day, focus }` list. Overridden per-day by the trainer's `Day N Focus` form fields when present.
- **`generate.js`** — orchestrates parallel generation (see below) and assembles the final `program_json` in the exact shape `pdf.js` expects.
- **`anthropic.js`** — thin Day One Anthropic wrapper (modeled on `src/mastermind/anthropic.js`) exposing a streamed-with-retry call. Reuses `isRetryableStreamError` + `withStreamRetry` logic ported from the current `server.js` (the PR #4 hardening), since each parallel call still needs mid-stream retry. Uses `@anthropic-ai/sdk@^0.97.1` already in the portal.
- **`pdf.js`** — fills `auth/src/templates/day-one/program-template.html` (+ base64 logo) via `formatProgramHTML`, calls PDFShift with the same `PDFSHIFT_API_KEY` + `fetch` pattern as `hrDocuments.js`. Returns a PDF buffer.
- **`deliver.js`** — SendGrid email to the client (reusing the portal's SendGrid setup) + ABC Financial document upload (reusing the existing ABC integration pattern). Each step is independently try/caught so one failure never blocks the others (preserves the PR #2 resilience fix).
- **`jobs.js`** — `pt_programs` row lifecycle: `createJob`, `setStatus`, `setProgress`, `attachProgram`, `attachPdf`, `markComplete`, `markError`. Also the SSE pump (poll/emit the row's `status`/`progress` to subscribers).

### Templates
- **`auth/src/templates/day-one/program-template.html`** and **`logo.png`** — copied verbatim from the dayone repo. PDF output stays byte-equivalent (no redesign in scope).

### Config reuse — retire `clubs-config.json`
Use the portal's canonical `src/config/ghlLocations.js`:
```js
const { getLocationById } = require('../config/ghlLocations')
const club = getLocationById(req.body.location?.id)
// club => { id, apiKey, name, slug, clubCode }   (clubCode === ABC club number)
```
- GHL key: `club.apiKey` (from env, not committed).
- ABC club number: `club.clubCode`.
- `fromName`: derived (`West Coast Strength` for Salem-style names, else `West Coast Strength - {name}`), matching current behavior; `fromEmail` from env (`FROM_EMAIL`).
- If `getLocationById` returns null (unknown/disabled location), reject the webhook with a 400 and send an error notification (today it silently falls back to a default key — we make it explicit).

## Speed: parallel per-day generation

Replace the single big call with a fan-out, all sharing one client-context preamble built in `prompts.js`.

1. **Assign day focuses (no AI call):** for each of the N training days, focus = the trainer's `Day N Focus` field if filled, else `splits.js` default for `daysPerWeek`. This removes the need for any "planning" AI call.
2. **Fan-out (parallel, `Promise.all`):**
   - **N day-calls** — one per training day, each ~1.5–2K tokens, returning a single workout object `{ day, title, focus, exercises:[{name,sets,reps,notes,variations}] }`. Each is given its assigned focus + the shared client context + limitation/medical constraints.
   - **1 overview-call** — returns `{ basicExplanation, progressionNotes, principles, importantNotes }`.
   Each call uses the streamed-with-retry wrapper (mid-stream drop safety per PR #4).
3. **Terminology (1 final call, kept for relatability):** after the day-calls resolve, a small call generates the `terminology` glossary **seeded with the actual generated exercise names + notes**, so every defined term is one that truly appears in the program. This preserves the current "terminology must match content" guarantee that a naive parallel split would lose. (Justin's explicit requirement.)
4. **Assemble:** combine into the exact existing shape:
   ```json
   {
     "basicExplanation": "...", "progressionNotes": "...", "terminology": "...",
     "principles": "...", "importantNotes": "...",
     "weekTemplate": { "workouts": [ /* N workout objects, ordered by day */ ] }
   }
   ```
   Then attach `trainerName` and `medicalScreening` post-generation (as today, steps 3–4).

**Per-call `max_tokens`:** each day-call and the overview/terminology calls are small (~2–3K each), so the truncation risk that drove the 8000→16000 bump is gone per-call; we still assert `stop_reason !== 'max_tokens'` on each and fail loudly if any call truncates.

**Expected latency:** ~35s → ~10–14s wall-clock (slowest single call + the short terminology tail), since the N day-calls run concurrently instead of one sequential 10K-token generation.

**Failure semantics:** if any day-call or the overview-call fails after retries, the whole generation aborts (no partial program is emailed) and a trainer error notification is sent — same all-or-nothing guarantee as today.

## Speed: delivery & feedback (SSE)

- **One webhook only**, fired once at form submit — unchanged. GHL's entire involvement is (a) the submit webhook → `/day-one-program/webhook`, (b) the post-submit redirect → `/day-one-program/success?contactId={{contact.id}}`. No mid-form webhooks (confirmed not possible/needed).
- **`contact_id` in the redirect URL** (Justin confirmed GHL can add it) lets the success page key precisely on the contact — eliminating the `lastGeneratedPdf` race.
- **SSE instead of polling:** the success page opens `GET /day-one-program/status/stream?contactId=...`. The server emits the job's progress as it advances: `Planning → Day 1 ready → … → Day N ready → Building PDF → Emailing client → Done` (with the `/pdf/:jobId` download link on completion). Falls back gracefully to a "Program sent" message after a max wait if something stalls.
- **Fire-on-ready delivery:** PDF render → email → ABC upload begin the moment `program_json` is assembled (already sequential after generation; we keep email/ABC independently resilient).

## Data model (Supabase)

New migration `auth/migrations/0NN_pt_programs.sql` (next sequential number):

Table **`pt_programs`**:
| column | type | notes |
|---|---|---|
| `id` | uuid pk (default gen_random_uuid) | also the job id / pdf URL token |
| `contact_id` | text | GHL contact id (indexed) |
| `contact_name` | text | |
| `contact_email` | text | |
| `location_id` | text | GHL location id |
| `club_code` | text | ABC club number |
| `trainer_name` | text | |
| `abc_member_id` | text | nullable |
| `status` | text | `pending`/`generating`/`rendering`/`delivering`/`complete`/`error` |
| `progress` | text | human-readable current step (for SSE) |
| `program_json` | jsonb | assembled program |
| `pdf_path` | text | Supabase Storage object path |
| `emailed` | boolean default false | |
| `uploaded_abc` | boolean default false | |
| `error_message` | text | nullable |
| `created_at` | timestamptz default now() | |
| `updated_at` | timestamptz | |
| `completed_at` | timestamptz | nullable |

- Index on `(contact_id, created_at desc)` for the SSE "latest job for contact" lookup.
- **RLS enabled, no policy** (service-role-only access — per the portal's RLS convention; the frontend never touches this table directly).

**Storage:** private bucket **`pt-programs`** holding `{id}.pdf`. PDFs downloaded by streaming through `/day-one-program/pdf/:jobId` (the API reads from Storage with the service role). Optional cleanup job can prune old objects later (not required — Storage isn't ephemeral like the old disk cache).

## Environment variables

Reused (already in the portal env): `ANTHROPIC_API_KEY`, `PDFSHIFT_API_KEY`, GHL per-location keys, ABC `app_id`/`app_key`, Supabase service role, SendGrid key, `FROM_EMAIL`.
Possibly add: `DAY_ONE_ADMIN_EMAIL` (error notifications; default `justin@westcoaststrength.com`), `DAY_ONE_FROM_EMAIL` (or reuse `FROM_EMAIL`).

## Testing

- **`intake.test.js`** — field mapping from representative GHL webhook bodies (incl. array-valued limitation fields, alternate field-name fallbacks, missing fields).
- **`splits.test.js`** — default split table for 3/4/5/6 days; trainer `Day N Focus` override precedence.
- **`generate.test.js`** — mocked Anthropic client: asserts N+1 day/overview calls fire in parallel, the terminology call runs after and is seeded with generated content, and the assembled `program_json` matches the expected shape; asserts abort-on-failure.
- **`anthropic` retry** — unit test `isRetryableStreamError` classification (port existing logic + its intent).
- **Manual end-to-end** — one real test contact through the live webhook before cutover (per Justin's "don't simulate recurring server tasks locally" rule, the real validation is the live run).

## Cutover & decommission

1. Ship the route + services + migration behind the new URL (old service still live).
2. Run migration; create the `pt-programs` Storage bucket.
3. Manual end-to-end test on the portal URL with a test contact.
4. Repoint the GHL PT-Intake workflow: webhook → `wcs-auth-api.onrender.com/day-one-program/webhook`; redirect → `.../day-one-program/success?contactId={{contact.id}}`.
5. Verify a real submission end-to-end.
6. **Decommission** the old `dayone` Render service; archive the `justinhuttinger/dayone` repo. (Also a security win: the committed `pit-*` GHL keys leave production. Consider rotating those keys since they were in a git history.)

## Open questions / decisions captured
- **Terminology:** kept as a final seeded call (Justin: must stay relatable to content). ✅
- **Plan step:** removed; focuses come from form fields / default split table. ✅
- **Target:** wcs-staff-portal `auth/` backend. ✅
- **contact_id in redirect:** confirmed available. ✅
- **Security note:** rotate the GHL `pit-*` keys that were committed to the dayone repo (recommended, not strictly required for function).
