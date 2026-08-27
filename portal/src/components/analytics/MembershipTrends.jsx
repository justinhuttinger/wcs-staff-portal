import { useEffect, useMemo, useState } from 'react'
import { createPortal } from 'react-dom'
import { api } from '../../lib/api'
import { useCancellableFetch } from '../../hooks/useCancellableFetch'
import DesktopLoading from '../DesktopLoading'
import { TOOLBAR_SLOT_ID } from './toolbarSlot'
import { useChartWidth } from './useChartWidth'
import { colorFor, fmtInt, fmtSignedPct, fmtMonth } from './chartPalette'

// ---------------------------------------------------------------------------
// Membership Trends — Analytics (admin only)
//
// Two charts over the same months: total members on top, new members below.
//
// They are stacked, share an x-axis and are deliberately NOT combined. Total
// members runs to five figures and new members to three; on one axis the new
// member line would be a flat smear along the bottom. Two panels with their own
// scales is the honest form — never a second y-axis.
// ---------------------------------------------------------------------------

const LINE_H = 190
const PAD_L = 52
const PAD_R = 12
const PAD_B = 22

function niceBounds(values) {
  const present = values.filter(v => v !== null && v !== undefined && Number.isFinite(v))
  if (!present.length) return { min: 0, max: 1 }
  const max = Math.max(...present)
  // Anchored at zero: a count chart that starts at 4,000 turns a 2% wobble into
  // a cliff. These are absolute quantities, so zero is the honest floor.
  const min = 0
  if (max === min) return { min, max: max + 1 }
  return { min, max }
}

function axisTicks(min, max, count = 4) {
  const out = []
  for (let i = 0; i <= count; i++) out.push(min + ((max - min) * i) / count)
  return out
}

function Chart({ title, months, series, valueKey, hovered, onHover }) {
  const [wrapRef, W] = useChartWidth()
  const plotW = (W || 0) - PAD_L - PAD_R
  const plotH = LINE_H - PAD_B

  const all = series.flatMap(s => s.points.map(p => p[valueKey]))
  const { min, max } = niceBounds(all)
  const span = max - min || 1

  const x = (i) => (months.length <= 1 ? plotW / 2 : (i / (months.length - 1)) * plotW)
  const y = (v) => plotH - ((v - min) / span) * plotH

  return (
    <div className="bg-surface rounded-xl border border-border p-3">
      <p className="text-xs font-bold text-text-primary mb-1">{title}</p>
      <div ref={wrapRef}>
        {W ? (
          <svg
            viewBox={`0 0 ${W} ${LINE_H}`}
            width={W}
            height={LINE_H}
            className="block"
            role="img"
            aria-label={`${title} by segment across ${months.length} months`}
            onMouseLeave={() => onHover(null)}
            onMouseMove={e => {
              const rect = e.currentTarget.getBoundingClientRect()
              const rel = (e.clientX - rect.left - PAD_L) / (plotW || 1)
              onHover(Math.max(0, Math.min(months.length - 1, Math.round(rel * (months.length - 1)))))
            }}
          >
            {axisTicks(min, max).map((t, i) => (
              <g key={i}>
                <line
                  x1={PAD_L} x2={PAD_L + plotW} y1={y(t)} y2={y(t)}
                  stroke="var(--color-border)" strokeWidth="1" vectorEffect="non-scaling-stroke"
                />
                <text x={PAD_L - 6} y={y(t) + 3} textAnchor="end" className="fill-text-muted" style={{ fontSize: 9 }}>
                  {Math.round(t).toLocaleString()}
                </text>
              </g>
            ))}

            {hovered !== null && months[hovered] !== undefined && (
              <line
                x1={PAD_L + x(hovered)} x2={PAD_L + x(hovered)} y1={0} y2={plotH}
                stroke="var(--color-text-muted)" strokeWidth="1" strokeDasharray="3 3"
                vectorEffect="non-scaling-stroke"
              />
            )}

            {series.map((s, si) => (
              <polyline
                key={s.key}
                points={s.points.map((p, i) => `${PAD_L + x(i)},${y(p[valueKey])}`).join(' ')}
                fill="none"
                stroke={colorFor(s.key, si)}
                strokeWidth="2"
                strokeLinejoin="round"
                strokeLinecap="round"
                opacity={hovered === null ? 1 : 0.85}
                vectorEffect="non-scaling-stroke"
              />
            ))}

            {/* Marker on the hovered month only — a dot on every point would
                bury the line it belongs to. */}
            {hovered !== null && series.map((s, si) => {
              const p = s.points[hovered]
              if (!p) return null
              return (
                <circle
                  key={s.key}
                  cx={PAD_L + x(hovered)} cy={y(p[valueKey])} r="3.5"
                  fill={colorFor(s.key, si)} stroke="var(--color-surface)" strokeWidth="1.5"
                />
              )
            })}

            {months.map((m, i) => {
              // Thin the labels so they never collide; always keep the last.
              const every = Math.max(1, Math.ceil(months.length / 12))
              if (i % every !== 0 && i !== months.length - 1) return null
              return (
                <text
                  key={m}
                  x={PAD_L + x(i)} y={LINE_H - 6} textAnchor="middle"
                  className="fill-text-muted" style={{ fontSize: 9 }}
                >
                  {fmtMonth(m)}
                </text>
              )
            })}
          </svg>
        ) : <div style={{ height: LINE_H }} />}
      </div>
    </div>
  )
}

