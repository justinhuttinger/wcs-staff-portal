import { useEffect, useMemo, useState } from 'react'
import { createPortal } from 'react-dom'
import { api } from '../../lib/api'
import { useCancellableFetch } from '../../hooks/useCancellableFetch'
import DesktopLoading from '../DesktopLoading'
import { TOOLBAR_SLOT_ID } from './toolbarSlot'
import { useChartWidth } from './useChartWidth'

// ---------------------------------------------------------------------------
// Club Activity Trends — Analytics (admin only)
//
// Ten small multiples. Each tile is ONE measure over the last 13 months, drawn
// against the same months a year earlier.
//
// Colour choices, deliberately dull: every tile uses the same hue. Colour here
// would encode nothing — the tiles are separate charts, never compared to each
// other, and the title already says which measure it is — so varying the hue
// per tile would be decoration masquerading as meaning. The prior-year line is
// a neutral grey dash: it is a reference, not a rival series, and the dash
// pattern (not the colour) is what distinguishes it, which keeps the pair
// readable for colour-blind viewers and in print.
//
// Percent-change bars sit above and below a zero baseline. They are NOT
// coloured green/red: "up" is good for New Members and bad for Lost Members,
// so a good/bad palette would be actively misleading on half the tiles.
// Position carries the polarity; the reader supplies the judgement.
// ---------------------------------------------------------------------------

const SERIES = '#2a78d6'
const PRIOR = 'var(--color-text-muted)'

const LINE_H = 88
const BAR_H = 64

function fmtValue(value, format, { compact = false } = {}) {
  if (value === null || value === undefined) return 'N/A'
  const n = Number(value)
  switch (format) {
    case 'money':
      if (!compact) return `$${Math.round(n).toLocaleString()}`
      if (Math.abs(n) >= 1e6) return `$${(n / 1e6).toFixed(1)}M`
      if (Math.abs(n) >= 1e3) return `$${Math.round(n / 1e3)}K`
      return `$${Math.round(n)}`
    case 'money2':
      return `$${n.toFixed(2)}`
    case 'ratio':
      return n.toFixed(1)
    default:
      if (compact && Math.abs(n) >= 1000) return `${(n / 1000).toFixed(n >= 10000 ? 0 : 1)}K`
      return Math.round(n).toLocaleString()
  }
}

function fmtPct(pct) {
  if (pct === null || pct === undefined) return 'N/A'
  return `${pct > 0 ? '+' : ''}${pct.toFixed(1)}%`
}

function fmtMonth(ym) {
  if (!ym) return ''
  const [y, m] = ym.split('-')
  return `${['', 'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'][Number(m)]} ${y}`
}

// Nice-ish axis bounds that always include zero, so the eye reads height as
// magnitude rather than as distance from an arbitrary floor.
function bounds(values) {
  const present = values.filter(v => v !== null && v !== undefined)
  if (present.length === 0) return { min: 0, max: 1 }
  const max = Math.max(...present, 0)
  const min = Math.min(...present, 0)
  if (max === min) return { min: min - 1, max: max + 1 }
  return { min, max }
}

