# Business-Hours Speed to Lead — Design

**Date:** 2026-06-30
**Status:** Approved, building
**Branch:** `feat/business-hours-stl`

## Objective

Surface speed-to-lead (STL) two ways for every Membership-pipeline opportunity:

1. **Raw STL** — wall-clock minutes between opportunity creation and first human
   contact. The honest customer-experience number (already shipped).
2. **Business-hours STL** — the same span with after-hours and weekend time
   clamped out, so a lead created at 11pm and contacted at 6:15am next morning
   reads as the contactable minutes inside staffed hours, not 7+ hours.

This is an **experimental admin item**, added beside the existing "Speed to Lead
Audit" tile without touching it.

## What already exists (reuse, do not rebuild)

- **`ghl_first_contact`** (migration `ghl-sync/008_first_contact.sql`) — per
  opportunity: `opportunity_created_at`, `first_human_contact_at` (kind `sms` |
  `call`), `location_id`, `contact_id`. This IS the `first_contact_at` the
  handoff describes; it is derived from GHL conversations, not a Twilio softphone.
  No new data source is needed.
- **`computeFirstContact.js`** in ghl-sync keeps it current on every sync.
- **`GET /reports/speed-to-lead`** and **`/reports/speed-to-lead/audit`** — raw
  median/mean + per-lead breakdown with skip reasons (`dnd`, `not_new_lead`,
  `contact_before_create`, `no_human_contact`). These stay byte-for-byte
  unchanged.
- **`SpeedToLeadAudit.jsx`** admin tile in the "Reports & KPIs" group. Untouched.

The only genuinely new work is the business-hours clamp, the per-location window
config, and a new tile surfacing both numbers side by side.

## Configuration

Staffed lead-response window, confirmed with Justin: **08:00–20:00, all 7 days,
all locations, `America/Los_Angeles`.** No holiday exclusion in v1.

New table `stl_business_hours_config`, one row per location so a future
non-Pacific club or different hours is a one-row edit, not a code change:

| column | type | seed |
| --- | --- | --- |
| `location_id` | text PK → `ghl_locations(id)` | each GHL location |
| `timezone` | text | `America/Los_Angeles` |
| `window_start` | time | `08:00` |
| `window_end` | time | `20:00` |
| `active_days` | int[] (0=Sun..6=Sat) | `{0,1,2,3,4,5,6}` |
| `updated_at` | timestamptz | `now()` |

RLS enabled, no policy (service-role only, per portal convention).

## Time math lives in Postgres

DST correctness is the whole reason to put the clamp in Postgres: `AT TIME ZONE`
resolves local wall-clock boundaries per date automatically.

### `business_seconds(start_ts, end_ts, tz, win_start, win_end, active_days) → bigint`

`LANGUAGE sql STABLE`. Walks each local calendar day the span touches via
`generate_series`, and for each active day sums the overlap of `[start, end]`
with `[day + win_start, day + win_end]` (both converted to instants via
`AT TIME ZONE tz`). `least`/`greatest` normalize a reversed span; `greatest(0,…)`
per day guards partial/zero overlaps. Days whose `dow` is not in `active_days`
contribute nothing (this is also how weekends and future holidays drop out).

### `speed_to_lead_business(p_location_ids, p_start, p_end, p_limit) → table`

`LANGUAGE sql STABLE`. Joins `ghl_first_contact` → `stl_business_hours_config`
and returns, per opportunity: `opportunity_id, contact_id, location_id,
opportunity_created_at, first_human_contact_at, first_contact_kind,
raw_seconds, business_seconds`. `raw_seconds` and `business_seconds` are NULL
when `first_human_contact_at` is NULL (still awaiting contact). Filters by
location ids (NULL = all) and the created-at date window; orders newest first;
caps at `p_limit` (default 5000). Config falls back to the 08:00–20:00 / all-days
/ Pacific defaults via `coalesce` if a location row is missing.

## New endpoint: `GET /reports/speed-to-lead/business-audit`

Query: `start_date`, `end_date`, `location_slug`, `limit`. Self-contained (does
not modify the proven raw endpoints; the shared New-Lead/DND filter logic is
duplicated rather than refactoring live code). Steps:

1. Resolve `location_slug` → GHL location ids (same helper as the raw audit).
2. Call `speed_to_lead_business` RPC for raw + business seconds per opportunity.
3. Fetch the rows' opportunities (`stage_id`, `created_at_ghl`,
   `last_stage_change_at`, `updated_at_ghl`) and contacts (`dnd`, name), then
   apply the **same** classification as the raw audit:
   - DND contact → `dnd`
   - not a genuine New-Lead entrant → `not_new_lead`
   - `first_human_contact_at` NULL → `no_human_contact` (excluded from medians)
   - raw minutes < 0 → `contact_before_create`
   - else → `counted`, `included = true`
4. Per included row emit `raw_minutes` and `business_minutes`
   (`round(seconds/60)`).
5. Summary: `raw_median_minutes`, `business_median_minutes`, `counted_count`,
   `uncontacted_count`, plus the exclusion counts.

Response: `{ rows, returned, truncated, summary }`.

## New admin tile: `BusinessHoursSpeedToLead.jsx`

Key `business-hours-stl`, registered in `EXPERIMENTAL_TILES` (gets the Beta
badge) and assigned to the **Reports & KPIs** category. Mirrors
`SpeedToLeadAudit.jsx` (location selector, quick date ranges, status-filter
chips, CSV/PDF export) and adds:

- Two median cards side by side: **Raw STL** and **Business-Hours STL**
  (`formatMinutes`).
- Table with **both** speed columns (Raw / Business) per lead, so the
  after-hours gap is visible row by row.
- All content in `bg-surface` cards (dark-backdrop-safe, per the portal's
  recurring invisibility gotcha).

`api.js` gets `getSpeedToLeadBusinessAudit(params, options)` mirroring
`getSpeedToLeadAudit`.

## Worked example (real 08:00–20:00 window)

Lead in 8:50pm Mon, contacted 6:10am Tue → business STL **0 min** (both instants
outside 08:00–20:00), while raw STL ≈ 9h20m. The two numbers together are the
point: business STL coaches staff responsiveness; raw STL exposes the
after-hours coverage gap.

## Edge cases

- `first_human_contact_at` NULL → undefined STL, reported as "awaiting contact,"
  excluded from both medians.
- Span entirely outside the window → business STL 0 (correct).
- DST transitions → handled by `timestamptz` + named timezone in Postgres.
- Multi-day / weekend gaps → the day-walk skips non-active days naturally.

## Out of scope for v1

- Per-location holiday list (table is structured to add later).
- GHL custom-field push of `business_stl_seconds` (deliverable 4 in the handoff;
  defer until there's demand for in-platform visibility).

## Files

- `ghl-sync/migrations/012_business_hours_stl.sql` — config table + seed +
  `business_seconds` + `speed_to_lead_business` + RLS.
- `auth/src/routes/reports.js` — `GET /reports/speed-to-lead/business-audit`.
- `portal/src/lib/api.js` — `getSpeedToLeadBusinessAudit`.
- `portal/src/components/admin/BusinessHoursSpeedToLead.jsx` — new tile.
- `portal/src/components/AdminPanel.jsx` — register tile + render.
