import { useState } from 'react'
import { useChartWidth } from './useChartWidth'
import { colorFor, fmtInt, fmtPct, fmtMoney, fmtMonth } from './chartPalette'

// Shared pieces for the Snapshot reports. Both snapshots are the same shape —
// one person, one window, the same window a month earlier, and a trend — so the
// card and the chart live here rather than being written twice and drifting.

export function fmtStat(v, format) {
  if (v === null || v === undefined) return 'N/A'
  switch (format) {
    case 'money': return fmtMoney(v)
    case 'pct': return fmtPct(v)
    case 'num': return Number(v).toLocaleString(undefined, { maximumFractionDigits: 1 })
    default: return fmtInt(v)
  }
}

/**
 * One stat, its prior-period value, and the change.
 *
 * Colour follows `betterWhen`, not the sign: a cancellation rate falling is
 * GOOD and must not be painted red just because the number went down. Where
 * neither direction is better (average session length) the change is left
 * neutral rather than implied to be an achievement.
 *
 * The arrow and the sign both carry direction, so the colour is never the only
 * thing saying which way it went.
 */
export function StatCard({ stat }) {
  const { value, prior, change, betterWhen, label, format } = stat
  const good = change === null || betterWhen === 'flat'
    ? null
    : betterWhen === 'down' ? change < 0 : change > 0

  const tone = good === null ? 'text-text-muted' : good ? 'text-emerald-600' : 'text-wcs-red'

  return (
    <div className="bg-surface rounded-xl border border-border px-3 py-2.5">
      <p className="text-[10px] font-semibold text-text-muted uppercase tracking-wide truncate" title={label}>
        {label}
      </p>
      <p className="text-xl font-bold tabular-nums text-text-primary mt-0.5">{fmtStat(value, format)}</p>
      <p className="text-[11px] tabular-nums mt-0.5">
        <span className={tone}>
          {change === null ? '—' : `${change > 0 ? '+' : ''}${change}%`}
          {change !== null && change !== 0 && (
            <span aria-hidden="true"> {change > 0 ? '▲' : '▼'}</span>
          )}
        </span>
        <span className="text-text-muted"> vs {fmtStat(prior, format)}</span>
      </p>
    </div>
  )
}

const PANEL_H = 150
const PAD_L = 46
const PAD_R = 10
const PAD_B = 20

/**
 * A month-by-month trend for one person.
 *
 * Counts and rates never share a panel: a percentage and a headcount on one
 * axis flattens whichever is smaller. Rate panels are pinned to a 0-100 track
 * so 50% always looks like half — Day One Book % can legitimately exceed 100%
 * when the booker is credited against their own sales, and scaling to that
 * would squash every honest month into a sliver. Over-scale points are clamped
 * and the figure is still printed on hover.
 */
