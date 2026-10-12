import { useEffect, useMemo, useRef, useState } from 'react'
import {
  ANALYTICS_REPORTS, REPORT_GROUPS, CORE_REPORTS, ungroupedReports, reportByKey,
} from '../../../components/AnalyticsView'
import { isReportVisible } from '../../../components/analyticsReportCatalogue'
import { TOOLBAR_SLOT_ID } from '../../../components/analytics/toolbarSlot'
import ReportRecords from '../../../components/analytics/ReportRecords'
import { getAppSettings } from '../../../lib/api'
import {
  getFavorites, toggleFavorite, FAVORITES_EVENT, MAX_FAVORITES,
} from '../../../lib/analyticsFavorites'
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
// What IS mobile-specific is the SHAPE of the navigation: desktop has a
// persistent sidebar, which does not exist on a phone, so here the picker is a
// screen of its own and choosing a report replaces it. The STRUCTURE is the
// same on both — search, then the core reports flat, then Favorites, then All
// reports holding the groups — because somebody who learns where a report
// lives at their desk should find it in the same place on their phone.
//
// Favorites are the same list, not a second one: lib/analyticsFavorites keeps
// them in localStorage and lib/uiPrefs syncs that to user_ui_preferences, so a
// report starred on the phone is starred at the desk and the other way round.
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
  const [search, setSearch] = useState('')
  const visibility = useReportVisibility()
  const canSee = useCanSee(visibility, locationSlug)
  const favorites = useFavorites()

  // The core six, flat and always visible, exactly as desktop shows them. The
  // rest sit behind All reports.
  const core = CORE_REPORTS.map(k => reportByKey[k]).filter(Boolean).filter(r => canSee(r.key))

  // Starred order is the order they were starred in. A report hidden for this
  // club drops out of the list but stays in storage — a club filter is not an
  // unstar, and the phone must not quietly unstar what the desktop shows.
  const favoriteReports = favorites
    .map(k => reportByKey[k]).filter(Boolean).filter(r => canSee(r.key))

  // Filed under no group. Above the groups inside All reports, so a report
  // nobody categorised is the first thing seen rather than the last.
  const unfiled = ungroupedReports().map(k => reportByKey[k]).filter(Boolean).filter(r => canSee(r.key))

  const groups = REPORT_GROUPS.map(group => ({
    ...group,
    // Alphabetical within a group, matching desktop, and sorted here for the
    // same reason it is sorted there: a report added to a group lands in the
    // right place without anyone re-sorting REPORT_GROUPS.
    reports: group.reports
      .map(k => reportByKey[k])
      .filter(Boolean)
      .filter(r => canSee(r.key))
      .sort((a, b) => a.label.localeCompare(b.label, 'en', { sensitivity: 'base' })),
    // A group whose every report is hidden for this club is not an empty group,
    // it is not a group. A header promising nothing behind it is worse than no
    // header.
  })).filter(g => g.reports.length > 0)

  // Counted distinctly: a report filed under two groups is one report.
  const allCount = new Set([
    ...unfiled.map(r => r.key),
    ...groups.flatMap(g => g.reports.map(r => r.key)),
  ]).size

  // Typing flattens the tree entirely. Thirty-seven reports is more than anyone
  // scrolls through on a phone, and it is what makes a six-item core list safe:
  // being wrong about the six costs three keystrokes rather than a hunt.
  const term = search.trim().toLowerCase()
  const results = term
    ? ANALYTICS_REPORTS.filter(r => canSee(r.key) && r.label.toLowerCase().includes(term))
        .sort((a, b) => a.label.localeCompare(b.label, 'en', { sensitivity: 'base' }))
    : null

  // Somebody who has built a shortlist wants to see it, not open it every
  // visit. Once only, and only when the list actually arrives — hydrateUiPrefs
  // can land the server's copy after this mounts — so a deliberate collapse is
  // not reopened underneath them.
  const favoritesAutoOpened = useRef(false)
  useEffect(() => {
    if (favoritesAutoOpened.current || favorites.length === 0) return
    favoritesAutoOpened.current = true
    setOpenGroups(prev => new Set(prev).add(FAVORITES_KEY))
  }, [favorites])

  function toggle(key) {
    setOpenGroups(prev => {
      const next = new Set(prev)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })
  }

  const favoritesOpen = openGroups.has(FAVORITES_KEY)
  const allOpen = openGroups.has(ALL_KEY)

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
      <div className="px-4 pt-4 pb-3">
        <input
          type="search"
          value={search}
          onChange={e => setSearch(e.target.value)}
          placeholder="Search reports"
          aria-label="Search reports"
          // 16px, not smaller: iOS Safari zooms the whole page in on focus for
          // anything under it, and the reader then has to pinch back out.
          className="w-full px-3 py-2 rounded-xl text-base bg-bg border border-border text-text-primary placeholder:text-text-muted"
        />
      </div>
      <div className="h-px bg-border mx-4" />

      {results ? (
        results.length > 0 ? (
          results.map(r => <ReportRow key={r.key} report={r} onOpen={onOpen} />)
        ) : (
          <p className="px-4 py-6 text-sm text-text-muted">
            No report matches “{search.trim()}”.
          </p>
        )
      ) : (
        <>
          {/* The core six, opening directly, so they carry no +/-. */}
          {core.map(r => <ReportRow key={r.key} report={r} onOpen={onOpen} />)}

          {/* Favorites — the same starred list the desktop shows, off the same
              synced preference. Rendered even when empty so the way to fill it
              is discoverable from the phone too. */}
          <SectionRow
            label="Favorites"
            count={favoriteReports.length || null}
            open={favoritesOpen}
            onClick={() => toggle(FAVORITES_KEY)}
          />
          {favoritesOpen && (
            <div className="analytics-subpanel bg-bg border-b border-border py-1">
              {favoriteReports.length > 0 ? (
                favoriteReports.map(r => <SubReportRow key={r.key} report={r} onOpen={onOpen} />)
              ) : (
                <p className="px-7 py-2.5 text-[13px] leading-snug text-text-muted">
                  No favorites yet. Open a report and tap the star beside its title.
                </p>
              )}
            </div>
          )}

          <SectionRow
            label="All reports"
            count={allCount || null}
            open={allOpen}
            onClick={() => toggle(ALL_KEY)}
          />
          {allOpen && (
            <div className="analytics-subpanel bg-bg border-b border-border py-1">
              {unfiled.map(r => <SubReportRow key={r.key} report={r} onOpen={onOpen} />)}

              {groups.map(group => {
                const open = openGroups.has(group.key)
                return (
                  <div key={group.key}>
                    <button
                      type="button"
                      onClick={() => toggle(group.key)}
                      aria-expanded={open}
                      className="w-full flex items-center justify-between gap-3 px-7 py-2.5 text-left active:bg-surface transition-colors"
                    >
                      <span className={`text-sm text-text-primary ${open ? 'font-bold' : 'font-semibold'}`}>
                        {group.label}
                      </span>
                      <span className="flex items-center gap-2 flex-shrink-0">
                        <span className="text-[11px] font-semibold text-text-muted">{group.reports.length}</span>
                        <PlusMinus open={open} />
                      </span>
                    </button>
                    {open && (
                      <div className="bg-surface py-1">
                        {group.reports.map(r => (
                          <SubReportRow key={r.key} report={r} onOpen={onOpen} deep />
                        ))}
                      </div>
                    )}
                  </div>
                )
              })}
            </div>
          )}
        </>
      )}
    </div>
  )
}

