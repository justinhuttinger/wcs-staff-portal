# Day One program intake site

**Date:** 2026-08-24
**Status:** built

## What this is

`program.westcoaststrength.com` — a per-club intake site that starts a Day One
program. A trainer opens their club's slug on a gym tablet, works through the
intake with the client, and gets a finished PDF in about 20 seconds.

It replaces the GHL PT-Intake survey as the way a program begins. The generator
itself is untouched.

## Why

The GHL survey path had three problems this fixes:

1. **Fragile trigger.** A program depended on a workflow firing with correctly
   configured Custom Data. A misconfigured field silently produced the wrong
   branding (see PR #602).
2. **No branding control.** Brand came from a payload field a trainer could get
   wrong. Now it comes from the URL, resolved server-side.
3. **Cross-domain hand-off.** The trainer was redirected to `api.wcstrength.com`
   to watch progress. Now they stay on one domain.

## Architecture

Two pieces, one interface between them.

**The site** — `justinhuttinger/wcs-program-intake`, Vite + React, deployed as a
Cloudflare Workers static-assets Worker. Holds no secrets and talks only to the
portal's public Day One endpoints. SPA routing via
`assets.not_found_handling: single-page-application`; a Pages-style `_redirects`
file must never be added (breaks Workers asset deploys, error 100324).

**The portal** — one new router, `auth/src/routes/publicDayOne.js`, mounted at
`/public/day-one` alongside the existing public routers.

```
program.westcoaststrength.com/salem
  → POST /public/day-one/intake
      1. validate + normalize payload   (publicIntake.js)
      2. resolve slug → club            (getLocationBySlug)
      3. verify Turnstile
      4. GHL /contacts/upsert           → dedupes on email
      5. jobs.createJob + runPipeline   → the existing generator
  → 202 { jobId }
  → poll GET /public/day-one/status/:jobId
  → open GET /day-one-program/pdf/:jobId
```

### Endpoints

| Endpoint | Purpose | Limit |
|---|---|---|
| `GET /public/day-one/locations` | club list + each club's brand | 300 / 5 min |
| `POST /public/day-one/intake` | submit; returns `{ jobId }` | 12 / hour |
| `GET /public/day-one/status/:jobId` | progress | 300 / 5 min |

### Shared pipeline

`runPipeline` moved out of `routes/dayOneProgram.js` into
`services/dayOneProgram/pipeline.js`. Both entry points — the GHL webhook and
this site — call the same function, so generation, PDF, email, ABC upload,
`pt_programs` tracking, and the brand layer can never drift between them.

## Decisions

**Contact resolution is an upsert, not a search.** The requirement was "search
first, create if not found". GHL's `/contacts/upsert` does exactly that
server-side, matching on email. This matters for more than convenience: a public
endpoint that searched contacts by name would let anyone enumerate the CRM. The
upsert returns nothing to the browser, so there is no lookup surface at all.

**Brand comes from the slug.** `milwaukie` → ESAC, everything else → WCS, via
`brandForSlug` in `brands.js`. Never read from the request body — a caller
cannot ask for another club's branding, and a trainer cannot pick wrong.

**Status is keyed on the job UUID, not the contact id.** The existing SSE stream
keys on `contact_id`, which on a public origin would let anyone stream a job by
guessing a contact id. The public status endpoint takes the job UUID and returns
no client detail.

**Every field is treated as hostile.** `publicIntake.js` coerces types, drops
unknown keys, and caps free text at 1000 characters — that text lands in a
Claude prompt.

**Turnstile fails open.** If Cloudflare is unreachable the check passes with a
warning, because a Cloudflare outage must not stop the gyms from working. With
no secret configured verification is skipped entirely and logged at boot.

## Not doing

- **No auth.** Decided deliberately: trainers use shared tablets and a login
  wall costs more than it protects. Turnstile plus rate limiting is the defence.
- **No new generator.** The Worker calls the portal; it does not talk to Claude,
  PDFShift, or GHL directly.
- **GHL survey stays live** until the new path is proven, so both can run side
  by side.

## Testing

Unit tests cover validation and normalization (required fields, email shape,
free-text caps, days-per-week clamping, day-focus trimming, toggle coercion,
unknown-key dropping) and brand-by-slug. The site was driven end to end against
a local mock of all three endpoints, and every screen inspected in both brands.

## Operational steps

1. Set `DAY_ONE_TURNSTILE_SECRET` on `wcs-auth-api` (until then, bot
   verification is off and logs a boot warning).
2. Add the Turnstile site key to the site and mount the widget on the review
   step.
3. Point `program.westcoaststrength.com` at the `wcs-program-intake` Worker.
4. Connect the repo to Cloudflare Workers Builds for auto-deploy from `main`.
