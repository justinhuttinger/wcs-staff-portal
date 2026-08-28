import BaseKpiReport from '../reports/KpiReport'

// ---------------------------------------------------------------------------
// KPIs — Analytics (admin only)
//
// The same report as Reporting > KPIs, drawn differently where it counts.
//
// NOTHING ABOUT THE DATA IS RESTATED HERE. The definitions, the fetchers, the
// derive functions and the goals out of app_config all come from the report
// this wraps. Copying that layer to change how it looks would have created two
// versions of every KPI, free to drift the first time a definition moved, and
// the goals in Admin would have had to be applied to both.
//
// The only difference is the multi-club expansion. There the original shows a
// table of Actual / Goal / Hit-or-Missed; this shows one bar per club against a
// shared scale with the goal marked on the track, so which clubs are short — and
// by how much — is read by looking rather than by comparing a column of numbers.
//
// Single-club is deliberately untouched: the change-over-time trend with its
// dashed goal line is the thing worth keeping, so it is kept exactly.
// ---------------------------------------------------------------------------

export default function KpiReport({ startDate, endDate, locationSlug }) {
  return (
    <BaseKpiReport
      startDate={startDate}
      endDate={endDate}
      locationSlug={locationSlug}
      multiClubView="bars"
    />
  )
}
