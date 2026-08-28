import { useMemo, useState } from 'react'
import { api } from '../../lib/api'
import { useCancellableFetch } from '../../hooks/useCancellableFetch'
import { useChartWidth } from './useChartWidth'
import DesktopLoading from '../DesktopLoading'
import { colorFor, fmtInt, fmtPct, fmtMoney, fmtMonth } from './chartPalette'

// ---------------------------------------------------------------------------
// Attrition Trends — Analytics (admin only)
//
// Two charts on the same metric: the whole selection pooled on top, split by a
// chosen segment underneath. Ten metrics, from attrition rate through to the
// average annual revenue each departing member was worth.
//
// The dashed line on each series is a least-squares fit. It is straight rather
// than smoothed on purpose: a curve through noisy monthly data invites reading
// a wiggle as a turning point.
// ---------------------------------------------------------------------------

const PANEL_H = 200
const PAD_L = 52
const PAD_R = 12
const PAD_T = 14
const PAD_B = 22

function fmtValue(v, format) {
  if (v === null || v === undefined) return 'N/A'
  if (format === 'pct') return fmtPct(v)
  if (format === 'money') return fmtMoney(v)
  return fmtInt(v)
}

// Short axis labels: $12.4k rather than $12,431, which would not fit.
function fmtAxis(v, format) {
  if (format === 'pct') return `${Math.round(v * 10) / 10}%`
  if (format === 'money') {
    if (Math.abs(v) >= 1000) return `$${Math.round(v / 100) / 10}k`
    return `$${Math.round(v)}`
  }
  return fmtInt(Math.round(v))
}

/**
 * One chart. `series` is a list of { key, label, points, trend }.
 *
 * Every series shares one y-scale — that is the whole point of drawing them
 * together. The scale starts at zero for counts and money so a bar's length
 * means what it looks like; percentages also start at zero, because an
 * attrition axis that started at 2% would turn a flat year into a cliff.
 */
function TrendChart({ title, series, months, format, showTrend, labelPoints }) {
  const [wrapRef, W] = useChartWidth()
  const [hover, setHover] = useState(null)

  const plotW = Math.max(0, (W || 0) - PAD_L - PAD_R)
  const plotH = PANEL_H - PAD_T - PAD_B
  const n = months.length

  const values = series.flatMap(s => s.points.map(p => p.value)).filter(v => Number.isFinite(v))
  const trendVals = showTrend
    ? series.flatMap(s => (s.trend ? [s.trend.from, s.trend.to] : []))
    : []
  const rawMax = Math.max(0, ...values, ...trendVals)
  const max = rawMax > 0 ? rawMax * 1.12 : 1

  const x = i => (n <= 1 ? plotW / 2 : (i / (n - 1)) * plotW)
  const y = v => plotH - (Math.max(0, Math.min(v, max)) / max) * plotH

  // Four gridlines, and the axis labels that go with them.
  const ticks = [0, 0.25, 0.5, 0.75, 1].map(f => f * max)

  const active = hover !== null ? months[hover] : null

  return (
    <div className="bg-surface rounded-xl border border-border p-3">
      <div className="flex items-baseline justify-between gap-3 mb-1">
        <p className="text-xs font-bold text-text-primary">{title}</p>
        <p className="text-[11px] text-text-muted tabular-nums truncate max-w-[60%] text-right">
          {active
            ? `${fmtMonth(active)} · ${series
                .map(s => `${s.label} ${fmtValue(s.points[hover]?.value, format)}`)
                .join('  ')}`
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
            <g transform={`translate(${PAD_L},${PAD_T})`}>
              {ticks.map((t, i) => (
                <g key={i}>
                  <line x1={0} x2={plotW} y1={y(t)} y2={y(t)} stroke="currentColor" className="text-border" strokeWidth="1" />
                  <text x={-8} y={y(t) + 3} textAnchor="end" className="fill-text-muted" style={{ fontSize: 9 }}>
                    {fmtAxis(t, format)}
                  </text>
                </g>
              ))}

              {active !== null && (
                <line x1={x(hover)} x2={x(hover)} y1={0} y2={plotH} stroke="currentColor"
                  className="text-text-muted" strokeWidth="1" strokeDasharray="2 2" />
              )}

              {series.map((s, si) => {
                const colour = colorFor(si)
                // Only the runs of consecutive real points are drawn. Joining
                // across a gap would invent a month that was never measured.
                const runs = []
                let run = []
                s.points.forEach((p, i) => {
                  if (Number.isFinite(p.value)) run.push({ i, v: p.value })
                  else if (run.length) { runs.push(run); run = [] }
                })
                if (run.length) runs.push(run)

                return (
                  <g key={s.key}>
                    {showTrend && s.trend && (
                      <line
                        x1={x(0)} y1={y(s.trend.from)}
                        x2={x(n - 1)} y2={y(s.trend.to)}
                        stroke={colour} strokeWidth="1.5" strokeDasharray="4 3" opacity="0.65"
                      />
                    )}
                    {runs.map((r, ri) =>
                      r.length === 1 ? (
                        <circle key={ri} cx={x(r[0].i)} cy={y(r[0].v)} r="3" fill={colour} />
                      ) : (
                        <polyline
                          key={ri}
                          points={r.map(p => `${x(p.i)},${y(p.v)}`).join(' ')}
                          fill="none" stroke={colour} strokeWidth="2"
                          strokeLinejoin="round" strokeLinecap="round"
                        />
                      )
                    )}
                    {labelPoints && s.points.map((p, i) =>
                      Number.isFinite(p.value) ? (
                        <text key={i} x={x(i)} y={y(p.value) - 6} textAnchor="middle"
                          className="fill-text-muted" style={{ fontSize: 9 }}>
                          {fmtAxis(p.value, format)}
                        </text>
                      ) : null
                    )}
                  </g>
                )
              })}
            </g>

            {months.map((m, i) =>
              // Thin the x labels so they never collide, however long the range.
              i % Math.ceil(n / 12) === 0 ? (
                <text key={m} x={PAD_L + x(i)} y={PANEL_H - 6} textAnchor="middle"
                  className="fill-text-muted" style={{ fontSize: 9 }}>
                  {fmtMonth(m)}
                </text>
              ) : null
            )}
          </svg>
        ) : (
          <div style={{ height: PANEL_H }} />
        )}
      </div>

      {series.length > 1 && (
        <div className="flex flex-wrap gap-x-3 gap-y-1 mt-2">
          {series.map((s, si) => (
            <span key={s.key} className="inline-flex items-center gap-1.5 text-[11px] text-text-muted">
              <span className="w-2.5 h-2.5 rounded-sm flex-shrink-0" style={{ background: colorFor(si) }} />
              {s.label}
            </span>
          ))}
        </div>
      )}
    </div>
  )
}

