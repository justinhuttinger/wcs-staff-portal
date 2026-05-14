# Website Submissions report — design

**Date:** 2026-05-14
**Author:** Justin Huttinger (w/ Claude)
**Status:** Approved

## Problem

The WCS website hosts a growing number of lead-capture forms (Swim Sign-Up, Membership inquiry, etc.). Each form needs to be visible to corporate/admin in one place so submissions can be triaged and trends watched. Today the submissions go nowhere queryable.

## Goal

Add a single webhook the website can POST every form submission to, persist each submission in Postgres, and surface a "Website Submissions" report under the Marketing group of the portal, filterable by **form name**, **location**, and **date range**.

## Non-goals

- No alerting / no-reply / lead-routing. Out of scope for v1.
- No idempotency or dedup. Duplicate submissions are real events worth recording.
- No mutation UI. Read-only report.
- No editing of form metadata. Forms auto-register the first time they're seen.

## Webhook contract

### URL

```
POST https://wcs-auth-api.onrender.com/webhooks/website-form?secret=<WEBSITE_FORM_WEBHOOK_SECRET>
```

The secret travels in the query string (not a header) because the website uses native HTML forms, and HTML forms can't set custom headers. The secret value is generated once and stored as `WEBSITE_FORM_WEBHOOK_SECRET` on Render.

### Headers

- `Content-Type: application/x-www-form-urlencoded` (default for HTML forms — nothing special required on the website side).

### Body

A standard URL-encoded form body. Sample (as captured from a real submission):

```
First+Name=Justin&Last+Name=Huttinger&Email=justinhuttinger1%40gmal.com&Phone=4259549854&Message=test&Opt+In+for+Messaging=on&No+Label+field_5f3533b=&form_id=3bf9439a&form_name=Springfield+-+Swim+Sign+Up
```

Field-name normalization for extraction:
- `First Name` → `first_name`
- `Last Name` → `last_name`
- `Email` → `email`
- `Phone` → `phone`
- `Message` → `message`
- `Opt In for Messaging` → `opt_in` (boolean: `'on'` → `true`, missing/empty → `false`)
- `form_id` → `form_id`
- `form_name` → `form_name`
- Anything else (including `No Label field_*` dynamic fields) — preserved verbatim inside the `raw` JSONB column. Nothing is dropped.

### Responses

| Status | When |
|---|---|
| `200 {success: true, id: <uuid>}` | Persisted. |
| `400 {error: 'empty body'}` | Body parsed to an empty object. |
| `401 {error: 'invalid secret'}` | `?secret` missing or wrong. Don't echo the provided value. |
| `500 {error: 'persist failed'}` | DB error. Logged with `form_id` for forensics. |

## Location parser

All website forms will use the convention **`{Location} - {Form-specific name}`** in `form_name`. Example: `Springfield - Swim Sign Up`.

The parser checks whether `form_name` begins (case-insensitively) with any known WCS location:

```
Salem | Keizer | Eugene | Springfield | Clackamas | Milwaukie | Medford
```

If matched, the matched canonical-cased location is stored in the `location` column. If not matched (legacy forms, typos), `location` is `null` and the row still persists — it just appears under "Unknown" in the report's location filter.

The parser does **not** strip the location from the displayed `form_name`. The full string is preserved as-is for clarity in the UI. If you later want a clean "form title" without the location prefix, that's a trivial derived field in the SQL view, but is not included in v1.

## Database schema

Migration: `auth/migrations/021_website_submissions.sql`

```sql
CREATE TABLE website_submissions (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  received_at   timestamptz NOT NULL DEFAULT now(),
  form_id       text,
  form_name     text,
  location      text,            -- parsed from form_name prefix; null if no match
  first_name    text,
  last_name     text,
  email         text,
  phone         text,
  message       text,
  opt_in        boolean,
  raw           jsonb NOT NULL   -- full URL-decoded body, every field as-submitted
);
CREATE INDEX idx_website_submissions_received  ON website_submissions(received_at DESC);
CREATE INDEX idx_website_submissions_form_name ON website_submissions(form_name, received_at DESC);
CREATE INDEX idx_website_submissions_location  ON website_submissions(location, received_at DESC);
```