function TrendTile({ tile, hovered, onHover }) {
  // Measured rather than fixed: a fixed viewBox is centred and padded by the
  // browser, which puts the crosshair somewhere other than the cursor. See
  // useChartWidth.
  const [wrapRef, CHART_W] = useChartWidth()
  const points = tile.series
  const all = [...points.map(p => p.value), ...points.map(p => p.priorValue)]
  const { min, max } = bounds(all)
  const span = max - min || 1

  const x = (i) => (points.length <= 1 ? CHART_W / 2 : (i / (points.length - 1)) * CHART_W)
  const y = (v) => LINE_H - ((v - min) / span) * LINE_H

  // A run of consecutive non-null points. Split rather than bridged, so a gap
  // in collection reads as a gap instead of a straight line implying data.
  const pathFor = (key) => {
    const segments = []
    let current = []
    points.forEach((p, i) => {
      const v = p[key]
      if (v === null || v === undefined) {
        if (current.length) segments.push(current)
        current = []
      } else {
        current.push(`${x(i)},${y(v)}`)
      }
    })
    if (current.length) segments.push(current)
    return segments.filter(s => s.length > 1).map(s => `M${s.join(' L')}`).join(' ')
  }

  const changes = points.map(p => p.changePct)
  const changeMax = Math.max(1, ...changes.filter(c => c !== null).map(Math.abs))
  const barW = Math.max(4, CHART_W / points.length - 3)

  const active = hovered !== null && hovered >= 0 && hovered < points.length ? points[hovered] : null
  const headlineValue = active ? active.value : tile.ytd
  const headlinePct = active ? active.changePct : tile.yoyPct
  const displayValue = tile.negate && headlineValue !== null ? -Math.abs(headlineValue) : headlineValue

  return (
    <div
      className="bg-surface rounded-xl border border-border p-3 flex flex-col"
      onMouseLeave={() => onHover(null)}
    >
      <p className="text-xs font-bold text-text-primary text-center border-b border-border pb-2 mb-2">{tile.label}</p>

      <div className="flex items-baseline justify-between gap-2 mb-1 min-h-[26px]">
        <span className="text-base font-bold text-text-primary tabular-nums">
          {tile.signed && displayValue > 0 ? '+' : ''}{fmtValue(displayValue, tile.format)}
          <span className="text-[10px] font-medium text-text-muted ml-1">
            {active ? fmtMonth(active.month) : 'YTD'}
          </span>
        </span>
        <span className={`text-xs font-semibold tabular-nums ${headlinePct === null ? 'text-text-muted' : 'text-text-primary'}`}>
          {fmtPct(headlinePct)}
        </span>
      </div>

      {/* Measured here rather than on the card above: the card is padded, and
          sizing the chart to the card's border box drew it wider than the box
          it sits in. */}
      <div ref={wrapRef}>

      {/* Line: this year solid, last year dashed */}
      <svg
        viewBox={`0 0 ${CHART_W || 1} ${LINE_H}`}
        width={CHART_W || 0}
        height={LINE_H}
        className="block"
        role="img"
        aria-label={`${tile.label}, ${points.length} months against the same months a year earlier`}
        onMouseMove={e => {
          const rect = e.currentTarget.getBoundingClientRect()
          const rel = (e.clientX - rect.left) / (CHART_W || 1)
          onHover(Math.max(0, Math.min(points.length - 1, Math.round(rel * (points.length - 1)))))
        }}
      >
        {/* Zero line, recessive — only when the series actually crosses it. */}
        {min < 0 && max > 0 && (
          <line x1="0" x2={CHART_W} y1={y(0)} y2={y(0)} stroke="var(--color-border)" strokeWidth="1" vectorEffect="non-scaling-stroke" />
        )}
        <path d={pathFor('priorValue')} fill="none" stroke={PRIOR} strokeWidth="1.5" strokeDasharray="4 3" opacity="0.75" vectorEffect="non-scaling-stroke" />
        <path d={pathFor('value')} fill="none" stroke={SERIES} strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" vectorEffect="non-scaling-stroke" />
        {active && active.value !== null && (
          <>
            <line x1={x(hovered)} x2={x(hovered)} y1="0" y2={LINE_H} stroke="var(--color-border)" strokeWidth="1" vectorEffect="non-scaling-stroke" />
            {/* 2px surface ring so the marker stays legible over the line. */}
            <circle cx={x(hovered)} cy={y(active.value)} r="4" fill={SERIES} stroke="var(--color-surface)" strokeWidth="2" vectorEffect="non-scaling-stroke" />
          </>
        )}
      </svg>

      {/* Percent change vs the same month last year */}
      <svg
        viewBox={`0 0 ${CHART_W || 1} ${BAR_H}`}
        width={CHART_W || 0}
        height={BAR_H}
        className="block mt-1"
        role="img"
        aria-label={`${tile.label}, percent change against the same month a year earlier`}
        onMouseMove={e => {
          const rect = e.currentTarget.getBoundingClientRect()
          const rel = (e.clientX - rect.left) / (CHART_W || 1)
          onHover(Math.max(0, Math.min(points.length - 1, Math.floor(rel * points.length))))
        }}
      >
        <line x1="0" x2={CHART_W} y1={BAR_H / 2} y2={BAR_H / 2} stroke="var(--color-border)" strokeWidth="1" vectorEffect="non-scaling-stroke" />
        {points.map((p, i) => {
          if (p.changePct === null) return null
          const h = (Math.abs(p.changePct) / changeMax) * (BAR_H / 2 - 2)
          const up = p.changePct >= 0
          return (
            <rect
              key={p.month}
              x={x(i) - barW / 2}
              y={up ? BAR_H / 2 - h : BAR_H / 2}
              width={barW}
              height={Math.max(1, h)}
              rx="2"
              fill={SERIES}
              opacity={hovered === null || hovered === i ? 0.75 : 0.3}
            />
          )
        })}
      </svg>
      </div>

      <p className="text-[10px] text-text-muted text-center mt-1 min-h-[14px]">
        {active
          ? `vs ${fmtMonth(active.month.replace(/^(\d{4})/, (y) => Number(y) - 1))}: ${fmtValue(active.priorValue, tile.format)}`
          : tile.missingPriorYear
            ? 'No prior-year data'
            : `${fmtMonth(points[0]?.month)} – ${fmtMonth(points[points.length - 1]?.month)}`}
      </p>
    </div>
  )
}

