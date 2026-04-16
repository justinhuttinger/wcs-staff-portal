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

export default function MobileReportShell({ title, children, user, hideDateRange }) {
  const defaultLocSlug = ['corporate', 'admin', 'director'].includes(user?.staff?.role)
    ? 'all'
    : (user?.staff?.locations?.find(l => l.is_primary)?.name || user?.staff?.locations?.[0]?.name || 'salem').toLowerCase()

  const [activeRange, setActiveRange] = useState('this_month')
  const [locationSlug, setLocationSlug] = useState(defaultLocSlug)
  const [customStart, setCustomStart] = useState('')
  const [customEnd, setCustomEnd] = useState('')

  const isCorporatePlus = ['corporate', 'admin', 'director'].includes(user?.staff?.role)

  const availableLocations = useMemo(() => {
    if (isCorporatePlus) return LOCATIONS
    const userLocations = user?.staff?.locations || []
    const allowed = userLocations
      .filter(loc => loc.can_view_reports !== false)
      .map(loc => (loc.name || '').toLowerCase())
    // Non-corporate users: no "All" option, only their assigned locations
    return LOCATIONS.filter(l => l.slug !== 'all' && allowed.includes(l.slug))
  }, [user, isCorporatePlus])

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
      {!hideDateRange && (
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
      )}

      {/* Custom date pickers */}
      {!hideDateRange && (
        <div className="px-4 pb-3 flex gap-2">
          <input
            type="date"
            value={customStart || startDate}
            onChange={e => handleCustomDate('start', e.target.value)}
            className="flex-1 bg-surface border border-border rounded-xl px-3 py-2 text-xs text-text-primary"
          />
          <input
            type="date"
            value={customEnd || endDate}
            onChange={e => handleCustomDate('end', e.target.value)}
            className="flex-1 bg-surface border border-border rounded-xl px-3 py-2 text-xs text-text-primary"
          />
        </div>
      )}

      {/* Report content */}
      <div className="flex-1 overflow-y-auto">
        {children({ startDate, endDate, locationSlug })}
      </div>
    </div>
  )
}
