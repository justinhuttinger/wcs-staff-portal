import { useState, useEffect } from 'react'
import MembershipReport from './reports/MembershipReport'
import PTReport from './reports/PTReport'
import ClubHealthReport from './reports/ClubHealthReport'
import PTRosterReport from './reports/PTRosterReport'
import OperationsReport from './reports/OperationsReport'
import CancelsReport from './reports/CancelsReport'
import CheckinsReport from './reports/CheckinsReport'
import PTSessionsReport from './reports/PTSessionsReport'
import PTNewClientsReport from './reports/PTNewClientsReport'
import SessionFrequencyReport from './reports/SessionFrequencyReport'
import DeactivatedPTReport from './reports/DeactivatedPTReport'
import PTHealthReport from './reports/PTHealthReport'
import PayrollReport from './reports/PayrollReport'
import RevenueReport from './reports/RevenueReport'
import MetaAdsView from './MetaAdsView'
import GoogleMarketingView from './GoogleMarketingView'
import WebsiteSubmissionsReport from './reports/WebsiteSubmissionsReport'
import KpiReport from './reports/KpiReport'
import ReportInfoButton from './ReportInfoButton'
import { getReportInfo } from '../lib/reportInfo'

// SVG path data for each reporting tile (outline style, matches main page tiles via ToolButton)
const REPORT_ICONS = {
  'club-health': 'M3.75 12h16.5m-16.5 3.75h16.5M3.75 19.5h16.5M5.625 4.5h12.75a1.875 1.875 0 0 1 0 3.75H5.625a1.875 1.875 0 0 1 0-3.75Z',
  membership: 'M9.568 3H5.25A2.25 2.25 0 0 0 3 5.25v4.318c0 .597.237 1.17.659 1.591l9.581 9.581c.699.699 1.78.872 2.607.33a18.095 18.095 0 0 0 5.223-5.223c.542-.827.369-1.908-.33-2.607L11.16 3.66A2.25 2.25 0 0 0 9.568 3Z M6 6h.008v.008H6V6Z',
  pt: 'M3.75 13.5l10.5-11.25L12 10.5h8.25L9.75 21.75 12 13.5H3.75Z',
  'pt-roster': 'M9 12h3.75M9 15h3.75M9 18h3.75m3 .75H18a2.25 2.25 0 0 0 2.25-2.25V6.108c0-1.135-.845-2.098-1.976-2.192a48.424 48.424 0 0 0-1.123-.08m-5.801 0c-.065.21-.1.433-.1.664 0 .414.336.75.75.75h4.5a.75.75 0 0 0 .75-.75 2.25 2.25 0 0 0-.1-.664m-5.8 0A2.251 2.251 0 0 1 13.5 2.25H15c1.012 0 1.867.668 2.15 1.586m-5.8 0c-.376.023-.75.05-1.124.08C9.095 4.01 8.25 4.973 8.25 6.108V8.25m0 0H4.875c-.621 0-1.125.504-1.125 1.125v11.25c0 .621.504 1.125 1.125 1.125h9.75c.621 0 1.125-.504 1.125-1.125V9.375c0-.621-.504-1.125-1.125-1.125H8.25ZM6.75 12h.008v.008H6.75V12Zm0 3h.008v.008H6.75V15Zm0 3h.008v.008H6.75V18Z',
  operations: 'M9 12.75 11.25 15 15 9.75M21 12c0 1.268-.63 2.39-1.593 3.068a3.745 3.745 0 0 1-1.043 3.296 3.745 3.745 0 0 1-3.296 1.043A3.745 3.745 0 0 1 12 21c-1.268 0-2.39-.63-3.068-1.593a3.746 3.746 0 0 1-3.296-1.043 3.745 3.745 0 0 1-1.043-3.296A3.745 3.745 0 0 1 3 12c0-1.268.63-2.39 1.593-3.068a3.745 3.745 0 0 1 1.043-3.296 3.746 3.746 0 0 1 3.296-1.043A3.746 3.746 0 0 1 12 3c1.268 0 2.39.63 3.068 1.593a3.746 3.746 0 0 1 3.296 1.043 3.746 3.746 0 0 1 1.043 3.296A3.745 3.745 0 0 1 21 12Z',
  cancels: 'M9.75 9.75l4.5 4.5m0-4.5l-4.5 4.5M21 12a9 9 0 11-18 0 9 9 0 0118 0z',
  checkins: 'M9 12.75 11.25 15 15 9.75M9 17.25v3.375c0 .621-.504 1.125-1.125 1.125h-1.5a1.125 1.125 0 0 1-1.125-1.125V17.25m7.5 0v3.375c0 .621.504 1.125 1.125 1.125h1.5a1.125 1.125 0 0 0 1.125-1.125V17.25m-7.5 0h7.5M3 8.25v6a3 3 0 0 0 3 3h12a3 3 0 0 0 3-3v-6a3 3 0 0 0-3-3H6a3 3 0 0 0-3 3Z',
  'pt-sessions': 'M12 6v6h4.5m4.5 0a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z',
  'pt-new-clients': 'M18 18.72a9.094 9.094 0 0 0 3.741-.479 3 3 0 0 0-4.682-2.72m.94 3.198.001.031c0 .225-.012.447-.037.666A11.944 11.944 0 0 1 12 21c-2.17 0-4.207-.576-5.963-1.584A6.062 6.062 0 0 1 6 18.719m12 0a5.971 5.971 0 0 0-.941-3.197m0 0A5.995 5.995 0 0 0 12 12.75a5.995 5.995 0 0 0-5.058 2.772m0 0a3 3 0 0 0-4.681 2.72 8.986 8.986 0 0 0 3.74.477m.94-3.197a5.971 5.971 0 0 0-.94 3.197M15 6.75a3 3 0 1 1-6 0 3 3 0 0 1 6 0Zm6 3a2.25 2.25 0 1 1-4.5 0 2.25 2.25 0 0 1 4.5 0Zm-13.5 0a2.25 2.25 0 1 1-4.5 0 2.25 2.25 0 0 1 4.5 0Z',
  'session-frequency': 'M3 13.125C3 12.504 3.504 12 4.125 12h2.25c.621 0 1.125.504 1.125 1.125v6.75C7.5 20.496 6.996 21 6.375 21h-2.25A1.125 1.125 0 0 1 3 19.875v-6.75ZM9.75 8.625c0-.621.504-1.125 1.125-1.125h2.25c.621 0 1.125.504 1.125 1.125v11.25c0 .621-.504 1.125-1.125 1.125h-2.25a1.125 1.125 0 0 1-1.125-1.125V8.625ZM16.5 4.125c0-.621.504-1.125 1.125-1.125h2.25C20.496 3 21 3.504 21 4.125v15.75c0 .621-.504 1.125-1.125 1.125h-2.25a1.125 1.125 0 0 1-1.125-1.125V4.125Z',
  'deactivated-pt': 'M18.364 18.364A9 9 0 0 0 5.636 5.636m12.728 12.728A9 9 0 0 1 5.636 5.636m12.728 12.728L5.636 5.636',
  'pt-health': 'M21 8.25c0-2.485-2.099-4.5-4.688-4.5-1.935 0-3.597 1.126-4.312 2.733-.715-1.607-2.377-2.733-4.313-2.733C5.1 3.75 3 5.765 3 8.25c0 7.22 9 12 9 12s9-4.78 9-12Z',
  payroll: 'M2.25 8.25h19.5M2.25 9h19.5m-16.5 5.25h6m-6 2.25h3m-3.75 3h15a2.25 2.25 0 0 0 2.25-2.25V6.75A2.25 2.25 0 0 0 19.5 4.5h-15a2.25 2.25 0 0 0-2.25 2.25v10.5A2.25 2.25 0 0 0 4.5 19.5Z',
  revenue: 'M2.25 18 9 11.25l4.306 4.307a11.95 11.95 0 0 1 5.814-5.518l2.74-1.22m0 0-5.94-2.281m5.94 2.28-2.28 5.941',
  marketing: 'M10.34 15.84c-.688-.06-1.386-.09-2.09-.09H7.5a4.5 4.5 0 1 1 0-9h.75c.704 0 1.402-.03 2.09-.09m0 9.18c.253.962.584 1.892.985 2.783.247.55.06 1.21-.463 1.511l-.657.38c-.551.318-1.26.117-1.527-.461a20.845 20.845 0 0 1-1.44-4.282m3.102.069a18.03 18.03 0 0 1-.59-4.59c0-1.586.205-3.124.59-4.59m0 9.18a23.848 23.848 0 0 1 8.835 2.535M10.34 6.66a23.847 23.847 0 0 0 8.835-2.535m0 0A23.74 23.74 0 0 0 18.795 3m.38 1.125a23.91 23.91 0 0 1 1.014 5.395m-1.014 8.855c-.118.38-.245.754-.38 1.125m.38-1.125a23.91 23.91 0 0 0 1.014-5.395m0-3.46c.495.413.811 1.035.811 1.73 0 .695-.316 1.317-.811 1.73m0-3.46a24.347 24.347 0 0 1 0 3.46',
  'meta-ads': 'M3.75 3v11.25A2.25 2.25 0 0 0 6 16.5h2.25M3.75 3h-1.5m1.5 0h16.5m0 0h1.5m-1.5 0v11.25A2.25 2.25 0 0 1 18 16.5h-2.25m-7.5 0h7.5m-7.5 0-1 3m8.5-3 1 3m0 0 .5 1.5m-.5-1.5h-9.5m0 0-.5 1.5M9 11.25v1.5M12 9v3.75m3-6v6',
  'google-marketing': 'm21 21-5.197-5.197m0 0A7.5 7.5 0 1 0 5.196 5.196a7.5 7.5 0 0 0 10.607 10.607Z',
  'website-submissions': 'M21.75 6.75v10.5a2.25 2.25 0 0 1-2.25 2.25h-15a2.25 2.25 0 0 1-2.25-2.25V6.75m19.5 0A2.25 2.25 0 0 0 19.5 4.5h-15a2.25 2.25 0 0 0-2.25 2.25m19.5 0v.243a2.25 2.25 0 0 1-1.07 1.916l-7.5 4.615a2.25 2.25 0 0 1-2.36 0L3.32 8.91a2.25 2.25 0 0 1-1.07-1.916V6.75',
  kpis: 'M9 12.75 11.25 15 15 9.75M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0Zm-9-3.75a3.75 3.75 0 1 0 0 7.5 3.75 3.75 0 0 0 0-7.5Z',
}

