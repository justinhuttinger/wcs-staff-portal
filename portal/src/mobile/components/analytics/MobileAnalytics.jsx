import { useEffect, useMemo, useState } from 'react'
import {
  ANALYTICS_REPORTS, REPORT_GROUPS, PINNED_REPORTS, ungroupedReports, reportByKey,
} from '../../../components/AnalyticsView'
import { isReportVisible } from '../../../components/analyticsReportCatalogue'
import { TOOLBAR_SLOT_ID } from '../../../components/analytics/toolbarSlot'
import ReportRecords from '../../../components/analytics/ReportRecords'
import { getAppSettings } from '../../../lib/api'
import { LOCATION_NAMES } from '../../../config/locations'

// ---------------------------------------------------------------------------
// Analytics on mobile.
//
// THE SAME REGISTRY THE DESKTOP RENDERS, not a mobile copy of it. Every report
// component, its key, its label and whether it manages its own dates all come
// from ANALYTICS_REPORTS in components/AnalyticsView. A second list would fall
// behind the first time somebody added a report and only remembered one file,
// and there are 35 of them.
//
// What IS mobile-specific is the navigation: desktop has a persistent sidebar
// with every group down the left, which does not exist on a phone. Here the
// picker is a screen of its own and choosing a report replaces it.
//
// Per-club visibility (the report_off_* settings an admin sets) is applied here
// too, on the same rule as desktop. A report hidden for a club must not simply
// reappear because the reader picked up their phone.
// ---------------------------------------------------------------------------

/**
 * The picker: one full-bleed stacked list, the way a phone navigation menu
 * behaves rather than the way a desktop sidebar does.
 *
 * Rows run edge to edge and sit flush against each other, separated by a single
 * hairline, with a +/- on the right of each group. Opening one drops its reports
 * in as a contrasting inset panel between the row that was tapped and the next
 * one, so the list reads as a single column that grows rather than a set of
 * floating cards that shuffle.
 *
 * Cards were the wrong shape here. This screen is navigation, not content: the
 * gaps and rounded corners implied each group was a thing in its own right, when
 * the only job is to get to a report in as few taps and as little scanning as
 * possible.
 *
 * The panel takes bg while the rows take surface, so the open group is set apart
 * by tone rather than by an outline, and it inverts correctly under Press
 * (white ground) without a second set of colours.
 */
