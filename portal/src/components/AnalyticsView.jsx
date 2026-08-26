import { useState, useEffect } from 'react'
import { LOCATION_OPTIONS as LOCATIONS } from '../config/locations'
import LocationMultiSelect from './LocationMultiSelect'
import SalespersonPerformance from './analytics/SalespersonPerformance'
import Topline from './analytics/Topline'
import ClubActivityTrends from './analytics/ClubActivityTrends'
import { TOOLBAR_SLOT_ID } from './analytics/toolbarSlot'

// ---------------------------------------------------------------------------
// Analytics — an admin-only reporting surface, separate from ReportingView.
//
// This is a staging ground for reports that are being rebuilt/reshaped before
// they graduate into the main Reporting view. Nothing here is visible to any
// role below `admin`: the tile is hidden in ToolGrid, App.jsx refuses to mount
// this view, and every server route these reports call must apply its own
// admin gate (client gating alone is not a gate).
//
// To add a report: drop a component in ./analytics/ and register it below.
// ---------------------------------------------------------------------------

const ANALYTICS_ICONS = {
  salespersonPerformance: 'M18 18.72a9.094 9.094 0 0 0 3.741-.479 3 3 0 0 0-4.682-2.72m.94 3.198.001.031c0 .225-.012.447-.037.666A11.944 11.944 0 0 1 12 21c-2.17 0-4.207-.576-5.963-1.584A6.062 6.062 0 0 1 6 18.719m12 0a5.971 5.971 0 0 0-.941-3.197m0 0A5.995 5.995 0 0 0 12 12.75a5.995 5.995 0 0 0-5.058 2.772m0 0a3 3 0 0 0-4.681 2.72 8.986 8.986 0 0 0 3.74.477m.94-3.197a5.971 5.971 0 0 0-.94 3.197M15 6.75a3 3 0 1 1-6 0 3 3 0 0 1 6 0Z',
  topline: 'M3.75 3v11.25A2.25 2.25 0 0 0 6 16.5h2.25M3.75 3h-1.5m1.5 0h16.5m0 0h1.5m-1.5 0v11.25A2.25 2.25 0 0 1 18 16.5h-2.25m-7.5 0h7.5m-7.5 0-1 3m8.5-3 1 3m0 0 .5 1.5m-.5-1.5h-9.5m0 0-.5 1.5M9 11.25v1.5M12 9v3.75m3-6v6',
  trends: 'M2.25 18 9 11.25l4.306 4.307a11.95 11.95 0 0 1 5.814-5.518l2.74-1.22m0 0-5.94-2.281m5.94 2.28-2.28 5.941',
  placeholder: 'M3 13.125C3 12.504 3.504 12 4.125 12h2.25c.621 0 1.125.504 1.125 1.125v6.75C7.5 20.496 6.996 21 6.375 21h-2.25A1.125 1.125 0 0 1 3 19.875v-6.75ZM9.75 8.625c0-.621.504-1.125 1.125-1.125h2.25c.621 0 1.125.504 1.125 1.125v11.25c0 .621-.504 1.125-1.125 1.125h-2.25a1.125 1.125 0 0 1-1.125-1.125V8.625ZM16.5 4.125c0-.621.504-1.125 1.125-1.125h2.25C20.496 3 21 3.504 21 4.125v15.75c0 .621-.504 1.125-1.125 1.125h-2.25a1.125 1.125 0 0 1-1.125-1.125V4.125Z',
}

// Ordered registry. `Component` receives
// { user, isAdmin, location, locationSlug, startDate, endDate }.
// `dates: false` hides the date-range controls for reports that manage their own.
const ANALYTICS_REPORTS = [
  {
    key: 'topline',
    label: 'Topline',
    desc: 'Headline Numbers',
    icon: ANALYTICS_ICONS.topline,
    Component: Topline,
    // Its windows are month-to-date / trailing 30 days / trailing 3 months,
    // anchored on the latest data date, so a shared range would mislead.
    dates: false,
  },
  {
    key: 'salesperson-performance',
    label: 'Salesperson Performance',
    desc: 'New Member Units',
    icon: ANALYTICS_ICONS.salespersonPerformance,
    Component: SalespersonPerformance,
  },
  {
    key: 'club-activity',
    label: 'Club Activity Trends',
    desc: 'Year over Year',
    icon: ANALYTICS_ICONS.trends,
    Component: ClubActivityTrends,
    // Its window is a fixed trailing 13 months against the same months a year
    // earlier, so the shared date range would do nothing but mislead.
    dates: false,
  },
]

