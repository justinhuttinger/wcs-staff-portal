import { useState, useEffect } from 'react'
import MembershipReport from './reports/MembershipReport'
import PTReport from './reports/PTReport'
import AdReports from './reports/AdReports'
import ClubHealthReport from './reports/ClubHealthReport'

const REPORT_TILES = [
  { key: 'club-health', label: 'Club Health', desc: 'Dashboard', icon: '❤️' },
  { key: 'membership', label: 'Membership', desc: 'Report', icon: '🏷️' },
  { key: 'pt', label: 'PT / Day One', desc: 'Report', icon: '🏋️' },
  { key: 'ads', label: 'Ad Reports', desc: 'Coming Soon', icon: '📣' },
]

const LOCATIONS = [
  { slug: 'all', label: 'All Locations' },
  { slug: 'salem', label: 'Salem' },
  { slug: 'keizer', label: 'Keizer' },
  { slug: 'eugene', label: 'Eugene' },
  { slug: 'springfield', label: 'Springfield' },
  { slug: 'clackamas', label: 'Clackamas' },
  { slug: 'milwaukie', label: 'Milwaukie' },
  { slug: 'medford', label: 'Medford' },
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
  const [activeReport, setActiveReport] = useState(getSubRoute())
  const [startDate, setStartDate] = useState(getMonthStart())
  const [endDate, setEndDate] = useState(getToday())
  const defaultSlug = isAdmin ? 'all' : (location || 'Salem').toLowerCase()
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
      {/* Header */}
      <div className="mb-5">
        {activeReport && (
          <button
            onClick={() => navigateTo(null)}
            className="flex items-center gap-2 text-sm text-text-muted hover:text-text-primary transition-colors mb-2"
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="w-4 h-4">
              <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" />
            </svg>
            Back to Reports
          </button>
        )}
        <h2 className="text-xl font-bold text-text-primary">
          {activeReport ? REPORT_TILES.find(t => t.key === activeReport)?.label || 'Report' : 'Reporting'}
        </h2>
      </div>

      {/* Location Selector (admin only) */}
      {isAdmin ? (
        <div className="flex flex-wrap gap-2 mb-4">
          {LOCATIONS.map(loc => (
            <button
              key={loc.slug}
              onClick={() => setLocationSlug(loc.slug)}
              className={`px-3 py-1.5 rounded-full text-xs font-medium border transition-colors ${
                locationSlug === loc.slug
                  ? 'bg-wcs-red text-white border-wcs-red'
                  : 'bg-surface text-text-muted border-border hover:text-text-primary hover:border-text-muted'
              }`}
            >
              {loc.label}
            </button>
          ))}
        </div>
      ) : (
        <p className="text-xs text-text-muted mb-4 uppercase tracking-wide font-semibold">{location}</p>
      )}

      {/* Date Controls — right aligned */}
      <div className="flex flex-wrap items-center gap-3 mb-6 justify-end">
        <div className="flex flex-wrap gap-1.5">
          {QUICK_RANGES.map(qr => (
            <button
              key={qr.key}
              onClick={() => applyQuickRange(qr.key)}
              className={`px-3 py-1.5 rounded-lg text-xs font-medium border transition-colors ${
                activeQuick === qr.key
                  ? 'bg-text-primary text-white border-text-primary'
                  : 'bg-surface text-text-muted border-border hover:text-text-primary'
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
            className="px-3 py-1.5 rounded-lg border border-border bg-surface text-text-primary text-sm focus:outline-none focus:ring-2 focus:ring-wcs-red"
          />
          <label className="text-xs text-text-muted">To</label>
          <input
            type="date"
            value={endDate}
            onChange={e => handleDateChange('end', e.target.value)}
            className="px-3 py-1.5 rounded-lg border border-border bg-surface text-text-primary text-sm focus:outline-none focus:ring-2 focus:ring-wcs-red"
          />
        </div>
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
              <div className="flex items-center justify-center w-14 h-14 rounded-full bg-bg text-wcs-red group-hover:bg-wcs-red group-hover:text-white transition-all duration-200">
                <span className="text-2xl">{tile.icon}</span>
              </div>
              <div className="text-center">
                <span className="block text-base font-semibold text-text-primary">{tile.label}</span>
                <span className="block text-xs font-medium text-text-muted uppercase tracking-[0.8px] mt-1">{tile.desc}</span>
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
          {activeReport === 'pt' && (
            <PTReport startDate={startDate} endDate={endDate} locationSlug={locationSlug} />
          )}
          {activeReport === 'ads' && (
            <AdReports startDate={startDate} endDate={endDate} locationSlug={locationSlug} />
          )}
        </>
      )}
    </div>
  )
}
