# KPIs Report (Experimental) - Design

**Date:** 2026-06-03
**Status:** Approved, pending implementation plan
**Branch / worktree:** `feat/kpis-report` (`.claude/worktrees/kpis-report`)

## Summary

Add a new **KPIs** report to the reporting page that measures admin-set per-club
goals against real club data. The first release tracks three KPIs:

1. **Trial Conversion %**
2. **Day One Booking %**
3. **VIP Booking %**

Each KPI is shown as a tile with its current value, the club's goal, and the gap
(on track / off track). Clicking a tile expands it inline (accordion) to reveal
that KPI's month-by-month trend over the last 6 months against the goal line.

The report goes in a new **"Experimental"** sidebar group and is visible to
**admin and director roles only**. Goals are admin-editable.

This is intentionally additive: no existing report or endpoint changes behavior.

## Goals and Non-Goals

### Goals
- Reuse existing data. No new metric computation on the backend.
- One flat target percentage per metric per club, editable in the admin portal.
- Per-KPI trend (last 6 calendar months) revealed on demand, not a shared chart.
- Design the UI so adding a future KPI is a one-line change to a config array.
- Render on light (`bg-surface`) cards so content is visible on the dark report
  background.

### Non-Goals (YAGNI)
- No new backend report route.
- No new database table (goals live in the existing `app_config` key-value store).
- No per-month or seasonal goals (flat target only).
- No CSV / PDF export for this report in v1.
- No combined multi-KPI chart (explicitly rejected: gets messy as KPIs grow).

## Data Sources (reuse only)

All three KPIs derive from a single existing endpoint, `GET /reports/membership`
(`auth/src/routes/reports.js`), which accepts `start_date`, `end_date`, and
`location_slug` (supports `all`). Relevant response fields:

| Response field | Meaning |
| --- | --- |
| `total_memberships` | New members in range (denominator for Day One % and VIP %) |
| `trial_conversion.rate` | Trial conversion %, already computed as `won / started * 100` |
| `total_day_one_booked` | Day ones booked in range (numerator) |
| `total_vips` | VIPs in range (numerator) |
| `by_date[]` | Daily `{ date, memberships, vips, day_ones }` series (not used for trends here) |

### KPI formulas (computed client-side)

| KPI | Formula |
| --- | --- |
| Trial Conversion % | `trial_conversion.rate` (used as-is) |
| Day One Booking % | `total_day_one_booked / total_memberships * 100` |
| VIP Booking % | `total_vips / total_memberships * 100` |

When `total_memberships` is 0, Day One % and VIP % are shown as "n/a" (no divide
by zero, no fake 0%).

### Trend data (last 6 months)

The trend cannot be assembled from `by_date` alone, because `by_date` lacks
per-day trial started/won counts (so trial % is not derivable per bucket). The
clean reuse path is to call `/reports/membership` **once per calendar month** for
the last 6 months and derive all three percentages from each month's response.

- 6 calls, issued in parallel, when the report (or the first expanded tile) loads.
- Each call recomputes `trial_conversion.rate` for that month's date range from
  stored `ghl_opportunities_v2` rows, so historical trial % is real, not
  current-only.
- Results cached in component state keyed by `{locationSlug}` so switching tiles
  does not refetch.

**History caveat:** the depth of real history is bounded by how far
`ghl_opportunities_v2` / membership data goes back (sync began ~April 2026).
Months with no data render as **gaps** in the trend line, never as 0%.

## Goals storage (existing `app_config` pattern)

Goals use the existing key-value config store (`app_config` table) accessed via
`GET /config/app-settings?prefix=...` and `PUT /config/app-settings`
(admin-only, already enforced). No schema change.

Key naming, one flat target percentage per metric per club:

```
kpi_goal_trial_<location_slug>
kpi_goal_dayone_<location_slug>
kpi_goal_vip_<location_slug>
```

Values are stored as plain percentage strings (e.g. `"65"`). Missing key means
"no goal set" and the tile shows actuals with a "Set a goal" prompt instead of a
gap.

## UI Design

### Reporting integration (`portal/src/components/ReportingView.jsx`)

- Add a 4th group to `REPORT_GROUPS`:
  ```
  { key: 'experimental', label: 'Experimental', desc: 'In Development',
    iconPath: <new flask/beaker icon>, reports: ['kpis'] }
  ```
- Add `kpis` to `ALL_REPORT_TILES`: `{ key: 'kpis', label: 'KPIs', desc: 'Goals vs. Actuals' }`.
- Add a `kpis` entry to `REPORT_ICONS` (outline SVG path).
- Add `kpis` only to the `default` (corporate / admin / director) branch of
  `getReportTilesForRole`; exclude it from `lead`, `manager`, and `marketing`.
  Director and corporate are already part of the `default` branch (per the
  existing comment in `getReportTilesForRole`), so both inherit `kpis`.