export default function ClubActivityTrends({ locationSlug }) {
  const [exclusion, setExclusion] = useState('exclude')
  const [hovered, setHovered] = useState(null)

  const query = useMemo(() => {
    const p = new URLSearchParams({ clubs: locationSlug || 'all', exclusion })
    return p.toString()
  }, [locationSlug, exclusion])

  const { data, loading, error } = useCancellableFetch(
    (signal) => api(`/analytics/club-activity?${query}`, { cache: true, signal }),
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

  const tiles = data?.tiles || []
  // A tile whose year-over-year rests on fewer months than the best-covered
  // tile is comparing a shorter period, which is worth saying out loud. This
  // is driven by comparedMonths rather than by which SHOWN months have
  // check-ins: the shown months are all covered, it is their prior-year
  // partners that predate collection, and that is invisible from the chart.
  const bestCoverage = Math.max(0, ...tiles.map(t => t.comparedMonths || 0))
  const shortTiles = tiles.filter(t => (t.comparedMonths || 0) < bestCoverage)
  // Only shown under Exclude — under Include no conditional rule is applied, so
  // describing one would be describing something that did not happen.
  const conditionalNotes = exclusion === 'exclude'
    ? Object.values(data?.meta?.conditional || {})
    : []

  return (
    <div className="space-y-4">
      <ExclusionToolbar value={exclusion} onChange={setExclusion} />

      {/* One legend for all ten charts — identity is never colour alone. */}
      <div className="flex items-center justify-between gap-4 flex-wrap bg-surface rounded-xl border border-border px-4 py-2.5">
        <p className="text-sm font-bold text-text-primary">
          Club Activity Trends
          {data?.asOfMonth && <span className="font-medium text-text-muted"> — year over year as of {fmtMonth(data.asOfMonth)}</span>}
        </p>
        <div className="flex items-center gap-4 text-[11px] text-text-muted">
          <span className="flex items-center gap-1.5">
            <svg width="22" height="8" aria-hidden="true"><line x1="0" y1="4" x2="22" y2="4" stroke={SERIES} strokeWidth="2" /></svg>
            This year
          </span>
          <span className="flex items-center gap-1.5">
            <svg width="22" height="8" aria-hidden="true"><line x1="0" y1="4" x2="22" y2="4" stroke="currentColor" strokeWidth="1.5" strokeDasharray="4 3" /></svg>
            Same month, prior year
          </span>
          <span>Bars: % change vs prior year</span>
        </div>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-5 gap-3">
        {tiles.map(tile => (
          <TrendTile key={tile.key} tile={tile} hovered={hovered} onHover={setHovered} />
        ))}
      </div>

      {shortTiles.length > 0 && (
        <p className="text-xs text-text-muted px-1">
          {shortTiles.map(t => t.label).join(', ')} compare only{' '}
          {shortTiles[0].comparedMonths} of the {bestCoverage} months the other tiles do — check-in
          collection starts part-way through the prior year, so the earlier months have nothing to
          compare against. Their year-over-year figures cover that shorter period rather than the
          full year to date, and the missing points are left blank instead of drawn as zero.
        </p>
      )}

      {conditionalNotes.length > 0 && (
        <div className="text-xs text-text-muted px-1 space-y-1">
          {conditionalNotes.map(n => <p key={n}>{n}</p>)}
        </div>
      )}
    </div>
  )
}

// Portalled next to the shared date range, matching Salesperson Performance.
function ExclusionToolbar({ value, onChange }) {
  const [slot, setSlot] = useState(null)
  useEffect(() => { setSlot(document.getElementById(TOOLBAR_SLOT_ID)) }, [])
  if (!slot) return null
  return createPortal(
    <label className="flex items-center gap-1.5 text-[11px] font-semibold text-text-muted uppercase tracking-wide">
      Member Count
      <select
        value={value}
        onChange={e => onChange(e.target.value)}
        className="px-2.5 py-1.5 rounded-lg text-xs bg-bg border border-border text-text-primary normal-case tracking-normal font-medium"
      >
        <option value="exclude">Exclude</option>
        <option value="include">Include</option>
      </select>
    </label>,
    slot
  )
}
