import { useEffect, useMemo, useState } from 'react'
import { createPortal } from 'react-dom'
import { api } from '../../lib/api'
import { useCancellableFetch } from '../../hooks/useCancellableFetch'
import DesktopLoading from '../DesktopLoading'
import { TOOLBAR_SLOT_ID } from './toolbarSlot'
import { useChartWidth } from './useChartWidth'

// ---------------------------------------------------------------------------
// Revenue Per Member — Analytics (admin only)
//
// Top: total members and total revenue over time, as TWO stacked charts on a
// shared x-axis rather than one chart with two y-axes. A dual-axis plot lets
// whoever scales the axes decide how correlated the two lines look — slide one
// scale and a divergence becomes a match. Stacking them keeps every comparison
// the reader makes an honest one, at the cost of one extra row of height.
//
// Bottom: average revenue per member, one line per segment.
// ---------------------------------------------------------------------------

const PALETTE = ['#2a78d6', '#eb6834', '#1baf7a', '#eda100', '#4a3aa7', '#e34948']
const INK = 'var(--color-text-primary)'
const MUTED = 'var(--color-text-muted)'

const H_TOP = 110
const H_BOTTOM = 190
const PAD_L = 56
const PAD_R = 12
const PAD_B = 22

const fmtMoney = (n) => (n === null || n === undefined ? 'N/A' : `$${Math.round(n).toLocaleString()}`)
const fmtMoney2 = (n) => (n === null || n === undefined ? 'N/A' : `$${Number(n).toFixed(2)}`)
const fmtInt = (n) => (n === null || n === undefined ? 'N/A' : Math.round(n).toLocaleString())
const fmtPct = (n) => (n === null || n === undefined ? 'N/A' : `${n > 0 ? '+' : ''}${n.toFixed(1)}%`)

function fmtMonth(ym, short = false) {
  if (!ym) return ''
  const [y, m] = ym.split('-')
  const name = ['', 'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'][Number(m)]
  return short ? `${name} ${y.slice(2)}` : `${name} ${y}`
}

function compact(n) {
  if (n === null || n === undefined) return ''
  if (Math.abs(n) >= 1e6) return `$${(n / 1e6).toFixed(1)}M`
  if (Math.abs(n) >= 1e3) return `$${Math.round(n / 1e3)}K`
  return `$${Math.round(n)}`
}

/**
 * One measure over the shared month axis.
 *
 * The viewBox is sized to the measured element width so the drawing scales 1:1.
 * With a fixed viewBox the browser centres the drawing and pads the sides, and
 * the pointer no longer lines up with what is under it — see useChartWidth.
 */
