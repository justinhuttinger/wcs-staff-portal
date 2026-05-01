import { useState, useEffect } from 'react'
import MembershipReport from './reports/MembershipReport'
import PTReport from './reports/PTReport'
import ClubHealthReport from './reports/ClubHealthReport'
import PTRosterReport from './reports/PTRosterReport'
import OperationsReport from './reports/OperationsReport'
import CancelsReport from './reports/CancelsReport'

// SVG path data for each reporting tile (outline style, matches main page tiles via ToolButton)
const REPORT_ICONS = {
  'club-health': 'M3.75 12h16.5m-16.5 3.75h16.5M3.75 19.5h16.5M5.625 4.5h12.75a1.875 1.875 0 0 1 0 3.75H5.625a1.875 1.875 0 0 1 0-3.75Z',
  membership: 'M9.568 3H5.25A2.25 2.25 0 0 0 3 5.25v4.318c0 .597.237 1.17.659 1.591l9.581 9.581c.699.699 1.78.872 2.607.33a18.095 18.095 0 0 0 5.223-5.223c.542-.827.369-1.908-.33-2.607L11.16 3.66A2.25 2.25 0 0 0 9.568 3Z M6 6h.008v.008H6V6Z',
  pt: 'M3.75 13.5l10.5-11.25L12 10.5h8.25L9.75 21.75 12 13.5H3.75Z',
  'pt-roster': 'M9 12h3.75M9 15h3.75M9 18h3.75m3 .75H18a2.25 2.25 0 0 0 2.25-2.25V6.108c0-1.135-.845-2.098-1.976-2.192a48.424 48.424 0 0 0-1.123-.08m-5.801 0c-.065.21-.1.433-.1.664 0 .414.336.75.75.75h4.5a.75.75 0 0 0 .75-.75 2.25 2.25 0 0 0-.1-.664m-5.8 0A2.251 2.251 0 0 1 13.5 2.25H15c1.012 0 1.867.668 2.15 1.586m-5.8 0c-.376.023-.75.05-1.124.08C9.095 4.01 8.25 4.973 8.25 6.108V8.25m0 0H4.875c-.621 0-1.125.504-1.125 1.125v11.25c0 .621.504 1.125 1.125 1.125h9.75c.621 0 1.125-.504 1.125-1.125V9.375c0-.621-.504-1.125-1.125-1.125H8.25ZM6.75 12h.008v.008H6.75V12Zm0 3h.008v.008H6.75V15Zm0 3h.008v.008H6.75V18Z',
  operations: 'M9 12.75 11.25 15 15 9.75M21 12c0 1.268-.63 2.39-1.593 3.068a3.745 3.745 0 0 1-1.043 3.296 3.745 3.745 0 0 1-3.296 1.043A3.745 3.745 0 0 1 12 21c-1.268 0-2.39-.63-3.068-1.593a3.746 3.746 0 0 1-3.296-1.043 3.745 3.745 0 0 1-1.043-3.296A3.745 3.745 0 0 1 3 12c0-1.268.63-2.39 1.593-3.068a3.745 3.745 0 0 1 1.043-3.296 3.746 3.746 0 0 1 3.296-1.043A3.746 3.746 0 0 1 12 3c1.268 0 2.39.63 3.068 1.593a3.746 3.746 0 0 1 3.296 1.043 3.746 3.746 0 0 1 1.043 3.296A3.745 3.745 0 0 1 21 12Z',
  cancels: 'M9.75 9.75l4.5 4.5m0-4.5l-4.5 4.5M21 12a9 9 0 11-18 0 9 9 0 0118 0z',
}

const ALL_REPORT_TILES = [
  { key: 'club-health', label: 'Club Health', desc: 'Dashboard' },
  { key: 'membership', label: 'Membership', desc: 'Report' },
  { key: 'cancels', label: 'Cancels', desc: 'Report' },
  { key: 'pt', label: 'PT / Day One', desc: 'Report' },
  { key: 'pt-roster', label: 'PT Roster', desc: 'Active Clients' },
  { key: 'operations', label: 'Operational Compliance', desc: 'Checklists' },
]

function getReportTilesForRole(role) {
  switch (role) {
    case 'team_member':
      return []
    case 'lead':
      return ALL_REPORT_TILES.filter(t => ['membership', 'cancels', 'pt', 'pt-roster'].includes(t.key))
    case 'manager':
      return ALL_REPORT_TILES.filter(t => ['membership', 'cancels', 'pt', 'club-health', 'pt-roster', 'operations'].includes(t.key))
    default: // corporate, admin
      return ALL_REPORT_TILES
  }
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

function getSubRoute() {
  const hash = window.location.hash
  if (hash.startsWith('#reporting/')) return hash.replace('#reporting/', '')
  return null
}

export default function ReportingView({ user, onBack, location, isAdmin }) {
  const userRole = user?.staff?.role || 'team_member'
  const REPORT_TILES = getReportTilesForRole(userRole)
  const [activeReport, setActiveReport] = useState(getSubRoute())
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
      setActiveReport(getSubRoute())
    }
    window.addEventListener('hashchange', onHashChange)
    return () => window.removeEventListener('hashchange', onHashChange)
  }, [])

  function navigateTo(key) {
    window.location.hash = key ? '#reporting/' + key : '#reporting'
    setActiveReport(key || null)
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

  function handleBack() {
    if (activeReport) {
      navigateTo(null)
    } else if (onBack) {
      onBack()
    }
  }

  return (
    <div className="w-full px-8 py-6 max-w-6xl mx-auto">
      {/* Header card */}
      <div className="bg-surface/95 backdrop-blur-sm rounded-xl border border-border p-5 mb-6">
        {activeReport && (
          <button
            onClick={handleBack}
            className="flex items-center gap-2 text-sm text-text-muted hover:text-text-primary transition-colors mb-2"
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="w-4 h-4">
              <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" />
            </svg>
            Back to Reports
          </button>
        )}
        <h2 className="text-xl font-bold text-text-primary mb-4">
          {activeReport ? REPORT_TILES.find(t => t.key === activeReport)?.label || 'Report' : 'Reporting'}
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

        {/* Date Controls — hidden for PT Roster and Operations (no date range) */}
        {activeReport !== 'pt-roster' && activeReport !== 'operations' && <div className="flex flex-wrap items-center gap-3 justify-end">
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

      {/* Content — Tile Grid or Active Report */}
      {!activeReport ? (
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-5">
          {REPORT_TILES.map(tile => (
            <button
              key={tile.key}
              onClick={() => navigateTo(tile.key)}
              className="group flex flex-col items-center justify-center gap-3 rounded-[14px] bg-surface border border-border p-8 cursor-pointer transition-all duration-200 hover:-translate-y-[1px] hover:shadow-[0_8px_32px_rgba(0,0,0,0.12)]"
            >
              <div className="flex items-center justify-center w-14 h-14 rounded-full bg-bg text-wcs-red group-hover:bg-wcs-red/10 transition-all duration-200">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" className="w-7 h-7">
                  <path strokeLinecap="round" strokeLinejoin="round" d={REPORT_ICONS[tile.key]} />
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
          {activeReport === 'operations' && (
            <OperationsReport locationSlug={locationSlug} />
          )}
        </>
      )}
    </div>
  )
}