Rationale (hybrid shape):
- The well-known fields are queryable/indexable without JSONB extracts — keeps the report fast.
- `raw` preserves every dynamic "No Label" field the website may add later without a migration.
- No idempotency column. Duplicate posts are real (members really do submit twice). Add if/when needed.

## Backend components

### `auth/src/services/websiteFormParser.js` (new)

Pure-function module — no I/O, easy to unit test.

```
parseWebsiteFormBody(parsedBody) -> {
  form_id, form_name, first_name, last_name, email, phone, message,
  opt_in, location, raw
}
```

- Accepts an already URL-decoded object (express handles decoding via `urlencoded()`).
- Maps known field names (case-insensitive lookup, since HTML forms can preserve case).
- Coerces `opt_in`: `'on'` → `true`, `'true'`/`true` → `true`, everything else → `false`.
- Calls `parseLocation(form_name)` which returns the canonical location string or `null`.
- Returns the entire input as `raw` (passes through verbatim — useful for forensics and the future "show full payload" expander).

### `auth/src/routes/webhooks.js` (modify)

Add a new handler:

```js
router.post(
  '/website-form',
  express.urlencoded({ extended: true, limit: '64kb' }),
  async (req, res) => { ... }
)
```

Per-route `urlencoded` middleware — the rest of `/webhooks/*` stays JSON-only. Steps:
1. Verify `req.query.secret === process.env.WEBSITE_FORM_WEBHOOK_SECRET`. If not, `401`.
2. If `Object.keys(req.body).length === 0`, `400`.
3. Call `parseWebsiteFormBody(req.body)`.
4. `INSERT INTO website_submissions (...)`.
5. Return `200 {success: true, id}`.

### `auth/src/routes/websiteSubmissions.js` (new file)

Mounted at `/reports/website-submissions` in `auth/src/index.js`. Both endpoints below are gated to `corporate` or `admin` (see "Role access" section).

- `GET /` — list rows.
  - Query params: `form_name`, `location`, `start` (ISO date), `end` (ISO date, exclusive), `limit` (default 500, max 2000).
  - Returns `{ rows, total }`.
- `GET /filter-options` — distinct values for dropdowns.
  - Returns `{ form_names: [...], locations: [...] }` ordered alphabetically.

### `auth/src/index.js` (modify)

```js
app.use('/reports/website-submissions', require('./routes/websiteSubmissions'))
```

## Role access

Visible to **corporate** and **admin** only (per Justin: "corp and admin").

The existing `requireRole('corporate')` middleware admits `corporate`, `marketing`, and `admin` (via the hierarchy in `auth/src/middleware/role.js`). Since Justin's preference excludes `marketing`, the new route uses an explicit allowlist check instead:

```js
function requireCorporateOrAdmin(req, res, next) {
  const role = resolveRole(req.staff.role) // 'director' aliases to 'corporate'
  if (role === 'corporate' || role === 'admin') return next()
  return res.status(403).json({ error: 'forbidden' })
}
```

If `resolveRole` isn't already exported from `middleware/role.js`, the implementation plan will export it (one-line change, used elsewhere already as part of `requireRole`).

UI tile visibility mirrors API gating.

## Frontend

### `portal/src/lib/api.js` (modify)

```js
export const getWebsiteSubmissions = (filters) => apiFetch(`/reports/website-submissions?${qs(filters)}`)
export const getWebsiteSubmissionFilterOptions = () => apiFetch('/reports/website-submissions/filter-options')
```

### `portal/src/components/reports/WebsiteSubmissionsReport.jsx` (new)

Desktop view. Layout:
- Top: three filter controls — form name dropdown, location dropdown, date range (start/end pickers, default = last 30 days).
- Body: a table with columns: Received, Form, Location, Name, Email, Phone, Message preview, Opt-In.
- Each row is expandable; expanded state shows the full `raw` JSON pretty-printed, so dynamic "No Label" fields are visible.
- Empty state: "No submissions in this range."

