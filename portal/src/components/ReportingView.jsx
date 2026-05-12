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
import PayrollReport from './reports/PayrollReport'

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
  payroll: 'M2.25 8.25h19.5M2.25 9h19.5m-16.5 5.25h6m-6 2.25h3m-3.75 3h15a2.25 2.25 0 0 0 2.25-2.25V6.75A2.25 2.25 0 0 0 19.5 4.5h-15a2.25 2.25 0 0 0-2.25 2.25v10.5A2.25 2.25 0 0 0 4.5 19.5Z',
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
  { key: 'payroll', label: 'Payroll', desc: 'Monthly Commissions' },
  { key: 'operations', label: 'Operational Compliance', desc: 'Checklists' },
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
    reports: ['club-health', 'membership', 'cancels', 'operations', 'checkins', 'payroll'],
  },
  {
    key: 'training',
    label: 'Training',
    desc: 'PT Reports',
    iconPath: REPORT_ICONS['pt-roster'],
    reports: ['pt', 'pt-roster', 'pt-sessions', 'pt-new-clients', 'session-frequency', 'deactivated-pt'],
  },
]

function getReportTilesForRole(role) {
  switch (role) {
    case 'team_member':
      return []
    case 'lead':
      return ALL_REPORT_TILES.filter(t => ['membership', 'cancels', 'pt', 'pt-roster', 'checkins', 'pt-sessions', 'pt-new-clients', 'session-frequency', 'deactivated-pt'].includes(t.key))
    case 'manager':
      return ALL_REPORT_TILES.filter(t => ['membership', 'cancels', 'pt', 'club-health', 'pt-roster', 'checkins', 'pt-sessions', 'pt-new-clients', 'session-frequency', 'deactivated-pt', 'payroll', 'operations'].includes(t.key))
    default: // corporate, admin
      return ALL_REPORT_TILES
  }
}

// Find the group a report belongs to, if any.
function findGroupForReport(reportKey) {
  return REPORT_GROUPS.find(g => g.reports.includes(reportKey)) || null
}

