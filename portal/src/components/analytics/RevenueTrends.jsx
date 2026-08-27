import { useEffect, useMemo, useState } from 'react'
import { createPortal } from 'react-dom'
import { api } from '../../lib/api'
import { useCancellableFetch } from '../../hooks/useCancellableFetch'
import DesktopLoading from '../DesktopLoading'
import { TOOLBAR_SLOT_ID } from './toolbarSlot'
import { useChartWidth } from './useChartWidth'
import { colorFor, fmtMoney, fmtMonth, fmtDay, fmtYear } from './chartPalette'

// ---------------------------------------------------------------------------
// Revenue Trends — Analytics (admin only)
//
// The same revenue at three grains, stacked: annual, monthly, daily.
//
// THREE PANELS, THREE SCALES, ONE SEGMENT. A year of revenue and a day of it
// share no useful axis — on one chart the daily line is a flat smear along the
// bottom. Splitting into panels is the honest answer; a second y-axis is not.
//
// The segment ranking is computed once server-side across all three grains, so
// a series is the same colour and the same member of "Other" in every panel.
// ---------------------------------------------------------------------------

const PANEL_H = 150
const PAD_L = 56
const PAD_R = 10
const PAD_B = 20

function labelFor(grain, bucket) {
  if (grain === 'annual') return fmtYear(bucket)
  if (grain === 'monthly') return fmtMonth(bucket)
  return fmtDay(bucket)
}

function Panel({ panel, segments, hoveredSeries }) {
  const [wrapRef, W] = useChartWidth()
  const [hover, setHover] = useState(null)
  const plotW = (W || 0) - PAD_L - PAD_R
  const plotH = PANEL_H - PAD_B

  const max = panel.max || 1
  // Anchored at zero unless revenue actually went negative (a refund-heavy day).
  const min = Math.min(0, panel.min || 0)
  const span = (max - min) || 1

  const n = panel.buckets.length
  const x = (i) => (n <= 1 ? plotW / 2 : (i / (n - 1)) * plotW)
  const y = (v) => plotH - ((v - min) / span) * plotH

  // Annual has very few buckets, so bars read better than a line through three
  // points; monthly and daily are dense enough for lines.
  const asBars = panel.key === 'annual'
  const barW = n ? Math.min(48, (plotW / n) * 0.55) : 0

  const active = hover !== null ? panel.buckets[hover] : null

  return (
    <div className="bg-surface rounded-xl border border-border p-3">
      <div className="flex items-baseline justify-between mb-1">
        <p className="text-xs font-bold text-text-primary">{panel.label}</p>
        <p className="text-[11px] text-text-muted tabular-nums">
          {active
            ? `${labelFor(panel.key, active)} · ${fmtMoney(panel.totals[hover]?.revenue, { compact: true })}`
            : `${n} ${panel.key === 'daily' ? 'days' : panel.key === 'monthly' ? 'months' : 'years'}`}
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
            aria-label={`${panel.label} revenue across ${n} buckets`}
            onMouseLeave={() => setHover(null)}
            onMouseMove={e => {
              const rect = e.currentTarget.getBoundingClientRect()
              const rel = (e.clientX - rect.left - PAD_L) / (plotW || 1)
              setHover(Math.max(0, Math.min(n - 1, Math.round(rel * (n - 1)))))
            }}
          >
            {[0, 0.5, 1].map(f => {
              const v = min + span * f
              return (
                <g key={f}>
                  <line x1={PAD_L} x2={PAD_L + plotW} y1={y(v)} y2={y(v)}
                        stroke="var(--color-border)" strokeWidth="1" vectorEffect="non-scaling-stroke" />
                  <text x={PAD_L - 6} y={y(v) + 3} textAnchor="end" className="fill-text-muted" style={{ fontSize: 9 }}>
                    {fmtMoney(v, { compact: true })}
                  </text>
                </g>
              )
            })}

            {hover !== null && !asBars && (
              <line x1={PAD_L + x(hover)} x2={PAD_L + x(hover)} y1={0} y2={plotH}
                    stroke="var(--color-text-muted)" strokeWidth="1" strokeDasharray="3 3"
                    vectorEffect="non-scaling-stroke" />
            )}

            {panel.series.map((s, si) => {
              const dim = hoveredSeries && hoveredSeries !== s.key
              const color = colorFor(s.key, si)
              if (asBars) {
                // Stacked bars: the segments of a year sit on each other so the
                // bar height stays total revenue.
                return s.points.map((p, i) => {
                  const below = panel.series.slice(0, si)
                    .reduce((sum, o) => sum + (o.points[i]?.revenue || 0), 0)
                  const h = Math.abs(y(0) - y(p.revenue)) || 0
                  return (
                    <rect
                      key={`${s.key}-${p.bucket}`}
                      x={PAD_L + x(i) - barW / 2}
                      y={y(below + p.revenue)}
                      width={barW}
                      height={Math.max(0, h)}
                      fill={color}
                      opacity={dim ? 0.25 : 1}
                      // 2px of surface between stacked segments.
                      style={{ boxShadow: 'inset 0 -2px 0 0 var(--color-surface)' }}
                    />
                  )
                })
              }
              return (
                <polyline
                  key={s.key}
                  points={s.points.map((p, i) => `${PAD_L + x(i)},${y(p.revenue)}`).join(' ')}
                  fill="none"
                  stroke={color}
                  strokeWidth="2"
                  strokeLinejoin="round"
                  strokeLinecap="round"
                  opacity={dim ? 0.2 : 1}
                  vectorEffect="non-scaling-stroke"
                />
              )
            })}

            {panel.buckets.map((b, i) => {
              const every = Math.max(1, Math.ceil(n / (panel.key === 'daily' ? 8 : 12)))
              if (i % every !== 0 && i !== n - 1) return null
              return (
                <text key={b} x={PAD_L + x(i)} y={PANEL_H - 5} textAnchor="middle"
                      className="fill-text-muted" style={{ fontSize: 9 }}>
                  {labelFor(panel.key, b)}
                </text>
              )
            })}
          </svg>
        ) : <div style={{ height: PANEL_H }} />}
      </div>
    </div>
  )
}

