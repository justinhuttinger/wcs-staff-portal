import React, { useState, useEffect, useMemo, useRef } from 'react'
import { getOperandioRange } from '../../../lib/api'
import { LOCATION_NAMES } from '../../../config/locations'
import MobileLoading from '../MobileLoading'

const SEGMENT_COLORS = {
  on_time: '#18CE99',
  late: '#F26C4F',
  skipped: '#3B82F6',
  uncompleted: '#DEF1FA',
}

function yesterdayISO() {
  const d = new Date()
  d.setDate(d.getDate() - 1)
  return d.toISOString().slice(0, 10)
}

function dateMinus(dateStr, days) {
  const d = new Date(dateStr + 'T00:00:00Z')
  d.setUTCDate(d.getUTCDate() - days)
  return d.toISOString().slice(0, 10)
}

function rangeLengthDays(start, end) {
  const s = new Date(start + 'T00:00:00Z').getTime()
  const e = new Date(end + 'T00:00:00Z').getTime()
  return Math.round((e - s) / 86400000) + 1
}

const QUICK_RANGES = [
  { key: 'yesterday', label: 'Yesterday' },
  { key: 'last_7', label: '7 Days' },
  { key: 'last_30', label: '30 Days' },
  { key: 'last_90', label: '90 Days' },
  { key: 'this_month', label: 'This Month' },
  { key: 'last_month', label: 'Last Month' },
]

function getQuickRange(key) {
  const yesterday = yesterdayISO()
  const today = new Date()
  switch (key) {
    case 'yesterday': return { start: yesterday, end: yesterday }
    case 'last_7': return { start: dateMinus(yesterday, 6), end: yesterday }
    case 'last_30': return { start: dateMinus(yesterday, 29), end: yesterday }
    case 'last_90': return { start: dateMinus(yesterday, 89), end: yesterday }
    case 'this_month': {
      const s = new Date(today.getFullYear(), today.getMonth(), 1).toISOString().slice(0, 10)
      return { start: s, end: yesterday }
    }
    case 'last_month': {
      const s = new Date(today.getFullYear(), today.getMonth() - 1, 1).toISOString().slice(0, 10)
      const e = new Date(today.getFullYear(), today.getMonth(), 0).toISOString().slice(0, 10)
      return { start: s, end: e }
    }
    default: return { start: dateMinus(yesterday, 6), end: yesterday }
  }
}

function fmtDate(s) {
  const d = new Date(s + 'T00:00:00Z')
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' })
}

function DeltaChip({ current, previous }) {
  if (previous === null || previous === undefined || previous === 0) return null
  const cur = Number(current || 0)
  const delta = cur - previous
  if (delta === 0) return <span className="text-[10px] text-text-muted">no change</span>
  const isUp = delta > 0
  const cls = isUp ? 'bg-green-50 text-green-700 border-green-200' : 'bg-red-50 text-red-700 border-red-200'
  return (
    <span className={`inline-flex items-center gap-1 text-[10px] font-semibold px-1.5 py-0.5 rounded-full border ${cls}`}>
      <span>{isUp ? '▲' : '▼'}</span>
      <span>{isUp ? '+' : ''}{delta.toFixed(1)}%</span>
    </span>
  )
}

function StackedBar({ on_time, late, skipped, uncompleted }) {
  const segs = [
    { key: 'on_time', value: on_time, color: SEGMENT_COLORS.on_time },
    { key: 'late', value: late, color: SEGMENT_COLORS.late },
    { key: 'skipped', value: skipped, color: SEGMENT_COLORS.skipped },
    { key: 'uncompleted', value: uncompleted, color: SEGMENT_COLORS.uncompleted },
  ]
  return (
    <div className="flex h-3 rounded-full overflow-hidden bg-bg">
      {segs.map(s => s.value > 0 && (
        <div key={s.key} title={`${s.key} ${s.value.toFixed(0)}%`} style={{ width: `${s.value}%`, backgroundColor: s.color }} />
      ))}
    </div>
  )
}

function Sparkline({ rows, dateRange }) {
  const days = []
  let d = dateRange.start
  while (d <= dateRange.end) {
    days.push(d)
    d = dateMinus(d, -1)
  }
  const byDate = {}
  for (const r of rows) byDate[r.period_start] = r
  if (days.length === 0) return null
  return (
    <div className="flex items-end gap-0.5 h-12 mt-2">
      {days.map(day => {
        const r = byDate[day]
        const h = r ? Math.max(2, r.overall_pct) : 0
        const bg = r
          ? (r.overall_pct >= 70 ? SEGMENT_COLORS.on_time : r.overall_pct >= 40 ? '#FCD34D' : SEGMENT_COLORS.late)
          : '#E5E7EB'
        return (
          <div
            key={day}
            title={r ? `${fmtDate(day)} — ${r.overall_pct}%` : `${fmtDate(day)} — no data`}
            className="flex-1 rounded-t-sm"
            style={{ height: `${h}%`, backgroundColor: bg, minWidth: '3px' }}
          />
        )
      })}
    </div>
  )
}

