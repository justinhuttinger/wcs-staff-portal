# PT Projections Report — Design

**Date:** 2026-06-25
**Status:** Approved (design), pending implementation plan
**Report key:** `pt-projections`

## Purpose

Give managers a forward view of recurring personal-training (PT) revenue: when each
member's next PT draft is expected, how much revenue we expect to collect on which days,
and how that projection reconciles against PT revenue actually collected so far this
period. Surfaces cash-flow timing and at-risk (past-due) drafts.

## Scope (v1)

- **Projection depth:** *next payment only* per active recurring PT agreement (each
  agreement's `nextBillingDate` + per-period amount). No multi-cycle roll-forward.
- **Core comparison:** current-period reconciliation — projected vs collected, with
  outstanding and past-due breakouts.
- **Breakdowns:** by day (calendar), by location, by trainer, and member detail rows.
- **PT scope:** core `TRAINING` profit center for collected revenue. Recurring-service
  population uses PT Roster's existing `isPT()` definition. (Optional later: fold
  CHALLENGE/STRETCH/small-group into the collected set — kept as a single config
  constant so it's a one-line change.)
- **Access:** `requireRole('manager')` (matches the financial Revenue report). Loosenable
  to `lead` via one entry if desired.

Explicitly out of scope for v1: multi-month roll-forward forecast, historical
projection-accuracy trending (would need Approach B's snapshot table), per-draft
payment matching.

## Chosen approach

**Approach A — on-demand, reuse PT Roster's cached population.**

Extract PT Roster's active-recurring-PT enumeration into a shared, SWR-cached helper.
The projections route consumes it, buckets by `nextBillingDate`, and reconciles against
`abc_revenue_transactions`. No new Postgres migration, no new sync job; matches the
established PT-report pattern (`ptRoster.js`, `ptNewClients.js`).

Alternatives considered:
- **B — daily-snapshot table + ghl-sync job:** enables projection-accuracy history but
  adds a migration and a sync job to maintain. Deferred as a future upgrade.
- **C — pure SQL from existing tables:** not viable; future per-agreement bill dates are
  not in Postgres today (only sold-in-period commissions and membership dues dates).

## Data sources

### Projection (expected drafts)
ABC `/{clubNumber}/members/recurringservices`, enumerated across all 7 clubs the same way
PT Roster does (scan 2020→today in 180-day windows over `saleTimestampRange` +
`lastModifiedTimestampRange`, dedupe by `recurringServiceId`), filtered to:
- `recurringServiceStatus === 'active'`
- NOT `recurringTypeDesc` containing "Paid in Full" (PIF doesn't recur)
- `isPT(serviceItem)` (PT Roster's definition)

Fields used per service: `recurringServiceDates.nextBillingDate`, `invoiceTotal`
(per-period $), `serviceEmployeeFirstName/LastName` (trainer), `memberId`,
`memberFirstName/LastName`, club (slug/name), `serviceItem`.

This enumeration is **extracted into a shared module** (e.g.
`auth/src/services/ptRecurring.js`) with its own SWR cache, and PT Roster is refactored
to consume it (no behavior change to PT Roster). Both reports then share one cached ABC
scan.

### Collected (actual revenue)
`abc_revenue_transactions` where `profit_center IN ('TRAINING','PERSONAL TRAINING')` and
`payment_date` within the selected window. (`PERSONAL TRAINING` is a legacy code that
stopped Sept 2024; folded in so historical windows reconcile.) Joined to location via
`location_slug` and to member via `member_number` for per-member collected status.

## Reconciliation model (current month)

`nextBillingDate` is a moving pointer that advances after each successful draft, so the
three buckets do not double-count:

- **Collected** = Σ TRAINING revenue with `payment_date` in the window (already drafted
  this period).
- **Outstanding** = Σ `invoiceTotal` of active agreements where `nextBillingDate` ∈
  [today, window-end] (still expected to draft this period).
- **Past-due / at-risk** = Σ `invoiceTotal` of active agreements whose `nextBillingDate`
  is *before today* but on/after window-start (the pointer is stuck on a date that has
  passed — a likely declined/lapsing draft).
- **Projected total** = Collected + Outstanding + Past-due.

(For the default current-month window, "window-end" is month-end and "window-start" is
the 1st. A fully-past window has no Outstanding; everything resolves to Collected or
Past-due.)

Headline summary, e.g.: *"June PT — projected $42,000, collected $31,500, $7,500
outstanding, $3,000 past-due."*

Date window is driven by the report's start/end pickers, defaulting to the current
calendar month. Outstanding/past-due split is computed relative to "today".

## API

`GET /reports/pt-projections?start_date=YYYY-MM-DD&end_date=YYYY-MM-DD&location_slug=all|<slug>`

Authenticated, `requireRole('manager')`, response cached via `wrapSWR` (align TTLs with
PT Roster: ~2 min fresh / ~15 min stale) and exposes `warmCache` for the cache warmer
pattern. Returns:

```jsonc
{
  "summary": {
    "projected": 42000, "collected": 31500, "outstanding": 7500, "pastDue": 3000,
    "window": { "start": "2026-06-01", "end": "2026-06-30" }, "asOf": "2026-06-25"
  },
  "byDay":      [ { "date": "2026-06-26", "amount": 1240, "count": 4 }, ... ],   // upcoming drafts
  "byLocation": [ { "slug": "salem", "name": "Salem", "projected": ..., "collected": ..., "outstanding": ..., "pastDue": ... }, ... ],
  "byTrainer":  [ { "trainer": "Jane Doe", "location": "salem", "projected": ..., "collected": ..., "count": ... }, ... ],
  "members":    [ { "memberId": "...", "name": "...", "trainer": "...", "location": "salem",
                    "nextBillingDate": "2026-06-26", "amount": 310, "status": "upcoming|collected|pastdue" }, ... ]
}
```

## UI

New `portal/src/components/reports/PTProjectionsReport.jsx`, in the **Training** report
group of `ReportingView.jsx`. Layout:

1. **Reconciliation summary cards** — Projected / Collected / Outstanding / Past-due for
   the window, with the headline sentence.
2. **Calendar-by-day** — bar/list of upcoming expected drafts per day (amount + count).
3. **By location** — table: location × {projected, collected, outstanding, past-due},
   with an all-clubs total row.
4. **By trainer** — table: trainer × metrics (filterable by location).
5. **Member detail rows** — member, next draft date, amount, trainer, location, status
   badge (Collected / Upcoming / Past-due). Search + CSV export.

Filters: date range (default current month), location, trainer, status; search box.
Reuses existing reporting filter-row patterns. No em-dashes in any user-facing copy.

## Wiring checklist (end to end)

1. `auth/src/services/ptRecurring.js` (NEW) — shared active-recurring-PT fetch + SWR cache.
2. `auth/src/routes/ptRoster.js` — refactor to consume the shared helper (no behavior change).
3. `auth/src/routes/ptProjections.js` (NEW) — the report route + reconciliation + `warmCache`.
4. `auth/src/index.js` — `app.use('/reports/pt-projections', require('./routes/ptProjections'))`.
5. `auth/src/middleware/role.js` — add `'pt-projections': ['manager','marketing','corporate','admin']` to `REPORT_ACCESS`.
6. `auth/src/routes/admin.js` — add `'pt-projections'` to `CUSTOM_REPORT_KEYS`.
7. `portal/src/config/portalTiles.js` — add `{ key: 'pt-projections', label: 'PT Projections' }` to `CUSTOM_REPORT_CATALOG`.
8. `portal/src/lib/api.js` — `getPTProjections(...)` client fn.
9. `portal/src/lib/reportInfo.js` — `REPORT_INFO['pt-projections']` help text incl. limitations.
10. `portal/src/components/reports/PTProjectionsReport.jsx` (NEW) — the component.
11. `portal/src/components/ReportingView.jsx` — import + tile + Training group + icon.
12. `portal/src/mobile/components/reports/ReportsHome.jsx` — mobile tile (+ a mobile view if mobile parity is wanted; otherwise desktop-only for v1).

## Known limitations (stated in-report via reportInfo)

- Point-in-time snapshot (cached minutes); `invoiceTotal` may include tax/fees, so
  projection is an estimate.
- Collected reconciles at the **aggregate** level, not per-draft (revenue rows carry no
  agreement id); per-member "Collected" means the member has a TRAINING payment in the
  window.
- "Past-due" is inferred from the bill-date pointer and labeled at-risk, not definitively
  failed.

## Testing

- Pure helpers (bucket-by-day, reconciliation math, status classification) extracted as
  pure functions with unit tests (mirror existing `*.test.js` style in the repo), fed
  synthetic recurring-service + revenue rows covering: collected, outstanding, past-due,
  PIF excluded, non-PT excluded, multi-club aggregation, month-boundary edges.
- Manual verification against ABC for one club/current month before shipping.
