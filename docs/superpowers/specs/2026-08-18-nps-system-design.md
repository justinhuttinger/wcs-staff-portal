# NPS / Member Feedback System — Design

**Date:** 2026-08-18
**Status:** Approved for implementation planning

## Purpose

Collect structured member feedback at defined lifecycle moments (day 30, tenure
anniversaries, cancellation) and from walk-up QR posters in each club, store it
in Supabase, and report on it by club, metric, and period.

Two ways in:

1. **Invited** — a nightly job finds members who hit a lifecycle milestone, tags
   them in GHL, and a GHL workflow emails them a personal survey link.
2. **Walk-up** — a QR poster in each club opens the same survey engine with no
   invite, no member identity, and no GHL involvement.

Both write to the same tables and feed the same report, tagged by source.

## Scope

**In scope**

- `nps_*` tables in the portal Supabase project (`ybopxxydsuwlbwxiuzve`).
- A nightly cohort job in `ghl-sync` that creates invites and applies GHL tags.
- A public, unauthenticated API on the auth service for reading a survey and
  submitting a response.
- A new Cloudflare Worker at `survey.westcoaststrength.com` that renders surveys.
- A portal admin UI to define surveys, questions, metrics, and trigger rules.
- A portal report over the collected scores.

**Out of scope for v1**

- Alerting or auto-follow-up on low scores. Reporting only. Alerting is a
  follow-on PR once response rates are known to be real.
- Writing scores back to GHL custom fields.
- SMS delivery. Email only.
- Per-location question variants. One question set per survey, all clubs.

## Key decisions

| Decision | Choice | Why |
| --- | --- | --- |
| Survey host | Cloudflare Worker, `survey.westcoaststrength.com` | Matches `wcs-forms-renderer`; assets-only, holds no secrets |
| Send mechanism | Job tags GHL contact, GHL workflow sends | Marketing edits email copy without a deploy; deliverability stays on GHL |
| Identity | Identified for invited, anonymous for walk-up | Enables tenure/club/churn cross-reference on the invited path |
| Trigger rules | Data on the survey row, not code | Adding a 3-year survey is a config action, not a deploy |
| Score storage | Typed rows in `nps_response_scores` | Cross-survey metric rollups stay a simple indexed query |
| v1 follow-up | Reporting only | Prove the pipeline and response rate before wiring actions |

## Existing building blocks

Nothing here is greenfield. Each piece has a working analog in the repo.

| New piece | Modeled on |
| --- | --- |
| Cohort job | `ghl-sync/src/abc/referralRewards.js` + `src/scheduler.js` run-locks |
| Public token-gated route | `auth/src/routes/publicTour.js` |
| Schema validator | `auth/src/services/formsSchema.js` |
| Public survey API | `auth/src/routes/publicForms.js` |
| Worker renderer | `wcs-forms-renderer` (assets-only Worker, Vite + React, SPA fallback) |
| Poster PDF | Existing PDFShift integration |

## Source data

`abc_members` (~100k rows) already carries every field the trigger rules need.
No new sync work.

| Column | Use |
| --- | --- |
| `email` | Delivery address; rows without one are skipped |
| `begin_date` | Tenure triggers (day 30, 6mo, 1yr, 2yr) |
| `member_status`, `member_status_date` | Cancel trigger; Cancelled rows are retained, not deleted |
| `club_number` | Report grouping, GHL location routing |
| `is_active` | Excludes cancelled members from tenure surveys |

**Observed volumes** (2026-08-17, members with an email): 39 new joins,
16 cancels, 28 six-month anniversaries, 11 one-year, 12 at day 30. Roughly
50-100 sends per day across all surveys. No batching or throttling needed
beyond the existing GHL rate limiter.

**Known coverage gap:** 17,782 of 21,096 active members have an email address.
About 16% of the active base is unreachable by the invited path regardless of
design. The walk-up QR partially covers this group.

## Data model

Migration `108_nps_system.sql`. Every table gets RLS enabled with no policy —
the portal DB is service-role only.

