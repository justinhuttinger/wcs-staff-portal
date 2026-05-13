# Revenue Reporting (ABC "Revenue by Profit Center")

**Date:** 2026-05-13
**Status:** Design — pending user review
**Owner:** Justin

## 1. Goal

Ingest ABC Financial's "Revenue by Profit Center" report (transaction-level CSV) into Supabase and surface a Revenue dashboard inside the existing Reporting tile. Three primary dimensions: **club**, **profit center**, **payment date**.

## 2. Sources & cadence

Two ingest paths, one shared parser:

1. **Daily auto-ingest.** ABC report scheduled to email `revenue@parse.wcstrength.com` (SendGrid Inbound Parse) → forwards multipart payload (CSV as `attachment1`) to `POST https://wcs-auth-api.onrender.com/revenue/webhook?secret=$REVENUE_WEBHOOK_SECRET`.
2. **Admin backfill upload.** Admin Panel tile "Revenue Backfill" → file picker → `POST /revenue/upload` (multer, `requireRole('admin')`). Used once for multi-year history and any one-off re-imports.

Both endpoints accept the same CSV format, share parsing/upsert code, and write to the same tables.

## 3. CSV format notes

Sample header row 1 (literal column names):

```
Textbox16, CLUB_NAME, CLUB_NUMBER, PAYMENT_CLUB, HOME_CLUB, MEMBER_NUMBER, AGREEMENT_NUMBER, LAST_NAME, FIRST_NAME, BILLING_TYPE, BILLING_MODE, BILLING_FREQUENCY, MEMBERSHIP_TYPE_ABC_CODE, PROFIT_CENTER, CATALOG_ITEM, DATE_KEY, PAYMENT_TYPE, PAYMENT_CODE_DESCRIPTION, TOTAL_AMOUNT3, TAX_AMOUNT, PAYMENT_AMOUNT, RECEIPT_NUMBER, COLLECTED_METHOD, GL_CODE, Textbox69, CLUB_NUMBER_I2, TOTAL_AMOUNT4, Textbox86, PAYMENT_AMOUNT1, CLUB_NUMBER_I1, TOTAL_AMOUNT5, Textbox64, PAYMENT_AMOUNT2
```

Row 2's `Textbox16` carries the period + grand-total marker:

```
"Location: All Locations | Date: 05/01/2026 - 05/12/2026 | Total Revenue: $262,386.78"
```

Other quirks:
- Money values formatted as `$24.50`, `$1,234.56`, `"$262,386.78"`, or `($40.00)` for negatives (refunds).
- `DATE_KEY` is `MM/DD/YYYY`.
- File ends with a footer block listing every profit center name (one per line, no commas) — skipped by row-shape check.
- `RECEIPT_NUMBER` is **not** unique; same `(receipt, member, profit_center, date, amount)` tuple can legitimately appear multiple times.
- ABC reports include the entire chain of clubs the agreement covers, not just WCS — but for WCS every active club we care about is in the mapping below.

## 4. Club mapping (WCS-only whitelist)

| CLUB_NUMBER | location_slug | Display name | Notes |
|---|---|---|---|
| 30935 | `salem` | Salem | |
| 31599 | `keizer` | Keizer | |
| 07655 | `eugene` | Eugene | |
| 31598 | `springfield` | Springfield | |
| 31600 | `clackamas` | Clackamas | |
| 32073 | `medford` | Medford | |
| 31601 | `milwaukie` | Milwaukie | ABC `CLUB_NAME = "EAST SIDE ATHLETIC CLUB"` (trade name) |

Display names come from `portal/src/config/locations.js`. Mapping lives server-side in `auth/src/services/revenueCsvParser.js`. Any club_number not in this map is skipped (logged at INFO).

## 5. Data model

Two new tables in Supabase (migration `auth/migrations/019_abc_revenue.sql`).

### 5.1 `abc_revenue_imports`

Tracks every ingest attempt (webhook or admin upload).

```sql
create table abc_revenue_imports (
  id              bigserial primary key,
  source          text        not null check (source in ('sendgrid_webhook', 'admin_upload')),
  uploaded_by     uuid        references auth.users(id),
  period_start    date        not null,
  period_end      date        not null,
  reported_total  numeric(14,2),
  computed_total  numeric(14,2),
  row_count       int,
  filename        text,
  email_subject   text,
  status          text        not null check (status in ('success','partial','failed')),
  error_message   text,
  created_at      timestamptz not null default now()
);
create index on abc_revenue_imports (created_at desc);
```

### 5.2 `abc_revenue_transactions`

Transaction grain — one row per CSV data row that passed the WCS-club filter.

