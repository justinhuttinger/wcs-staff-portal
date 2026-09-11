import { useState, useEffect, useMemo, useCallback, useRef } from 'react'
import { LOCATION_OPTIONS as LOCATIONS, LOCATION_NAMES } from '../config/locations'
import { getAppSettings } from '../lib/api'
import { getFavorites, toggleFavorite, FAVORITES_EVENT, MAX_FAVORITES } from '../lib/analyticsFavorites'
import { isReportVisible } from './analyticsReportCatalogue'
import LocationMultiSelect from './LocationMultiSelect'
import SurfaceToggle from './SurfaceToggle'
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
import AttritionAnalysis from './analytics/AttritionAnalysis'
import PtRoster from './analytics/PtRoster'
import SessionFrequency from './analytics/SessionFrequency'
import Checkins from './analytics/Checkins'
import Compliance from './analytics/Compliance'
import PosSales from './analytics/PosSales'
import Revenue from './analytics/Revenue'
import DailySnapshot from './analytics/DailySnapshot'
import Payroll from './analytics/Payroll'
import GroupX from './analytics/GroupX'
import Childcare from './analytics/Childcare'
import Nps from './analytics/Nps'
import Till from './analytics/Till'
import Audits from './analytics/Audits'
import LeadSources from './analytics/LeadSources'
import MemberJourney from './analytics/MemberJourney'
import VipAnalysis from './analytics/VipAnalysis'
import AverageDues from './analytics/AverageDues'
import ClubSnapshot from './analytics/ClubSnapshot'
import KpiReport from './analytics/KpiReport'
import PtSnapshot from './analytics/PtSnapshot'
import { TOOLBAR_SLOT_ID } from './analytics/toolbarSlot'
import ReportRecords from './analytics/ReportRecords'
import MemberFilters, { MemberFilterNote, MEMBER_CATEGORY_OPTIONS } from './analytics/MemberFilters'

// ---------------------------------------------------------------------------
// Analytics — a corporate+ reporting surface, separate from ReportingView.
//
// This is a staging ground for reports that are being rebuilt/reshaped before
// they graduate into the main Reporting view. Nothing here is visible to any
// role below `corporate`: the tile is hidden in ToolGrid, App.jsx refuses to
// mount this view, and every server route these reports call must apply its own
// corporate gate (client gating alone is not a gate).
//
// To add a report: drop a component in ./analytics/ and register it below.
// ---------------------------------------------------------------------------