const ALL_REPORT_TILES = [
  { key: 'club-health', label: 'Club Health', desc: 'Dashboard' },
  { key: 'membership', label: 'Membership', desc: 'Report' },
  { key: 'cancels', label: 'Cancels', desc: 'Report' },
  { key: 'pt', label: 'Day One', desc: 'Report' },
  { key: 'pt-roster', label: 'Roster', desc: 'Active Clients' },
  { key: 'checkins', label: 'Check-ins', desc: 'Traffic & Times' },
  { key: 'pt-sessions', label: 'Trainer Load', desc: 'Session Count' },
  { key: 'pt-new-clients', label: 'New Clients', desc: 'New + Resign Sales' },
  { key: 'session-frequency', label: 'Session Frequency', desc: 'Sessions / Member / Week' },
  { key: 'deactivated-pt', label: 'Deactivated PT', desc: 'Cancels + Burned PIFs' },
  { key: 'pt-health', label: 'PT Health', desc: 'Overview Dashboard' },
  { key: 'payroll', label: 'Payroll', desc: 'Monthly Commissions' },
  { key: 'revenue', label: 'Revenue', desc: 'Dollars & Profit Centers' },
  { key: 'operations', label: 'Operational Compliance', desc: 'Checklists' },
  { key: 'meta-ads', label: 'Meta Ads', desc: 'Facebook & Instagram' },
  { key: 'google-marketing', label: 'Google', desc: 'Business + Analytics' },
  { key: 'website-submissions', label: 'Website Submissions', desc: 'Form Leads' },
  { key: 'kpis', label: 'KPIs', desc: 'Goals vs. Actuals' },
]

