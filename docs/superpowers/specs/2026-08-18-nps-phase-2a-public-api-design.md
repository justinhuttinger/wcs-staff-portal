# NPS Phase 2a — Public API + Manual Fire — Design

Addendum to `2026-08-18-nps-system-design.md`. Phase 1 (schema + nightly cohort
job) shipped in #558. This covers the unauthenticated survey API that the
renderer will call, and an authenticated manual-fire tool for testing.

The Worker (`wcs-survey-renderer`, sub-project 2b) and the admin UI
(sub-project 3) are NOT in this design. 2a gates 2b; nothing gates 3.

## Purpose

Two things become possible that are impossible today:

1. A tokenised survey link actually resolves to something. Today
   `nps_invites.token` is generated and stored but nothing serves it.
2. A named test subject can be pushed through a chosen survey on demand, end to
   end including the GHL workflow, without waiting for the nightly job or
   hand-writing SQL.

## Corrections to the parent spec

**CORS.** The parent spec says to mount `/public/nps` CORS in the path-scoped
block beside `/public/group-x` and `/public/facility`. That is the wrong
precedent. Those two are `origin: '*'` because they are embedded on
westcoaststrength.com and loaded by in-gym TVs. The right precedent is the forms
renderer: `https://forms.westcoaststrength.com` sits in `ALLOWED_ORIGINS`
(`auth/src/index.js:17`) and `/public/forms` mounts normally at line 146 under
the global CORS.

Follow forms. Add `https://survey.westcoaststrength.com` to `ALLOWED_ORIGINS`
and mount `/public/nps` normally. Allowlisting our own domain is tighter than a
wildcard, and the ordering hazard the parent spec warns about does not apply to
a path-scoped mount that comes after the global one.

## Metric vocabulary

Confirmed with Justin, 2026-08-18. Seeded by migration 109:

| `key` | `label` |
| --- | --- |
| `nps` | Likelihood to recommend |
| `cleanliness` | Cleanliness of the gym |
| `staff_positivity` | Staff friendliness and helpfulness |
| `equipment` | Equipment condition and availability |
| `value` | Value for money |

Deliberately small. Five metrics with full history beat twelve each answered by
a fraction of people. Adding a metric later is free; removing one is not.

**Cancellation surveys do not get their own metrics.** They ask the same rating
questions, and the report segments by survey instead. That is what makes "what
do cancelling members think versus six-month members" a filter rather than a
separate schema. A cancel-reason question is a `select`, which lands in
`nps_responses.answers` and never enters `nps_response_scores`, so it stays out
of the cross-survey rollups.

## Migration 109

### Metric seed

Insert the five rows above, `on conflict (key) do nothing` so a re-apply is
safe.

### Test isolation

Add `is_test boolean not null default false` to `nps_invites`, `nps_responses`,
and `nps_response_scores`.

It goes on the scores table too, denormalised alongside the `club_number`,
`source` and `submitted_at` already there for the same reason: the report reads
that table directly, and excluding test rows must stay a single indexed scan
with no join back to invites.

### The idempotency index becomes partial

```sql
drop index if exists nps_invites_survey_member_date_idx;
create unique index nps_invites_survey_member_date_idx
  on nps_invites (survey_id, member_id, trigger_date)
  where not is_test;
```

This is what lets manual fire repeat. Real invites keep the guarantee that a
rerun, an overlapping cron tick or a replayed back-window cannot double-send.
Test rows are exempt **by construction**, not by a code path that has to
remember to skip the check, which is the version that rots.

### Report filter index

```sql
create index if not exists nps_response_scores_survey_metric_time_idx
  on nps_response_scores (survey_id, metric_key, submitted_at desc);
```

Serves the by-survey segmentation. The existing
`(metric_key, club_number, submitted_at desc)` index serves the by-club view
and stays.

## `auth/src/services/npsSchema.js`

Mirrors `formsSchema.js`: a single-point type registry, an id format check, a
duplicate-id check, and a per-type rules pass. Question types are `rating`,
`nps`, `textarea`, `short_text`, `select`, `header`, `description`.

Exports `validateSchema(schema, { metricKeys })` and
`validateSubmission(schema, answers)`.

The NPS-specific rule: every `rating` and `nps` question must carry a
`metric_key` present and `active` in `nps_metrics`. This runs on write, not on
render. It is the only thing standing between the system and a silent metric
split, and a split is invisible in the report by definition — you cannot see the
rows that went to the wrong key.

`validateSubmission` returns `{ ok, errors, cleaned, scores }`, where `scores`
is the flattened `nps_response_scores` rows for the rating and nps answers, so
the route never re-walks the schema to build them.

## `auth/src/routes/publicNps.js`

Unauthenticated, mounted at `/public/nps`, gated entirely by token or QR key,
rate limited with `express-rate-limit` v8 (`limit`, not the deprecated `max`)
exactly as `publicForms.js` does.

### `GET /public/nps/:slug?t={token}`

Resolves the invite by token. Returns
`{ survey: { slug, title, intro, schema }, member: { first_name, club_number } }`
and stamps `opened_at` if not already set.

