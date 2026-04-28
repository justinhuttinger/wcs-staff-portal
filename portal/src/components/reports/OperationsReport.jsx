import { useState, useEffect } from 'react'
import { getOperandioLatest } from '../../lib/api'
import { LOCATION_NAMES } from '../../config/locations'

const SEGMENT_COLORS = {
  on_time: '#18CE99',     // green — matches Operandio
  late: '#F26C4F',        // red/orange
  skipped: '#3B82F6',     // blue
  uncompleted: '#DEF1FA', // light gray-blue (the "remaining")
}

function fmtPeriod(period) {
  if (!period) return ''
  const fmt = (s) => {
    const d = new Date(s + 'T00:00:00Z')
    return d.toLocaleDateString('en-US', { month: 'long', day: 'numeric', timeZone: 'UTC' })
  }
  const year = new Date(period.end + 'T00:00:00Z').getUTCFullYear()
  return `${fmt(period.start)} — ${fmt(period.end)}, ${year}`
}

function DeltaChip({ current, previous }) {
  if (previous === null || previous === undefined) return null
  const cur = Number(current || 0)
  const prev = Number(previous || 0)
  if (prev === 0 && cur === 0) return null
  const delta = cur - prev
  if (delta === 0) {
    return <span className="text-[11px] text-text-muted">no change</span>
  }
  const isUp = delta > 0
  const cls = isUp
    ? 'bg-green-50 text-green-700 border-green-200'
    : 'bg-red-50 text-red-700 border-red-200'
  return (
    <span className={`inline-flex items-center gap-1 text-[11px] font-semibold px-2 py-0.5 rounded-full border ${cls}`}>
      <span>{isUp ? '▲' : '▼'}</span>
      <span>{isUp ? '+' : ''}{delta}%</span>
    </span>
  )
}

function StackedBar({ row }) {
  const segs = [
    { key: 'on_time', label: 'On-time', value: row.on_time_pct, color: SEGMENT_COLORS.on_time },
    { key: 'late', label: 'Late', value: row.late_pct, color: SEGMENT_COLORS.late },
    { key: 'skipped', label: 'Skipped', value: row.skipped_pct, color: SEGMENT_COLORS.skipped },
    { key: 'uncompleted', label: 'Uncompleted', value: row.uncompleted_pct, color: SEGMENT_COLORS.uncompleted },
  ]
  return (
    <div className="flex h-3 rounded-full overflow-hidden bg-bg">
      {segs.map(s => s.value > 0 && (
        <div
          key={s.key}
          title={`${s.label} ${s.value}%`}
          style={{ width: `${s.value}%`, backgroundColor: s.color }}
        />
      ))}
    </div>
  )
}

function Legend() {
  return (
    <div className="flex flex-wrap items-center gap-4 text-xs text-text-muted">
      {[
        { label: 'On-time', color: SEGMENT_COLORS.on_time },
        { label: 'Late', color: SEGMENT_COLORS.late },
        { label: 'Skipped', color: SEGMENT_COLORS.skipped },
        { label: 'Uncompleted', color: SEGMENT_COLORS.uncompleted },
      ].map(l => (
        <div key={l.label} className="flex items-center gap-1.5">
          <span className="inline-block w-3 h-3 rounded-sm" style={{ backgroundColor: l.color }} />
          {l.label}
        </div>
      ))}
    </div>
  )
}

function LocationRow({ row, prevRow, displayName }) {
  return (
    <div className="bg-surface border border-border rounded-xl p-5">
      <div className="flex items-center justify-between gap-4 mb-2">
        <p className="text-sm font-semibold text-text-primary">{displayName}</p>
        <div className="flex items-center gap-2">
          <DeltaChip current={row.overall_pct} previous={prevRow?.overall_pct} />
          <span className="text-2xl font-bold text-text-primary">{row.overall_pct}%</span>
        </div>
      </div>
      <StackedBar row={row} />
      <div className="grid grid-cols-4 gap-2 mt-3 text-[11px] text-text-muted">
        <span>On-time {row.on_time_pct}%</span>
        <span>Late {row.late_pct}%</span>
        <span>Skipped {row.skipped_pct}%</span>
        <span>Uncompleted {row.uncompleted_pct}%</span>
      </div>
    </div>
  )
}

export default function OperationsReport({ locationSlug }) {
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  useEffect(() => {
    setLoading(true)
    setError('')
    getOperandioLatest()
      .then(res => { setData(res); setLoading(false) })
      .catch(err => { setError(err.message); setLoading(false) })
  }, [])

  if (loading) return <p className="text-text-muted text-sm py-8 text-center">Loading operations data...</p>
  if (error) return <p className="text-wcs-red text-sm py-4">{error}</p>
  if (!data?.current) {
    return (
      <div className="bg-surface rounded-xl border border-border p-8 text-center">
        <p className="text-sm font-semibold text-text-primary">No reports yet</p>
        <p className="text-xs text-text-muted mt-2">Once Operandio's weekly email is forwarded to the parser, the latest week will show here.</p>
      </div>
    )
  }

  const current = data.current
  const previous = data.previous
  const prevBySlug = {}
  if (previous?.rows) {
    for (const r of previous.rows) prevBySlug[r.location_slug] = r
  }

  const filtered = (locationSlug && locationSlug !== 'all')
    ? current.rows.filter(r => r.location_slug === locationSlug)
    : current.rows

  // Sort by location name (matches LOCATION_NAMES order)
  const orderIdx = {}
  LOCATION_NAMES.forEach((name, i) => { orderIdx[name.toLowerCase()] = i })
  const sorted = [...filtered].sort((a, b) => (orderIdx[a.location_slug] ?? 99) - (orderIdx[b.location_slug] ?? 99))

  const displayName = (slug) => {
    const found = LOCATION_NAMES.find(n => n.toLowerCase() === slug)
    return found || slug
  }

  return (
    <div className="space-y-4">
      <div className="bg-surface/95 backdrop-blur-sm rounded-xl border border-border p-4 flex items-center justify-between gap-4">
        <div>
          <p className="text-xs uppercase tracking-wide text-text-muted">Reporting Period</p>
          <p className="text-sm font-semibold text-text-primary">{fmtPeriod(current.period)}</p>
        </div>
        <Legend />
      </div>

      {sorted.length === 0 ? (
        <p className="text-text-muted text-sm py-4 text-center">No data for this location in the latest report.</p>
      ) : (
        sorted.map(r => (
          <LocationRow
            key={r.location_slug}
            row={r}
            prevRow={prevBySlug[r.location_slug]}
            displayName={displayName(r.location_slug)}
          />
        ))
      )}
    </div>
  )
}