export default function RevenueTrends({ startDate, endDate, locationSlug }) {
  const [segment, setSegment] = useState('overall')
  const [hoveredSeries, setHoveredSeries] = useState(null)

  const query = useMemo(() => new URLSearchParams({
    start: startDate, end: endDate, clubs: locationSlug || 'all', segment,
  }).toString(), [startDate, endDate, locationSlug, segment])

  const { data, loading, error } = useCancellableFetch(
    (signal) => api(`/analytics/revenue-trends?${query}`, { cache: true, signal }),
    [query]
  )

  if (loading) return <DesktopLoading />
  if (error) {
    return (
      <div className="bg-surface rounded-xl border border-border p-8 text-center">
        <p className="text-sm text-wcs-red font-semibold">Could not load the report</p>
        <p className="text-xs text-text-muted mt-1">{String(error.message || error)}</p>
      </div>
    )
  }

  const panels = data?.panels || []
  const segs = data?.segments || []
  const defs = Object.values(data?.meta?.definitions || {}).filter(Boolean)

  return (
    <div className="space-y-3">
      <Toolbar segment={segment} setSegment={setSegment} segments={data?.segments || []} allSegments={segs} />

      {/* A single series needs no legend — the segment control names it. Two or
          more always get one. */}
      {segs.length > 1 && (
        <div className="bg-surface rounded-xl border border-border p-3 flex flex-wrap gap-x-4 gap-y-1.5">
          {segs.map((s, i) => (
            <button
              key={s.key}
              type="button"
              onMouseEnter={() => setHoveredSeries(s.key)}
              onMouseLeave={() => setHoveredSeries(null)}
              onFocus={() => setHoveredSeries(s.key)}
              onBlur={() => setHoveredSeries(null)}
              className="inline-flex items-center gap-1.5 text-[11px]"
            >
              <span className="w-3 h-1.5 rounded-sm flex-shrink-0" style={{ background: colorFor(s.key, i) }} />
              <span className="text-text-primary font-medium">{s.label}</span>
            </button>
          ))}
        </div>
      )}

      {panels.length === 0 ? (
        <div className="bg-surface rounded-xl border border-border p-8 text-center">
          <p className="text-sm text-text-muted">No revenue in this range.</p>
        </div>
      ) : panels.map(p => (
        <Panel key={p.key} panel={p} segments={segs} hoveredSeries={hoveredSeries} />
      ))}

      {defs.length > 0 && (
        <div className="text-xs text-text-muted px-1 space-y-1">
          {defs.map(d => <p key={d}>{d}</p>)}
        </div>
      )}
    </div>
  )
}

function Toolbar({ segment, setSegment, segments }) {
  const [slot, setSlot] = useState(null)
  useEffect(() => { setSlot(document.getElementById(TOOLBAR_SLOT_ID)) }, [])
  if (!slot) return null
  const cls = 'px-2.5 py-1.5 rounded-lg text-xs bg-bg border border-border text-text-primary normal-case tracking-normal font-medium'
  const wrap = 'flex items-center gap-1.5 text-[11px] font-semibold text-text-muted uppercase tracking-wide'
  return createPortal(
    <label className={wrap}>
      Segment
      <select value={segment} onChange={e => setSegment(e.target.value)} className={cls}>
        {segments.map(s => <option key={s.key} value={s.key}>{s.label}</option>)}
      </select>
    </label>,
    slot
  )
}