404 on: unknown token, a token whose survey slug does not match the path,
`expires_at` in the past, or `status = 'responded'`.

The body carries a `reason` only for a token that resolved but is expired or
already answered. An unknown token returns the same status with no reason.
Distinguishing "expired" from "never existed" would tell a probing caller which
tokens are real.

### `GET /public/nps/:slug?k={qr_key}`

Walk-up. Resolves `nps_club_qr` by key where `active`. Same payload with no
`member` object. 404 on unknown or inactive key.

### `POST /public/nps/:slug/submit`

Body `{ t | k, answers }`. Validates against the schema, then writes the
response row and its score rows together. On the invited path it burns the
token: sets `nps_invites.status = 'responded'` and `responded_at`.

`is_test` propagates from the invite to the response and to every score row, so
a manual fire's answers stay out of the report all the way down.

Walk-up abuse controls, per the parent spec: a hashed-IP rate limit and a
per-QR-key hourly cap. Tuned to stop idle repeat-submitting, not to trip on a
busy Saturday.

### `?s={score}` pre-answer

The invite email renders the primary question's buttons inline; clicking one
opens `/{slug}?t={token}&s={score}`. The GET records that score against the
survey's first `nps`-typed question and returns the remaining questions.

This is typically the difference between roughly 5% and 15% completion versus a
bare "click here to take our survey" link, which is why it is in 2a rather than
deferred.

## `auth/src/routes/nps.js` — manual fire

Authenticated (`middleware/auth`) and admin-gated (`middleware/role`), in the
private router, not the public one.

### `POST /nps/test-fire`

Body `{ slug, member_id, force }`.

Deliberately does **not** call `selectCohort`. Cohort selection is exactly what
is being bypassed: you have already chosen the member.

It builds the invite with the shared `buildInvite`, then performs the GHL write
with `auth`'s own client, in the field-before-tag order (see *Sharing code
across services* below for why the write is not shared and what pins it).

With `force: true`:

- the cooldown lookup is skipped entirely
- `is_test: true` is written, which the partial index lets through however many
  times it is fired
- `dry_run: false`, so the custom field and tag are really written and a real
  email really sends

Rails off is the point. This is the only way to verify the GHL workflow itself,
which is the component most likely to be misconfigured and the one no amount of
unit testing reaches.

Returns `{ invite, contact, url, ghl: { tagged, errors } }`. A wrong `ghl_tag`
or `ghl_field_key` surfaces in the response body rather than in a log someone
has to go find.

Every call writes to `audit_log` via
`services/auditLog.record(staffId, 'nps_test_fire', { ... })` with the target
member and survey.

### Sharing code across services

`ghl-sync` and `auth` are separate Render deploys with separate `package.json`
files, so what `auth` can borrow from `ghl-sync` is limited by dependencies, not
by paths. Render clones the whole repo and only sets the working directory, so a
relative require resolves; it is the `node_modules` that does not.

Split accordingly:

- **`buildInvite` and `surveyUrl` are shared.** `ghl-sync/src/nps/npsInvites.js`
  imports nothing but `node:crypto`, so `auth` can require it directly with no
  dependency coupling. Token generation and row shape must not fork: two
  implementations of a security token is how one of them ends up predictable.
- **`applyGhlForInvites` is NOT shared.** It drags in `ghl-sync`'s axios client,
  its rate limiter, and its `config/locations.js`. `auth` already has the
  equivalents: `services/ghlClient.js` (`ghlFetch`) and `config/ghlLocations.js`.
  Manual fire uses those.

The drift risk is therefore narrowed to one invariant: **custom field before
tag.** `auth`'s own test pins the ordering, the same way
`npsJob.test.js` pins it on the `ghl-sync` side. Both tests must fail if either
implementation flips.

**Trap.** The two location configs disagree on a field name:
`ghl-sync/src/config/locations.js` uses `clubNumber`, `auth/src/config/ghlLocations.js`
uses `clubCode`. They are otherwise the same seven clubs. Reading the wrong one
yields `undefined`, matches no location, and the invite silently records "no GHL
location configured" rather than failing loudly.

## Testing

`node:test` + `node:assert`, CommonJS, run with `node --test`, following the
Phase 1 modules. Fake `db` in the style of `npsJob.test.js`.

- `npsSchema.test.js` — type registry, duplicate ids, and the metric_key rule
  rejecting a key that is missing or inactive.
- `publicNps.test.js` — token resolution including the expired,
  already-answered and slug-mismatch branches; QR resolution including
  inactive; submit writing the response plus score rows and burning the token;
  `is_test` propagating from invite through to scores.
- `npsTestFire.test.js` — `force` bypasses the cooldown; a non-forced call still
  respects it; a second forced fire on the same member and day succeeds where a
  real invite would be rejected.

## Not in this design

The Worker and `survey.westcoaststrength.com` (2b), the admin UI (3), the report
(later), and walk-up QR key generation (Phase 5). Manual fire gets no UI here;
it is an endpoint until the admin UI wraps it.