import { LOCATION_OPTIONS as LOCATIONS } from '../config/locations'

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

  const initial = parseHash()
  const [activeGroup, setActiveGroup] = useState(initial.group)
  const [activeReport, setActiveReport] = useState(initial.report)
  const [startDate, setStartDate] = useState(getMonthStart())
  const [endDate, setEndDate] = useState(getToday())

  // Build the list of locations this user can view reports for
  const reportLocations = (user?.staff?.locations || []).filter(l => l.can_view_reports !== false)
  const hasMultipleReportLocations = isAdmin || reportLocations.length > 1
  const defaultSlug = hasMultipleReportLocations ? 'all' : (location || 'Salem').toLowerCase()
  const [locationSlug, setLocationSlug] = useState(defaultSlug)
  const [activeQuick, setActiveQuick] = useState('this_month')

  useEffect(() => {
    function onHashChange() {
      const next = parseHash()
      setActiveGroup(next.group)
      setActiveReport(next.report)
    }
    window.addEventListener('hashchange', onHashChange)
    return () => window.removeEventListener('hashchange', onHashChange)
  }, [])

  function navigateToGroup(groupKey) {
    window.location.hash = groupKey ? '#reporting/' + groupKey : '#reporting'
    setActiveGroup(groupKey || null)
    setActiveReport(null)
  }

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

  function handleBack() {
    if (activeReport) {
      // Drop the report; stay inside the group if we were inside one.
      navigateToReport(null)
    } else if (activeGroup) {
      // Step out of the group view to the root tile grid.
      navigateToGroup(null)
    } else if (onBack) {
      onBack()
    }
  }

  // Tiles shown in the current view: groups at root, that group's reports inside a group.
  const tilesAtRoot = visibleGroups.map(g => ({ key: g.key, label: g.label, desc: g.desc, iconPath: g.iconPath, isGroup: true }))
  const tilesInGroup = currentGroup
    ? currentGroup.reports
        .map(k => ALL_REPORT_TILES.find(t => t.key === k))
        .filter(Boolean)
        .map(t => ({ key: t.key, label: t.label, desc: t.desc, iconPath: REPORT_ICONS[t.key], isGroup: false }))
    : []
  const tilesToShow = activeReport ? [] : (currentGroup ? tilesInGroup : tilesAtRoot)

  const backLabel = activeReport
    ? (currentGroup ? `Back to ${currentGroup.label}` : 'Back to Reports')
    : (currentGroup ? 'Back to Reports' : '')

  return (
    <div className="w-full px-8 py-6 max-w-6xl mx-auto">
      {/* Header card */}
      <div className="bg-surface/95 backdrop-blur-sm rounded-xl border border-border p-5 mb-6">
        {(activeReport || activeGroup) && (
          <button
            onClick={handleBack}
            className="flex items-center gap-2 text-sm text-text-muted hover:text-text-primary transition-colors mb-2"
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="w-4 h-4">
              <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" />
            </svg>
            {backLabel}
          </button>
        )}
        <h2 className="text-xl font-bold text-text-primary mb-4">
          {activeReportTile?.label || currentGroup?.label || 'Reporting'}
        </h2>

        {/* Location Selector */}
        {hasMultipleReportLocations ? (
          <div className="flex flex-wrap gap-2 mb-4">
            {(isAdmin ? LOCATIONS : [{ slug: 'all', label: 'All Locations' }, ...reportLocations.map(l => ({ slug: l.name.toLowerCase(), label: l.name }))]).map(loc => (
              <button
                key={loc.slug}
                onClick={() => setLocationSlug(loc.slug)}
                className={`px-3 py-1.5 rounded-full text-xs font-medium border transition-colors ${
                  locationSlug === loc.slug
                    ? 'bg-wcs-red text-white border-wcs-red'
                    : 'bg-bg text-text-muted border-border hover:text-text-primary hover:border-text-muted'
                }`}
              >
                {loc.label}
              </button>
            ))}
          </div>
        ) : (
          <p className="text-xs text-text-muted mb-4 uppercase tracking-wide font-semibold">{location}</p>
        )}

        {/* Date Controls — hidden for reports with fixed or self-managed date ranges */}
        {activeReport !== 'pt-roster' && activeReport !== 'operations' && activeReport !== 'payroll' && <div className="flex flex-wrap items-center gap-3 justify-end">
          <div className="flex flex-wrap gap-1.5">
            {QUICK_RANGES.map(qr => (
              <button
                key={qr.key}
                onClick={() => applyQuickRange(qr.key)}
                className={`px-3 py-1.5 rounded-lg text-xs font-medium border transition-colors ${
                  activeQuick === qr.key
                    ? 'bg-text-primary text-white border-text-primary'
                    : 'bg-bg text-text-muted border-border hover:text-text-primary'
                }`}
              >
                {qr.label}
              </button>
            ))}
          </div>
          <div className="flex items-center gap-2">
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
        </div>}
      </div>

      {/* Content — Tile Grid (root or group) or Active Report */}
      {!activeReport ? (
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-5">
          {tilesToShow.map(tile => (
            <button
              key={tile.key}
              onClick={() => tile.isGroup ? navigateToGroup(tile.key) : navigateToReport(tile.key)}
              className="group flex flex-col items-center justify-center gap-3 rounded-[14px] bg-surface border border-border p-8 cursor-pointer transition-all duration-200 hover:-translate-y-[1px] hover:shadow-[0_8px_32px_rgba(0,0,0,0.12)]"
            >
              <div className="flex items-center justify-center w-14 h-14 rounded-full bg-bg text-wcs-red group-hover:bg-wcs-red/10 transition-all duration-200">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" className="w-7 h-7">
                  <path strokeLinecap="round" strokeLinejoin="round" d={tile.iconPath} />
                </svg>
              </div>
              <div className="text-center">
                <span className="block text-base font-semibold text-text-primary">{tile.label}</span>
                <span className="block text-xs font-medium text-tile-sub uppercase tracking-[0.8px] mt-1">{tile.desc}</span>
              </div>
            </button>
          ))}
        </div>
      ) : (
        <>
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
            <SessionFrequencyReport startDate={startDate} endDate={endDate} locationSlug={locationSlug} />
          )}
          {activeReport === 'deactivated-pt' && (
            <DeactivatedPTReport startDate={startDate} endDate={endDate} locationSlug={locationSlug} />
          )}
          {activeReport === 'payroll' && (
            <PayrollReport locationSlug={locationSlug} />
          )}
          {activeReport === 'operations' && (
            <OperationsReport locationSlug={locationSlug} />
          )}
        </>
      )}
    </div>
  )
}
