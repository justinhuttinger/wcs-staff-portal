# Reporting Redesign Spec

**Date:** 2026-04-08  
**Scope:** Reporting opens in new Electron tab, tile-based navigation, fix trial conversion, PT day one breakdown, salesperson stats changes, club health dashboard, bug fixes

---

## 1. New Electron Tab for Reporting

### Hash-Based Routing

The portal gains lightweight hash routing to support the reporting tab loading independently.

**Supported hashes:**
- `#reporting` — shows the reporting tile grid
- `#reporting/club-health` — Club Health dashboard
- `#reporting/salesperson` — Salesperson Stats
- `#reporting/membership` — Membership Report
- `#reporting/pt` — PT / Day One Report
- `#reporting/ads` — Ad Reports

**App.jsx changes:**
- Read `window.location.hash` on mount and listen for `hashchange`
- If hash starts with `#reporting`, render `ReportingView` directly (skip ToolGrid)
- ReportingView manages sub-navigation via hash updates

### ToolGrid Change

When the Reporting tile is clicked:
- Instead of `onReporting={() => setShowReporting(true)}`
- Call: `window.open(window.location.origin + window.location.pathname + '#reporting', '_blank')`
- Electron's portal-preload intercepts `_blank` and opens a new tab via IPC

### Electron Changes

**launcher/src/main.js:**
- Add to `URL_TAB_NAMES`: match portal URL containing `#reporting` → tab name `'Reporting'`
- The `getTabName()` function needs to check the hash fragment, not just hostname

---

## 2. Reporting Tile Grid

Replaces the old tab-bar layout. When hash is `#reporting` (no sub-route), show a tile grid:

**Tiles (in order):**
1. Club Health — new dashboard
2. Salesperson Stats
3. Membership
4. PT / Day One
5. Ad Reports

**No Pipeline tile.** Pipeline report and its component are removed.

**Shared layout:** Location pills and date range controls render above the tile grid AND above each individual report. They persist across navigation within reporting.

**Navigation:** Clicking a tile updates `window.location.hash` to the sub-route. Back button returns hash to `#reporting`.

---

## 3. Date Range Layout

Move all date controls to a single right-aligned row:

```
[Location pills row]
                    [This Month] [Last Month] [Last 30] [Last 90] [YTD]  From [___] To [___]
```

Quick range buttons and custom date pickers sit together, right-aligned. This gives more horizontal space for location pills.

---

## 4. Fix Trial Conversion (Membership Report)

### Root Cause

`auth/src/routes/reports.js` `/membership` endpoint:
- Fetches ALL opportunities from `ghl_opportunities_v2` with no date filter
- When `location_slug` is used, can't filter opportunities (slug not on that table)
- Result: Salem shows 296/459 (all-time) instead of ~10/10 (this month)

### Fix

In the `/membership` endpoint:

1. **Resolve location for opportunities:** When `location_slug` is provided, query `ghl_locations` to find the matching `id` (which is `ghl_location_id` used in `ghl_opportunities_v2.location_id`). Apply this filter.

2. **Apply date range to opportunities:** Filter `ghl_opportunities_v2.created_at_ghl` using the same `startMs`/`endMs` range.

3. **Check oppsError:** Add the missing error check for the opportunities query.

### Implementation

```javascript
// Resolve slug to ghl_location_id for opportunities
let oppLocationId = null
if (locationFilter) {
  if (locationFilter.column === 'location_id') {
    oppLocationId = locationFilter.value
  } else if (locationFilter.column === 'location_slug') {
    const { data: loc } = await supabaseAdmin
      .from('ghl_locations')
      .select('id')
      .ilike('name', locationFilter.value)
      .single()
    if (loc) oppLocationId = loc.id
  }
}

let oppQuery = supabaseAdmin
  .from('ghl_opportunities_v2')
  .select('id, status, stage_id, pipeline_id, ghl_pipeline_stages(name)')

if (oppLocationId) oppQuery = oppQuery.eq('location_id', oppLocationId)
oppQuery = applyDateRange(oppQuery, 'created_at_ghl', startMs, endMs)

const { data: opps, error: oppsError } = await oppQuery
if (oppsError) return res.status(500).json({ error: 'Failed to fetch trial data', detail: oppsError.message })
```

**Note:** The `ghl_locations.name` values are like "Salem", "Keizer" etc. The `location_slug` values are lowercase versions. Use `ilike` for case-insensitive match, or store a slug column on `ghl_locations`.

---

## 5. Salesperson Stats Changes

### Backend (`/reports/salesperson-stats`)

Current aggregation per salesperson:
```javascript
{ total_sales, vips, day_one_booked_yes, day_one_booked_no }
```

Change to:
```javascript
{ total_sales, vips, day_one_booked, same_day_sale }
```

Where:
- `day_one_booked` = count of contacts where `day_one_booked === 'Yes'`
- `same_day_sale` = count of contacts where `same_day_sale === 'Yes'`
- Remove `day_one_booked_yes` and `day_one_booked_no`

### Frontend (`SalespersonStats.jsx`)

**Table columns:**
| Salesperson | Total Sales | VIPs | Day One | Same Day Sale |

- "Day One" column shows the count of Yes only
- "Same Day Sale" column shows the count of Yes only
- Remove the old Day One Yes/No split
- Update stat cards: replace "Day One Booked Rate" with "Same Day Sales" big number
- Update CSV export to match new columns
- Update totals row

---

## 6. PT Report — Day One Breakdown

### What to add

A **Day One Breakdown** table at the top of the PT report (before the trainer summary). Shows every Day One contact with:

