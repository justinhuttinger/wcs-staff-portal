import { useState } from 'react'
import { useChartWidth } from './useChartWidth'
import { colorFor, fmtInt, fmtMonth } from './chartPalette'

// ---------------------------------------------------------------------------
// Shared chart primitives for the Analytics reports.
//
// Extracted because the rebuilt reports (Check-ins, Compliance, Audits, POS
// Sales, Till, Revenue) all want the same three shapes, and six hand-rolled
// copies would drift apart — the colorFor(name, index) bug already shipped
// twice from copies of one chart.
//
// Conventions that hold in every chart here, and are not options:
//
//   ONE Y-SCALE, ZERO-BASED. Never a second axis. A compliance axis starting at
//   50% turns a good month into a cliff, and a dual axis lets any two series be
//   made to look correlated.
//
//   COLOUR IS PASSED IN OR DERIVED FROM A NAME, never from a rank. Sorting a
//   list must not repaint it. colorFor takes (name, index) — BOTH; passing one
//   argument returns undefined and SVG then draws nothing at all.
//
//   TEXT WEARS TEXT TOKENS. Values and labels stay in primary/muted ink; the
//   mark beside them carries the identity.
// ---------------------------------------------------------------------------

const PANEL_H = 190
const PAD_L = 46
const PAD_R = 12
const PAD_T = 12
const PAD_B = 22

export const fmtPctValue = v => (v === null || v === undefined ? 'N/A' : `${v}%`)

function formatValue(v, format) {
  if (v === null || v === undefined || !Number.isFinite(v)) return 'N/A'
  return format === 'pct' ? `${v}%` : fmtInt(v)
}

function formatAxis(v, format) {
  if (format === 'pct') return `${Math.round(v)}%`
  return v >= 1000 ? `${Math.round(v / 1000)}k` : String(Math.round(v))
}

/**
 * A single measure across months.
 *
 * `months` is [{ month, ...}]; `valueKey` picks the measure. Gaps are not
 * joined across — a month with no value breaks the line rather than inventing
 * a reading that was never taken.
 */
export function MonthlyTrend({ title, months, valueKey, format = 'int', subtitle, seriesName = 'series' }) {
  const [wrapRef, W] = useChartWidth()
  const [hover, setHover] = useState(null)

  const plotW = Math.max(0, (W || 0) - PAD_L - PAD_R)
  const plotH = PANEL_H - PAD_T - PAD_B
  const n = months.length

  const values = months.map(m => m[valueKey]).filter(v => Number.isFinite(v))
  const rawMax = Math.max(0, ...values)
  const max = rawMax > 0 ? rawMax * 1.12 : 1

  const x = i => (n <= 1 ? plotW / 2 : (i / (n - 1)) * plotW)
  const y = v => plotH - (Math.max(0, Math.min(v, max)) / max) * plotH
  const ticks = [0, 0.25, 0.5, 0.75, 1].map(f => f * max)

  const active = hover !== null ? months[hover] : null
  const colour = colorFor(seriesName, 0)

  // Only runs of consecutive real points are drawn.
  const runs = []
  let run = []
  months.forEach((m, i) => {
    if (Number.isFinite(m[valueKey])) run.push({ i, v: m[valueKey] })
    else if (run.length) { runs.push(run); run = [] }
  })
  if (run.length) runs.push(run)

  return (
    <div className="bg-surface rounded-xl border border-border p-3">
      <div className="flex items-baseline justify-between gap-3 mb-1">
        <p className="text-xs font-bold text-text-primary">{title}</p>
        <p className="text-[11px] text-text-muted tabular-nums truncate max-w-[60%] text-right">
          {active
            ? `${fmtMonth(active.month)} · ${formatValue(active[valueKey], format)}`
            : (subtitle || `${n} months`)}
        </p>
      </div>

      <div ref={wrapRef}>
        {W ? (
          <svg
            viewBox={`0 0 ${W} ${PANEL_H}`} width={W} height={PANEL_H} className="block"
            role="img" aria-label={`${title} across ${n} months`}
            onMouseLeave={() => setHover(null)}
            onMouseMove={e => {
              const rect = e.currentTarget.getBoundingClientRect()
              const rel = (e.clientX - rect.left - PAD_L) / (plotW || 1)
              setHover(Math.max(0, Math.min(n - 1, Math.round(rel * (n - 1)))))
            }}
          >
            <g transform={`translate(${PAD_L},${PAD_T})`}>
              {ticks.map((t, i) => (
                <g key={i}>
                  <line x1={0} x2={plotW} y1={y(t)} y2={y(t)} stroke="currentColor"
                    className="text-border" strokeWidth="1" />
                  <text x={-8} y={y(t) + 3} textAnchor="end" className="fill-text-muted"
                    style={{ fontSize: 9 }}>{formatAxis(t, format)}</text>
                </g>
              ))}

              {active && (
                <line x1={x(hover)} x2={x(hover)} y1={0} y2={plotH} stroke="currentColor"
                  className="text-text-muted" strokeWidth="1" strokeDasharray="2 2" />
              )}

              {runs.map((r, ri) =>
                r.length === 1 ? (
                  <circle key={ri} cx={x(r[0].i)} cy={y(r[0].v)} r="3" fill={colour} />
                ) : (
                  <polyline key={ri} points={r.map(p => `${x(p.i)},${y(p.v)}`).join(' ')}
                    fill="none" stroke={colour} strokeWidth="2"
                    strokeLinejoin="round" strokeLinecap="round" />
                )
              )}
              {months.map((m, i) =>
                Number.isFinite(m[valueKey]) ? (
                  <circle key={m.month} cx={x(i)} cy={y(m[valueKey])} r={hover === i ? 4 : 2.5} fill={colour} />
                ) : null
              )}
            </g>

            {months.map((m, i) =>
              i % Math.ceil(n / 12) === 0 ? (
                <text key={m.month} x={PAD_L + x(i)} y={PANEL_H - 6} textAnchor="middle"
                  className="fill-text-muted" style={{ fontSize: 9 }}>{fmtMonth(m.month)}</text>
              ) : null
            )}
          </svg>
        ) : (
          <div style={{ height: PANEL_H }} />
        )}
      </div>
    </div>
  )
}

