import React, { useState, useMemo } from 'react'

const LOCATIONS = [
  { slug: 'all', label: 'All' },
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
  { key: 'last_30', label: '30 Days' },
  { key: 'last_90', label: '90 Days' },
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
    case 'last_30': { const s = new Date(now); s.setDate(s.getDate() - 30); return { start: s.toISOString().split('T')[0], end: today } }
    case 'last_90': { const s = new Date(now); s.setDate(s.getDate() - 90); return { start: s.toISOString().split('T')[0], end: today } }
    case 'ytd': return { start: new Date(now.getFullYear(), 0, 1).toISOString().split('T')[0], end: today }
    default: return { start: today, end: today }
  }
}

export default function MobileReportShell({ title, children, user }) {
  const [activeRange, setActiveRange] = useState('this_month')
  const [locationSlug, setLocationSlug] = useState('all')
  const [customStart, setCustomStart] = useState('')
  const [customEnd, setCustomEnd] = useState('')

  const availableLocations = useMemo(() => {
    const role = user?.staff?.role
    if (role === 'admin' || role === 'director') return LOCATIONS
    const userLocations = user?.staff?.locations || []
    const allowed = userLocations
      .filter(loc => loc.can_view_reports !== false)
      .map(loc => (loc.name || '').toLowerCase())
    return LOCATIONS.filter(l => l.slug === 'all' || allowed.includes(l.slug))
  }, [user])

  const { startDate, endDate } = useMemo(() => {
    if (customStart && customEnd) return { startDate: customStart, endDate: customEnd }
    const range = getQuickRange(activeRange)
    return { startDate: range.start, endDate: range.end }
  }, [activeRange, customStart, customEnd])

  function handleRangeSelect(key) {
    setActiveRange(key)
    setCustomStart('')
    setCustomEnd('')
  }

  function handleCustomDate(field, value) {
    if (field === 'start') setCustomStart(value)
    else setCustomEnd(value)
    setActiveRange('')
  }

  return (
    <div className="flex flex-col min-h-0">
      <div className="px-4 pt-3 pb-2">
        <h2 className="text-lg font-bold text-text-primary">{title}</h2>
      </div>

      {/* Location pills */}
      <div className="px-4 pb-2 overflow-x-auto scrollbar-hide">
        <div className="flex gap-2 min-w-max">
          {availableLocations.map(loc => (
            <button
              key={loc.slug}
              onClick={() => setLocationSlug(loc.slug)}
              className={`px-3 py-1.5 rounded-full text-xs font-medium whitespace-nowrap transition-colors ${
                locationSlug === loc.slug
                  ? 'bg-wcs-red text-white'
                  : 'bg-surface border border-border text-text-secondary'
              }`}
            >
              {loc.label}
            </button>
          ))}
        </div>
      </div>

      {/* Quick range pills */}
      <div className="px-4 pb-2 overflow-x-auto scrollbar-hide">
        <div className="flex gap-2 min-w-max">
          {QUICK_RANGES.map(range => (
            <button
              key={range.key}
              onClick={() => handleRangeSelect(range.key)}
              className={`px-3 py-1.5 rounded-full text-xs font-medium whitespace-nowrap transition-colors ${
                activeRange === range.key
                  ? 'bg-wcs-red text-white'
                  : 'bg-surface border border-border text-text-secondary'
              }`}
            >
              {range.label}
            </button>
          ))}
        </div>
      </div>

      {/* Custom date pickers */}
      <div className="px-4 pb-3 flex gap-2">
        <div className="flex-1 relative">
          <svg className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-wcs-red pointer-events-none" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M6.75 3v2.25M17.25 3v2.25M3 18.75V7.5a2.25 2.25 0 012.25-2.25h13.5A2.25 2.25 0 0121 7.5v11.25m-18 0A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75m-18 0v-7.5A2.25 2.25 0 015.25 9h13.5A2.25 2.25 0 0121 11.25v7.5" />
          </svg>
          <input
            type="date"
            value={customStart || startDate}
            onChange={e => handleCustomDate('start', e.target.value)}
            className="w-full bg-surface border-2 border-border rounded-xl pl-9 pr-3 py-2.5 text-xs text-text-primary focus:border-wcs-red focus:outline-none transition-colors"
          />
        </div>
        <div className="flex-1 relative">
          <svg className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-wcs-red pointer-events-none" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M6.75 3v2.25M17.25 3v2.25M3 18.75V7.5a2.25 2.25 0 012.25-2.25h13.5A2.25 2.25 0 0121 7.5v11.25m-18 0A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75m-18 0v-7.5A2.25 2.25 0 015.25 9h13.5A2.25 2.25 0 0121 11.25v7.5" />
          </svg>
          <input
            type="date"
            value={customEnd || endDate}
            onChange={e => handleCustomDate('end', e.target.value)}
            className="w-full bg-surface border-2 border-border rounded-xl pl-9 pr-3 py-2.5 text-xs text-text-primary focus:border-wcs-red focus:outline-none transition-colors"
          />
        </div>
      </div>

      {/* Report content */}
      <div className="flex-1 overflow-y-auto">
        {children({ startDate, endDate, locationSlug })}
      </div>
    </div>
  )
}