| Member Name | Booking Team Member | Date Scheduled | Day One Date | Trainer | Status | Sale |

Fields from `ghl_contacts_report`:
- Member Name = `first_name` + `last_name`
- Booking Team Member = `day_one_booking_team_member`
- Date Scheduled = `day_one_booking_date` (ms timestamp → formatted date)
- Day One Date = `day_one_date` (ms timestamp → formatted date)
- Trainer = `day_one_trainer`
- Status = `day_one_status`
- Sale = `day_one_sale`

The backend already returns all contacts with these fields. This is a frontend-only change — add a new table section to `PTReport.jsx`.

Keep the existing trainer aggregation table below.

---

## 7. Club Health Dashboard

### Backend: `GET /reports/club-health`

New endpoint in `auth/src/routes/reports.js`.

Query params: `start_date`, `end_date`, `location_slug`, `location_id`

Queries `ghl_contacts_report` where `member_sign_date` is not null, filtered by location and date range.

Returns:
```json
{
  "total_vips": 42,
  "total_same_day_sales": 18,
  "total_day_ones_booked": 35,
  "day_one_booked": { "Yes": 35, "No": 120 },
  "day_one_status": { "Completed": 20, "Scheduled": 10, "No Show": 5 },
  "day_one_sale": { "Sale": 12, "No Sale": 8 }
}
```

Aggregation logic:
- `total_vips`: sum of `parseInt(vip_count)` across contacts
- `total_same_day_sales`: count where `same_day_sale === 'Yes'`
- `total_day_ones_booked`: count where `day_one_booked === 'Yes'`
- `day_one_booked`: group contacts by `day_one_booked` value, count each
- `day_one_status`: group contacts where `day_one_booked === 'Yes'` by `day_one_status`, count each
- `day_one_sale`: group contacts where `day_one_status === 'Completed'` by `day_one_sale`, count each

### Frontend: `ClubHealthReport.jsx`

**Layout:**
1. **Big number cards** (3 across): Total VIPs, Total Same Day Sales, Total Day Ones Booked
2. **Pie charts** (3 across):
   - Day One Booked: Yes vs No
   - Day One Status: Scheduled / Completed / No Show / etc.
   - Day One Sale: Sale vs No Sale

**Pie chart implementation:** SVG with `conic-gradient` via inline styles, or SVG `circle` elements with `stroke-dasharray`. No external charting library.

Each pie chart has a legend below it showing the values.

### API (`api.js`)

Add: `getClubHealthReport(params)`

---

## 8. Bug Fixes

### 8a. Guard `res.json()` in `api.js`

```javascript
export async function api(path, options = {}) {
  const headers = { ... }
  const res = await fetch(API_URL + path, { ...options, headers })
  let data
  try {
    data = await res.json()
  } catch {
    throw new Error('Server error — please try again')
  }
  if (!res.ok) throw new Error(data.error || 'Request failed')
  return data
}
```

### 8b. Date validation in `reports.js`

```javascript
function dateToMs(dateStr, endOfDay = false) {
  if (!dateStr) return null
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) return null
  const d = endOfDay ? new Date(dateStr + 'T23:59:59.999Z') : new Date(dateStr + 'T00:00:00.000Z')
  if (isNaN(d.getTime())) return null
  return d.getTime().toString()
}
```

### 8c. Sync status error handling (`syncStatus.js`)

Add error checks to the three unguarded queries (recentLogs, lastFull, lastDelta). Use optional fallbacks — don't fail the whole response if one query fails.

### 8d. Remove Pipeline code

- Delete `portal/src/components/reports/PipelineReport.jsx`
- Remove Pipeline imports and references from `ReportingView.jsx`
- Remove `/reports/pipelines` endpoint from `auth/src/routes/reports.js`
- Remove `getPipelineReport` from `api.js`

### 8e. PDF export improvement

Set `document.title` before calling `window.print()`, restore after:

```javascript
export function exportPDF(reportName) {
  const prev = document.title
  if (reportName) document.title = reportName
  window.print()
  document.title = prev
}
```

---

## Files Changed

### Portal (frontend)
| File | Change |
|------|--------|
| `portal/src/App.jsx` | Add hash routing, detect `#reporting` |
| `portal/src/components/ToolGrid.jsx` | Reporting tile opens `_blank` with hash |
| `portal/src/components/ReportingView.jsx` | Tile grid + sub-navigation via hash, remove pipeline tab, new date layout |
| `portal/src/components/reports/ClubHealthReport.jsx` | **NEW** — dashboard with pie charts |
| `portal/src/components/reports/SalespersonStats.jsx` | Remove Day One No, add Same Day Sale column |
| `portal/src/components/reports/PTReport.jsx` | Add Day One breakdown table |
| `portal/src/components/reports/MembershipReport.jsx` | No changes (trial conversion fixed in backend) |
| `portal/src/components/reports/PipelineReport.jsx` | **DELETE** |
| `portal/src/components/reports/AdReports.jsx` | No changes |
| `portal/src/lib/api.js` | Add `getClubHealthReport`, remove `getPipelineReport`, guard JSON parse |
| `portal/src/lib/export.js` | Improve PDF export with title |

### Auth API (backend)
| File | Change |
|------|--------|
| `auth/src/routes/reports.js` | Fix membership trial conversion, add club-health endpoint, update salesperson-stats aggregation, add date validation, remove pipelines endpoint |
| `auth/src/routes/syncStatus.js` | Add error handling to 3 queries |

### Electron (launcher)
| File | Change |
|------|--------|
| `launcher/src/main.js` | Update `URL_TAB_NAMES` and `getTabName()` for reporting hash |