```sql
create table abc_revenue_transactions (
  id                    bigserial primary key,
  payment_date          date          not null,
  club_number           text          not null,
  location_slug         text          not null,
  member_number         text,
  agreement_number      text,
  member_first_name     text,
  member_last_name      text,
  billing_type          text,
  membership_type_code  text,
  profit_center         text          not null,
  catalog_item          text,
  payment_code_desc     text,
  payment_type          text,
  collected_method      text,
  receipt_number        text,
  gl_code               text,
  payment_amount        numeric(12,2) not null,
  total_amount          numeric(12,2),
  tax_amount            numeric(12,2),
  source_file_id        bigint        not null references abc_revenue_imports(id) on delete cascade,
  source_row_index      int           not null,
  imported_at           timestamptz   not null default now(),
  unique (source_file_id, source_row_index)
);

create index on abc_revenue_transactions (payment_date);
create index on abc_revenue_transactions (location_slug, payment_date);
create index on abc_revenue_transactions (profit_center, payment_date);
create index on abc_revenue_transactions (location_slug, profit_center, payment_date);
```

### 5.3 Aggregation RPC

A Postgres function `revenue_summary(start_date, end_date, location_filter text[])` returning the cards + per-day + per-club + per-profit-center rollups in one round-trip. Pattern proven by FB ROAS PR #89 — pushing aggregation server-side sidesteps the Supabase statement-timeout on large windows (multi-year backfill view).

`location_filter` is an array of allowed slugs; `NULL` / empty array means all WCS clubs.

## 6. Ingest pipeline

### 6.1 Parser (`auth/src/services/revenueCsvParser.js`)

Pure function: `parseRevenueCsv(buffer) → { period_start, period_end, reported_total, rows[], skipped, errors[] }`.

Steps:
1. Decode buffer as UTF-8, normalize line endings.
2. `csv-parse/sync` with `columns: true, relax_quotes: true, skip_empty_lines: true`.
3. From the first data row, parse `Textbox16` via regex:
   - Period: `Date:\s*(\d{2}\/\d{2}\/\d{4})\s*-\s*(\d{2}\/\d{2}\/\d{4})`
   - Total: `Total Revenue:\s*\$?([\d,]+\.\d{2})`
4. For each remaining row:
   - Skip if `CLUB_NUMBER` is blank or not in whitelist.
   - Skip if `DATE_KEY` is blank.
   - `parseMoney(s)`: strip `$` and `,`; if wrapped in parens, treat as negative; empty → `0`.
   - `parseDate(s)`: `MM/DD/YYYY` → ISO `YYYY-MM-DD`.
   - Push normalized row with `source_row_index` set to the CSV ordinal.
5. Sum all `payment_amount` → `computed_total`.

### 6.2 Webhook handler (`auth/src/routes/revenue.js`)

```
POST /revenue/webhook?secret=…    // multer().any() for SendGrid multipart
POST /revenue/upload              // authenticate + requireRole('admin'), multer().single('file')
GET  /reports/revenue/summary
GET  /reports/revenue/profit-center-trend
GET  /reports/revenue/imports
```

`/webhook` validates shared secret (`REVENUE_WEBHOOK_SECRET` env var; same pattern as `OPERANDIO_WEBHOOK_SECRET`). Locates the CSV in `req.files` (first `application/*` or `text/csv` attachment; falls back to `attachment1`).

### 6.3 Ingest transaction

For each successful parse:

1. Insert `abc_revenue_imports` row with `status='success'` placeholder and the parsed metadata.
2. Determine `clubs_in_file` = distinct `club_number` values across parsed rows.
3. `DELETE FROM abc_revenue_transactions WHERE payment_date BETWEEN $period_start AND $period_end AND club_number = ANY($clubs_in_file)`.
4. Bulk insert parsed rows in chunks of 5,000 (Supabase request payload safe).
5. Update the import row with `computed_total`, `row_count`, and final `status`.

On parse failure, the import row is still recorded with `status='failed'` + `error_message` so the Admin "Last sync" UI can show it.

## 7. Read API

All require `authenticate + requireRole('manager')`. Server resolves the allowed slug set:

- **Manager / lead with a `can_view_reports` location list** → that list (e.g., a regional manager covering Salem + Keizer sees both, locked).
- **Director / corporate / admin** → may pass `all` or any specific slug; defaults to `all`.

If the client passes a slug the user is not authorized for, the server narrows the query to their allowed set silently rather than 403'ing (matches existing `/reports/*` behavior).

```
GET /reports/revenue/summary
    Query: start_date, end_date, location_slug
    Returns: {
      period: { start, end },
      total: number,
      by_club: [{ slug, label, total }],
      by_profit_center: [{ name, total, pct_of_total }],
      by_day: [{ date, total }],
      compare: { period: {start,end}, total, by_club, by_profit_center, by_day }  // prior equivalent period
    }

GET /reports/revenue/profit-center-trend
    Query: start_date, end_date, location_slug, profit_center
    Returns: { series: [{ date, total }] }

GET /reports/revenue/imports?limit=20
    Returns: { rows: [{ id, source, period_start, period_end, reported_total, computed_total, row_count, status, created_at }] }
```

Sums computed via the `revenue_summary` RPC (one SQL call per request).

## 8. UI

### 8.1 Tile placement

In `portal/src/components/ReportingView.jsx`:

- Add `REPORT_ICONS.revenue` (dollar / chart line path).
- Add to `ALL_REPORT_TILES`:
  `{ key: 'revenue', label: 'Revenue', desc: 'Dollars & Profit Centers' }`
