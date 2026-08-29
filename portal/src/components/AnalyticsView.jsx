import { useState, useEffect } from 'react'
import { LOCATION_OPTIONS as LOCATIONS } from '../config/locations'
import LocationMultiSelect from './LocationMultiSelect'
import SalespersonPerformance from './analytics/SalespersonPerformance'
import Topline from './analytics/Topline'
import PastDue from './analytics/PastDue'
import MembershipMix from './analytics/MembershipMix'
import RevenuePerMember from './analytics/RevenuePerMember'
import PtPenetration from './analytics/PtPenetration'
import PtScorecard from './analytics/PtScorecard'
import ClubActivityTrends from './analytics/ClubActivityTrends'
import MembershipTrends from './analytics/MembershipTrends'
import NetMembership from './analytics/NetMembership'
import RevenueByProfitCenter from './analytics/RevenueByProfitCenter'
import RevenueTrends from './analytics/RevenueTrends'
import FirstPtPurchase from './analytics/FirstPtPurchase'
import TrainerPerformance from './analytics/TrainerPerformance'
import TrainerSnapshot from './analytics/TrainerSnapshot'
import SalespersonSnapshot from './analytics/SalespersonSnapshot'
import AttritionTrends from './analytics/AttritionTrends'
import Checkins from './analytics/Checkins'
import Compliance from './analytics/Compliance'
import PosSales from './analytics/PosSales'
import Revenue from './analytics/Revenue'
import DailySnapshot from './analytics/DailySnapshot'
import Till from './analytics/Till'
import Audits from './analytics/Audits'
import LeadSources from './analytics/LeadSources'
import ProblemAreas from './analytics/ProblemAreas'
import MemberJourney from './analytics/MemberJourney'
import ClubSnapshot from './analytics/ClubSnapshot'
import KpiReport from './analytics/KpiReport'
import PtSnapshot from './analytics/PtSnapshot'
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