/** Vertical columns for a distribution read left to right (hour, weekday). */
export function ShareColumns({ title, rows, labelFor, valueKey = 'share', format = 'pct', subtitle, seriesName = 'series' }) {
  const [wrapRef, W] = useChartWidth()
  const [hover, setHover] = useState(null)

  const plotW = Math.max(0, (W || 0) - PAD_L - PAD_R)
  const plotH = PANEL_H - PAD_T - PAD_B
  const n = rows.length
  const max = Math.max(0.001, ...rows.map(r => r[valueKey] || 0)) * 1.12

  const bw = n ? Math.max(2, (plotW / n) - 3) : 0
  const x = i => (n ? (i / n) * plotW : 0)
  const y = v => plotH - ((v || 0) / max) * plotH
  const ticks = [0, 0.5, 1].map(f => f * max)

  const active = hover !== null ? rows[hover] : null
  const colour = colorFor(seriesName, 0)

  return (
    <div className="bg-surface rounded-xl border border-border p-3">
      <div className="flex items-baseline justify-between gap-3 mb-1">
        <p className="text-xs font-bold text-text-primary">{title}</p>
        <p className="text-[11px] text-text-muted tabular-nums truncate max-w-[60%] text-right">
          {active ? `${labelFor(active)} · ${formatValue(active[valueKey], format)}` : subtitle}
        </p>
      </div>

      <div ref={wrapRef}>
        {W ? (
          <svg viewBox={`0 0 ${W} ${PANEL_H}`} width={W} height={PANEL_H} className="block"
            role="img" aria-label={title} onMouseLeave={() => setHover(null)}>
            <g transform={`translate(${PAD_L},${PAD_T})`}>
              {ticks.map((t, i) => (
                <g key={i}>
                  <line x1={0} x2={plotW} y1={y(t)} y2={y(t)} stroke="currentColor"
                    className="text-border" strokeWidth="1" />
                  <text x={-8} y={y(t) + 3} textAnchor="end" className="fill-text-muted"
                    style={{ fontSize: 9 }}>{formatAxis(t, format)}</text>
                </g>
              ))}
              {rows.map((r, i) => (
                <rect key={i} x={x(i)} y={y(r[valueKey])} width={bw}
                  height={Math.max(0, plotH - y(r[valueKey]))} rx="2" fill={colour}
                  opacity={hover === null || hover === i ? 1 : 0.4}
                  onMouseEnter={() => setHover(i)}>
                  <title>{`${labelFor(r)}: ${formatValue(r[valueKey], format)}`}</title>
                </rect>
              ))}
            </g>
            {rows.map((r, i) =>
              i % Math.ceil(Math.max(n, 1) / 12) === 0 ? (
                <text key={i} x={PAD_L + x(i) + bw / 2} y={PANEL_H - 6} textAnchor="middle"
                  className="fill-text-muted" style={{ fontSize: 9 }}>{labelFor(r)}</text>
              ) : null
            )}
          </svg>
        ) : (
          <div style={{ height: PANEL_H }} />
        )}
      </div>
    </div>
  )
}

/**
 * Ranked horizontal bars.
 *
 * `secondary` renders a second figure to the right of each bar so a rate and
 * its volume can be read together. Ranking on one number alone routinely buries
 * the interesting row.
 */
export function RankedBars({ title, rows, labelKey, valueKey, format = 'int', secondary, emptyText = 'Nothing in this selection.' }) {
  const max = Math.max(1, ...rows.map(r => Math.abs(r[valueKey] || 0)))
  return (
    <div className="bg-surface rounded-xl border border-border p-3">
      <p className="text-xs font-bold text-text-primary mb-2">{title}</p>
      <div className="space-y-1.5">
        {rows.map((r, i) => {
          const label = String(r[labelKey] ?? '')
          const v = r[valueKey]
          return (
            <div key={`${label}-${i}`} className="flex items-center gap-3">
              <span className="text-xs text-text-primary w-40 text-right flex-shrink-0 truncate" title={label}>
                {label}
              </span>
              <div className="flex-1 min-w-[100px] h-6 rounded-sm bg-bg overflow-hidden">
                <div className="h-full rounded-sm flex items-center justify-end pr-1.5"
                  style={{
                    width: `${(Math.abs(v || 0) / max) * 100}%`,
                    background: colorFor(label, i),
                  }}>
                  <span className="text-[10px] font-semibold text-white drop-shadow-[0_1px_1px_rgba(0,0,0,0.45)]">
                    {formatValue(v, format)}
                  </span>
                </div>
              </div>
              {secondary && (
                <span className="text-[11px] text-text-muted tabular-nums w-40 text-right flex-shrink-0 truncate">
                  {secondary(r)}
                </span>
              )}
            </div>
          )
        })}
        {rows.length === 0 && (
          <p className="text-sm text-text-muted text-center py-8">{emptyText}</p>
        )}
      </div>
    </div>
  )
}