function LineChart({ months, series, height, yFormat, colors, hovered, onHover, yTicks = 3 }) {
  const [wrapRef, W] = useChartWidth()

  const values = series.flatMap(s => s.points.map(p => p.value)).filter(v => v !== null && v !== undefined)
  const max = values.length ? Math.max(...values) : 1
  const min = 0                       // rates and totals are read against zero
  const span = (max - min) || 1
  const plotW = (W || 0) - PAD_L - PAD_R
  const plotH = height - PAD_B

  const x = (i) => PAD_L + (months.length <= 1 ? plotW / 2 : (i / (months.length - 1)) * plotW)
  const y = (v) => plotH - ((v - min) / span) * (plotH - 8)

  const pathFor = (points) => {
    const segs = []
    let cur = []
    points.forEach((p, i) => {
      if (p.value === null || p.value === undefined) {
        if (cur.length) segs.push(cur)
        cur = []
      } else cur.push(`${x(i)},${y(p.value)}`)
    })
    if (cur.length) segs.push(cur)
    return segs.filter(s => s.length > 1).map(s => `M${s.join(' L')}`).join(' ')
  }

  const ticks = Array.from({ length: yTicks + 1 }, (_, i) => min + (span * i) / yTicks)

  // Nothing to draw until the width is known; guessing would paint once at the
  // wrong scale and visibly jump.
  if (!W || plotW <= 0) return <div ref={wrapRef} style={{ height }} />

  return (
    <div ref={wrapRef}>
    <svg
      viewBox={`0 0 ${W} ${height}`}
      width={W}
      height={height}
      className="block"
      onMouseMove={e => {
        const r = e.currentTarget.getBoundingClientRect()
        // Scale is 1, so the offset within the element IS the viewBox x.
        const i = Math.round((((e.clientX - r.left) - PAD_L) / plotW) * (months.length - 1))
        onHover(Math.max(0, Math.min(months.length - 1, i)))
      }}
      onMouseLeave={() => onHover(null)}
    >
      {ticks.map((t, i) => (
        <g key={i}>
          <line x1={PAD_L} x2={W - PAD_R} y1={y(t)} y2={y(t)} stroke="var(--color-border)" strokeWidth="1" vectorEffect="non-scaling-stroke" />
          <text x={PAD_L - 6} y={y(t) + 3} textAnchor="end" fontSize="9" fill={MUTED}>{yFormat(t)}</text>
        </g>
      ))}

      {series.map((s, si) => (
        <path
          key={s.name}
          d={pathFor(s.points)}
          fill="none"
          stroke={colors ? colors[si] : INK}
          strokeWidth="2"
          strokeLinejoin="round"
          strokeLinecap="round"
          vectorEffect="non-scaling-stroke"
          opacity={hovered === null ? 1 : 0.9}
        />
      ))}

      {hovered !== null && (
        <line x1={x(hovered)} x2={x(hovered)} y1="0" y2={plotH} stroke={MUTED} strokeWidth="1" strokeDasharray="3 3" vectorEffect="non-scaling-stroke" />
      )}
      {hovered !== null && series.map((s, si) => {
        const p = s.points[hovered]
        if (!p || p.value === null) return null
        return <circle key={s.name} cx={x(hovered)} cy={y(p.value)} r="3.5" fill={colors ? colors[si] : INK} stroke="var(--color-surface)" strokeWidth="2" vectorEffect="non-scaling-stroke" />
      })}

      {months.map((m, i) => {
        // Roughly six labels, whatever the window length.
        const step = Math.max(1, Math.round(months.length / 6))
        if (i % step !== 0 && i !== months.length - 1) return null
        return <text key={m} x={x(i)} y={height - 6} textAnchor="middle" fontSize="9" fill={MUTED}>{fmtMonth(m, true)}</text>
      })}
    </svg>
    </div>
  )
}

