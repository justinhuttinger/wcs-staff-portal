import { Fragment, useState, useMemo } from 'react'
import { getCheckinsReport } from '../../lib/api'
import { useCancellableFetch } from '../../hooks/useCancellableFetch'
import DesktopLoading from '../DesktopLoading'

const DOW_NAMES = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
const HOURS = Array.from({ length: 24 }, (_, h) => h)

function formatHour(h) {
  if (h === 0) return '12a'
  if (h === 12) return '12p'
  return h < 12 ? `${h}a` : `${h - 12}p`
}

function formatHourLong(h) {
  if (h === 0) return '12:00 AM'
  if (h === 12) return '12:00 PM'
  return h < 12 ? `${h}:00 AM` : `${h - 12}:00 PM`
}

function SectionHeader({ title }) {
  return (
    <div className="flex items-center gap-3 pt-2">
      <div className="bg-surface/95 backdrop-blur-sm rounded-lg border border-border px-3 py-1.5 shadow-sm">
        <h3 className="text-sm font-bold uppercase tracking-[0.12em] text-text-primary">{title}</h3>
      </div>
      <div className="flex-1 h-px bg-border" />
    </div>
  )
}

function KpiCard({ label, value, sub }) {
  return (
    <div className="bg-surface rounded-xl border border-border p-6 text-center">
      <p className="text-xs text-text-muted uppercase tracking-wide">{label}</p>
      <p className="text-4xl font-bold text-text-primary mt-2">{value}</p>
      {sub && <p className="text-[11px] text-text-muted mt-1">{sub}</p>}
    </div>
  )
}

function BarChart({ title, points }) {
  const [hover, setHover] = useState(null)
  const total = points.reduce((s, p) => s + p.count, 0)

  if (points.length === 0 || total === 0) {
    return (
      <div className="bg-surface rounded-xl border border-border p-6 text-center">
        <p className="text-xs font-semibold text-text-muted uppercase tracking-wide mb-4">{title}</p>
        <p className="text-sm text-text-muted py-4">No data</p>
      </div>
    )
  }

  const max = Math.max(...points.map(p => p.count), 1)
  const w = 600, h = 180, padL = 30, padR = 10, padT = 10, padB = 25
  const chartW = w - padL - padR
  const chartH = h - padT - padB
  const barW = chartW / points.length
  const yLabels = [0, Math.round(max / 2), max]
  const hovered = hover !== null ? points[hover] : null

  return (
    <div className="bg-surface rounded-xl border border-border p-6">
      <p className="text-xs font-semibold text-text-muted uppercase tracking-wide mb-3">{title}</p>
      <div className="h-5 mb-1 text-xs text-text-muted">
        {hovered && (
          <span>
            <span className="font-medium text-text-primary">{hovered.date}</span>
            {' — '}
            <span style={{ color: '#e53e3e' }}>{hovered.count.toLocaleString()} check-ins</span>
          </span>
        )}
      </div>
      <svg
        viewBox={`0 0 ${w} ${h}`}
        className="w-full"
        style={{ maxHeight: '200px' }}
        onMouseLeave={() => setHover(null)}
      >
        {yLabels.map(v => {
          const y = padT + chartH - (v / max) * chartH
          return (
            <g key={v}>
              <line x1={padL} x2={w - padR} y1={y} y2={y} stroke="#e2e8f0" strokeWidth="0.5" />
              <text x={padL - 4} y={y + 3} textAnchor="end" className="fill-gray-400" style={{ fontSize: '8px' }}>{v}</text>
            </g>
          )
        })}
        {points.map((p, i) => {
          const x = padL + i * barW
          const bh = (p.count / max) * chartH
          return (
            <g key={i}>
              {p.count > 0 && (
                <rect
                  x={x + 1}
                  y={padT + chartH - bh}
                  width={Math.max(1, barW - 2)}
                  height={bh}
                  fill="#e53e3e"
                  rx="1"
                  opacity={hover === i ? 1 : 0.85}
                />
              )}
              <rect
                x={x}
                y={0}
                width={barW}
                height={h}
                fill="transparent"
                style={{ cursor: 'crosshair' }}
                onMouseEnter={() => setHover(i)}
              />
            </g>
          )
        })}
        <text x={padL} y={h - 5} textAnchor="start" className="fill-gray-400" style={{ fontSize: '8px' }}>{points[0].date}</text>
        <text x={w - padR} y={h - 5} textAnchor="end" className="fill-gray-400" style={{ fontSize: '8px' }}>{points[points.length - 1].date}</text>
      </svg>
    </div>
  )
}