const QUICK_RANGES = [
  { key: 'this_month', label: 'This Month' },
  { key: 'last_month', label: 'Last Month' },
  { key: 'last_30', label: 'Last 30 Days' },
  { key: 'last_90', label: 'Last 90 Days' },
  { key: 'ytd', label: 'YTD' },
]

function getQuickRange(key) {
  const now = new Date()
  const today = now.toISOString().split('T')[0]
  switch (key) {
    case 'this_month':
      return { start: new Date(now.getFullYear(), now.getMonth(), 1).toISOString().split('T')[0], end: today }
    case 'last_month': {
      const s = new Date(now.getFullYear(), now.getMonth() - 1, 1)
      const e = new Date(now.getFullYear(), now.getMonth(), 0)
      return { start: s.toISOString().split('T')[0], end: e.toISOString().split('T')[0] }
    }
    case 'last_30': {
      const s = new Date(now)
      s.setDate(s.getDate() - 30)
      return { start: s.toISOString().split('T')[0], end: today }
    }
    case 'last_90': {
      const s = new Date(now)
      s.setDate(s.getDate() - 90)
      return { start: s.toISOString().split('T')[0], end: today }
    }
    case 'ytd':
      return { start: new Date(now.getFullYear(), 0, 1).toISOString().split('T')[0], end: today }
    default:
      return { start: today, end: today }
  }
}

// Hash format: `#analytics` or `#analytics/<reportKey>`.
function parseHash() {
  const hash = window.location.hash
  if (!hash.startsWith('#analytics/')) return null
  const slug = hash.replace('#analytics/', '')
  return ANALYTICS_REPORTS.some(r => r.key === slug) ? slug : null
}