// Kept distinct from any real group key so the three collapse states can never
// collide with each other.
const FAVORITES_KEY = '__favorites'
const ALL_KEY = '__all'

/** Read the starred list and follow it as it changes. */
function useFavorites() {
  const [favorites, setFavorites] = useState(getFavorites)
  useEffect(() => {
    const sync = () => setFavorites(getFavorites())
    window.addEventListener(FAVORITES_EVENT, sync)
    // hydrateUiPrefs writes localStorage directly on this tab; another tab
    // fires `storage` instead. Both have to land or the star and the list
    // disagree.
    window.addEventListener('storage', sync)
    return () => {
      window.removeEventListener(FAVORITES_EVENT, sync)
      window.removeEventListener('storage', sync)
    }
  }, [])
  return favorites
}

/**
 * The +/- mark on a collapsible row.
 *
 * Drawn rather than typed: a glyph "+" and a glyph "-" are different weights
 * and widths, so the mark jumps as it toggles. Two spans of the same bar, one
 * rotated away, do not.
 */
function PlusMinus({ open }) {
  return (
    <span className="relative w-3.5 h-3.5 flex-shrink-0" aria-hidden="true">
      <span className="absolute inset-x-0 top-1/2 h-0.5 -translate-y-1/2 bg-text-primary rounded-full" />
      <span
        className={`absolute inset-x-0 top-1/2 h-0.5 -translate-y-1/2 bg-text-primary rounded-full transition-transform duration-200 ${
          open ? 'rotate-0 opacity-0' : 'rotate-90'
        }`}
      />
    </span>
  )
}