- Add the render block: `{activeReport === 'kpis' && <KpiReport startDate=... endDate=... locationSlug=... />}`.
- Add a `kpis` entry to `lib/reportInfo.js` describing the report.

The standard header date controls and location selector already wrap the active
report, so KPIs gets the same range + location controls as other reports for free
(the report's "current period" reflects those controls).

### KpiReport component (`portal/src/components/reports/KpiReport.jsx`)

- Config-driven by a local `KPI_DEFS` array so future KPIs are one entry:
  ```js
  const KPI_DEFS = [
    { key: 'trial',  label: 'Trial Conversion', goalKey: 'kpi_goal_trial',
      derive: d => d.trial_conversion?.rate ?? null },
    { key: 'dayone', label: 'Day One Booking',  goalKey: 'kpi_goal_dayone',
      derive: d => pct(d.total_day_one_booked, d.total_memberships) },
    { key: 'vip',    label: 'VIP Booking',       goalKey: 'kpi_goal_vip',
      derive: d => pct(d.total_vips, d.total_memberships) },
  ]
  ```
- On load: fetch current-period membership data (the report's date range), fetch
  goals via `getAppSettings('kpi_goal_')`, and fetch the 6 monthly snapshots for
  trends.
- Renders a vertical stack of **KPI tiles**, each a `bg-surface` rounded card
  (light on dark) showing:
  - KPI name
  - Current % (large)
  - Goal % (or "Set a goal" if unset)
  - Gap badge: green "+N% above goal" or red "-N% below goal"
- **Accordion behavior:** clicking a tile expands it inline and collapses any
  other open tile. Expanded content shows:
  - An inline SVG `LineChart` (reusing the existing hand-rolled chart pattern from
    `MembershipReport.jsx`, no new dependency) plotting the actual % across the
    last 6 months as a solid line plus a dashed horizontal goal line.
  - A "trending toward goal" / "trending away from goal" indicator comparing the
    latest month to the prior month relative to the goal.
  - Gaps for months with no data.

### All-locations handling

Goals are per-club. When `locationSlug === 'all'`, tiles still show aggregate
actuals, but in place of a gap badge they display "Goal: set per club" and the
trend dashed goal line is omitted. No aggregate goal is invented.

### Admin: KPI Goals tile (`portal/src/components/admin/`)

- New admin component `KpiGoalsAdmin.jsx` following `ActionLinksAdmin.jsx` exactly:
  load via `getAppSettings('kpi_goal_')`, edit, save all via `saveAppSettings(...)`.
- A location picker (or per-club rows) with three numeric percentage inputs:
  Trial goal, Day One goal, VIP goal.
- Register a "KPI Goals" tile in `AdminPanel.jsx`, admin-only (matches the
  existing admin-tile gating).

## Components and responsibilities

| Unit | Responsibility | Depends on |
| --- | --- | --- |
| `KpiReport.jsx` | Fetch current + 6-month data, compute %s, render tiles + accordion | `/reports/membership`, `getAppSettings`, inline `LineChart` |
| `KpiTile` (within report) | One tile: value vs goal, gap badge, expandable trend | KPI def, goal, current %, trend series |
| `KpiGoalsAdmin.jsx` | Admin CRUD for per-club goals | `getAppSettings` / `saveAppSettings` |
| `ReportingView.jsx` (edit) | Register group, tile, icon, role gate, render block | existing |
| `AdminPanel.jsx` (edit) | Register KPI Goals admin tile | existing |
| `lib/reportInfo.js` (edit) | KPIs report description | existing |

## Error / edge handling

- `total_memberships === 0`: Day One % and VIP % show "n/a", no gap badge.
- Missing goal key: tile shows actual + "Set a goal", no gap badge.
- A failed monthly trend call: that month is a gap; the rest of the trend still
  renders.
- `locationSlug === 'all'`: per-club goal note instead of gap, no goal line.

## Testing

- Unit: `pct(num, den)` helper (0 denominator -> null; normal rounding).
- Unit: gap/direction logic (above/below goal, trending toward/away).
- Component/manual: tile renders value vs goal; clicking expands exactly one tile;
  trend line plus dashed goal line render; gaps for empty months; all-locations
  shows the per-club note.
- Manual: admin can set a goal, value persists and reflects in the report.

## Open follow-ups (future, not this spec)
- Additional KPIs (add `KPI_DEFS` entries).
- Possible backend optimization: add trial started/won to `by_date` so the trend
  needs one call instead of six (only if the 6-call cost proves noticeable).