function DowBars({ rows }) {
  const max = Math.max(...rows.map(r => r.total), 1)
  return (
    <div className="bg-surface rounded-xl border border-border p-6">
      <p className="text-xs font-semibold text-text-muted uppercase tracking-wide mb-4">Check-ins by Day of Week</p>
      <div className="space-y-2">
        {rows.map(r => (
          <div key={r.dow} className="flex items-center gap-3 text-sm">
            <span className="w-10 text-text-muted text-xs font-medium">{r.dow}</span>
            <div className="flex-1 h-5 bg-bg rounded overflow-hidden">
              <div
                className="h-full bg-wcs-red transition-all"
                style={{ width: `${(r.total / max) * 100}%` }}
              />
            </div>
            <span className="w-16 text-right font-semibold text-text-primary tabular-nums">
              {r.total.toLocaleString()}
            </span>
          </div>
        ))}
      </div>
    </div>
  )
}

function Heatmap({ grid }) {
  const max = useMemo(() => {
    let m = 0
    for (const row of grid) for (const v of row) if (v > m) m = v
    return m
  }, [grid])

  function cellColor(v) {
    if (max === 0 || v === 0) return '#f3f4f6'
    // 0-1 → light gray to deep WCS red
    const t = v / max
    // Interpolate from #fef2f2 (light) to #b91c1c (deep red) through #e53e3e
    // Use a perceptual-ish ramp via lightness on red hue.
    const lightness = 95 - t * 60 // 95% → 35%
    return `hsl(0, 75%, ${lightness}%)`
  }

  function cellTextColor(v) {
    if (max === 0 || v === 0) return '#9ca3af'
    return v / max > 0.55 ? '#ffffff' : '#1f2937'
  }

  return (
    <div className="bg-surface rounded-xl border border-border p-6 overflow-x-auto">
      <p className="text-xs font-semibold text-text-muted uppercase tracking-wide mb-4">
        Heatmap — Avg Check-ins by Day & Hour
      </p>
      <div className="inline-block min-w-full">
        <div className="grid" style={{ gridTemplateColumns: '40px repeat(24, minmax(28px, 1fr))', gap: '2px' }}>
          <div />
          {HOURS.map(h => (
            <div key={h} className="text-[10px] text-text-muted text-center font-medium">
              {h % 3 === 0 ? formatHour(h) : ''}
            </div>
          ))}
          {grid.map((row, dow) => (
            <Fragment key={dow}>
              <div className="text-xs text-text-muted font-medium pr-2 flex items-center justify-end">
                {DOW_NAMES[dow]}
              </div>
              {row.map((v, h) => (
                <div
                  key={`${dow}-${h}`}
                  className="aspect-square rounded-sm flex items-center justify-center text-[9px] font-semibold tabular-nums"
                  style={{ backgroundColor: cellColor(v), color: cellTextColor(v) }}
                  title={`${DOW_NAMES[dow]} ${formatHourLong(h)} — ${v.toFixed(1)} avg`}
                >
                  {v >= 1 ? Math.round(v) : ''}
                </div>
              ))}
            </Fragment>
          ))}
        </div>
        <div className="flex items-center gap-2 mt-4 text-[11px] text-text-muted">
          <span>Less</span>
          {[0, 0.25, 0.5, 0.75, 1].map((t, i) => (
            <div
              key={i}
              className="w-5 h-3 rounded-sm border border-border"
              style={{ backgroundColor: `hsl(0, 75%, ${95 - t * 60}%)` }}
            />
          ))}
          <span>More</span>
          {max > 0 && <span className="ml-2">(peak ≈ {max.toFixed(1)} check-ins/hr)</span>}
        </div>
      </div>
    </div>
  )
}