/** A top-level collapsible row: Favorites, All reports. */
function SectionRow({ label, count, open, onClick }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-expanded={open}
      className="w-full flex items-center justify-between gap-3 px-4 py-3.5 text-left border-b border-border active:bg-bg transition-colors"
    >
      <span className={`text-sm text-text-primary ${open ? 'font-bold' : 'font-semibold'}`}>
        {label}
      </span>
      <span className="flex items-center gap-2 flex-shrink-0">
        {count ? <span className="text-[11px] font-semibold text-text-muted">{count}</span> : null}
        <PlusMinus open={open} />
      </span>
    </button>
  )
}

/** A report inside an open panel. `deep` is one level further in. */
function SubReportRow({ report, onOpen, deep = false }) {
  return (
    <button
      type="button"
      onClick={() => onOpen(report.key)}
      className={`w-full text-left py-2.5 active:bg-surface transition-colors ${deep ? 'pl-10 pr-7' : 'px-7'}`}
    >
      <span className="block text-sm text-text-primary">{report.label}</span>
      {report.desc && (
        <span className="block text-[11px] text-text-muted truncate">{report.desc}</span>
      )}
    </button>
  )
}

/**
 * The star beside a report's title, and the ONLY way in or out of Favorites —
 * the same call the desktop makes. You star a report having read it and decided
 * it is worth coming back to, which is not a judgement you can make from a nav
 * list, and it keeps the picker a list of reports rather than a column of
 * controls.
 *
 * Rendered into MobileHeader's rightAction, so it sits beside the title exactly
 * where the desktop puts it.
 */
export function MobileFavoriteStar({ reportKey }) {
  const favorites = useFavorites()
  const favorite = favorites.includes(reportKey)
  const blocked = !favorite && favorites.length >= MAX_FAVORITES
  const label = favorite
    ? 'Remove from Favorites'
    : blocked
      ? `Favorites is full (${MAX_FAVORITES}). Remove one first.`
      : 'Add to Favorites'

  return (
    <button
      type="button"
      onClick={() => toggleFavorite(reportKey)}
      disabled={blocked}
      aria-pressed={favorite}
      aria-label={label}
      title={label}
      // A 40px box, not a 20px icon: this is a touch target beside a back
      // button that already has one.
      className={`flex items-center justify-center w-10 h-10 -mr-2 rounded-lg active:bg-bg transition-colors ${
        favorite ? 'text-wcs-red' : 'text-text-muted'
      } ${blocked ? 'opacity-40' : ''}`}
    >
      <svg
        viewBox="0 0 24 24" fill={favorite ? 'currentColor' : 'none'} stroke="currentColor"
        strokeWidth="2" aria-hidden="true" className="w-5 h-5"
      >
        <path
          strokeLinecap="round" strokeLinejoin="round"
          d="M11.48 3.5a.56.56 0 011.04 0l2.13 4.87 5.3.48c.5.05.7.67.32 1l-4 3.5 1.18 5.2c.11.49-.42.88-.85.62L12 16.42l-4.6 2.75c-.43.26-.96-.13-.85-.62l1.18-5.2-4-3.5c-.38-.33-.18-.95.32-1l5.3-.48 2.13-4.87z"
        />
      </svg>
    </button>
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
            note={report.recordsNote}
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