function Legend() {
  return (
    <div className="flex flex-wrap items-center gap-2 text-[10px] text-text-muted">
      {[
        { label: 'On-time', color: SEGMENT_COLORS.on_time },
        { label: 'Late', color: SEGMENT_COLORS.late },
        { label: 'Skipped', color: SEGMENT_COLORS.skipped },
        { label: 'Uncompleted', color: SEGMENT_COLORS.uncompleted },
      ].map(l => (
        <div key={l.label} className="flex items-center gap-1">
          <span className="inline-block w-2.5 h-2.5 rounded-sm" style={{ backgroundColor: l.color }} />
          {l.label}
        </div>
      ))}
    </div>
  )
}

function aggregateLocation(rows) {
  const daily = rows.filter(r => r.period_start === r.period_end)
  if (daily.length === 0) return null
  const sum = daily.reduce((acc, r) => ({
    overall: acc.overall + r.overall_pct,
    on_time: acc.on_time + r.on_time_pct,
    late: acc.late + r.late_pct,
    skipped: acc.skipped + r.skipped_pct,
    uncompleted: acc.uncompleted + r.uncompleted_pct,
  }), { overall: 0, on_time: 0, late: 0, skipped: 0, uncompleted: 0 })
  return {
    overall_pct: sum.overall / daily.length,
    on_time_pct: sum.on_time / daily.length,
    late_pct: sum.late / daily.length,
    skipped_pct: sum.skipped / daily.length,
    uncompleted_pct: sum.uncompleted / daily.length,
    days: daily.length,
  }
}

function SectionHeader({ title }) {
  return (
    <div className="flex items-center gap-3 pt-2 px-4">
      <div className="bg-surface/95 backdrop-blur-sm rounded-lg border border-border px-3 py-1.5 shadow-sm">
        <h3 className="text-xs font-bold uppercase tracking-[0.12em] text-text-primary">{title}</h3>
      </div>
      <div className="flex-1 h-px bg-border" />
    </div>
  )
}