function Tile({ tile }) {
  const v = tile.value
  const isPct = tile.format === 'pct'
  const tone = !tile.signed || v === null
    ? 'text-text-primary'
    : v > 0 ? 'text-emerald-600' : v < 0 ? 'text-wcs-red' : 'text-text-muted'
  return (
    <div className="bg-surface rounded-xl border border-border px-3 py-2 text-center">
      <p className={`text-lg font-bold tabular-nums ${tone}`}>
        {isPct ? fmtSignedPct(v) : fmtInt(v)}
      </p>
      <p className="text-[10px] font-medium text-text-muted leading-tight mt-0.5">{tile.label}</p>
    </div>
  )
}

export default function MembershipTrends({ locationSlug }) {
  const [segment, setSegment] = useState('club')
  const [exclusion, setExclusion] = useState('exclude')
  const [hovered, setHovered] = useState(null)

  const query = useMemo(
    () => new URLSearchParams({ clubs: locationSlug || 'all', segment, exclusion }).toString(),
    [locationSlug, segment, exclusion]
  )

  const { data, loading, error } = useCancellableFetch(
    (signal) => api(`/analytics/membership-trends?${query}`, { cache: true, signal }),
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
  const series = data?.series || []
  const active = hovered !== null ? months[hovered] : null

  return (
    <div className="space-y-3">
      <Toolbar
        segment={segment} setSegment={setSegment}
        segments={data?.segments || []}
        exclusion={exclusion} setExclusion={setExclusion}
      />

      <div className="grid grid-cols-2 sm:grid-cols-3 xl:grid-cols-6 gap-2">
        {(data?.tiles || []).map(t => <Tile key={t.key} tile={t} />)}
      </div>

      <Chart
        title={active ? `Total Members — ${fmtMonth(active)}` : 'Total Members'}
        months={months} series={series} valueKey="totalMembers"
        hovered={hovered} onHover={setHovered}
      />
      <Chart
        title={active ? `New Members — ${fmtMonth(active)}` : 'New Members'}
        months={months} series={series} valueKey="newMembers"
        hovered={hovered} onHover={setHovered}
      />

      {/* Legend is always present for two or more series, and doubles as the
          hovered-month readout so identity is never colour alone. */}
      <div className="bg-surface rounded-xl border border-border p-3">
        <div className="flex flex-wrap gap-x-4 gap-y-1.5">
          {series.map((s, i) => {
            const p = hovered !== null ? s.points[hovered] : null
            return (
              <span key={s.key} className="inline-flex items-center gap-1.5 text-[11px]">
                <span className="w-3 h-1.5 rounded-sm flex-shrink-0" style={{ background: colorFor(s.key, i) }} />
                <span className="text-text-primary font-medium">{s.label}</span>
                {p && (
                  <span className="text-text-muted tabular-nums">
                    {fmtInt(p.totalMembers)} / +{fmtInt(p.newMembers)}
                  </span>
                )}
              </span>
            )
          })}
        </div>
        {hovered !== null && (
          <p className="text-[10px] text-text-muted mt-2">Total members / new members in {fmtMonth(active)}.</p>
        )}
      </div>
    </div>
  )
}

function Toolbar({ segment, setSegment, segments, exclusion, setExclusion }) {
  const [slot, setSlot] = useState(null)
  useEffect(() => { setSlot(document.getElementById(TOOLBAR_SLOT_ID)) }, [])
  if (!slot) return null
  const cls = 'px-2.5 py-1.5 rounded-lg text-xs bg-bg border border-border text-text-primary normal-case tracking-normal font-medium'
  const wrap = 'flex items-center gap-1.5 text-[11px] font-semibold text-text-muted uppercase tracking-wide'
  return createPortal(
    <div className="flex items-center gap-3 flex-wrap">
      <label className={wrap}>
        Segment
        <select value={segment} onChange={e => setSegment(e.target.value)} className={cls}>
          {segments.map(s => <option key={s.key} value={s.key}>{s.label}</option>)}
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