export function TrendPanel({ title, months, series, kind = 'count' }) {
  const [wrapRef, W] = useChartWidth()
  const [hover, setHover] = useState(null)

  const plotW = (W || 0) - PAD_L - PAD_R
  const plotH = PANEL_H - PAD_B
  const n = months.length

  const rawMax = series.reduce(
    (m, s) => Math.max(m, ...s.points.map(p => (typeof p.value === 'number' ? p.value : 0))), 0)
  const max = kind === 'rate' ? 100 : Math.max(1, rawMax)

  const x = (i) => (n <= 1 ? plotW / 2 : (i / (n - 1)) * plotW)
  const y = (v) => plotH - (Math.min(v, max) / max) * plotH

  // A line through one point draws nothing, so a single month is drawn as dots.
  const dotsOnly = n < 2
  const active = hover !== null ? months[hover] : null

  return (
    <div className="bg-surface rounded-xl border border-border p-3">
      <div className="flex items-baseline justify-between mb-1 gap-3">
        <p className="text-xs font-bold text-text-primary">{title}</p>
        <p className="text-[11px] text-text-muted tabular-nums truncate">
          {active
            ? `${fmtMonth(active)} · ${series.map(s => `${s.label} ${fmtStat(s.points[hover]?.value, kind === 'rate' ? 'pct' : 'num')}`).join('  ')}`
            : `${n} months`}
        </p>
      </div>

      <div ref={wrapRef}>
        {W ? (
          <svg
            viewBox={`0 0 ${W} ${PANEL_H}`}
            width={W}
            height={PANEL_H}
            className="block"
            role="img"
            aria-label={`${title} across ${n} months`}
            onMouseLeave={() => setHover(null)}
            onMouseMove={e => {
              const rect = e.currentTarget.getBoundingClientRect()
              const rel = (e.clientX - rect.left - PAD_L) / (plotW || 1)
              setHover(Math.max(0, Math.min(n - 1, Math.round(rel * (n - 1)))))
            }}
          >
            {[0, 0.5, 1].map(f => {
              const v = max * f
              return (
                <g key={f}>
                  <line x1={PAD_L} x2={PAD_L + plotW} y1={y(v)} y2={y(v)}
                        stroke="var(--color-border)" strokeWidth="1" vectorEffect="non-scaling-stroke" />
                  <text x={PAD_L - 6} y={y(v) + 3} textAnchor="end" className="fill-text-muted" style={{ fontSize: 9 }}>
                    {kind === 'rate' ? `${Math.round(v)}%` : Math.round(v).toLocaleString()}
                  </text>
                </g>
              )
            })}

            {hover !== null && (
              <line x1={PAD_L + x(hover)} x2={PAD_L + x(hover)} y1={0} y2={plotH}
                    stroke="var(--color-text-muted)" strokeWidth="1" strokeDasharray="3 3"
                    vectorEffect="non-scaling-stroke" />
            )}

            {series.map((s, si) => {
              const color = colorFor(s.key, si)
              const pts = s.points
                .map((p, i) => (typeof p.value === 'number' ? `${PAD_L + x(i)},${y(p.value)}` : null))
                .filter(Boolean)
              return (
                <g key={s.key}>
                  {!dotsOnly && (
                    <polyline
                      points={pts.join(' ')}
                      fill="none" stroke={color} strokeWidth="2"
                      strokeLinejoin="round" strokeLinecap="round"
                      vectorEffect="non-scaling-stroke"
                    />
                  )}
                  {s.points.map((p, i) => (
                    typeof p.value === 'number' ? (
                      <circle
                        key={p.month}
                        cx={PAD_L + x(i)} cy={y(p.value)} r={hover === i ? 4 : 2.5}
                        fill={color} stroke="var(--color-surface)" strokeWidth="1.5"
                      />
                    ) : null
                  ))}
                </g>
              )
            })}

            {months.map((m, i) => {
              const every = Math.max(1, Math.ceil(n / 12))
              if (i % every !== 0 && i !== n - 1) return null
              return (
                <text key={m} x={PAD_L + x(i)} y={PANEL_H - 5} textAnchor="middle"
                      className="fill-text-muted" style={{ fontSize: 9 }}>
                  {fmtMonth(m)}
                </text>
              )
            })}
          </svg>
        ) : <div style={{ height: PANEL_H }} />}
      </div>

      {series.length > 1 && (
        <div className="flex flex-wrap gap-x-4 gap-y-1 mt-1.5">
          {series.map((s, i) => (
            <span key={s.key} className="inline-flex items-center gap-1.5 text-[11px]">
              <span className="w-3 h-1.5 rounded-sm flex-shrink-0" style={{ background: colorFor(s.key, i) }} />
              <span className="text-text-primary font-medium">{s.label}</span>
            </span>
          ))}
        </div>
      )}
    </div>
  )
}

/** The person picker. One person at a time is the whole point of a snapshot. */
export function PersonPicker({ label, people, value, onChange }) {
  return (
    <label className="flex items-center gap-2 text-[11px] font-semibold text-text-muted uppercase tracking-wide">
      {label}
      <select
        value={value || ''}
        onChange={e => onChange(e.target.value)}
        className="px-2.5 py-1.5 rounded-lg text-xs bg-bg border border-border text-text-primary normal-case tracking-normal font-medium min-w-[200px]"
      >
        {people.length === 0 && <option value="">No one with activity in this range</option>}
        {people.map(p => <option key={p} value={p}>{p}</option>)}
      </select>
    </label>
  )
}