export function MobileAnalyticsHome({ locationSlug, onOpen }) {
  const [openGroups, setOpenGroups] = useState(() => new Set())
  const visibility = useReportVisibility()
  const canSee = useCanSee(visibility, locationSlug)

  const top = [...PINNED_REPORTS, ...ungroupedReports()]
    .filter(canSee)
    .map(k => reportByKey[k])
    .filter(Boolean)

  function toggle(key) {
    setOpenGroups(prev => {
      const next = new Set(prev)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })
  }

  return (
    // No negative margin: the route gives this component the full width and
    // pads only its own header. The earlier -mx-4 was trying to escape a px-4
    // wrapper, and could not — MobileReportShell hands its children an
    // overflow-y-auto box, and an element with overflow on one axis gets it on
    // the other too, so the bleed was clipped and left a sideways scroll.
    // No background or border of its own: the route wraps this whole screen in
    // one surface, so a second one here would draw a seam across the middle of
    // it and double the hairline under the club selector.
    <div className="pb-6">
      <p className="px-4 pt-4 pb-2 text-sm font-bold text-text-primary">
        Browse Reports
      </p>
      <div className="h-px bg-border mx-4" />

      {/* Pinned and unfiled reports open directly, so they carry no +/-. They
          lead because they are the ones opened most. */}
      {top.map(r => (
        <ReportRow key={r.key} report={r} onOpen={onOpen} />
      ))}

      {REPORT_GROUPS.map(group => {
        // Alphabetical within a group, matching desktop, and sorted here for the
        // same reason it is sorted there: a report added to a group lands in the
        // right place without anyone re-sorting REPORT_GROUPS.
        const reports = group.reports
          .map(k => reportByKey[k])
          .filter(Boolean)
          .filter(r => canSee(r.key))
          .sort((a, b) => a.label.localeCompare(b.label, 'en', { sensitivity: 'base' }))
        // A group whose every report is hidden for this club is not an empty
        // group, it is not a group. A header promising nothing behind it is
        // worse than no header.
        if (reports.length === 0) return null
        const open = openGroups.has(group.key)

        return (
          <div key={group.key}>
            <button
              type="button"
              onClick={() => toggle(group.key)}
              aria-expanded={open}
              className="w-full flex items-center justify-between gap-3 px-4 py-3.5 text-left border-b border-border active:bg-bg transition-colors"
            >
              <span className={`text-sm text-text-primary ${open ? 'font-bold' : 'font-semibold'}`}>
                {group.label}
              </span>
              {/* Drawn rather than typed: a glyph "+" and a glyph "-" are
                  different weights and widths, so the mark jumps as it toggles.
                  Two spans of the same bar, one rotated away, do not. */}
              <span className="relative w-3.5 h-3.5 flex-shrink-0" aria-hidden="true">
                <span className="absolute inset-x-0 top-1/2 h-0.5 -translate-y-1/2 bg-text-primary rounded-full" />
                <span
                  className={`absolute inset-x-0 top-1/2 h-0.5 -translate-y-1/2 bg-text-primary rounded-full transition-transform duration-200 ${
                    open ? 'rotate-0 opacity-0' : 'rotate-90'
                  }`}
                />
              </span>
            </button>

            {open && (
              // The contrasting panel. Inset text, no per-row rules: this is a
              // short list inside an open section, and hairlines between seven
              // items would compete with the ones separating the groups.
              //
              // The class carries the Press case: that theme sets bg and surface
              // to the SAME white, so bg-bg alone would leave an open group with
              // no contrast at all. index.css gives it the press band instead.
              <div className="analytics-subpanel bg-bg border-b border-border py-1">
                {reports.map(r => (
                  <button
                    key={r.key}
                    type="button"
                    onClick={() => onOpen(r.key)}
                    className="w-full text-left px-7 py-2.5 active:bg-surface transition-colors"
                  >
                    <span className="block text-sm text-text-primary">{r.label}</span>
                    {r.desc && (
                      <span className="block text-[11px] text-text-muted truncate">{r.desc}</span>
                    )}
                  </button>
                ))}
              </div>
            )}
          </div>
        )
      })}
    </div>
  )
}

/** A report that opens straight from the top of the list. */
function ReportRow({ report, onOpen }) {
  return (
    <button
      type="button"
      onClick={() => onOpen(report.key)}
      className="w-full flex items-center justify-between gap-3 text-left px-4 py-3.5 border-b border-border active:bg-bg transition-colors"
    >
      <span className="min-w-0">
        <span className="block text-sm font-semibold text-text-primary truncate">{report.label}</span>
        {report.desc && (
          <span className="block text-[11px] text-text-muted truncate">{report.desc}</span>
        )}
      </span>
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"
        aria-hidden="true" className="w-4 h-4 text-text-muted flex-shrink-0">
        <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
      </svg>
    </button>
  )
}

/**
 * One report.
 *
 * The desktop component is rendered as-is. Its charts are already width-driven
 * and its stat cards already wrap, but its WIDE TABLES are not: PT Scorecard is
 * twenty-odd columns. Rather than maintain a second narrow build of thirty-five
 * reports, the report gets a horizontal scroller of its own and the page itself
 * never scrolls sideways, which is the rule the rest of the portal follows for
 * wide content.
 *
 * THE TOOLBAR SLOT IS WHY THE CONTROLS APPEAR AT ALL. Twenty-five of the report
 * components own controls that belong beside the shared date range rather than
 * buried in the report body — the person picker on Salesperson Snapshot and
 * Trainer Snapshot, the day picker on Daily Snapshot, the member-count toggle on
 * PT Scorecard — and every one of them portals into an element with this id and
 * renders NOTHING when it is absent. The desktop shell provides it; without one
 * here, those reports came up on mobile with no way to drive them. Providing the
 * element is the whole fix, and it fixes all twenty-five at once rather than the
 * two that got noticed.
 *
 * It is safe to reuse the id: only one report is mounted at a time on mobile and
 * the desktop shell is not mounted at all, so there is never a second element
 * competing for the same portal target.
 */
