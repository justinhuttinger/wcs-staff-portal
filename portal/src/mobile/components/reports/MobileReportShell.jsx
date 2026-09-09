import React, { useState, useMemo } from 'react'
import LocationMultiSelect from '../../../components/LocationMultiSelect'
import { usePullToRefresh } from '../usePullToRefresh'
import WcsLoadingMark from '../../../components/WcsLoadingMark'

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

/**
 * `flush` makes the controls part of one continuous sheet instead of a card:
 * no side margin, no rounding, a single hairline underneath, and no repeated
 * title — the screen already has one in its header. For screens whose body is
 * edge to edge, where a floating card on top of it reads as two designs.
 */
export default function MobileReportShell({ title, children, user, hideDateRange, flush = false, onRefresh }) {
  // Pull down at the top to reload. Opt-in: a screen with nothing to refresh
  // passes no handler and keeps ordinary scrolling.
  const { ref: pullRef, pull, refreshing, armed } = usePullToRefresh(onRefresh)

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
      <div className={flush
        ? 'bg-surface border-b border-border px-4 py-3 space-y-2'
        : 'mx-4 mt-3 mb-2 bg-surface/95 backdrop-blur-sm rounded-2xl border border-border p-4 space-y-2'}>
        {!flush && <h2 className="text-lg font-bold text-text-primary">{title}</h2>}

      {/* Location selector */}
      <div>
        <LocationMultiSelect
          value={locationSlug}
          onChange={setLocationSlug}
          options={availableLocations.filter(l => l.slug !== 'all')}
        />
      </div>

      {/* Quick range pills */}
      {!hideDateRange && (
        <div className="overflow-x-auto scrollbar-hide">
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
        <div className="flex gap-2">
          <input
            type="date"
            value={customStart || startDate}
            onChange={e => handleCustomDate('start', e.target.value)}
            className="flex-1 bg-bg border border-border rounded-xl px-3 py-2 text-xs text-text-primary"
          />
          <input
            type="date"
            value={customEnd || endDate}
            onChange={e => handleCustomDate('end', e.target.value)}
            className="flex-1 bg-bg border border-border rounded-xl px-3 py-2 text-xs text-text-primary"
          />
        </div>
      )}
      </div>

      {/* Report content.
          overscroll-contain is not decoration: without it, a pull at the top
          hands the gesture to the browser, and on an installed PWA that
          reloads the whole app and drops the reader back where they started.

          The indicator sits BEHIND the content and the content slides down off
          it, so nothing is pushed around on a screen that is not pulling. */}
      <div ref={pullRef} className="flex-1 overflow-y-auto relative" style={{ overscrollBehaviorY: 'contain' }}>
        {onRefresh && (
          <div
            className="absolute inset-x-0 top-0 flex items-start justify-center pointer-events-none z-10"
            style={{ height: pull, opacity: pull > 6 ? 1 : 0 }}
            aria-hidden={!refreshing}
          >
            <div className="pt-2">
              {refreshing ? (
                <WcsLoadingMark size={22} />
              ) : (
                <svg
                  viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"
                  className={`w-5 h-5 transition-transform ${
                    armed ? 'rotate-180 text-wcs-red' : 'text-text-muted'
                  }`}
                >
                  <path strokeLinecap="round" strokeLinejoin="round" d="M19 14l-7 7m0 0l-7-7m7 7V3" />
                </svg>
              )}
            </div>
          </div>
        )}
        <div
          style={{
            transform: pull ? `translateY(${pull}px)` : undefined,
            // Only while settling. Following the finger has to be immediate,
            // or the content lags behind the drag.
            transition: refreshing || pull === 0 ? 'transform 180ms ease-out' : undefined,
          }}
        >
          {children({ startDate, endDate, locationSlug })}
        </div>
      </div>
    </div>
  )
}