// Group tiles surface fewer items at the top level. Each group holds an
// ordered list of report keys; reports outside any group still render as
// top-level tiles (none today, but easy to add).
const REPORT_GROUPS = [
  {
    key: 'health',
    label: 'Club Health',
    desc: 'Health, Activity & Compliance',
    iconPath: REPORT_ICONS['club-health'],
    reports: ['club-health', 'membership', 'cancels', 'operations', 'checkins', 'payroll', 'revenue'],
  },
  {
    key: 'training',
    label: 'Training',
    desc: 'PT Reports',
    iconPath: REPORT_ICONS['pt-roster'],
    reports: ['pt-health', 'pt', 'pt-roster', 'pt-sessions', 'pt-new-clients', 'session-frequency', 'deactivated-pt'],
  },
  {
    key: 'marketing',
    label: 'Marketing',
    desc: 'Ads, SEO & Lead Capture',
    iconPath: REPORT_ICONS['marketing'],
    reports: ['meta-ads', 'google-marketing', 'website-submissions'],
  },
  {
    key: 'experimental',
    label: 'Experimental',
    desc: 'In Development',
    iconPath: 'M10.5 1.5H8.25A2.25 2.25 0 0 0 6 3.75v16.5a2.25 2.25 0 0 0 2.25 2.25h7.5A2.25 2.25 0 0 0 18 20.25V3.75a2.25 2.25 0 0 0-2.25-2.25H13.5m-3 0V3h3V1.5m-3 0h3m-3 18.75h3',
    reports: ['kpis'],
  },
]