export function MobileAnalyticsReport({ reportKey, user, startDate, endDate, locationSlug }) {
  const report = reportByKey[reportKey]
  if (!report) {
    return (
      <div className="px-4 py-6">
        <div className="bg-surface rounded-2xl border border-border shadow-sm px-4 py-8 text-center text-sm text-text-muted">
          That report is no longer available.
        </div>
      </div>
    )
  }
  const Component = report.Component
  return (
    <div className="px-3 pb-6">
      {/* Rendered in the same commit as the report below it, so the child's
          getElementById in its mount effect already finds it: React commits the
          whole tree to the DOM before running any effect.

          Stacked, not laid out in a row: these controls were built for a wide
          desktop header, and a person search alone is a label plus a 190px
          input, which does not sit beside anything else on a phone. Collapses
          to nothing when the report has no toolbar (empty:hidden), so the
          reports without one gain no empty box. */}
      <div
        id={TOOLBAR_SLOT_ID}
        className="flex flex-col items-stretch gap-3 empty:hidden mb-3 bg-surface rounded-2xl border border-border px-3 py-2.5"
      />

      {/* NO SIDEWAYS SCROLL ON THE PAGE. This used to be an overflow-x-auto
          scroller around a w-max box, which let a report be as wide as it liked
          and made the reader drag the whole page around to read one number.

          Now the report is held to the screen and the .analytics-mobile rules
          in index.css do the work: every grid collapses to one column, every
          fixed min-width is released, and charts measure their container so
          they redraw at the phone's width on their own.

          overflow-x: clip rather than hidden or auto — those two force the
          other axis to auto as well, which would nest a second vertical
          scroller inside the page's own. clip is the one value that stops
          horizontal overflow without doing that, and it leaves the inner
          scrollers on wide data tables working.

          Wide TABLES keep a scroller of their own. Twenty-odd columns cannot be
          stacked without losing the header each number belongs to, and the
          honest alternative — dropping columns on small screens — hides data
          without saying so. The page never moves sideways; the table does. */}
      <div className="analytics-mobile" style={{ overflowX: 'clip' }}>
        <Component
          user={user}
          isAdmin={user?.staff?.role === 'admin'}
          location={locationSlug}
          locationSlug={locationSlug}
          startDate={startDate}
          endDate={endDate}
        />

        {/* The same Data section desktop gets, from the same declaration on the
            report's registry entry. */}
        <div className="mt-3">
          <ReportRecords
            sets={report.records}
            params={{ start: startDate, end: endDate, clubs: locationSlug || 'all' }}
          />
        </div>
      </div>
    </div>
  )
}

/** True when the report manages its own dates and the shell should offer none. */
export function reportHidesDates(reportKey) {
  return reportByKey[reportKey]?.dates === false
}

export function reportLabel(reportKey) {
  return reportByKey[reportKey]?.label || 'Analytics'
}

export function analyticsReportKeys() {
  return ANALYTICS_REPORTS.map(r => r.key)
}

// ---------------------------------------------------------------------------
// Shared visibility plumbing.
// ---------------------------------------------------------------------------

function useReportVisibility() {
  const [visibility, setVisibility] = useState(null)
  useEffect(() => {
    let alive = true
    getAppSettings('report_off_')
      .then(map => { if (alive) setVisibility(map || {}) })
      // A failed load leaves everything visible. Hiding reports because a
      // settings call failed would be the worse error, same as on desktop.
      .catch(() => { if (alive) setVisibility({}) })
    return () => { alive = false }
  }, [])
  return visibility
}

function useCanSee(visibility, locationSlug) {
  // 'all' means every club, not "no filter" — otherwise picking All would
  // bypass the toggles entirely.
  const slugs = useMemo(() => (
    !locationSlug || locationSlug === 'all'
      ? LOCATION_NAMES.map(n => n.toLowerCase())
      : String(locationSlug).split(',').map(x => x.trim()).filter(Boolean)
  ), [locationSlug])
  return useMemo(
    () => (key) => isReportVisible(visibility, key, slugs),
    [visibility, slugs]
  )
}
