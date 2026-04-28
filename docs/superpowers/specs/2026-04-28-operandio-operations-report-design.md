# Operandio Operations Report — Design

**Status:** Approved 2026-04-28, implementation starting
**Owner:** Justin
**Audience:** Manager+ (matches Club Health gate)

## Goal

Surface Operandio's weekly checklist completion data inside the WCS Staff
Portal Reporting tile, broken out per club with week-over-week delta.

## Source

Operandio sends a weekly email titled
`"Weekly Activity for West Coast Strength: <date> to <date> at all locations"`
from `notifications@app.operandio.com`. The plain-text body contains a
`## Locations` section with 7 entries — one per club — each with five
percentages: Overall / On-time / Late / Skipped / Uncompleted.

We only consume the Locations section. Areas of Work and Jobs are out of
scope for v1.

## Data flow

```
Operandio → notifications@app.operandio.com
  ↓ Gmail forwarding rule on justin@wcstrength.com
reports@parse.wcstrength.com
  ↓ SendGrid Inbound Parse webhook
POST https://api.wcstrength.com/operandio/webhook?secret=<env>
  ↓ parse plain-text body, upsert by (period_start, period_end, location_slug)
Supabase: operandio_location_reports
  ↓ GET /operandio/latest
Reporting → Operations tile (manager+)
```

## Database

```sql
create table operandio_location_reports (
  period_start date not null,
  period_end date not null,
  location_slug text not null,
  overall_pct int not null,
  on_time_pct int not null,
  late_pct int not null,
  skipped_pct int not null,
  uncompleted_pct int not null,
  received_at timestamptz default now(),
  raw_subject text,
  primary key (period_start, period_end, location_slug)
);

create index operandio_location_reports_period_idx
  on operandio_location_reports (period_start desc, period_end desc);
```

Idempotent on re-delivery: same period+location = upsert, not duplicate.

## Backend

`auth/src/routes/operandio.js` mounted at `/operandio`.

| Endpoint | Auth | Purpose |
|---|---|---|
| `POST /webhook` | shared secret query param | SendGrid Inbound Parse target. Parses email, upserts rows. |
| `GET /latest` | JWT + `requireRole('manager')` | Returns latest week's 7 location rows + prior week's rows for delta. |

**Webhook secret:** `OPERANDIO_WEBHOOK_SECRET` env var on auth-api. SendGrid
URL is `https://api.wcstrength.com/operandio/webhook?secret=<value>`. Reject
mismatched. SendGrid POSTs `multipart/form-data`; we read `text` field
(plain-text body) plus `subject`.

**Parser** (~30 lines):
- Extract `period_start` and `period_end` from subject regex:
  `Weekly Activity for West Coast Strength: (\w+ \d+\w+, \d+) to (\w+ \d+\w+, \d+)`
  → parse with `Date.parse`.
- Iterate body, find blocks matching:
  ```
  #### <Name> - Overall <pct>%

  On-time <pct>%
  Late <pct>%
  Skipped <pct>%
  Uncompleted <pct>%
  ```
  inside the `## Locations` section only (stop at next `## ` header).
- Map each `Name` to its slug via the `LOCATION_SLUGS` set; ignore unknown
  names so the parser doesn't choke if Operandio adds a location later.

## Frontend

`portal/src/components/reports/OperationsReport.jsx` — new file.

Layout:
- Date subtitle: "April 21 — April 27, 2026"
- Location pills (All Locations + 7 — same component as other reports)
- Per-location card: stacked horizontal bar (green/red/blue/light gray) with
  Overall % on the right and a `+5 ▲` delta chip
- "All Locations" view: all 7 cards in a column (mirrors the email layout)

`portal/src/lib/api.js` — add `getOperandioLatest()`.

`portal/src/components/ReportingView.jsx` — add:
```js
{ key: 'operations', label: 'Operations', desc: 'Checklists', icon: '✅' }
```
Visible to manager+ (filter rule in `getReportTilesForRole`).

## Setup work (one-time, outside code)

1. **DNS:** add MX record `parse.wcstrength.com` → `mx.sendgrid.net` (priority 10).
2. **SendGrid:** Settings → Inbound Parse → Add Host & URL:
   - Host: `parse.wcstrength.com`
   - URL: `https://api.wcstrength.com/operandio/webhook?secret=<value>`
   - Spam Check: off
   - Send Raw: off
3. **Gmail filter:** `from:notifications@app.operandio.com subject:"Weekly Activity for West Coast Strength"` → forward to `reports@parse.wcstrength.com`.
4. **Render env var on auth-api:** `OPERANDIO_WEBHOOK_SECRET=<random-string>`.
5. **Apply migration** to Supabase project `ybopxxydsuwlbwxiuzve`.

## Files touched

- `supabase/migrations/<ts>_operandio_location_reports.sql` (new)
- `auth/src/routes/operandio.js` (new)
- `auth/src/index.js` (mount route, install `multer` if needed for multipart)
- `portal/src/components/reports/OperationsReport.jsx` (new)
- `portal/src/components/ReportingView.jsx` (add tile + role gate)
- `portal/src/lib/api.js` (add wrapper)

## Out of scope (v1)

- Areas of Work / Jobs sections
- Threshold alerts
- Charts beyond inline stacked bars
- Backfill of prior emails (parses going forward only)
