import { useEffect, useMemo, useState } from 'react'
import {
  ANALYTICS_REPORTS, REPORT_GROUPS, PINNED_REPORTS, ungroupedReports, reportByKey,
} from '../../../components/AnalyticsView'
import { isReportVisible } from '../../../components/analyticsReportCatalogue'
import { TOOLBAR_SLOT_ID } from '../../../components/analytics/toolbarSlot'
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

/** The picker: pinned reports first, then each group as an accordion. */
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
    <div className="space-y-3 pb-4">
      {top.length > 0 && (
        <div className="space-y-2">
          {top.map(r => <ReportRow key={r.key} report={r} onOpen={onOpen} />)}
        </div>
      )}

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
          <div key={group.key} className="bg-surface rounded-2xl border border-border overflow-hidden">
            <button
              type="button"
              onClick={() => toggle(group.key)}
              aria-expanded={open}
              className="w-full flex items-center justify-between gap-2 px-4 py-3 text-left"
            >
              <span className="text-sm font-bold text-text-primary">{group.label}</span>
              <span className="flex items-center gap-2">
                <span className="text-[11px] text-text-muted tabular-nums">{reports.length}</span>
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"
                  aria-hidden="true"
                  className={`w-4 h-4 text-text-muted transition-transform ${open ? 'rotate-180' : ''}`}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
                </svg>
              </span>
            </button>
            {open && (
              <div className="border-t border-border divide-y divide-border">
                {reports.map(r => (
                  <ReportRow key={r.key} report={r} onOpen={onOpen} flush />
                ))}
              </div>
            )}
          </div>
        )
      })}
    </div>
  )
}

function ReportRow({ report, onOpen, flush = false }) {
  return (
    <button
      type="button"
      onClick={() => onOpen(report.key)}
      className={`w-full flex items-center justify-between gap-3 text-left px-4 py-3 ${
        flush ? '' : 'bg-surface rounded-2xl border border-border'
      }`}
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
      <div className="px-4 py-10 text-center text-sm text-text-muted">
        That report is no longer available.
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

      <div className="overflow-x-auto">
        {/* A floor width keeps a wide table readable inside the scroller rather
            than crushed into the phone's width one character per column. */}
        <div className="min-w-[340px]">
          <Component
            user={user}
            isAdmin={user?.staff?.role === 'admin'}
            location={locationSlug}
            locationSlug={locationSlug}
            startDate={startDate}
            endDate={endDate}
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