function getReportTilesForRole(role) {
  switch (role) {
    case 'team_member':
      return []
    case 'lead':
      return ALL_REPORT_TILES.filter(t => ['membership', 'cancels', 'pt', 'pt-roster', 'checkins', 'pt-sessions', 'pt-new-clients', 'session-frequency', 'deactivated-pt', 'pt-health'].includes(t.key))
    case 'manager':
      return ALL_REPORT_TILES.filter(t => ['membership', 'cancels', 'pt', 'club-health', 'pt-roster', 'checkins', 'pt-sessions', 'pt-new-clients', 'session-frequency', 'deactivated-pt', 'pt-health', 'payroll', 'operations', 'revenue'].includes(t.key))
    case 'marketing':
      // Marketing: marketing tiles + broader reports per REPORT_ACCESS, minus
      // website-submissions and kpis (corp+admin only).
      return ALL_REPORT_TILES.filter(t => t.key !== 'website-submissions' && t.key !== 'kpis')
    default: // corporate, admin, director
      return ALL_REPORT_TILES
  }
}

// Find the group a report belongs to, if any.
function findGroupForReport(reportKey) {
  return REPORT_GROUPS.find(g => g.reports.includes(reportKey)) || null
}

import { LOCATION_OPTIONS as LOCATIONS } from '../config/locations'
import LocationMultiSelect from './LocationMultiSelect'

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

function getMonthStart() {
  const d = new Date()
  return new Date(d.getFullYear(), d.getMonth(), 1).toISOString().split('T')[0]
}

function getToday() {
  return new Date().toISOString().split('T')[0]
}