export default function RevenuePerMember({ locationSlug }) {
  const [breakdown, setBreakdown] = useState('membership_type')
  const [exclusion, setExclusion] = useState('exclude')
  const [hovered, setHovered] = useState(null)

  const query = useMemo(
    () => new URLSearchParams({ clubs: locationSlug || 'all', breakdown, exclusion }).toString(),
    [locationSlug, breakdown, exclusion]
  )

  const { data, loading, error } = useCancellableFetch(
    (signal) => api(`/analytics/revenue-per-member?${query}`, { cache: true, signal }),
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

  const months = data?.months || []
  const totals = data?.totals || []
  const k = data?.kpis || {}
  const activeMonth = hovered !== null ? months[hovered] : null
  const activeTotals = hovered !== null ? totals[hovered] : null

  const revenueSeries = [{ name: 'Total Revenue', points: totals.map(t => ({ month: t.month, value: t.revenue })) }]
  const memberSeries = [{ name: 'Total Members', points: totals.map(t => ({ month: t.month, value: t.members })) }]

  return (
    <div className="space-y-4">
      <Toolbar
        breakdown={breakdown} setBreakdown={setBreakdown}
        exclusion={exclusion} setExclusion={setExclusion}
        breakdowns={data?.breakdowns || []}
      />

      <div className="bg-surface rounded-xl border border-border overflow-x-auto">
        <div className="flex min-w-max divide-x divide-border">
          {[
            { label: 'Avg Monthly Revenue Per Member, Current Quarter', value: fmtMoney2(k.currentQuarter) },
            { label: '% Change From Current Quarter Prior Year', value: fmtPct(k.vsPriorYearQuarter) },
            { label: '% Change From Prior Quarter', value: fmtPct(k.vsPriorQuarter) },
            { label: 'Avg Monthly Revenue Per Member, Last 12 Months', value: fmtMoney2(k.last12Months) },
            { label: '% Change From Last 12 Months Prior Year', value: fmtPct(k.vsPriorYear12Months) },
          ].map(t => (
            <div key={t.label} className="px-5 py-4 text-center min-w-[150px] flex-1">
              <p className="text-xl font-bold text-text-primary tabular-nums">{t.value}</p>
              <p className="text-[11px] text-text-muted mt-0.5 leading-tight">{t.label}</p>
            </div>
          ))}
        </div>
      </div>

      {/* Members and revenue: two charts, one axis each, sharing the months. */}
      <div className="bg-surface rounded-xl border border-border p-4">
        <div className="flex items-baseline justify-between gap-3 mb-1">
          <p className="text-sm font-bold text-text-primary">Members &amp; Revenue</p>
          <p className="text-[11px] text-text-muted">
            {activeTotals
              ? `${fmtMonth(activeMonth)} — ${fmtInt(activeTotals.members)} members, ${fmtMoney(activeTotals.revenue)}`
              : `${fmtMonth(months[0])} – ${fmtMonth(months[months.length - 1])}`}
          </p>
        </div>
        <p className="text-[10px] font-semibold text-text-muted uppercase tracking-wide mt-2">Total Revenue</p>
        <LineChart months={months} series={revenueSeries} height={H_TOP} yFormat={compact} colors={[PALETTE[0]]} hovered={hovered} onHover={setHovered} />
        <p className="text-[10px] font-semibold text-text-muted uppercase tracking-wide mt-1">Total Members</p>
        <LineChart months={months} series={memberSeries} height={H_TOP} yFormat={(v) => fmtInt(v)} colors={[MUTED]} hovered={hovered} onHover={setHovered} />
        <p className="text-[10px] text-text-muted mt-1">
          Two charts rather than two y-axes: a shared plot with independent scales can be made to show any
          degree of correlation you like.
        </p>
      </div>

      {/* Revenue per member by segment */}
      <div className="bg-surface rounded-xl border border-border p-4">
        <div className="flex items-baseline justify-between gap-3 mb-2">
          <p className="text-sm font-bold text-text-primary">Avg Revenue Per Member</p>
          {activeMonth && <p className="text-[11px] text-text-muted">{fmtMonth(activeMonth)}</p>}
        </div>
        <LineChart
          months={months}
          series={data?.series || []}
          height={H_BOTTOM}
          yFormat={(v) => `$${Math.round(v)}`}
          colors={PALETTE}
          hovered={hovered}
          onHover={setHovered}
        />
        <div className="flex flex-wrap gap-x-5 gap-y-1.5 mt-2 pt-2 border-t border-border">
          {(data?.series || []).map((s, i) => {
            const p = hovered !== null ? s.points[hovered] : null
            return (
              <span key={s.name} className="flex items-center gap-1.5 text-[11px] text-text-muted">
                <svg width="16" height="8" aria-hidden="true"><line x1="0" y1="4" x2="16" y2="4" stroke={PALETTE[i % PALETTE.length]} strokeWidth="2" /></svg>
                {s.name}
                {p && p.value !== null && <span className="text-text-primary font-semibold tabular-nums">{fmtMoney2(p.value)}</span>}
              </span>
            )
          })}
        </div>
      </div>

      <div className="text-xs text-text-muted px-1 space-y-1">
        {data?.foldedSegments > 0 && (
          <p>Showing the {data.series?.length} largest segments; {data.foldedSegments} smaller ones are not charted.</p>
        )}
        {Object.values(data?.meta?.caveats || {}).map(c => <p key={c}>{c}</p>)}
        <p>Through {fmtMonth(data?.anchor)} — the last complete month, since a month still running pairs a full month of members with a partial month of revenue.</p>
      </div>
    </div>
  )
}

function Toolbar({ breakdown, setBreakdown, exclusion, setExclusion, breakdowns }) {
  const [slot, setSlot] = useState(null)
  useEffect(() => { setSlot(document.getElementById(TOOLBAR_SLOT_ID)) }, [])
  if (!slot) return null
  const cls = 'px-2.5 py-1.5 rounded-lg text-xs bg-bg border border-border text-text-primary normal-case tracking-normal font-medium'
  const wrap = 'flex items-center gap-1.5 text-[11px] font-semibold text-text-muted uppercase tracking-wide'
  return createPortal(
    <div className="flex items-center gap-3 flex-wrap">
      <label className={wrap}>
        Breakdown
        <select value={breakdown} onChange={e => setBreakdown(e.target.value)} className={cls}>
          {(breakdowns.length ? breakdowns : [{ key: 'membership_type', label: 'Membership Type' }])
            .map(b => <option key={b.key} value={b.key}>{b.label}</option>)}
        </select>
      </label>
      <label className={wrap}>
        Member Count
        <select value={exclusion} onChange={e => setExclusion(e.target.value)} className={cls}>
          <option value="exclude">Exclude</option>
          <option value="include">Include</option>
        </select>
      </label>
    </div>,
    slot
  )
}