// Ordered registry. `Component` receives
// { user, isAdmin, location, locationSlug, startDate, endDate }.
// `dates: false` hides the date-range controls for reports that manage their own.
const ANALYTICS_REPORTS = [
  {
    key: 'topline',
    label: 'Topline',
    desc: 'Headline Numbers',
    Component: Topline,
    // Its windows are month-to-date / trailing 30 days / trailing 3 months,
    // anchored on the latest data date, so a shared range would mislead.
    dates: false,
  },
  {
    key: 'salesperson-performance',
    label: 'Salesperson Performance',
    desc: 'New Member Units',
    Component: SalespersonPerformance,
  },
  {
    key: 'club-activity',
    label: 'Club Activity Trends',
    desc: 'Year over Year',
    Component: ClubActivityTrends,
    // Its window is a fixed trailing 13 months against the same months a year
    // earlier, so the shared date range would do nothing but mislead.
    dates: false,
  },
  {
    key: 'revenue-per-member',
    label: 'Revenue Per Member',
    desc: 'Members vs Revenue',
    Component: RevenuePerMember,
    // A fixed trailing window anchored on the last complete month.
    dates: false,
  },
  {
    key: 'pt-scorecard',
    label: 'PT Scorecard',
    desc: 'Day One Funnel',
    Component: PtScorecard,
  },
  {
    key: 'pt-penetration',
    label: 'PT Penetration',
    desc: 'PT Clients by Club',
    Component: PtPenetration,
    // A fixed trailing window anchored on the last complete month.
    dates: false,
  },
  {
    key: 'membership-mix',
    label: 'Membership Mix',
    desc: 'Who Our Members Are',
    Component: MembershipMix,
    // A snapshot of the membership as it stands; a date range would imply a
    // history the current member rows do not carry.
    dates: false,
  },
  {
    key: 'past-due',
    label: 'Past Due',
    desc: 'Who Owes What',
    Component: PastDue,
    // A live snapshot of what is owed right now; a date range would imply a
    // history the balances do not have.
    dates: false,
  },
  {
    key: 'membership-trends',
    label: 'Membership Trends',
    desc: 'Members & Joins by Segment',
    Component: MembershipTrends,
    // A fixed 25-month trailing window, like Club Activity Trends.
    dates: false,
  },
  {
    key: 'net-membership',
    label: 'Net Membership',
    desc: 'In, Out and Net',
    Component: NetMembership,
  },
  {
    key: 'revenue-by-profit-center',
    label: 'Revenue by Profit Center',
    desc: 'Where the Money Comes From',
    Component: RevenueByProfitCenter,
  },
  {
    key: 'revenue-trends',
    label: 'Revenue Trends',
    desc: 'Annual, Monthly, Daily',
    Component: RevenueTrends,
  },
  {
    key: 'attrition-trends',
    label: 'Attrition Trends',
    desc: 'Losses, Dues and Revenue',
    Component: AttritionTrends,
    // The report picks its own trailing month range, so the shared date
    // controls would only be a second answer to the same question.
    dates: false,
  },
  {
    key: 'problem-areas',
    label: 'Problem Areas',
    desc: 'What Needs Attention',
    Component: ProblemAreas,
    // Its own trailing window, chosen in the report: month-to-date would judge
    // every club on two days of data on the 2nd of the month.
    dates: false,
  },
  {
    key: 'member-journey',
    label: 'Member Journey',
    desc: 'Visits and Spend by Tenure',
    Component: MemberJourney,
    // The x-axis is month of membership, not calendar time, so the shared date
    // range would be answering a different question than the chart asks.
    dates: false,
  },
  {
    key: 'lead-sources',
    label: 'Lead Sources',
    desc: 'Where Leads Come From',
    Component: LeadSources,
  },
  {
    key: 'checkins',
    label: 'Check-ins',
    desc: 'Visits, Timing and Frequency',
    Component: Checkins,
  },
  {
    key: 'compliance',
    label: 'Compliance',
    desc: 'Operational Task Completion',
    Component: Compliance,
  },
  {
    key: 'audits',
    label: 'Audits',
    desc: 'QA Coverage and Scores',
    Component: Audits,
  },
  {
    key: 'pos-sales',
    label: 'Retail Analysis',
    desc: 'Goods, Margin and Items',
    Component: PosSales,
  },
  {
    key: 'till',
    label: 'Till Analysis',
    desc: 'Cash Reconciliation',
    Component: Till,
  },
  {
    key: 'revenue',
    label: 'Revenue Analysis',
    desc: 'Profit Centers vs Last Month and Last Year',
    Component: Revenue,
  },
  {
    key: 'daily-snapshot',
    label: 'Daily Snapshot',
    desc: 'A Single Day, End to End',
    Component: DailySnapshot,
    // It owns its own date — Today, Yesterday or a specific day — because the
    // whole report is about one day. A shared range picker would let a caller
    // ask for a month and get a card whose every label says "day".
    dates: false,
  },
  {
    key: 'kpis',
    label: 'KPIs',
    desc: 'Goals by Club',
    Component: KpiReport,
  },
  {
    key: 'club-snapshot',
    label: 'Club Snapshot',
    desc: 'Membership, Day Ones and PT',
    Component: ClubSnapshot,
  },
  {
    key: 'pt-snapshot',
    label: 'PT Snapshot',
    desc: 'Whole Club Training',
    Component: PtSnapshot,
  },
  {
    key: 'salesperson-snapshot',
    label: 'Salesperson Snapshot',
    desc: 'One Salesperson at a Time',
    Component: SalespersonSnapshot,
  },
  {
    key: 'trainer-snapshot',
    label: 'Trainer Snapshot',
    desc: 'One Trainer at a Time',
    Component: TrainerSnapshot,
  },
  {
    key: 'trainer-performance',
    label: 'Trainer Performance',
    desc: 'Sessions, Day Ones and Closes',
    Component: TrainerPerformance,
  },
  {
    key: 'first-pt-purchase',
    label: 'First Purchases by Join Month',
    desc: 'How Soon Members Buy PT',
    Component: FirstPtPurchase,
    // The window here is the member's JOIN date, not a payment range, so the
    // report supplies its own labelled controls.
    dates: false,
  },
]

// Sidebar grouping. A report may appear in more than one group — Revenue Per
// Member and Past Due are deliberately under both Member Counts and Revenue,
// because both teams look for them there.
//
// Keys that do not (yet) exist in ANALYTICS_REPORTS are ignored rather than
// rendering a dead link, so a group can name a report that ships later.
const REPORT_GROUPS = [
  { key: 'marketing', label: 'Marketing',     reports: ['lead-sources'] },
  { key: 'members',   label: 'Member Counts', reports: ['membership-trends', 'net-membership', 'membership-mix', 'past-due', 'revenue-per-member', 'club-snapshot', 'attrition-trends', 'member-journey', 'checkins'] },
  { key: 'revenue',   label: 'Revenue',       reports: ['revenue-by-profit-center', 'revenue-trends', 'revenue-per-member', 'past-due', 'pos-sales', 'revenue'] },
  { key: 'training',  label: 'Training',      reports: ['pt-penetration', 'pt-scorecard', 'first-pt-purchase', 'pt-snapshot', 'trainer-snapshot'] },
  { key: 'employees', label: 'Employees',     reports: ['salesperson-performance', 'trainer-performance', 'salesperson-snapshot', 'trainer-snapshot', 'compliance', 'audits', 'till'] },
  // Club-wide overviews first, then the one-person-at-a-time cards.
  { key: 'snapshots', label: 'Snapshots',     reports: ['daily-snapshot', 'club-snapshot', 'pt-snapshot', 'salesperson-snapshot', 'trainer-snapshot'] },
]