- Append `'revenue'` to the `'health'` group's `reports` array (after `payroll`).
- Include `'revenue'` in `getReportTilesForRole`'s `manager` and `default` (corporate/admin) lists. **Not** in `lead`.
- Add `{activeReport === 'revenue' && <RevenueReport ... />}` in the render switch.

### 8.2 `RevenueReport.jsx`

Props: `{ startDate, endDate, locationSlug }`. Fetches `/reports/revenue/summary` whenever any prop changes.

Layout (top to bottom):

1. **Header strip — 4 stat cards:**
   - Total Revenue (`$262,386.78`)
   - Δ vs prior equivalent period (`DeltaChip` — reuse from Marketing report)
   - Top Profit Center (e.g., "Dues — 64% of total")
   - Top Club (admin/director) **or** "Your Club: $X" (manager)

2. **Daily trend chart** (Recharts `<ComposedChart>`):
   - X = day, Y = $
   - Stacked area = top 6 profit centers + "Other"
   - Hover tooltip shows each stack's value

3. **By Club** (admin/director only):
   - Horizontal bar list sorted by $ desc, with Δ vs prior period badge

4. **Profit Center Breakdown** table:
   - Columns: Profit Center | Total | % of Total | Δ vs prior
   - Click a row → swaps the trend chart above to that single profit-center series (fetch `/profit-center-trend`)

5. **Footer:** CSV download + Print button (consistent with other reports)

### 8.3 Admin Backfill tile

In Admin Panel:

- New tile "Revenue Backfill" alongside Sync Status.
- File drop-zone (PNG of cloud-upload icon, same look as HR Documents uploader).
- Posts to `/revenue/upload` with progress bar.
- After response: result card showing `period_start..period_end`, `row_count`, `computed_total`, and reconciliation badge:
  - Green "Matches reported total" if `|computed - reported| < $0.01`.
  - Yellow "Drift $X.YY" otherwise (e.g., when a club we don't whitelist is in the file).
- "Recent imports" table below — last 20 from `/reports/revenue/imports`.

## 9. Security & roles

- `REVENUE_WEBHOOK_SECRET` — Render env var. Same model as `OPERANDIO_WEBHOOK_SECRET`.
- `/revenue/webhook` — secret-only (no user auth).
- `/revenue/upload` — `authenticate` + `requireRole('admin')`.
- `/reports/revenue/*` — `authenticate` + `requireRole('manager')`, with manager-locked `location_slug`.
- Supabase RLS off these tables (service-role-only writes; reads via auth API).

## 10. Acceptance criteria

- [ ] Daily SendGrid email lands → row count grows by ~1 day's volume → dashboard reflects within seconds.
- [ ] Re-sending today's email is idempotent (no duplicates, no missing rows). Verified by sending the same file twice.
- [ ] 12-day sample file (`Revenue by Profit Center.csv`, ~9,144 rows) imports cleanly; `computed_total == reported_total = $262,386.78`.
- [ ] Manager logged into Springfield sees only Springfield numbers; admin sees the "All Locations" toggle.
- [ ] Refund row (e.g., Loos / `($40.00)` / INVOICE) appears as `-40.00` in `payment_amount` and reduces totals.
- [ ] 5-year backfill CSV (estimated ~1.5M rows) imports without timeout — chunked inserts in 5K batches; admin sees progress and final reconciliation.
- [ ] East Side Athletic Club rows (club 31601) appear under "Milwaukie" everywhere in the UI.
- [ ] If ABC adds a club not in the whitelist, the import succeeds, the unknown club's rows are skipped, and `reported_total - computed_total` shows the drift on the import card.

## 11. Out of scope (v1)

- Transaction Explorer (row-level search/filter UI) — recoverable later by adding a sub-tab.
- Profit-center grouping/categorization (e.g., "Dues" vs "Retail" buckets) — flat profit centers for v1.
- PT-specific revenue reconciliation against `pt_sessions` / payroll commissions — separate report.
- Forecasts, budgets, goal lines — not in v1.
- Member-level lifetime-revenue lookup — separate feature, would join on `member_number`.

## 12. Open questions

None blocking v1. The data quirks (non-unique receipts, refund parens, header total) are all handled. Mapping is fixed.

## 13. Files to touch

**New:**
- `auth/migrations/019_abc_revenue.sql`
- `auth/src/routes/revenue.js`
- `auth/src/services/revenueCsvParser.js`
- `portal/src/components/reports/RevenueReport.jsx`
- `portal/src/components/admin/RevenueBackfillTile.jsx` (or similar)

**Modified:**
- `auth/src/index.js` (mount `/revenue` + `/reports/revenue` routers)
- `portal/src/components/ReportingView.jsx` (tile + group + role gate + render switch)
- `portal/src/lib/api.js` (three new wrappers)
- Admin Panel root component (add Revenue Backfill tile)
- `.env.example` / Render env (`REVENUE_WEBHOOK_SECRET`)