### `nps_surveys`

The config space. One row per survey; the trigger rule lives here as data.

| Column | Type | Notes |
| --- | --- | --- |
| `id` | uuid pk | |
| `slug` | text unique | URL path: `survey.westcoaststrength.com/{slug}` |
| `title`, `intro` | text | Shown at the top of the rendered survey |
| `schema` | jsonb | Ordered question list, see below |
| `status` | text | `draft` \| `active` \| `paused` |
| `trigger_type` | text | `tenure_days` \| `tenure_months` \| `status_change` \| `walkup` |
| `trigger_value` | int | 30, 6, 12, 24; null for `status_change` and `walkup` |
| `trigger_status` | text | e.g. `Cancelled`; only for `status_change` |
| `audience_filter` | jsonb | Optional narrowing (club numbers, membership types) |
| `send_window_days` | int | Back-window so a missed night self-heals; default 3 |
| `resend_cooldown_days` | int | Global per-member suppression; default 60 |
| `ghl_tag` | text | Tag the job applies to fire the GHL workflow |
| `ghl_field_key` | text | GHL custom field that carries the survey URL |
| `expires_days` | int | Invite token lifetime; default 30 |
| `created_at`, `updated_at` | timestamptz | |

`trigger_type = 'walkup'` means the cohort job skips this row entirely: no
invites, no tags, no GHL. It is reachable only by QR.

### Question schema

`nps_surveys.schema` is a jsonb array. Field types: `rating`, `nps`,
`textarea`, `short_text`, `select`, `header`, `description`.

```json
[
  {"id":"q_clean","type":"rating","label":"How clean is the gym?","min":1,"max":10,"metric_key":"cleanliness","required":true},
  {"id":"q_staff","type":"rating","label":"How positive is our staff?","min":1,"max":10,"metric_key":"staff_positivity","required":true},
  {"id":"q_nps","type":"nps","label":"How likely are you to recommend us?","metric_key":"nps","required":true},
  {"id":"q_why","type":"textarea","label":"Anything else you want us to know?"}
]
```

Validated by `auth/src/services/npsSchema.js`, built on the `formsSchema.js`
pattern: a single-point type registry, id format check, duplicate-id check, and
a per-type rules pass. `rating` and `nps` fields must carry a `metric_key` that
exists and is active in `nps_metrics`.

### `nps_metrics`

`key`, `label`, `description`, `active`. Admin-managed lookup.

This table exists to keep `metric_key` a picked value rather than free text.
`cleanliness` in the 6-month survey and `cleanliness` in the 2-year survey must
be the same string to roll up together; a typo would silently split one metric
into two half-populated ones, and the split would not be visible in the report.

### `nps_invites`

One row per member per send. Invited path only.

| Column | Type | Notes |
| --- | --- | --- |
| `id` | uuid pk | |
| `survey_id` | uuid fk | |
| `token` | text unique, indexed | Unguessable; the only access credential |
| `member_id`, `club_number`, `ghl_contact_id` | text | |
| `member_email`, `member_name`, `tenure_days` | snapshot | Member may cancel or change before answering |
| `trigger_date` | date | Date the rule matched |
| `sent_at`, `ghl_tag_applied_at`, `ghl_error` | | |
| `opened_at`, `responded_at`, `expires_at` | timestamptz | |
| `status` | text | `pending` \| `sent` \| `opened` \| `responded` \| `failed` \| `expired` |

**`unique (survey_id, member_id, trigger_date)`** is the idempotency guard. A
job rerun, an overlapping cron tick, or a replayed back-window cannot produce a
second invite for the same member and milestone.

### `nps_responses`

| Column | Type | Notes |
| --- | --- | --- |
| `id` | uuid pk | |
| `invite_id` | uuid fk, unique, **nullable** | Null for walk-up |
| `survey_id` | uuid fk | |
| `member_id` | text, **nullable** | Null for walk-up |
| `club_number` | text | From the invite, or from the QR key |
| `source` | text | `invited` \| `walkup` |
| `nps_score` | int nullable | Denormalized from the `nps` field for report speed |
| `answers` | jsonb | Every answer, verbatim, including comments and open text |
| `contact_name`, `contact_email` | text nullable | Optional walk-up capture |
| `submitted_at` | timestamptz | |
| `ip_hash`, `user_agent` | text | Abuse control only |