function HourRanking({ title, hours, accent }) {
  const max = Math.max(...hours.map(x => x.avg), 1)
  return (
    <div className="bg-surface rounded-xl border border-border p-6">
      <p className="text-xs font-semibold text-text-muted uppercase tracking-wide mb-4">{title}</p>
      {hours.length === 0 ? (
        <p className="text-sm text-text-muted py-4 text-center">No data</p>
      ) : (
        <div className="space-y-2">
          {hours.map(h => (
            <div key={h.hour} className="flex items-center gap-3 text-sm">
              <span className="w-14 text-text-muted text-xs font-medium tabular-nums">{formatHourLong(h.hour)}</span>
              <div className="flex-1 h-5 bg-bg rounded overflow-hidden">
                <div
                  className="h-full transition-all"
                  style={{ width: `${(h.avg / max) * 100}%`, backgroundColor: accent }}
                />
              </div>
              <span className="w-20 text-right font-semibold text-text-primary tabular-nums">
                {h.avg.toFixed(1)}/hr
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

function LocationTable({ rows }) {
  if (!rows || rows.length === 0) return null
  const total = rows.reduce((s, r) => s + r.total, 0)
  return (
    <div className="bg-surface rounded-xl border border-border p-6">
      <p className="text-xs font-semibold text-text-muted uppercase tracking-wide mb-4">Check-ins by Location</p>
      <table className="w-full text-sm">
        <thead>
          <tr className="text-left text-text-muted text-xs uppercase tracking-wide border-b border-border">
            <th className="py-2">Location</th>
            <th className="py-2 text-right">Total</th>
            <th className="py-2 text-right">% of Total</th>
          </tr>
        </thead>
        <tbody>
          {rows.map(r => (
            <tr key={r.slug} className="border-b border-border/50 last:border-0">
              <td className="py-2 capitalize text-text-primary font-medium">{r.slug}</td>
              <td className="py-2 text-right tabular-nums">{r.total.toLocaleString()}</td>
              <td className="py-2 text-right text-text-muted tabular-nums">
                {total ? Math.round((r.total / total) * 100) : 0}%
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

export default function CheckinsReport({ startDate, endDate, locationSlug }) {
  const { data, loading, error } = useCancellableFetch(
    (signal) => {
      const params = {}
      if (startDate) params.start_date = startDate
      if (endDate) params.end_date = endDate
      if (locationSlug && locationSlug !== 'all') params.location_slug = locationSlug
      return getCheckinsReport(params, { cache: true, signal })
    },
    [startDate, endDate, locationSlug]
  )

  if (loading) return <DesktopLoading variant="report" />
  if (error) return <p className="text-wcs-red text-sm py-4">{error.message || String(error)}</p>
  if (!data) return null

  const s = data.summary || {}
  const peakDayLabel = s.peak_day
    ? `${s.peak_day.date} (${s.peak_day.count.toLocaleString()})`
    : '—'
  const peakHourLabel = s.peak_hour
    ? `${formatHourLong(s.peak_hour.hour)} (${s.peak_hour.avg.toFixed(1)}/hr avg)`
    : '—'

  return (
    <div className="space-y-6">
      <SectionHeader title="Summary" />
      <div className="grid grid-cols-2 sm:grid-cols-3 gap-4">
        <KpiCard
          label="Total Check-ins"
          value={(s.total_checkins ?? 0).toLocaleString()}
          sub={`${s.days_with_data ?? 0} days with data`}
        />
        <KpiCard
          label="Member-Hours"
          value={(s.member_hours ?? 0).toLocaleString()}
          sub={s.visits_per_member_hour ? `${s.visits_per_member_hour} visits per member-hour` : ''}
        />
        <KpiCard
          label="Avg Members / Hour"
          value={(s.avg_members_per_active_hour ?? 0).toLocaleString()}
          sub="while gym is active"
        />
        <KpiCard
          label="Avg Check-ins / Day"
          value={(s.avg_per_open_day ?? 0).toLocaleString()}
        />
        <KpiCard
          label="Peak Day"
          value={s.peak_day ? s.peak_day.count.toLocaleString() : '—'}
          sub={s.peak_day ? s.peak_day.date : ''}
        />
        <KpiCard
          label="Peak Hour"
          value={s.peak_hour ? formatHour(s.peak_hour.hour) : '—'}
          sub={s.peak_hour ? `${s.peak_hour.avg.toFixed(1)} avg/hr` : ''}
        />
      </div>

      <SectionHeader title="Trends" />
      <BarChart title="Check-ins by Day" points={data.by_date || []} />

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <DowBars rows={data.by_dow || []} />
        <LocationTable rows={data.by_location} />
      </div>

      <SectionHeader title="Time of Day" />
      <Heatmap grid={data.heatmap || Array.from({ length: 7 }, () => Array(24).fill(0))} />

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <HourRanking title="Most Popular Hours" hours={data.popular_hours || []} accent="#e53e3e" />
        <HourRanking title="Least Popular Hours" hours={data.unpopular_hours || []} accent="#94a3b8" />
      </div>
    </div>
  )
}