export default function MobileOperations({ user }) {
  const isCorporatePlus = ['corporate', 'admin', 'director'].includes(user?.staff?.role)

  const userLocs = (user?.staff?.locations || []).filter(l => l.can_view_reports !== false)
  const defaultLocSlug = isCorporatePlus
    ? 'all'
    : (userLocs.find(l => l.is_primary)?.name || userLocs[0]?.name || LOCATION_NAMES[0]).toLowerCase()
  const [locationSlug, setLocationSlug] = useState(defaultLocSlug)

  const initialRange = getQuickRange('last_7')
  const [activeQuick, setActiveQuick] = useState('last_7')
  const [startDate, setStartDate] = useState(initialRange.start)
  const [endDate, setEndDate] = useState(initialRange.end)
  const [data, setData] = useState(null)
  const [prevData, setPrevData] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const reqRef = useRef(0)

  useEffect(() => {
    const id = ++reqRef.current
    setLoading(true)
    setError('')

    const len = rangeLengthDays(startDate, endDate)
    const prevEnd = dateMinus(startDate, 1)
    const prevStart = dateMinus(prevEnd, len - 1)

    Promise.all([
      getOperandioRange({ start_date: startDate, end_date: endDate }),
      getOperandioRange({ start_date: prevStart, end_date: prevEnd }),
    ]).then(([cur, prev]) => {
      if (id !== reqRef.current) return
      setData(cur)
      setPrevData(prev)
      setLoading(false)
    }).catch(err => {
      if (id !== reqRef.current) return
      setError(err.message)
      setLoading(false)
    })
  }, [startDate, endDate])

  function applyQuick(key) {
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

  const grouped = useMemo(() => {
    const out = {}
    for (const r of (data?.rows || [])) {
      if (!out[r.location_slug]) out[r.location_slug] = []
      out[r.location_slug].push(r)
    }
    return out
  }, [data])

  const prevGrouped = useMemo(() => {
    const out = {}
    for (const r of (prevData?.rows || [])) {
      if (!out[r.location_slug]) out[r.location_slug] = []
      out[r.location_slug].push(r)
    }
    return out
  }, [prevData])

  const slugs = useMemo(() => {
    const all = LOCATION_NAMES.map(n => n.toLowerCase())
    if (locationSlug && locationSlug !== 'all') return all.filter(s => s === locationSlug)
    return all
  }, [locationSlug])

  const availableLocations = useMemo(() => {
    if (isCorporatePlus) {
      return [{ slug: 'all', label: 'All' }, ...LOCATION_NAMES.map(n => ({ slug: n.toLowerCase(), label: n }))]
    }
    return userLocs.map(l => ({ slug: l.name.toLowerCase(), label: l.name }))
  }, [isCorporatePlus, userLocs])

  return (
    <div className="space-y-4 pb-6">
      {/* Header */}
      <div className="mx-4 mt-3 bg-surface/95 backdrop-blur-sm rounded-2xl border border-border p-4 space-y-3">
        {availableLocations.length > 1 && (
          <div className="overflow-x-auto scrollbar-hide -mx-1">
            <div className="flex gap-2 min-w-max px-1">
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
        )}

        <div className="overflow-x-auto scrollbar-hide -mx-1">
          <div className="flex gap-2 min-w-max px-1">
            {QUICK_RANGES.map(qr => (
              <button
                key={qr.key}
                onClick={() => applyQuick(qr.key)}
                className={`px-3 py-1.5 rounded-full text-xs font-medium whitespace-nowrap transition-colors ${
                  activeQuick === qr.key
                    ? 'bg-wcs-red text-white'
                    : 'bg-surface border border-border text-text-secondary'
                }`}
              >
                {qr.label}
              </button>
            ))}
          </div>
        </div>

        <div className="flex gap-2">
          <input
            type="date"
            value={startDate}
            max={yesterdayISO()}
            onChange={e => handleDateChange('start', e.target.value)}
            className="flex-1 bg-bg border border-border rounded-xl px-3 py-2 text-xs text-text-primary"
          />
          <input
            type="date"
            value={endDate}
            max={yesterdayISO()}
            onChange={e => handleDateChange('end', e.target.value)}
            className="flex-1 bg-bg border border-border rounded-xl px-3 py-2 text-xs text-text-primary"
          />
        </div>

        <Legend />
      </div>

      {loading && <MobileLoading text="Loading operations data..." />}
      {error && <p className="px-4 text-wcs-red text-sm py-3">{error}</p>}

      {!loading && !error && (
        <>
          <SectionHeader title="Period Summary" />
          <div className="space-y-3 px-4">
            {slugs.map(slug => {
              const rows = grouped[slug] || []
              const prevRows = prevGrouped[slug] || []
              const agg = aggregateLocation(rows)
              const prevAgg = aggregateLocation(prevRows)
              const displayName = LOCATION_NAMES.find(n => n.toLowerCase() === slug) || slug

              if (!agg) {
                return (
                  <div key={slug} className="bg-surface border border-border rounded-2xl p-4">
                    <div className="flex items-center justify-between gap-2">
                      <p className="text-sm font-semibold text-text-primary">{displayName}</p>
                      <span className="text-[11px] text-text-muted">No data in range</span>
                    </div>
                  </div>
                )
              }

              return (
                <div key={slug} className="bg-surface border border-border rounded-2xl p-4">
                  <div className="flex items-center justify-between gap-2 mb-2">
                    <div className="min-w-0">
                      <p className="text-sm font-semibold text-text-primary">{displayName}</p>
                      <p className="text-[11px] text-text-muted">{agg.days} day{agg.days === 1 ? '' : 's'}</p>
                    </div>
                    <div className="flex items-center gap-2">
                      <DeltaChip current={agg.overall_pct} previous={prevAgg?.overall_pct} />
                      <span className="text-2xl font-bold text-text-primary">{agg.overall_pct.toFixed(0)}%</span>
                    </div>
                  </div>
                  <StackedBar
                    on_time={agg.on_time_pct}
                    late={agg.late_pct}
                    skipped={agg.skipped_pct}
                    uncompleted={agg.uncompleted_pct}
                  />
                </div>
              )
            })}
          </div>

          <SectionHeader title="Daily Trend" />
          <div className="px-4 mb-2">
            <div className="bg-surface/95 backdrop-blur-sm rounded-2xl border border-border p-3 flex flex-wrap items-center gap-2 text-[10px] text-text-muted">
              <div className="flex items-center gap-1">
                <span className="inline-block w-2.5 h-2.5 rounded-sm" style={{ backgroundColor: '#18CE99' }} />
                70%+ on track
              </div>
              <div className="flex items-center gap-1">
                <span className="inline-block w-2.5 h-2.5 rounded-sm" style={{ backgroundColor: '#FCD34D' }} />
                40–69% needs attention
              </div>
              <div className="flex items-center gap-1">
                <span className="inline-block w-2.5 h-2.5 rounded-sm" style={{ backgroundColor: '#F26C4F' }} />
                below 40% at risk
              </div>
              <div className="flex items-center gap-1">
                <span className="inline-block w-2.5 h-2.5 rounded-sm" style={{ backgroundColor: '#E5E7EB' }} />
                no data
              </div>
            </div>
          </div>

          <div className="space-y-3 px-4">
            {slugs.map(slug => {
              const rows = grouped[slug] || []
              const displayName = LOCATION_NAMES.find(n => n.toLowerCase() === slug) || slug
              const dailyRows = rows.filter(r => r.period_start === r.period_end)
              if (dailyRows.length === 0) return null
              return (
                <div key={slug} className="bg-surface border border-border rounded-2xl p-4">
                  <p className="text-sm font-semibold text-text-primary mb-2">{displayName}</p>
                  <Sparkline rows={rows} dateRange={{ start: startDate, end: endDate }} />
                </div>
              )
            })}
          </div>
        </>
      )}
    </div>
  )
}