// Ordered registry. `Component` receives
// { user, isAdmin, location, locationSlug, startDate, endDate }. `isAdmin` is
// still the true admin flag, not the Analytics access gate.
// `dates: false` hides the date-range controls for reports that manage their own.
// `records: [...]` names the record sets the report is built from, which fills
// The Data section at the bottom of it. Declared here rather than inside each
// component so a report gains one by writing a line, and so the list of what a
// report actually draws on is readable in one place.
// Exported so the mobile app renders THE SAME registry rather than a second
// list that has to be kept in step. A report added here appears on both
// surfaces; a mobile-only copy would silently fall behind on the first one
// somebody forgot to add twice.
export const ANALYTICS_REPORTS = [
  {
    key: 'topline',
    filters: ['category', 'basis'],
    records: ['new-members', 'lost-members', 'revenue', 'day-ones'],
    label: 'Topline',
    desc: 'Headline Numbers',
    Component: Topline,
    // Its windows are month-to-date / trailing 30 days / trailing 3 months,
    // anchored on the latest data date, so a shared range would mislead.
    dates: false,
  },
  {
    key: 'salesperson-performance',
    filters: ['category', 'basis'],
    records: ['new-members', 'day-ones', 'vips', 'tours'],
    label: 'Salesperson Performance',
    desc: 'New Member Units',
    Component: SalespersonPerformance,
  },
  {
    key: 'club-activity',
    filters: ['category', 'basis'],
    records: ['new-members', 'lost-members', 'revenue', 'day-ones'],
    label: 'Club Activity Trends',
    desc: 'Year over Year',
    Component: ClubActivityTrends,
    // Its window is a fixed trailing 13 months against the same months a year
    // earlier, so the shared date range would do nothing but mislead.
    dates: false,
  },
  {
    key: 'revenue-per-member',
    filters: ['category', 'basis'],
    records: ['revenue', 'new-members'],
    label: 'Revenue Per Member',
    desc: 'Members vs Revenue',
    Component: RevenuePerMember,
    // A fixed trailing window anchored on the last complete month.
    dates: false,
  },
  {
    key: 'pt-scorecard',
    records: ['day-ones', 'pt-sales', 'new-members'],
    label: 'PT Scorecard',
    desc: 'Day One Funnel',
    Component: PtScorecard,
  },
  {
    key: 'pt-penetration',
    records: ['new-members', 'pt-sales'],
    label: 'PT Penetration',
    desc: 'PT Clients by Club',
    Component: PtPenetration,
    // A fixed trailing window anchored on the last complete month.
    dates: false,
  },
  {
    key: 'membership-mix',
    filters: ['category', 'basis'],
    records: ['new-members'],
    label: 'Membership Mix',
    desc: 'Who Our Members Are',
    Component: MembershipMix,
    // A snapshot of the membership as it stands; a date range would imply a
    // history the current member rows do not carry.
    dates: false,
  },
  {
    key: 'past-due',
    filters: ['category', 'basis'],
    records: ['past-due'],
    label: 'Past Due',
    desc: 'Who Owes What',
    Component: PastDue,
    // A live snapshot of what is owed right now; a date range would imply a
    // history the balances do not have.
    dates: false,
  },
  {
    key: 'membership-trends',
    filters: ['category', 'basis'],
    records: ['new-members', 'lost-members'],
    label: 'Membership Trends',
    desc: 'Members & Joins by Segment',
    Component: MembershipTrends,
    // A fixed 25-month trailing window, like Club Activity Trends.
    dates: false,
  },
  {
    key: 'net-membership',
    filters: ['category', 'basis'],
    records: ['new-members', 'lost-members'],
    label: 'Net Membership',
    desc: 'In, Out and Net',
    Component: NetMembership,
  },
  {
    key: 'revenue-by-profit-center',
    records: ['revenue'],
    label: 'Revenue by Profit Center',
    desc: 'Where the Money Comes From',
    Component: RevenueByProfitCenter,
  },
  {
    key: 'revenue-trends',
    records: ['revenue'],
    label: 'Revenue Trends',
    desc: 'Annual, Monthly, Daily',
    Component: RevenueTrends,
  },
  {
    key: 'pt-roster',
    records: ['pt-sales', 'pt-sessions'],
    label: 'PT Roster',
    desc: 'Who Is On Training',
    Component: PtRoster,
    // The date controls stay ON, even though the roster is a stock rather than
    // a window: abc_pt_services keeps every service as a dated term, so the
    // roster rewinds, and the window's END is the as-of date. Hiding the
    // controls left that reachable only through a hand-typed URL.
  },
  {
    key: 'session-frequency',
    records: ['pt-sessions', 'pt-clients'],
    label: 'Session Frequency',
    desc: 'How Often They Train',
    Component: SessionFrequency,
  },
  {
    key: 'average-dues',
    // Basis only, no category: this report IS the dues category, so a category
    // control here could only ever narrow it to nothing.
    filters: ['basis'],
    records: ['new-members'],
    recordsNote: 'Built from what every active member is billed today, which is a live snapshot rather than a set of records over a range.',
    label: 'Average Monthly Dues',
    desc: 'Dues per Paying Member',
    Component: AverageDues,
    // abc_members carries what a member is billed NOW and no history of it, so
    // a date range would be accepted and ignored.
    dates: false,
  },
  {
    key: 'vip-analysis',
    // Not 'tours': Came In is a GHL pipeline stage, and tours turned out to
    // have almost nothing to do with how a VIP referral is actually worked.
    records: ['vips', 'new-members'],
    recordsNote: 'Came In and Pass Redeemed are GHL pipeline stages, which have no record view here.',
    label: 'VIP Analysis',
    desc: 'Referrals In and Signed',
    Component: VipAnalysis,
  },
  {
    key: 'attrition-analysis',
    filters: ['category', 'basis'],
    records: ['cancels', 'pending-cancels'],
    label: 'Attrition Analysis',
    desc: 'Who Left and Why',
    Component: AttritionAnalysis,
  },
  {
    key: 'attrition-trends',
    filters: ['category', 'basis'],
    records: ['lost-members'],
    label: 'Attrition Trends',
    desc: 'Losses, Dues and Revenue',
    Component: AttritionTrends,
    // The report picks its own trailing month range, so the shared date
    // controls would only be a second answer to the same question.
    dates: false,
  },
  {
    key: 'member-journey',
    records: ['new-members', 'lost-members'],
    label: 'Member Journey',
    desc: 'Visits and Spend by Tenure',
    Component: MemberJourney,
    // The x-axis is month of membership, not calendar time, so the shared date
    // range would be answering a different question than the chart asks.
    dates: false,
  },
  {
    key: 'lead-sources',
    records: ['new-members'],
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
    records: ['revenue'],
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
    records: ['revenue'],
    label: 'Revenue Analysis',
    desc: 'Profit Centers vs Last Month and Last Year',
    Component: Revenue,
  },
  {
    key: 'daily-snapshot',
    records: ['new-members', 'lost-members', 'day-ones', 'pt-sales', 'revenue'],
    label: 'Daily Snapshot',
    desc: 'A Single Day, End to End',
    Component: DailySnapshot,
    // It owns its own date — Today, Yesterday or a specific day — because the
    // whole report is about one day. A shared range picker would let a caller
    // ask for a month and get a card whose every label says "day".
    dates: false,
  },
  {
    key: 'nps',
    label: 'NPS',
    desc: 'Member Feedback and Response Rates',
    Component: Nps,
  },
  {
    key: 'childcare',
    label: 'Childcare',
    desc: 'Headcounts by Day and Shift',
    Component: Childcare,
  },
  {
    key: 'group-x',
    records: ['pt-sessions'],
    label: 'Group X',
    desc: 'Class Attendance',
    Component: GroupX,
  },
  {
    key: 'payroll',
    records: ['pt-sales', 'pt-sessions'],
    label: 'Payroll',
    desc: 'POS, PT and Sessions',
    Component: Payroll,
    // Commission is paid per month, so the report picks a pay period rather
    // than taking the shell's range — a window straddling two would produce a
    // figure nobody pays anyone.
    dates: false,
  },
  {
    key: 'kpis',
    // The sets that actually feed a KPI. `revenue` and `lost-members` were
    // listed here and back nothing on this report - no KPI touches revenue at
    // all, and the cancels KPI is Click2Save utilisation, which is the
    // `cancels` set rather than the membership-loss one.
    //
    // Day One Attachment and VIP Collection % both divide into new members;
    // Click2Save divides into cancels. The other four KPIs come from GHL and
    // Operandio, which have no record view - see recordsNote.
    records: ['new-members', 'day-ones', 'vips', 'cancels'],
    recordsNote: 'Trial Conversion, Speed to Lead, Operational Compliance and Cleanliness are measured in GHL and Operandio, which have no record view here.',
    label: 'KPIs',
    desc: 'Goals by Club',
    Component: KpiReport,
  },
  {
    key: 'club-snapshot',
    records: ['new-members', 'lost-members', 'day-ones', 'pt-sales', 'pt-losses', 'revenue', 'past-due'],
    label: 'Club Snapshot',
    desc: 'Membership, Day Ones and PT',
    Component: ClubSnapshot,
  },
  {
    key: 'pt-snapshot',
    records: ['day-ones', 'day-ones-pending', 'pt-sales', 'pt-losses'],
    label: 'PT Snapshot',
    desc: 'Whole Club Training',
    Component: PtSnapshot,
  },
  {
    key: 'salesperson-snapshot',
    filters: ['category', 'basis'],
    records: ['new-members', 'day-ones', 'vips', 'tours'],
    label: 'Salesperson Snapshot',
    desc: 'One Salesperson at a Time',
    Component: SalespersonSnapshot,
  },
  {
    key: 'trainer-snapshot',
    records: ['pt-sessions', 'pt-clients', 'day-ones', 'day-ones-pending', 'pt-sales', 'pt-losses'],
    label: 'Trainer Snapshot',
    desc: 'One Trainer at a Time',
    Component: TrainerSnapshot,
  },
  {
    key: 'trainer-performance',
    records: ['pt-sessions', 'pt-clients', 'day-ones', 'pt-sales'],
    label: 'Trainer Performance',
    desc: 'Sessions, Day Ones and Closes',
    Component: TrainerPerformance,
  },
  {
    key: 'first-pt-purchase',
    records: ['new-members', 'pt-sales'],
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
//
// Order WITHIN a group is not read from here — the sidebar sorts each group
// alphabetically by label — so a new report can be appended to whichever list
// it belongs in. The order of the groups themselves is still this order.
export const REPORT_GROUPS = [
  { key: 'marketing', label: 'Marketing',     reports: ['lead-sources'] },
  { key: 'members',   label: 'Member Counts', reports: ['membership-trends', 'net-membership', 'membership-mix', 'past-due', 'revenue-per-member', 'club-snapshot', 'attrition-analysis', 'attrition-trends', 'member-journey', 'checkins', 'nps', 'vip-analysis', 'average-dues'] },
  { key: 'revenue',   label: 'Revenue',       reports: ['revenue-by-profit-center', 'revenue-trends', 'revenue-per-member', 'past-due', 'pos-sales', 'revenue', 'average-dues'] },
  { key: 'training',  label: 'Training',      reports: ['pt-penetration', 'pt-scorecard', 'first-pt-purchase', 'pt-snapshot', 'trainer-snapshot', 'pt-roster', 'session-frequency'] },
  { key: 'employees', label: 'Employees',     reports: ['salesperson-performance', 'trainer-performance', 'salesperson-snapshot', 'trainer-snapshot', 'compliance', 'audits', 'till', 'payroll'] },
  { key: 'snapshots', label: 'Snapshots',     reports: ['daily-snapshot', 'club-snapshot', 'pt-snapshot', 'salesperson-snapshot', 'trainer-snapshot'] },
  { key: 'misc',      label: 'Misc',          reports: ['childcare', 'group-x'] },
]

/**
 * The registry without its components, for the Admin visibility grid.
 *
 * Derived here rather than retyped there, so a report added above appears in
 * the grid automatically and can never be toggled into a key nothing reads.
 */
export const REPORT_META = ANALYTICS_REPORTS.map(r => ({ key: r.key, label: r.label }))

// The reports that get opened daily, flat at the top of the sidebar and outside
// any category, in this order.
//
// The list is deliberately SHORT and hand-picked. Thirty-seven reports filed by
// topic put the six that carry the week at exactly the same depth as First
// Purchases by Join Month, and the tail is what a reader ends up scanning past.
// Everything not named here still exists, one click down under All reports, in
// the same group it has always been in.
//
// A core report keeps its place in its topic group as well as appearing here -
// the same call Past Due already gets by sitting under both Member Counts and
// Revenue. Somebody browsing Member Counts should not find Club Snapshot
// missing because it was promoted.
export const CORE_REPORTS = [
  'kpis',
  'club-snapshot',
  'daily-snapshot',
  'salesperson-performance',
  'attrition-analysis',
  'revenue',
]

// The Favorites section shares the collapse machinery with REPORT_GROUPS but
// is not one of them: its contents are per-user, so it cannot be a static list
// here. Kept distinct from any real group key so the two can never collide.
const FAVORITES_GROUP_KEY = '__favorites'

// The disclosure holding everything that is not core. Same collapse machinery,
// same reason it cannot be a REPORT_GROUPS entry: it contains the groups rather
// than sitting beside them.
const ALL_REPORTS_KEY = '__all'

/**
 * Reports that belong in no group and are not core still need a way in.
 * Rather than trusting the catalogue above to stay exhaustive, anything
 * unclaimed is listed at the top of All reports, above the groups — adding a
 * report can therefore never make it unreachable, only mis-filed.
 *
 * Today this holds Topline and Club Activity Trends, which used to be pinned
 * and are in no group.
 */
export function ungroupedReports() {
  const claimed = new Set([...CORE_REPORTS, ...REPORT_GROUPS.flatMap(g => g.reports)])
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

export default function AnalyticsView({ user, onBack, location, isAdmin, canAnalytics, onReporting }) {
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
  // Persist across reports the way location and dates do. A reader who has
  // narrowed to Insurance is asking a question, not setting a per-report
  // preference, and losing it on every click would make the control unusable.
  const [category, setCategory] = useState('all')
  const [basis, setBasis] = useState('members')

  // Per-club report visibility, set in Admin. Loaded once: it changes about
  // never, and a report list that flickers as settings arrive is worse than one
  // that starts complete and narrows.
  const [visibility, setVisibility] = useState(null)
  useEffect(() => {
    let alive = true
    getAppSettings('report_off_')
      .then(map => { if (alive) setVisibility(map || {}) })
      // A failed load leaves visibility null, which shows everything. Hiding
      // reports because a settings call failed would be the worse error.
      .catch(() => { if (alive) setVisibility({}) })
    return () => { alive = false }
  }, [])

  // The clubs the visibility rule is evaluated against. 'all' means every club,
  // not "no filter" — otherwise selecting All would bypass the toggles entirely.
  const scopedSlugs = useMemo(() => (
    locationSlug === 'all'
      ? LOCATION_NAMES.map(n => n.toLowerCase())
      : String(locationSlug).split(',').map(x => x.trim()).filter(Boolean)
  ), [locationSlug])

  const canSee = useCallback(
    (key) => isReportVisible(visibility, key, scopedSlugs),
    [visibility, scopedSlugs]
  )
  // A person's own starred reports. Held in state (not read from localStorage
  // on every render) and refreshed off the change event, so a star clicked in
  // the sidebar and the one in the header stay in step without either owning
  // the other.
  const [favorites, setFavorites] = useState(getFavorites)
  useEffect(() => {
    const sync = () => setFavorites(getFavorites())
    window.addEventListener(FAVORITES_EVENT, sync)
    // Another tab writing localStorage fires `storage`, not our own event.
    window.addEventListener('storage', sync)
    return () => {
      window.removeEventListener(FAVORITES_EVENT, sync)
      window.removeEventListener('storage', sync)
    }
  }, [])

  // Every group starts collapsed, as asked. Opening one is a per-visit choice,
  // not something worth persisting.
  const [openGroups, setOpenGroups] = useState(() => new Set())

  // Favorites is the exception: somebody who has built a shortlist wants to
  // see it, not to open it every visit. Done as an effect rather than as
  // initial state because hydrateUiPrefs can land the server's list a moment
  // AFTER this mounts, and seeding at mount would leave it shut. Once only,
  // so a deliberate collapse is not reopened underneath them.
  // Typing here flattens the tree entirely. At thirty-seven reports, somebody
  // who knows the name should not have to remember which group it was filed
  // under - and it is what makes a short core list safe, because being wrong
  // about the six costs three keystrokes rather than a hunt.
  const [search, setSearch] = useState('')

  const favoritesAutoOpened = useRef(false)
  useEffect(() => {
    if (favoritesAutoOpened.current || favorites.length === 0) return
    favoritesAutoOpened.current = true
    setOpenGroups(prev => new Set(prev).add(FAVORITES_GROUP_KEY))
  }, [favorites])

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

  // Belt-and-braces: App.jsx already refuses to mount this below corporate.
  if (!canAnalytics) return null

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

  // Landing on a tail report - a deep link, or the fallback below - must not
  // leave the nav pointing at nothing, so the disclosure and the group holding
  // it are opened. Keyed on the report CHANGING, so collapsing a group while
  // sitting inside it stays collapsed rather than springing back open.
  const lastRevealed = useRef(null)
  useEffect(() => {
    if (!activeReport || lastRevealed.current === activeReport) return
    lastRevealed.current = activeReport
    if (CORE_REPORTS.includes(activeReport)) return
    const holders = REPORT_GROUPS.filter(g => g.reports.includes(activeReport)).map(g => g.key)
    setOpenGroups(prev => {
      const next = new Set(prev)
      next.add(ALL_REPORTS_KEY)
      for (const k of holders) next.add(k)
      return next
    })
  }, [activeReport])

  // A report hidden by a club change must not leave a blank pane behind: fall
  // back to the default rather than rendering nothing and looking broken.
  useEffect(() => {
    if (!visibility || !activeReport) return
    if (canSee(activeReport)) return
    const fallback = [...CORE_REPORTS, ...ANALYTICS_REPORTS.map(r => r.key)].find(canSee)
    if (fallback) setActiveReport(fallback)
  }, [visibility, activeReport, canSee])

  // Starred order is the order they were starred in, not alphabetical: a
  // shortlist someone built by hand should stay where they put it. Keys for
  // retired or club-hidden reports drop out here rather than rendering a dead
  // link, and stay in storage — a report hidden for today's club selection is
  // not a report they unstarred.
  const favoriteReports = useMemo(
    () => favorites.map(k => reportByKey[k]).filter(Boolean).filter(r => canSee(r.key)),
    [favorites, canSee],
  )
  const favoritesFull = favorites.length >= MAX_FAVORITES

  const coreReports = useMemo(
    () => CORE_REPORTS.map(k => reportByKey[k]).filter(Boolean).filter(r => canSee(r.key)),
    [canSee],
  )

  // Everything behind the All reports disclosure: the unclaimed reports first,
  // then the groups. Counted DISTINCTLY - a report filed under two groups is
  // one report, and a count that said 38 of 37 would be its own small bug.
  const tailReports = useMemo(
    () => ungroupedReports().map(k => reportByKey[k]).filter(Boolean).filter(r => canSee(r.key)),
    [canSee],
  )
  const tailCount = useMemo(() => {
    const keys = new Set(tailReports.map(r => r.key))
    for (const g of REPORT_GROUPS) for (const k of g.reports) {
      if (reportByKey[k] && canSee(k)) keys.add(k)
    }
    return keys.size
  }, [tailReports, canSee])

  // Search runs over every report a reader can see, core and tail alike, and
  // ignores where it is filed. Matching on label only: the description is not
  // on screen, so a hit no visible text explains reads as a bug.
  const searchTerm = search.trim().toLowerCase()
  const searchResults = useMemo(() => {
    if (!searchTerm) return null
    return ANALYTICS_REPORTS
      .filter(r => canSee(r.key) && r.label.toLowerCase().includes(searchTerm))
      .sort((a, b) => a.label.localeCompare(b.label, 'en', { sensitivity: 'base' }))
  }, [searchTerm, canSee])

  const active = ANALYTICS_REPORTS.find(r => r.key === activeReport) || null
  const showDateControls = active ? active.dates !== false : true
  const ActiveComponent = active?.Component || null

  // Only for reports that actually apply the filters — otherwise a persisted
  // Insurance selection would claim to be filtering a report it does not touch.
  const filterBanner = useMemo(() => {
    const wants = active?.filters || []
    const parts = []
    if (wants.includes('category') && category !== 'all') {
      const label = MEMBER_CATEGORY_OPTIONS.find(o => o.value === category)?.label || category
      parts.push(`${label} only`)
    }
    if (wants.includes('basis') && basis === 'agreements') {
      parts.push('counting agreements, so a family counts once')
    }
    if (parts.length === 0) return null
    return `Filtered: ${parts.join('; ')}.`
  }, [active, category, basis])

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
              className="redundant-back w-full flex items-center gap-2 px-3 py-2 text-[11px] uppercase tracking-wide text-text-muted hover:text-text-primary font-semibold transition-colors"
            >
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="w-3.5 h-3.5">
                <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" />
              </svg>
              Back to Portal
            </button>
          )}
          {/* The same control Reporting carries, so the two surfaces read as
              two halves of one thing rather than two destinations. */}
          <div className="px-3 pt-1 pb-3">
            <SurfaceToggle active="analytics" onReports={onReporting} onAnalytics={null} />
          </div>
          {/* Search flattens everything: while there is a term, the tree is
              replaced by one flat list of matches rather than shown beside
              them, which would leave two answers to the same question on
              screen at once. */}
          <div className="px-1 pb-2">
            <div className="relative">
              <svg
                viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"
                aria-hidden="true"
                className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-text-muted pointer-events-none"
              >
                <path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-4.35-4.35M17 10.5a6.5 6.5 0 11-13 0 6.5 6.5 0 0113 0z" />
              </svg>
              <input
                type="search"
                value={search}
                onChange={e => setSearch(e.target.value)}
                onKeyDown={e => { if (e.key === 'Escape') setSearch('') }}
                placeholder="Search reports"
                aria-label="Search reports"
                className="w-full pl-8 pr-2 py-1.5 rounded-lg text-xs bg-bg border border-border text-text-primary placeholder:text-text-muted"
              />
            </div>
          </div>

          {searchResults ? (
            searchResults.length > 0 ? (
              <ul className="space-y-0.5">
                {searchResults.map(r => (
                  <li key={r.key}>
                    <ReportLink report={r} active={activeReport === r.key} onSelect={navigateToReport} />
                  </li>
                ))}
              </ul>
            ) : (
              <p className="px-3 py-2 text-[11px] leading-snug text-text-muted">
                No report matches “{search.trim()}”.
              </p>
            )
          ) : (
            <>
              {/* Core: the daily six, flat and always open. No disclosure,
                  because a list this short costs nothing to leave showing and
                  a triangle over six links is a control that earns nothing. */}
              <ul className="space-y-0.5">
                {coreReports.map(r => (
                  <li key={r.key}>
                    <ReportLink report={r} active={activeReport === r.key} onSelect={navigateToReport} />
                  </li>
                ))}
              </ul>

              {/* Favorites — this person's own shortlist, between the org's
                  core list and the full catalogue. Rendered even when empty: a
                  section that only appears once you already know how to fill it
                  is a section nobody discovers. */}
              {(() => {
                const open = openGroups.has(FAVORITES_GROUP_KEY)
                const holdsActive = favoriteReports.some(r => r.key === activeReport)
                return (
                  <div className="mt-2">
                    <SectionHeader
                      label="Favorites"
                      open={open}
                      holdsActive={holdsActive}
                      count={favoriteReports.length || null}
                      onClick={() => toggleGroup(FAVORITES_GROUP_KEY)}
                      icon={<StarIcon filled className="w-3.5 h-3.5 flex-shrink-0 text-wcs-red" />}
                    />
                    {open && (
                      favoriteReports.length > 0 ? (
                        <ul className="space-y-0.5 mt-0.5">
                          {favoriteReports.map(r => (
                            <li key={r.key}>
                              <ReportLink report={r} active={activeReport === r.key} onSelect={navigateToReport} indented />
                            </li>
                          ))}
                        </ul>
                      ) : (
                        <p className="pl-6 pr-3 pb-2 text-[11px] leading-snug text-text-muted">
                          No favorites yet. Open a report and click the star beside its title to add it here.
                        </p>
                      )
                    )}
                  </div>
                )
              })()}

              {/* All reports: the same seven groups as before, one level down.
                  Nothing was refiled - only the depth changed. */}
              {(() => {
                const open = openGroups.has(ALL_REPORTS_KEY)
                const holdsActive = !CORE_REPORTS.includes(activeReport)
                return (
                  <div className="mt-2">
                    <SectionHeader
                      label="All reports"
                      open={open}
                      holdsActive={holdsActive}
                      count={tailCount || null}
                      onClick={() => toggleGroup(ALL_REPORTS_KEY)}
                    />
                    {open && (
                      <div className="mt-0.5">
                        {/* Filed under no group. Above the groups rather than
                            below them, so a report nobody categorised is the
                            first thing seen rather than the last. */}
                        {tailReports.length > 0 && (
                          <ul className="space-y-0.5">
                            {tailReports.map(r => (
                              <li key={r.key}>
                                <ReportLink report={r} active={activeReport === r.key} onSelect={navigateToReport} indented />
                              </li>
                            ))}
                          </ul>
                        )}

                        {REPORT_GROUPS.map(group => {
                          // Alphabetical by label WITHIN a group, sorted here
                          // rather than by hand in REPORT_GROUPS above, so a
                          // report added to a group lands in the right place
                          // without anyone having to re-sort the list.
                          const reports = group.reports
                            .map(k => reportByKey[k]).filter(Boolean)
                            .sort((a, b) => a.label.localeCompare(b.label, 'en', { sensitivity: 'base' }))
                          if (reports.length === 0) return null
                          const groupOpen = openGroups.has(group.key)
                          const visible = reports.filter(r => canSee(r.key))
                          // A section whose every report is hidden for these
                          // clubs is not an empty section, it is not a section —
                          // rendering the header would promise something behind it.
                          if (visible.length === 0) return null
                          return (
                            <div key={group.key} className="mt-1">
                              <SectionHeader
                                label={group.label}
                                open={groupOpen}
                                holdsActive={visible.some(r => r.key === activeReport)}
                                count={visible.length}
                                onClick={() => toggleGroup(group.key)}
                                indented
                              />
                              {groupOpen && (
                                <ul className="space-y-0.5 mt-0.5">
                                  {visible.map(r => (
                                    <li key={r.key}>
                                      <ReportLink
                                        report={r}
                                        active={activeReport === r.key}
                                        onSelect={navigateToReport}
                                        indented
                                        className="pl-9"
                                      />
                                    </li>
                                  ))}
                                </ul>
                              )}
                            </div>
                          )
                        })}
                      </div>
                    )}
                  </div>
                )
              })()}
            </>
          )}
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
                className="redundant-back md:hidden flex items-center gap-1 text-xs font-semibold text-text-muted hover:text-text-primary"
              >
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="w-3.5 h-3.5">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" />
                </svg>
                Back
              </button>
            )}
            <h2 className="text-xl font-bold text-text-primary">{active?.label || 'Analytics'}</h2>
            {/* The only way in or out of Favorites. Beside the title, because
                that is where you are standing when you decide a report is
                worth coming back to. */}
            {active && (
              <FavoriteStar
                reportKey={active.key}
                favorite={favorites.includes(active.key)}
                favoritesFull={favoritesFull}
                onToggle={toggleFavorite}
                className="-ml-1"
              />
            )}
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
            <MemberFilters
              filters={active?.filters}
              category={category}
              basis={basis}
              onCategory={setCategory}
              onBasis={setBasis}
            />
            <div id={TOOLBAR_SLOT_ID} className="flex items-center gap-2" />
          </div>
        </div>

        {/* Report body */}
        {ActiveComponent ? (
          <>
            {/* Insurance alone is 32% of the member base, so a filtered report
                looks exactly like a collapse. Say so above the numbers, not
                only in the dropdown that produced them. */}
            <MemberFilterNote note={filterBanner} />
            <ActiveComponent
              user={user}
              isAdmin={isAdmin}
              location={location}
              locationSlug={locationSlug}
              startDate={startDate}
              endDate={endDate}
              category={category}
              basis={basis}
            />
            {/* Collapsed until asked for, so a report carrying a large set does
                not get slower for having one. */}
            <div className="mt-3">
              <ReportRecords
                sets={reportByKey[activeReport]?.records}
                note={reportByKey[activeReport]?.recordsNote}
                params={{ start: startDate, end: endDate, clubs: locationSlug || 'all' }}
              />
            </div>
          </>
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

export const reportByKey = Object.fromEntries(ANALYTICS_REPORTS.map(r => [r.key, r]))

function StarIcon({ filled, className = '' }) {
  return (
    <svg
      viewBox="0 0 24 24" fill={filled ? 'currentColor' : 'none'} stroke="currentColor"
      strokeWidth="2" aria-hidden="true" className={className}
    >
      <path
        strokeLinecap="round" strokeLinejoin="round"
        d="M11.48 3.5a.56.56 0 011.04 0l2.13 4.87 5.3.48c.5.05.7.67.32 1l-4 3.5 1.18 5.2c.11.49-.42.88-.85.62L12 16.42l-4.6 2.75c-.43.26-.96-.13-.85-.62l1.18-5.2-4-3.5c-.38-.33-.18-.95.32-1l5.3-.48 2.13-4.87z"
      />
    </svg>
  )
}

/**
 * The star that adds or removes one report from Favorites.
 *
 * The ONE way in and out of the list, and it lives beside the report's title
 * rather than on every row of the sidebar: you star a report having read it
 * and decided it is worth coming back to, which is a judgement you cannot make
 * from a nav list. It also keeps the sidebar a list of reports instead of a
 * column of controls. Removing one therefore means opening it again - which is
 * the same gesture, in the same place, so there is nothing extra to learn.
 *
 * At the cap, starring a further report is refused rather than evicting the
 * oldest one - same call as the pinned bar, and for the same reason: silently
 * dropping something a person chose is the more surprising of the two.
 */
function FavoriteStar({ reportKey, favorite, favoritesFull, onToggle, className = '' }) {
  const blocked = !favorite && favoritesFull
  const title = favorite
    ? 'Remove from Favorites'
    : blocked
      ? `Favorites is full (${MAX_FAVORITES}). Remove one first.`
      : 'Add to Favorites'
  return (
    <button
      type="button"
      title={title}
      aria-label={title}
      aria-pressed={favorite}
      disabled={blocked}
      onClick={() => onToggle(reportKey)}
      className={`flex-shrink-0 p-1 rounded transition-colors ${
        favorite ? 'text-wcs-red' : 'text-text-muted hover:text-wcs-red'
      } ${blocked ? 'opacity-40 cursor-not-allowed hover:text-text-muted' : ''} ${className}`}
    >
      <StarIcon filled={favorite} className="w-[18px] h-[18px]" />
    </button>
  )
}

// `className` exists for one thing: the indent. A report inside a group inside
// All reports is two levels deep, and pl-6 no longer says which.
function ReportLink({ report, active, onSelect, indented = false, className = '' }) {
  return (
    <button
      type="button"
      onClick={() => onSelect(report.key)}
      className={`w-full px-3 py-2 rounded-lg text-sm font-medium transition-colors text-left ${
        indented ? 'pl-6' : ''
      } ${className} ${active ? 'bg-wcs-red/10 text-wcs-red' : 'text-text-primary hover:bg-bg'}`}
    >
      <span className="block truncate">{report.label}</span>
    </button>
  )
}

/**
 * A collapsible section heading: Favorites, All reports, and each group inside
 * it. One component rather than three copies of the same button, so the three
 * depths cannot drift apart.
 *
 * `holdsActive` colours the header when it is shut over the current report -
 * closed nav that gives no sign where you are is how a deep link reads as
 * broken.
 */
function SectionHeader({ label, open, holdsActive, count, onClick, icon = null, indented = false }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-expanded={open}
      className={`w-full flex items-center justify-between gap-2 pr-3 py-2 rounded-lg transition-colors ${
        indented ? 'pl-6 text-[13px] font-semibold' : 'pl-3 text-sm font-bold'
      } ${holdsActive && !open ? 'text-wcs-red' : 'text-text-primary hover:bg-bg'}`}
    >
      <span className="flex items-center gap-1.5 min-w-0">
        {icon}
        <span className="truncate text-left">{label}</span>
        {count ? <span className="text-[11px] font-semibold text-text-muted">{count}</span> : null}
      </span>
      <svg
        viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"
        aria-hidden="true"
        className={`w-3.5 h-3.5 flex-shrink-0 transition-transform ${open ? 'rotate-180' : ''}`}
      >
        <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
      </svg>
    </button>
  )
}
