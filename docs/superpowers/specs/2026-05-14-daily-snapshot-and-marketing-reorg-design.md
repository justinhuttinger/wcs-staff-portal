# Daily Snapshot report + Marketing reorg — design

**Date:** 2026-05-14
**Author:** Justin Huttinger (w/ Claude)
**Status:** Approved

## Overview

Two related changes to the Reporting area of the portal:

1. **Marketing reorg** — move the top-level Marketing sidebar entry into Reporting as a third group alongside Club Health and Training, so all reports live under one roof.
2. **Daily Snapshot** — a new report under Club Health for a single-day view of the club's planning + retrospective KPIs. Toggle between Yesterday / Today / Custom date, with panels that morph based on whether the date is past, today, or future.

## Part A — Marketing reorg

Today, Marketing is a separate top-level sidebar tile in `portal/src/components/App.jsx` that mounts `<MarketingView/>`. Mobile already groups Meta / Google / Website Submissions under a "Marketing" group inside Reporting. Desktop should match.

### Changes

- `portal/src/components/ReportingView.jsx`
  - Add three entries to `ALL_REPORT_TILES`: `meta-ads`, `google-marketing`, `website-submissions` (with their existing icons).
  - Add a new entry to `REPORT_GROUPS` with `key: 'marketing'`, `label: 'Marketing'`, `reports: ['meta-ads', 'google-marketing', 'website-submissions']`.
  - In the active-report router, route the three keys to `<MetaAdsView/>`, `<GoogleMarketingView/>`, and `<WebsiteSubmissionsReport/>` respectively.
  - Adjust `getReportTilesForRole`:
    - `default` (corporate/admin/director) — gets all marketing tiles.
    - Add a `marketing` case: same as default but exclude `website-submissions` (corp+admin-only).
- `portal/src/App.jsx`
  - Remove the top-level Marketing tile/sidebar entry and the `<MarketingView/>` mount.
  - Remove `showMetaAds`/`setShowMetaAds` state if no other consumer remains. (Quick grep during implementation will confirm.)
