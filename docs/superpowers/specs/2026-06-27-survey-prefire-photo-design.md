# Survey prefire + early photo + delete-on-complete (design spec)

**Date:** 2026-06-27
**Status:** approved, pending implementation
**Repo:** wcs-staff-portal (auth service + portal)
**Builds on:** the standalone Tour Check-In app (PRs #368–#373, `docs/tour-checkin-module.md`).

## Goal

Get a prospect into the Tour Check-In queue **faster** (speed-to-lead) by firing
the intake from the survey page in the browser **before** the GHL survey is
submitted, including the profile photo. Once a staffer records the tour outcome,
the existing outbound per-location webhook carries everything downstream and the
row is **deleted** — the iPad is a transient live queue, not a record store.

This is the deliberately minimal version. The earlier multi-session plan
(Supabase Storage, base64 photo migration, `submission_id`/`status=partial`
model, fbp/fbclid, reconciliation ceremony) is explicitly **out of scope** —
most of it would break the live iPad app, which keys on `status='ready'` and
renders `photo_base64`.

## Lifecycle

```
Browser prefire (survey step, early)  --> POST /webhooks/tour-intake        --> create 'ready' row (fast)
Browser photo  (survey step, early)   --> POST /webhooks/tour-intake-photo  --> attach photo to that row
GHL "Survey Submitted" webhook        --> POST /webhooks/tour-intake        --> merge into same row (email->phone)
Staffer finishes tour on iPad         --> PATCH /public/tour/:token/intake/:id --> fire outbound webhook, then DELETE row
```

All live rows are `status='ready'`. There is no Completed tab and no retained
completed rows; the outbound webhook (built in #370, `buildTourWebhookPayload`)
is the system of record on the way out. The webhook does **not** include the
photo (confirmed not needed downstream).

## Correlation / dedup

- Key: **normalized email** (lowercased, trimmed), fallback **digits-only phone**,
  within a **24h** window. (No `submission_id` column — email/phone covers the
  three requests, all of which carry email at survey step 5.)
- Upsert: find the most recent matching live row; if found, update; else insert.
- On update, **never** disturb `status`, `outcome`, `tour_member`, or `notes`
  (so a tour a staffer already touched is safe), and **never** overwrite a
  non-empty `photo_base64`.

## CORS (critical — browser POSTs currently fail with ERR_FAILED)

The auth service's global `cors()` (index.js) answers every `OPTIONS` preflight
itself and, for a non-portal origin, ends it 204 with **no** `Access-Control-Allow-Origin`.
So survey-origin CORS must be mounted **before** the global `cors()`.

- New middleware mounted before global `cors()` for `/webhooks/tour-intake` and
  `/webhooks/tour-intake-photo`.
- Allowlist (explicit, easy to extend): the 7 survey domains
  `https://wcssalem.app`, `wcskeizer.app`, `wcseugene.app`, `wcsspringfield.app`,
  `wcsclackamas.app`, `wcsmilwaukie.app`, `wcsmedford.app`.
- Echo the matched origin into `Access-Control-Allow-Origin` (no `*` — a secret
  rides in the URL), set `Vary: Origin`, allow methods `POST, OPTIONS`, header
  `Content-Type`.
- Answer `OPTIONS` with **204 immediately**, before the `?secret=` check (the
  preflight carries no secret).

## Body parsers

`auth/src/index.js` already registers `express.json({ limit: '6mb' })` for
`/webhooks/tour-intake` (which also prefix-matches `-photo`). Register a
`10mb` JSON parser for `/webhooks/tour-intake-photo` **before** the 6mb line so
the larger photo body parses (first matching parser consumes the stream).

## Endpoints (auth service)

### `POST /webhooks/tour-intake` (modified)
Handles both the browser prefire and the GHL submit (same handler).
- Resolve location: `body.location.id` -> `locations.ghl_location_id` (GHL submit),
  else map the **request Origin** domain -> slug -> `locations` (browser prefire).
- Resolve `name/email/phone` from the flat payload (existing `pickKey`), GHL
  contact fallback unchanged.
- Photo from `Member Profile Photo` (existing), used only if present.
- **Upsert by email->phone** (see Correlation). Insert -> `status='ready'` with a
  `// TODO: speed-to-lead first-touch (Twilio/GHL)` hook. Update -> fill
  `contact_name/email/phone`, `ghl_contact_id`, `location_id` if null, and
  `photo_base64` only if currently empty; leave status/outcome/tour_member/notes.
- Keep `verifyWebhookSecret` (`?secret=`) on POST; CORS/preflight handled earlier.

### `POST /webhooks/tour-intake-photo` (new)
Browser photo: `{ email, phone, photo_base64, ... }` (tolerant of variants).
- `verifyWebhookSecret`, survey CORS, 10mb body.
- Normalize the base64 to a data URL (reuse the existing `normalizePhoto`).
- Find the live row by email->phone (24h); if none, insert a minimal `status='ready'`
  row (so the later text/submit merges in by email). Set `photo_base64` only if
  currently empty (never overwrite). Resolve location from Origin when inserting.

## Portal changes (iPad app)

- **`auth/src/routes/publicTour.js` GET `/public/tour/:token`**: return only the
  `ready` list; drop the `completed` query (and `completed` from the response).
- **`auth/src/routes/publicTour.js` PATCH `/public/tour/:token/intake/:id`**:
  after firing the outbound webhook, **delete** the row instead of setting
  `status='completed'`. (Keep the location-ownership check before mutating.)
- **`portal/src/tour/TourCheckinApp.jsx`**: remove the Completed tab and its
  state; show only the live queue. Remove `readOnly`/completed handling.

## Database

- No schema change. The dedup lookup matches email case-insensitively with
  `ILIKE`; delete-on-complete keeps `tour_intakes` small (only the live queue),
  so the per-webhook lookup is a cheap scan and needs no index. No new columns;
  no status-model change.

## Gates (defense-in-depth, not strong auth — by necessity)

The `?secret=` (`TOUR_INTAKE_SECRET` / existing `GHL_WEBHOOK_SECRET` via
`verifyWebhookSecret`) is client-visible because it ships in the survey page, so
it plus the origin allowlist are layered checks, not real authentication. Noted
in code comments.

## Out of scope

- Supabase Storage for photos (base64 column retained; rows are short-lived).
- `submission_id`, `status='partial'`, fbp/fbclid, prefire_at/submitted_at columns.
- The survey-page client script that fires these POSTs (separate work).
- Including the photo in the outbound webhook.

## Verification

- `node -e require()` load checks for the routers; portal `npm run build`.
- The dedup/upsert is the riskiest logic — reason through prefire-before-photo,
  photo-before-text, and GHL-submit-after-staff-completed (must not resurrect a
  deleted/processed row) during review.