// Hash format: `#reporting`, `#reporting/<groupKey>`, or `#reporting/<reportKey>`.
// We disambiguate by checking REPORT_GROUPS for the key.
function parseHash() {
  const hash = window.location.hash
  if (!hash.startsWith('#reporting/')) return { group: null, report: null }
  const slug = hash.replace('#reporting/', '')
  if (!slug) return { group: null, report: null }
  if (REPORT_GROUPS.some(g => g.key === slug)) return { group: slug, report: null }
  return { group: findGroupForReport(slug)?.key || null, report: slug }
}

export default function ReportingView({ user, onBack, location, isAdmin }) {
  const userRole = user?.staff?.role || 'team_member'
  const REPORT_TILES = getReportTilesForRole(userRole)
  const VISIBLE_REPORT_KEYS = new Set(REPORT_TILES.map(t => t.key))

  // Only show groups that contain at least one report the user can see.
  const visibleGroups = REPORT_GROUPS
    .map(g => ({ ...g, reports: g.reports.filter(k => VISIBLE_REPORT_KEYS.has(k)) }))
    .filter(g => g.reports.length > 0)

  const defaultReportKey = visibleGroups[0]?.reports[0] || null
  const initial = parseHash()
  // If hash points at a group only, jump to its first report. If hash has no
  // report at all, fall back to the very first report the user can see.
  const initialReport = initial.report
    || (initial.group && visibleGroups.find(g => g.key === initial.group)?.reports[0])
    || defaultReportKey
  const initialGroup = initialReport ? findGroupForReport(initialReport)?.key || null : null
  const [activeGroup, setActiveGroup] = useState(initialGroup)
  const [activeReport, setActiveReport] = useState(initialReport)
  const [startDate, setStartDate] = useState(getMonthStart())
  const [endDate, setEndDate] = useState(getToday())

  // Build the list of locations this user can view reports for
  const reportLocations = (user?.staff?.locations || []).filter(l => l.can_view_reports !== false)
  const hasMultipleReportLocations = isAdmin || reportLocations.length > 1
  const defaultSlug = hasMultipleReportLocations ? 'all' : (location || 'Salem').toLowerCase()
  const [locationSlug, setLocationSlug] = useState(defaultSlug)
  const [activeQuick, setActiveQuick] = useState('this_month')

  useEffect(() => {
    // Make sure the URL hash matches the resolved initial report so refreshes
    // land in the same place.
    if (initialReport && parseHash().report !== initialReport) {
      window.location.hash = '#reporting/' + initialReport
    }
    function onHashChange() {
      const next = parseHash()
      // If hash drifts to a group-only or empty path, redirect to first report.
      if (!next.report) {
        const fallback = next.group
          ? visibleGroups.find(g => g.key === next.group)?.reports[0] || defaultReportKey
          : defaultReportKey
        if (fallback) {
          window.location.hash = '#reporting/' + fallback
          return
        }
      }
      setActiveGroup(next.group)
      setActiveReport(next.report)
    }
    window.addEventListener('hashchange', onHashChange)
    return () => window.removeEventListener('hashchange', onHashChange)
  }, [])

  function navigateToReport(reportKey) {
    if (!reportKey) {
      // Step back to the current group if we have one, otherwise root.
      window.location.hash = activeGroup ? '#reporting/' + activeGroup : '#reporting'
      setActiveReport(null)
      return
    }
    const group = findGroupForReport(reportKey)
    window.location.hash = '#reporting/' + reportKey
    setActiveGroup(group?.key || null)
    setActiveReport(reportKey)
  }

  function applyQuickRange(key) {
    setActiveQuick(key)
    const range = getQuickRange(key)
    setStartDate(range.start)
    setEndDate(range.end)
  }

  function handleDateChange(field, value) {
    setActiveQuick(null)
    if (field === 'start') setStartDate(value)
    else setEndDate(value)
  }

  const currentGroup = activeGroup ? visibleGroups.find(g => g.key === activeGroup) : null
  const activeReportTile = activeReport ? REPORT_TILES.find(t => t.key === activeReport) : null

  return (
    <div className="w-full px-6 py-6 max-w-7xl mx-auto flex gap-6">
      {/* Left sidebar — grouped report nav */}
      <aside className="w-56 flex-shrink-0 hidden md:block">
        <div className="bg-surface rounded-xl border border-border p-2 sticky top-6">
          {onBack && (
            <button
              type="button"
              onClick={onBack}
              className="w-full flex items-center gap-2 px-3 py-2 text-[11px] uppercase tracking-wide text-text-muted hover:text-text-primary font-semibold transition-colors"
            >
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="w-3.5 h-3.5">
                <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" />
              </svg>
              Back to Portal
            </button>
          )}
          <button
            type="button"
            onClick={() => defaultReportKey && navigateToReport(defaultReportKey)}
            className="w-full text-left px-3 pt-1 pb-3 text-lg font-bold text-text-primary hover:text-wcs-red transition-colors"
          >
            Reports
          </button>
          {visibleGroups.map(group => (
            <div key={group.key} className="mt-3 first:mt-0">
              <div className="px-3 pt-1 pb-1.5 text-sm font-bold text-text-primary">
                {group.label}
              </div>
              <ul className="space-y-0.5">
                {group.reports.map(reportKey => {
                  const tile = ALL_REPORT_TILES.find(t => t.key === reportKey)
                  if (!tile) return null
                  const active = activeReport === reportKey
                  return (
                    <li key={reportKey}>
                      <button
                        type="button"
                        onClick={() => navigateToReport(reportKey)}
                        className={`w-full flex items-center gap-2.5 px-3 py-2 rounded-lg text-sm font-medium transition-colors ${
                          active
                            ? 'bg-wcs-red/10 text-wcs-red'
                            : 'text-text-primary hover:bg-bg'
                        }`}
                      >
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" className="w-4 h-4 flex-shrink-0">
                          <path strokeLinecap="round" strokeLinejoin="round" d={REPORT_ICONS[reportKey]} />
                        </svg>
                        <span className="truncate text-left">{tile.label}</span>
                      </button>
                    </li>
                  )
                })}
              </ul>
            </div>
          ))}
        </div>
      </aside>

      {/* Main content pane */}
      <div className="flex-1 min-w-0">
      {/* Header card */}
      <div className="relative z-20 bg-surface/95 backdrop-blur-sm rounded-xl border border-border p-5 mb-6">
        {(() => {
          const showDateControls = activeReport !== 'pt-roster' && activeReport !== 'operations' && activeReport !== 'payroll' && activeReport !== 'session-frequency' && activeReport !== 'meta-ads' && activeReport !== 'google-marketing' && activeReport !== 'website-submissions'
          const showLocation = hasMultipleReportLocations
          return (
            <>
              {/* Title row: report title + location selector on the same line */}
              <div className="flex items-center gap-3 mb-4">
                <h2 className="text-xl font-bold text-text-primary">
                  {activeReportTile?.label || currentGroup?.label || 'Reporting'}
                </h2>
                {activeReport && (
                  <ReportInfoButton info={getReportInfo(activeReport)} />
                )}
                <div className="ml-auto flex-shrink-0">
                  {showLocation ? (
                    <LocationMultiSelect
                      value={locationSlug}
                      onChange={setLocationSlug}
                      options={(isAdmin
                        ? LOCATIONS.filter(l => l.slug !== 'all')
                        : reportLocations.map(l => ({ slug: l.name.toLowerCase(), label: l.name }))
                      )}
                    />
                  ) : (
                    <p className="text-xs text-text-muted uppercase tracking-wide font-semibold">{location}</p>
                  )}
                </div>
              </div>

              {/* Date controls row (hidden for reports with fixed/self-managed dates) */}
              {showDateControls && (
                <div className="flex items-center gap-3 mb-4 flex-wrap">
                  <div className="flex gap-1.5">
                    {QUICK_RANGES.map(qr => (
                      <button
                        key={qr.key}
                        onClick={() => applyQuickRange(qr.key)}
                        className={`px-3 py-1.5 rounded-lg text-xs font-medium border transition-colors whitespace-nowrap ${
                          activeQuick === qr.key
                            ? 'bg-text-primary text-white border-text-primary'
                            : 'bg-bg text-text-muted border-border hover:text-text-primary'
                        }`}
                      >
                        {qr.label}
                      </button>
                    ))}
                  </div>
                  <div className="flex items-center gap-2 ml-auto">
                    <label className="text-xs text-text-muted">From</label>
                    <input
                      type="date"
                      value={startDate}
                      onChange={e => handleDateChange('start', e.target.value)}
                      className="px-3 py-1.5 rounded-lg border border-border bg-bg text-text-primary text-sm focus:outline-none focus:ring-2 focus:ring-wcs-red"
                    />
                    <label className="text-xs text-text-muted">To</label>
                    <input
                      type="date"
                      value={endDate}
                      onChange={e => handleDateChange('end', e.target.value)}
                      className="px-3 py-1.5 rounded-lg border border-border bg-bg text-text-primary text-sm focus:outline-none focus:ring-2 focus:ring-wcs-red"
                    />
                  </div>
                </div>
              )}
            </>
          )
        })()}
      </div>

      {/* Active report content (sidebar is the nav) */}
      <>
        {!activeReport && (
          <div className="bg-surface rounded-xl border border-border p-8 text-center text-text-muted">
            No reports available for your role.
          </div>
        )}
        {activeReport === 'club-health' && (
            <ClubHealthReport startDate={startDate} endDate={endDate} locationSlug={locationSlug} />
          )}
          {activeReport === 'membership' && (
            <MembershipReport startDate={startDate} endDate={endDate} locationSlug={locationSlug} />
          )}
          {activeReport === 'cancels' && (
            <CancelsReport startDate={startDate} endDate={endDate} locationSlug={locationSlug} />
          )}
          {activeReport === 'pt' && (
            <PTReport startDate={startDate} endDate={endDate} locationSlug={locationSlug} />
          )}
          {activeReport === 'pt-roster' && (
            <PTRosterReport locationSlug={locationSlug} />
          )}
          {activeReport === 'checkins' && (
            <CheckinsReport startDate={startDate} endDate={endDate} locationSlug={locationSlug} />
          )}
          {activeReport === 'pt-sessions' && (
            <PTSessionsReport startDate={startDate} endDate={endDate} locationSlug={locationSlug} />
          )}
          {activeReport === 'pt-new-clients' && (
            <PTNewClientsReport startDate={startDate} endDate={endDate} locationSlug={locationSlug} />
          )}
          {activeReport === 'session-frequency' && (
            <SessionFrequencyReport locationSlug={locationSlug} />
          )}
          {activeReport === 'deactivated-pt' && (
            <DeactivatedPTReport startDate={startDate} endDate={endDate} locationSlug={locationSlug} />
          )}
          {activeReport === 'pt-health' && (
            <PTHealthReport startDate={startDate} endDate={endDate} locationSlug={locationSlug} />
          )}
          {activeReport === 'payroll' && (
            <PayrollReport locationSlug={locationSlug} />
          )}
          {activeReport === 'operations' && (
            <OperationsReport locationSlug={locationSlug} />
          )}
          {activeReport === 'revenue' && (
            <RevenueReport startDate={startDate} endDate={endDate} locationSlug={locationSlug} />
          )}
          {activeReport === 'meta-ads' && (
            <MetaAdsView onBack={() => navigateToReport(null)} />
          )}
          {activeReport === 'google-marketing' && (
            <GoogleMarketingView onBack={() => navigateToReport(null)} />
          )}
          {activeReport === 'website-submissions' && (
            <WebsiteSubmissionsReport />
          )}
          {activeReport === 'kpis' && (
            <KpiReport startDate={startDate} endDate={endDate} locationSlug={locationSlug} />
          )}
        </>
      </div>
    </div>
  )
}