- `portal/src/components/MarketingView.jsx`
  - Keep the file as-is for now (it's still used for the Website Submissions inline sub-routing pattern via its `<WebsiteSubmissionsReport/>` mount). Delete only if unreferenced after removing from App.jsx.

Mobile already groups these correctly under `REPORT_GROUPS` in `portal/src/mobile/components/reports/ReportsHome.jsx`. No mobile changes needed beyond verification.

### Risk

Low — pure UI restructuring. No backend changes, no schema changes. The three target views (`MetaAdsView`, `GoogleMarketingView`, `WebsiteSubmissionsReport`) are unchanged and continue to work.

## Part B — Daily Snapshot

### Goal

Give managers and above a single-screen answer to two questions, depending on which date is picked:

- **For today/future:** "What's on the schedule?" — day-one appointments, tours, PT clients-to-confirm.
- **For yesterday/past:** "How did that day go?" — day-one outcomes, membership sales count, sale revenue by profit center, tour count, new PT sales.

### Architecture

One backend endpoint `GET /reports/daily-snapshot?date=YYYY-MM-DD&location=<slug|all>` returns a single JSON shape with every panel pre-computed. Date is interpreted in **America/Los_Angeles**. The server populates only the panels that apply for the temporal mode (`past` | `today` | `future`) and returns `null` for inapplicable panels so the UI can render "—" or hide.

Single endpoint per page is intentional:
- One loading state, one error state.
- Atomic role + location authorization on a single request.
- Server controls which panels are applicable for a given date, so the UI doesn't need to duplicate date math.

### Panel matrix

| Panel | Past | Today | Future |
|---|---|---|---|
| **Day One** | count completed; breakdown of `sale_result` (sale / no_sale / other); list of names | count scheduled; count completed so far; remaining | count scheduled |
| **Tours** | count scheduled (or count attended if status reliable); list of names | count scheduled; completed so far | count scheduled |
| **Membership sales** | count of new memberships paid that day (rows in `abc_revenue_transactions` whose billing type indicates a new membership) | hidden — show note: "ABC data uploads overnight" | hidden |
| **Revenue by profit center** | dollars per `profit_center` from `abc_revenue_transactions` for `payment_date = $date` | hidden — same note | hidden |
| **PT new sales** | count of new PT clients sold that day (from PT New Clients data source) | hidden | hidden |

For "today" mode the experience is hybrid: scheduling panels render fully; sales/revenue panels render placeholder text. For future dates, only scheduling panels render.

### Data sources

All sources exist today — no new tables or migrations.

- **Day One appointments:** local `appointments` table where `appointment_type = 'DAYONE'`. Filter by `appointment_time::date = $date` in Pacific. Past mode adds `status='completed'` and groups by `sale_result`.
- **Tours:** local `appointments` table where `appointment_type = 'TOUR'` if present; if not, the implementation will use the existing `/tours` GHL pattern to fetch live, scoped to the date and location. Decided at implementation time based on a quick check of the appointments-table contents.
- **Membership sales count:** `abc_revenue_transactions` rows where `payment_date = $date` AND the row represents a new membership. The exact filter on `billing_type` / `membership_type_code` will mirror what the existing Revenue report uses for "new memberships" — confirmed in implementation by reading `auth/src/routes/revenueReports.js`. If no existing helper exists, the simplest accurate filter is "rows tagged as initial agreement payment."
- **Revenue by profit center:** `abc_revenue_transactions` rows for `payment_date = $date` grouped by `profit_center`, sum of `amount`.
- **PT new sales:** reuse the existing PT New Clients query (in `auth/src/routes/ptNewClients.js`) filtered to a single day. Returns a count.

### Date math (Pacific time)

The server must interpret `?date=YYYY-MM-DD` as a date in `America/Los_Angeles`. Compute the day boundaries as:
```
start = new Date(`${date}T00:00:00-08:00`)  // adjust for DST
end   = start + 1 day
```
The codebase already has a Pacific-time helper for ABC checkins (`fmtAbcTimestamp` in `ghl-sync/src/abc/checkins.js`); we'll use the same convention so PT-day boundaries are consistent across reports.

Temporal mode comparison:
```
const today = todayInPacific()  // YYYY-MM-DD in PT
if (date <  today) mode = 'past'
if (date == today) mode = 'today'
if (date >  today) mode = 'future'
```

### Response shape

```jsonc
{
  "date": "2026-05-13",
  "mode": "past",                 // 'past' | 'today' | 'future'
  "location_slug": "salem",       // or null if 'all'
  "day_one": {
    "scheduled": 8,
    "completed": 8,
    "sale_count": 5,
    "no_sale_count": 3,
    "other_count": 0,
    "names": [{ "name": "...", "result": "sale" }, ...]
  },
  "tours": {
    "scheduled": 3,
    "names": [...]
  },
  "membership_sales": {
    "count": 7
  } /* or null if mode != 'past' */,
  "revenue": {
    "by_profit_center": [
      { "profit_center": "Dues", "amount": 1234.56 },
      { "profit_center": "Personal Training", "amount": 890.00 },
      ...
    ],
    "total": 2124.56
  } /* or null if mode != 'past' */,
  "pt_new_sales": {
    "count": 2
  } /* or null if mode != 'past' */
}
```

### Frontend

- `portal/src/components/reports/DailySnapshotReport.jsx` (new) — top: date toggle (Yesterday / Today / Custom date picker) + location dropdown. Below: a responsive grid of panels.
- `portal/src/mobile/components/reports/MobileDailySnapshot.jsx` (new) — same controls, vertical stack.
- Panels render based on `mode`:
  - `past` → full panel suite.
  - `today` → schedule panels render; sales/revenue panels render an informational placeholder ("ABC data uploads overnight — check tomorrow").
  - `future` → schedule panels only.
- Wire as a new tile in:
  - Desktop: add `daily-snapshot` to `ALL_REPORT_TILES` and to the `REPORT_GROUPS.health.reports` list.
  - Mobile: add to mobile `REPORT_TILES` and the Club Health group's reports list.

### Role access

`['manager', 'marketing', 'corporate', 'admin']` — matches the existing Club Health gate. Managers' location dropdown is restricted to their `staff.location_ids`; corporate/admin/marketing get the full club list and "All" default.

Add `'daily-snapshot': ['manager', 'marketing', 'corporate', 'admin']` to `REPORT_ACCESS` in `auth/src/middleware/role.js`.

### Error handling

| Scenario | Behavior |
|---|---|
| Invalid date format | `400 {error: 'invalid date'}` |
| Date > 1 year past or future | `400 {error: 'date out of range'}` |
| Caller location not allowed | Silent narrow to allowed locations (matches Revenue report pattern). |
| Sub-query fails (e.g., GHL down for live tours fetch) | Panel returns `null` with `panel_errors: { tours: 'GHL fetch failed' }` so other panels still render. |
| All sub-queries fail | `500 {error: 'snapshot failed'}` |

### Testing

- **Backend unit:** date-mode classification (`past`/`today`/`future` boundary cases at midnight PT, including DST transition days).
- **Backend integration:** mock supabase responses for a past date → assert response shape matches the JSON above.
- **Manual smoke:** Hit `/reports/daily-snapshot?date=<yesterday>` and `?date=<today>` and `?date=<tomorrow>` with curl after deploy. Verify the past response includes revenue and membership-sales blocks; today/future omit them.

### Out of scope for v1

- Drill-downs (clicking a Day One number to see the appointments list) — names are surfaced in `names` arrays inline; no separate drill-down pages.
- Charts/sparklines — counts and totals as numbers only.
- Comparisons with prior week / same day last month.
- Export / CSV download.
- Configurable panels per role.