### `portal/src/mobile/components/reports/MobileWebsiteSubmissions.jsx` (new)

Mobile view. Same filters, but rows are stacked cards.

### Tile registration

- Desktop: `portal/src/components/ReportingView.jsx` — add `Website Submissions` tile under the existing Marketing group.
- Mobile: `portal/src/mobile/components/reports/ReportsHome.jsx` — add a new tile with `key: 'website-submissions'` and an inbox/letter icon. Update `getTilesForRole` so the tile is included only for `corporate` and `admin` (the `default` branch already covers admin/director/corporate, but `marketing` falls through to `default` — so an explicit exclusion will be needed there).

## Data flow

```
HTML form on the website
  └─ POST application/x-www-form-urlencoded
       https://wcs-auth-api.onrender.com/webhooks/website-form?secret=...
            ├─ secret check       (env: WEBSITE_FORM_WEBHOOK_SECRET)
            ├─ parseWebsiteFormBody(req.body)
            │    └─ parseLocation(form_name)
            └─ INSERT website_submissions
                 └─ 200 {success, id}

portal UI (corporate/admin)
  ↓
  GET /reports/website-submissions?form_name=&location=&start=&end=
       └─ SELECT ... ORDER BY received_at DESC LIMIT 500
            └─ JSON to client
                 └─ table render + expandable row for raw JSONB
```

## Error handling summary

| Scenario | Behavior |
|---|---|
| `?secret` missing/wrong | `401` immediately, no logging of submitted secret. |
| Body parsed to empty `{}` | `400 {error: 'empty body'}`. |
| `form_name` missing | Row still persists. `form_name` is `NULL`. Filter dropdown lists it as `(no form name)`. |
| Location prefix doesn't match | Row still persists. `location = NULL`. Filter lists it as `Unknown`. |
| DB insert fails | `500 {error: 'persist failed'}` + `console.error` with `form_id` (or `'(no form_id)'`). |
| Report query returns >2000 rows | Capped at 2000 server-side. UI shows "Showing first 2000 of N — narrow your date range." |

## Testing

**Unit (`auth/tests/websiteFormParser.test.js`)**
- Decodes URL-decoded sample payload → returns expected `{first_name, last_name, email, phone, message, opt_in: true, form_id, form_name, location: 'Springfield', raw}`.
- `Opt+In+for+Messaging` missing → `opt_in: false`.
- `form_name` with no recognized location prefix → `location: null`, row still parseable.
- `form_name` empty → `location: null`, no throw.
- Dynamic `No Label field_*` keys preserved inside `raw`.

**Integration (manual smoke after deploy)**
1. `curl --data-urlencode 'First Name=Test' --data-urlencode 'form_name=Springfield - Smoke' --data-urlencode 'form_id=smoke1' 'https://wcs-auth-api.onrender.com/webhooks/website-form?secret=<SECRET>'` → expect 200 + JSON body with `id`.
2. Same with bad secret → 401.
3. Open the portal → Marketing → Website Submissions → confirm the smoke row appears, `location=Springfield`.

## Deployment

1. Apply migration `021_website_submissions.sql` to Supabase via MCP.
2. Set `WEBSITE_FORM_WEBHOOK_SECRET` env var on the `wcs-auth-api` Render service.
3. Merge PR → Render auto-deploys → endpoint goes live.
4. Justin pastes the URL into the website form's `action=` attribute.

## Open questions / future work

- Email/SMS forward of new submissions to a staff inbox: out of scope, easy to add later (would be a fire-and-forget side effect of the webhook handler, same pattern as `click2save_events → syncCancelReasonToGhl`).
- Auto-create GHL contact on submission: not in v1. Add later if marketing wants leads automatically pushed.
- "Hide / archive" rows in the UI: not in v1.
- Cleanup of the existing migration-017 numbering collision (`017_ghl_contacts_attribution.sql` and `017_ghl_custom_field_cache.sql` both exist on master). Cosmetic only; address in a separate housekeeping PR.