// Pinned above the groups, in this order, outside any category.
const PINNED_REPORTS = ['kpis', 'problem-areas', 'topline', 'club-activity']

/**
 * Reports that belong in no group and are not pinned still need a way in.
 * Rather than trusting the catalogue above to stay exhaustive, anything
 * unclaimed is listed alongside Topline — adding a report can therefore never
 * make it unreachable, only mis-filed.
 */
function ungroupedReports() {
  const claimed = new Set([...PINNED_REPORTS, ...REPORT_GROUPS.flatMap(g => g.reports)])
  return ANALYTICS_REPORTS.filter(r => !claimed.has(r.key)).map(r => r.key)
}

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
  // KPIs is the landing report. Topline only held the spot because it happened
  // to be first in the registry, which meant the default silently moved
  // whenever the list was reordered. Named explicitly, with a fallback so
  // removing or renaming the KPIs entry degrades to the first report rather
  // than to a blank pane.
  //
  // A #analytics/<report> deep link still wins, or shared links to a specific
  // report would all land on KPIs instead.
  const defaultReportKey =
    ANALYTICS_REPORTS.find(r => r.key === 'kpis')?.key
    || ANALYTICS_REPORTS[0]?.key
    || null
  const [activeReport, setActiveReport] = useState(() => parseHash() || defaultReportKey)
  const initialRange = getQuickRange('this_month')
  const [startDate, setStartDate] = useState(initialRange.start)
  const [endDate, setEndDate] = useState(initialRange.end)
  const [activeQuick, setActiveQuick] = useState('this_month')
  const [locationSlug, setLocationSlug] = useState('all')
  // Every group starts collapsed, as asked. Opening one is a per-visit choice,
  // not something worth persisting.
  const [openGroups, setOpenGroups] = useState(() => new Set())

  function toggleGroup(key) {
    setOpenGroups(prev => {
      const next = new Set(prev)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })
  }

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
          {/* Topline first, then anything not filed under a group. */}
          <ul className="space-y-0.5">
            {[...PINNED_REPORTS, ...ungroupedReports()]
              .map(key => reportByKey[key])
              .filter(Boolean)
              .map(r => (
                <li key={r.key}>
                  <ReportLink report={r} active={activeReport === r.key} onSelect={navigateToReport} />
                </li>
              ))}
          </ul>

          {REPORT_GROUPS.map(group => {
            const reports = group.reports.map(k => reportByKey[k]).filter(Boolean)
            if (reports.length === 0) return null
            const open = openGroups.has(group.key)
            const holdsActive = reports.some(r => r.key === activeReport)
            return (
              <div key={group.key} className="mt-2">
                <button
                  type="button"
                  onClick={() => toggleGroup(group.key)}
                  aria-expanded={open}
                  className={`w-full flex items-center justify-between gap-2 px-3 py-2 text-sm font-bold rounded-lg transition-colors ${
                    holdsActive && !open ? 'text-wcs-red' : 'text-text-primary hover:bg-bg'
                  }`}
                >
                  <span className="truncate text-left">{group.label}</span>
                  <svg
                    viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"
                    aria-hidden="true"
                    className={`w-3.5 h-3.5 flex-shrink-0 transition-transform ${open ? 'rotate-180' : ''}`}
                  >
                    <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
                  </svg>
                </button>
                {open && (
                  <ul className="space-y-0.5 mt-0.5">
                    {reports.map(r => (
                      <li key={r.key}>
                        <ReportLink report={r} active={activeReport === r.key} onSelect={navigateToReport} indented />
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            )
          })}
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

const reportByKey = Object.fromEntries(ANALYTICS_REPORTS.map(r => [r.key, r]))

function ReportLink({ report, active, onSelect, indented = false }) {
  return (
    <button
      type="button"
      onClick={() => onSelect(report.key)}
      className={`w-full px-3 py-2 rounded-lg text-sm font-medium transition-colors text-left ${
        indented ? 'pl-6' : ''
      } ${active ? 'bg-wcs-red/10 text-wcs-red' : 'text-text-primary hover:bg-bg'}`}
    >
      <span className="block truncate">{report.label}</span>
    </button>
  )
}