export default function AnalyticsView({ user, onBack, location, isAdmin }) {
  const defaultReportKey = ANALYTICS_REPORTS[0]?.key || null
  const [activeReport, setActiveReport] = useState(() => parseHash() || defaultReportKey)
  const initialRange = getQuickRange('this_month')
  const [startDate, setStartDate] = useState(initialRange.start)
  const [endDate, setEndDate] = useState(initialRange.end)
  const [activeQuick, setActiveQuick] = useState('this_month')
  const [locationSlug, setLocationSlug] = useState('all')

  useEffect(() => {
    if (activeReport && parseHash() !== activeReport) {
      window.location.hash = '#analytics/' + activeReport
    }
    function onHashChange() {
      setActiveReport(parseHash() || defaultReportKey)
    }
    window.addEventListener('hashchange', onHashChange)
    return () => window.removeEventListener('hashchange', onHashChange)
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  // Belt-and-braces: App.jsx already refuses to mount this for non-admins.
  if (!isAdmin) return null

  function navigateToReport(reportKey) {
    window.location.hash = '#analytics/' + reportKey
    setActiveReport(reportKey)
  }

  function applyQuickRange(key) {
    setActiveQuick(key)
    const r = getQuickRange(key)
    setStartDate(r.start)
    setEndDate(r.end)
  }

  function handleDateChange(field, value) {
    setActiveQuick(null)
    if (field === 'start') setStartDate(value)
    else setEndDate(value)
  }

  const active = ANALYTICS_REPORTS.find(r => r.key === activeReport) || null
  const showDateControls = active ? active.dates !== false : true
  const ActiveComponent = active?.Component || null

  return (
    // Wider than ReportingView's max-w-7xl: these boards are deliberately
    // column-heavy, and squeezing them into 80rem makes every table scroll.
    <div className="w-full px-6 py-6 max-w-[1800px] mx-auto flex gap-6">
      {/* Left sidebar */}
      <aside className="w-56 flex-shrink-0 hidden md:block">
        <div className="bg-surface rounded-xl border border-border p-2 sticky top-6 max-h-[calc(100vh_-_3rem)] overflow-y-auto">
          {onBack && (
            <button
              type="button"
              onClick={onBack}
              className="press-hide-back w-full flex items-center gap-2 px-3 py-2 text-[11px] uppercase tracking-wide text-text-muted hover:text-text-primary font-semibold transition-colors"
            >
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="w-3.5 h-3.5">
                <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" />
              </svg>
              Back to Portal
            </button>
          )}
          <div className="flex items-center gap-2 px-3 pt-1 pb-3">
            <span className="text-lg font-bold text-text-primary">Analytics</span>
            <span className="px-1.5 py-0.5 rounded text-[10px] font-bold uppercase tracking-wide bg-wcs-red/10 text-wcs-red">Admin</span>
          </div>
          <ul className="space-y-0.5">
            {ANALYTICS_REPORTS.map(r => {
              const isActive = activeReport === r.key
              return (
                <li key={r.key}>
                  <button
                    type="button"
                    onClick={() => navigateToReport(r.key)}
                    className={`w-full flex items-center gap-2.5 px-3 py-2 rounded-lg text-sm font-medium transition-colors ${
                      isActive ? 'bg-wcs-red/10 text-wcs-red' : 'text-text-primary hover:bg-bg'
                    }`}
                  >
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" className="w-4 h-4 flex-shrink-0">
                      <path strokeLinecap="round" strokeLinejoin="round" d={r.icon || ANALYTICS_ICONS.placeholder} />
                    </svg>
                    <span className="truncate text-left">{r.label}</span>
                  </button>
                </li>
              )
            })}
          </ul>
        </div>
      </aside>

      {/* Main content pane */}
      <div className="flex-1 min-w-0">
        {/* Header card */}
        {/* z-50 so the Filters popup inside this card clears the table's
            sticky header (z-30). z-20 here made the card its own stacking
            context and trapped the popup underneath the column headers. */}
        <div className="relative z-50 bg-surface/95 backdrop-blur-sm rounded-xl border border-border p-5 mb-6">
          <div className="flex items-center gap-3 mb-4">
            {onBack && (
              <button
                type="button"
                onClick={onBack}
                className="press-hide-back md:hidden flex items-center gap-1 text-xs font-semibold text-text-muted hover:text-text-primary"
              >
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="w-3.5 h-3.5">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" />
                </svg>
                Back
              </button>
            )}
            <h2 className="text-xl font-bold text-text-primary">{active?.label || 'Analytics'}</h2>
            <div className="ml-auto flex-shrink-0">
              <LocationMultiSelect
                value={locationSlug}
                onChange={setLocationSlug}
                options={LOCATIONS.filter(l => l.slug !== 'all')}
              />
            </div>
          </div>

          {/* Date row. The trailing slot is where a report portals its own
              controls (e.g. the Filters button) so they sit inline with the
              date range instead of in a second bar below it. */}
          <div className="flex items-center gap-3 flex-wrap">
            {showDateControls && (
              <>
              <div className="flex gap-1.5">
                {QUICK_RANGES.map(qr => (
                  <button
                    key={qr.key}
                    onClick={() => applyQuickRange(qr.key)}
                    className={`px-3 py-1.5 rounded-lg text-xs font-medium border transition-colors whitespace-nowrap ${
                      activeQuick === qr.key
                        ? 'bg-wcs-red text-white border-wcs-red'
                        : 'bg-bg text-text-muted border-border hover:text-text-primary'
                    }`}
                  >
                    {qr.label}
                  </button>
                ))}
              </div>
              <div className="flex items-center gap-2">
                <input
                  type="date"
                  value={startDate}
                  onChange={e => handleDateChange('start', e.target.value)}
                  className="px-2.5 py-1.5 rounded-lg text-xs bg-bg border border-border text-text-primary"
                />
                <span className="text-text-muted text-xs">to</span>
                <input
                  type="date"
                  value={endDate}
                  onChange={e => handleDateChange('end', e.target.value)}
                  className="px-2.5 py-1.5 rounded-lg text-xs bg-bg border border-border text-text-primary"
                />
              </div>
              </>
            )}
            <div id={TOOLBAR_SLOT_ID} className="flex items-center gap-2" />
          </div>
        </div>

        {/* Report body */}
        {ActiveComponent ? (
          <ActiveComponent
            user={user}
            isAdmin={isAdmin}
            location={location}
            locationSlug={locationSlug}
            startDate={startDate}
            endDate={endDate}
          />
        ) : (
          <div className="bg-surface rounded-xl border border-border p-10 text-center">
            <p className="text-base font-semibold text-text-primary mb-1">No analytics reports yet</p>
            <p className="text-sm text-text-muted">Reports get registered in <code className="font-mono">ANALYTICS_REPORTS</code> as they are built.</p>
          </div>
        )}
      </div>
    </div>
  )
}