Postgres permits many NULLs under a unique constraint, so `invite_id` staying
unique still guarantees one response per invite while allowing unlimited
walk-up rows.

### `nps_response_scores`

One row per rating answer. This is the table the report reads.

`id`, `response_id` fk, `survey_id`, `metric_key`, `score` int,
`club_number`, `source`, `submitted_at`.

Indexed on `(metric_key, club_number, submitted_at)`.

Denormalizing `club_number`, `source`, and `submitted_at` onto this table is
deliberate: it keeps every report query a single indexed scan with no joins,
and these values are immutable once a response is submitted.

### `nps_club_qr`

`id`, `club_number`, `key` (opaque, unique, indexed), `survey_id`, `active`,
`created_at`, `rotated_at`.

One row per club per walk-up survey. The QR encodes
`survey.westcoaststrength.com/{slug}?k={key}`. An opaque key rather than the
raw club number prevents someone editing the URL and dumping one club's scores
onto another's report. Rotation exists because posters hang in public and a
photographed URL cannot be un-shared.

## Components

### 1. Cohort job — `ghl-sync/src/nps/`

Nightly, ~7am Pacific, added to `src/scheduler.js` with the same run-lock
pattern as the existing cron entries and the same `alerts.js` failure path.

Per active, non-walkup survey:

1. Translate the trigger rule to a query over `abc_members`, across the
   `send_window_days` back-window:
   - `tenure_days = 30` → `begin_date = target - 30 AND is_active`
   - `tenure_months = 6` → `begin_date = (target - interval '6 months')::date AND is_active`
   - `status_change` → `member_status = trigger_status AND member_status_date = target`
2. Drop members with no email, and members with any invite inside
   `resend_cooldown_days`.
3. Insert invites; the unique constraint absorbs anything already sent.
4. For each new invite: write the survey URL to the GHL custom field, then add
   the tag. Field before tag — the workflow fires on the tag and must not read
   an empty URL field.
5. Record per-invite success or `ghl_error`; one failure never aborts the run.

A `NPS_DRY_RUN=1` env flag creates invites and skips all GHL writes. This is
how phase 1 ships.

### 2. Public API — `auth/src/routes/publicNps.js`

Unauthenticated, mounted before the auth middleware, gated entirely by token or
QR key. Rate limited like the forms endpoints.

- `GET /public/nps/:slug?t={token}` — returns title, intro, questions, member
  first name, club. Stamps `opened_at`. 404 on unknown, expired, or already-used
  token.
- `GET /public/nps/:slug?k={qr_key}` — walk-up mode. Returns the same payload
  with no member fields. 404 on unknown or inactive key.
- `POST /public/nps/:slug/submit` — body `{ t | k, answers }`. Validates against
  the schema, writes the response and its score rows together, and for the
  invited path burns the token and sets `responded_at`.

**CORS mount order matters.** `auth/src/index.js` mounts path-scoped CORS for
`/public/group-x` and `/public/facility` at lines 26-27, *before* the global
`app.use(cors({...}))` at line 29. The `/public/nps` CORS middleware must be
mounted in that same block. A no-path CORS middleware mounted after the global
one would swallow OPTIONS for every URL in the API.

### 3. Worker — new repo `wcs-survey-renderer`

Forked from `wcs-forms-renderer`. Assets-only Cloudflare Worker with
`not_found_handling: "single-page-application"` so `/6mo?t=...` resolves to the
SPA. Custom domain `survey.westcoaststrength.com`. Vite + React, plain CSS.

Holds **no secrets**. All database access stays behind the auth API, which is
what keeps the Supabase service-role key out of Cloudflare.

Rendering notes:

- `rating` and `nps` render as tappable numbered chips, sized for thumbs.
  Nearly every open will be on a phone.
- One question group per screen on narrow viewports; a progress indicator.
- Distinct states for expired token, already-submitted, and thank-you.

**The email carries the first score.** The invite email renders the primary
question's buttons inline; clicking one opens
`/{slug}?t={token}&s={score}`, which pre-records that score and drops the
member straight into the remaining questions. This one detail is typically the
difference between a ~5% and a ~15% completion rate versus a bare
"click here to take our survey" link.

### 4. Walk-up abuse control

There is no token to burn, so the invited path's one-shot guarantee does not
apply. Controls:

- Rate limit by hashed IP: a small number of submissions per hour.
- Per-QR-key hourly cap.
- Optional `contact_name` / `contact_email` fields at the end. Left blank the
  response stays anonymous; filled in, a detractor becomes someone a manager can
  call.

Tuned to stop idle repeat-submitting, not to trip on a busy Saturday.

### 5. Admin UI — `portal/src/components/nps/`

Survey list, question builder, metric management, trigger configuration
(type + value + audience), activate/pause, preview link, per-club QR generation
and poster download.

This is the config space the whole design turns on: adding a 3-year survey, or
a new rating metric, is filling in this form. Never a deploy.

### 6. Report

Registered in the report catalog and `defaultReportKeysForRole`. Access is
gated by `requireReportAccess` tier, not the roles grid.

Views:

- NPS by club and period, with trend.
- Per-metric averages by club, with trend.
- Response rate per survey (invites sent, opened, responded).
- Comment feed, filterable by club, survey, and score band.
- Cancel-reason breakdown from the exit survey.

**Invited and walk-up responses are separated by default**, with an explicit
toggle to combine. Walk-up responses are self-selected and skew to the extremes:
the member who just had a great session, or the one who just found a rack
broken. Invited responses are a roughly random cohort sample. Blending them
silently means company NPS moves when a poster gets hung nearer the door, and
someone spends a month chasing a trend that is an artifact of poster placement.
Both are useful; they answer different questions.

Per existing convention, clubs and metrics with no data are omitted from the
report entirely rather than shown as an empty row.

## GHL configuration

Per survey: one tag and one custom field holding the URL. A GHL workflow
triggers on the tag and sends the email.

**This is the main ongoing operational cost.** A workflow per survey per
location is 5 × 7 = 35 workflows to build and maintain, and every copy change
becomes 7 edits. Recommendation: start with **one shared workflow per survey**
(5 total) and split to per-location only where a club genuinely needs different
copy. The tag and field design is identical either way, so splitting later costs
nothing structurally.

## Testing

Following the repo convention of `*.test.js` beside the file:

- `npsSchema.test.js` — schema validation and submission validation, including
  rating bounds, unknown keys, and missing required fields.
- `npsTriggers.test.js` — trigger rule to date-set translation for every
  `trigger_type`, including the back-window and leap-year anniversaries.
- `npsCohort.test.js` — cohort selection with injected dependencies, mirroring
  the `referralRewards.js` testable-by-injection structure. Covers cooldown
  suppression, missing email, and idempotency on rerun.

## Rollout

Each phase is its own PR off master.

1. **Migration + cohort job in dry-run.** Creates invites, applies no GHL tags,
   sends nothing. Verify the cohorts match expectations against live data before
   a single email exists.
2. **Public API + Worker.** Tested against hand-created tokens.
3. **Admin UI + report.**
4. **Go live gradually.** Enable the 6-month survey at one club, confirm
   delivery and response rate, then fan out to the remaining clubs and surveys.
5. **Walk-up QR.** Generate posters once the engine is proven on the invited
   path.

Migration `108_nps_system.sql` is applied to production by hand at merge time —
this repo has no migration runner.

## Open items

- GHL custom field keys and tag names per survey need to be created in GHL
  before phase 4; the field key is stored on the survey row.
- Poster design for the QR (copy, layout, sizing) is a marketing task, not a
  code task.