function Select({ label, value, onChange, options }) {
  return (
    <label className="flex flex-col gap-1 min-w-[170px]">
      <span className="text-[11px] font-semibold text-text-muted uppercase tracking-wide">{label}</span>
      <select
        value={value}
        onChange={e => onChange(e.target.value)}
        className="bg-bg border border-border rounded-lg px-2 py-1.5 text-sm text-text-primary"
      >
        {options.map(o => <option key={o.key} value={o.key}>{o.label}</option>)}
      </select>
    </label>
  )
}

export default function AttritionTrends({ locationSlug }) {
  const [metric, setMetric] = useState('attrition_pct')
  const [segment, setSegment] = useState('club')
  const [months, setMonths] = useState(13)
  const [showTrend, setShowTrend] = useState(true)
  const [exclude, setExclude] = useState(true)

  const query = useMemo(() => {
    const p = new URLSearchParams({
      clubs: locationSlug || 'all',
      metric, segment,
      months: String(months),
      exclude: String(exclude),
    })
    return p.toString()
  }, [locationSlug, metric, segment, months, exclude])

  const { data, loading, error } = useCancellableFetch(
    signal => api(`/analytics/attrition-trends?${query}`, { cache: true, signal }),
    [query]
  )

  const metrics = data?.metrics || []
  const segments = data?.segments || []

  return (
    <div className="space-y-3">
      <div className="bg-surface rounded-xl border border-border p-3 flex flex-wrap gap-3 items-end">
        <Select label="Metric" value={metric} onChange={setMetric}
          options={metrics.map(m => ({ key: m.key, label: m.label }))} />
        <Select label="Split By" value={segment} onChange={setSegment}
          options={segments.map(s => ({ key: s.key, label: s.label }))} />
        <Select label="Months" value={String(months)} onChange={v => setMonths(Number(v))}
          options={[
            { key: '13', label: 'Last 13 Months' },
            { key: '25', label: 'Last 25 Months' },
            { key: '37', label: 'Last 37 Months' },
          ]} />
        <Select label="Member Count Exclusion" value={String(exclude)} onChange={v => setExclude(v === 'true')}
          options={[{ key: 'true', label: 'Exclude' }, { key: 'false', label: 'Include' }]} />
        <label className="flex items-center gap-2 text-xs text-text-primary pb-1.5">
          <input type="checkbox" checked={showTrend} onChange={e => setShowTrend(e.target.checked)} />
          Trend lines
        </label>
      </div>

      {loading && <DesktopLoading />}

      {!loading && error && (
        <div className="bg-surface rounded-xl border border-border p-8 text-center">
          <p className="text-sm text-wcs-red font-semibold">Could not load the report</p>
          <p className="text-xs text-text-muted mt-1">{String(error.message || error)}</p>
        </div>
      )}

      {!loading && !error && data && (
        <>
          {/* Overall is POOLED from the raw counts, never averaged from the
              segments below — averaging rates would weight a 40-member segment
              the same as a 4,000-member one. */}
          <TrendChart
            title={`Overall · ${data.metricLabel}`}
            series={[data.overall]}
            months={data.months}
            format={data.format}
            showTrend={showTrend}
            labelPoints
          />

          {segment !== 'overall' && (
            <TrendChart
              title={`By ${segments.find(s => s.key === segment)?.label || segment} · ${data.metricLabel}`}
              series={data.series}
              months={data.months}
              format={data.format}
              showTrend={showTrend}
            />
          )}
        </>
      )}
    </div>
  )
}
