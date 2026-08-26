import { useEffect, useMemo, useState } from 'react'
import { createPortal } from 'react-dom'
import { api } from '../../lib/api'
import { useCancellableFetch } from '../../hooks/useCancellableFetch'
import DesktopLoading from '../DesktopLoading'
import { TOOLBAR_SLOT_ID } from './toolbarSlot'
import { useChartWidth } from './useChartWidth'

// ---------------------------------------------------------------------------
// PT Penetration — Analytics (admin only)
//
// One line per club. Seven clubs is under the eight-slot categorical cap, so
// every club keeps a fixed hue assigned by size — colour follows the club, not
// its rank in the current filter, so narrowing the selection never repaints the
// survivors.
// ---------------------------------------------------------------------------

const PALETTE = ['#2a78d6', '#eb6834', '#1baf7a', '#eda100', '#e87ba4', '#008300', '#4a3aa7', '#e34948']

const H = 300
const PAD_L = 52
const PAD_R = 12
const PAD_B = 26

const fmt = (v, format) => {
  if (v === null || v === undefined) return 'N/A'
  const n = Number(v)
  if (format === 'pct') return `${n.toFixed(2)}%`
  if (format === 'money') return `$${Math.round(n).toLocaleString()}`
  if (format === 'money2') return `$${n.toFixed(2)}`
  return Math.round(n).toLocaleString()
}

function fmtMonth(ym, short = false) {
  if (!ym) return ''
  const [y, m] = ym.split('-')
  const name = ['', 'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'][Number(m)]
  return short ? `${name} ${y.slice(2)}` : `${name} ${y}`
}

function Chart({ months, series, format, hovered, onHover, dimmed }) {
  const [wrapRef, W] = useChartWidth()

  const values = series.flatMap(s => s.points.map(p => p.value)).filter(v => v !== null && v !== undefined)
  const max = values.length ? Math.max(...values) : 1
  const span = max || 1
  const plotW = (W || 0) - PAD_L - PAD_R
  const plotH = H - PAD_B

  const x = (i) => PAD_L + (months.length <= 1 ? plotW / 2 : (i / (months.length - 1)) * plotW)
  const y = (v) => plotH - (v / span) * (plotH - 10)

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

  // Sized to the measured width so the drawing scales 1:1 and the crosshair
  // lands under the cursor — see useChartWidth.
  if (!W || plotW <= 0) return <div ref={wrapRef} style={{ height: H }} />

  const ticks = Array.from({ length: 5 }, (_, i) => (span * i) / 4)

  return (
    <div ref={wrapRef}>
      <svg
        viewBox={`0 0 ${W} ${H}`}
        width={W}
        height={H}
        className="block"
        onMouseMove={e => {
          const r = e.currentTarget.getBoundingClientRect()
          const i = Math.round((((e.clientX - r.left) - PAD_L) / plotW) * (months.length - 1))
          onHover(Math.max(0, Math.min(months.length - 1, i)))
        }}
        onMouseLeave={() => onHover(null)}
      >
        {ticks.map((t, i) => (
          <g key={i}>
            <line x1={PAD_L} x2={W - PAD_R} y1={y(t)} y2={y(t)} stroke="var(--color-border)" strokeWidth="1" vectorEffect="non-scaling-stroke" />
            <text x={PAD_L - 6} y={y(t) + 3} textAnchor="end" fontSize="10" fill="var(--color-text-muted)">{fmt(t, format)}</text>
          </g>
        ))}

        {series.map((s, si) => (
          <path
            key={s.name}
            d={pathFor(s.points)}
            fill="none"
            stroke={PALETTE[si % PALETTE.length]}
            strokeWidth="2"
            strokeLinejoin="round"
            strokeLinecap="round"
            vectorEffect="non-scaling-stroke"
            opacity={dimmed && dimmed !== s.name ? 0.18 : 1}
          />
        ))}

        {hovered !== null && (
          <line x1={x(hovered)} x2={x(hovered)} y1="0" y2={plotH} stroke="var(--color-text-muted)" strokeWidth="1" strokeDasharray="3 3" vectorEffect="non-scaling-stroke" />
        )}
        {hovered !== null && series.map((s, si) => {
          const p = s.points[hovered]
          if (!p || p.value === null) return null
          if (dimmed && dimmed !== s.name) return null
          return <circle key={s.name} cx={x(hovered)} cy={y(p.value)} r="3.5" fill={PALETTE[si % PALETTE.length]} stroke="var(--color-surface)" strokeWidth="2" vectorEffect="non-scaling-stroke" />
        })}

        {months.map((m, i) => {
          const step = Math.max(1, Math.round(months.length / 8))
          if (i % step !== 0 && i !== months.length - 1) return null
          return <text key={m} x={x(i)} y={H - 8} textAnchor="middle" fontSize="10" fill="var(--color-text-muted)">{fmtMonth(m, true)}</text>
        })}
      </svg>
    </div>
  )
}

export default function PtPenetration({ locationSlug }) {
  const [metric, setMetric] = useState('penetration')
  const [windowMonths, setWindowMonths] = useState(3)
  const [hovered, setHovered] = useState(null)
  const [dimmed, setDimmed] = useState(null)

  const query = useMemo(
    () => new URLSearchParams({ clubs: locationSlug || 'all', metric, window: String(windowMonths) }).toString(),
    [locationSlug, metric, windowMonths]
  )

  const { data, loading, error } = useCancellableFetch(
    (signal) => api(`/analytics/pt-penetration?${query}`, { cache: true, signal }),
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

  const s = data?.summary || {}
  const months = data?.months || []
  const series = data?.series || []
  const activeMetric = (data?.metrics || []).find(m => m.key === data?.metric) || { format: 'pct', label: '' }
  const activeMonth = hovered !== null ? months[hovered] : null

  return (
    <div className="space-y-4">
      <Toolbar
        metric={metric} setMetric={setMetric}
        windowMonths={windowMonths} setWindowMonths={setWindowMonths}
        metrics={data?.metrics || []} windows={data?.windows || []}
      />

      <div className="bg-surface rounded-xl border border-border overflow-x-auto">
        <div className="flex min-w-max divide-x divide-border">
          {[
            { label: `PT Member Penetration %, ${fmtMonth(s.month)}`, value: fmt(s.penetration, 'pct') },
            { label: 'PT Members', value: fmt(s.ptMembers, 'int') },
            { label: 'Members', value: fmt(s.members, 'int') },
            { label: 'PT Revenue', value: fmt(s.ptRevenue, 'money') },
            { label: 'PT Revenue Per PT Member', value: fmt(s.revenuePerPtMember, 'money2') },
            { label: '% Change vs Prior Year', value: s.hasPriorYear ? fmt(s.vsPriorYear, 'pct') : 'N/A' },
          ].map(t => (
            <div key={t.label} className="px-5 py-4 text-center min-w-[140px] flex-1">
              <p className="text-xl font-bold text-text-primary tabular-nums">{t.value}</p>
              <p className="text-[11px] text-text-muted mt-0.5 leading-tight">{t.label}</p>
            </div>
          ))}
        </div>
      </div>

      <div className="bg-surface rounded-xl border border-border p-4">
        <div className="flex items-baseline justify-between gap-3 mb-2">
          <p className="text-sm font-bold text-text-primary">{activeMetric.label} by Club</p>
          <p className="text-[11px] text-text-muted">
            {activeMonth ? fmtMonth(activeMonth) : `${fmtMonth(months[0])} – ${fmtMonth(months[months.length - 1])}`}
          </p>
        </div>

        <Chart months={months} series={series} format={activeMetric.format} hovered={hovered} onHover={setHovered} dimmed={dimmed} />

        <div className="flex flex-wrap gap-x-5 gap-y-1.5 mt-2 pt-2 border-t border-border">
          {series.map((sr, i) => {
            const p = hovered !== null ? sr.points[hovered] : null
            return (
              <button
                key={sr.name}
                type="button"
                onMouseEnter={() => setDimmed(sr.name)}
                onMouseLeave={() => setDimmed(null)}
                className="flex items-center gap-1.5 text-[11px] text-text-muted hover:text-text-primary transition-colors"
              >
                <svg width="16" height="8" aria-hidden="true"><line x1="0" y1="4" x2="16" y2="4" stroke={PALETTE[i % PALETTE.length]} strokeWidth="2" /></svg>
                {sr.name}
                {p && p.value !== null && (
                  <span className="text-text-primary font-semibold tabular-nums">{fmt(p.value, activeMetric.format)}</span>
                )}
              </button>
            )
          })}
        </div>
      </div>

      <div className="text-xs text-text-muted px-1 space-y-1">
        {Object.values(data?.meta?.definition || {}).map(d => <p key={d}>{d}</p>)}
      </div>
    </div>
  )
}

function Toolbar({ metric, setMetric, windowMonths, setWindowMonths, metrics, windows }) {
  const [slot, setSlot] = useState(null)
  useEffect(() => { setSlot(document.getElementById(TOOLBAR_SLOT_ID)) }, [])
  if (!slot) return null
  const cls = 'px-2.5 py-1.5 rounded-lg text-xs bg-bg border border-border text-text-primary normal-case tracking-normal font-medium'
  const wrap = 'flex items-center gap-1.5 text-[11px] font-semibold text-text-muted uppercase tracking-wide'
  return createPortal(
    <div className="flex items-center gap-3 flex-wrap">
      <label className={wrap}>
        Metric
        <select value={metric} onChange={e => setMetric(e.target.value)} className={cls}>
          {(metrics.length ? metrics : [{ key: 'penetration', label: 'PT Member Penetration %' }])
            .map(m => <option key={m.key} value={m.key}>{m.label}</option>)}
        </select>
      </label>
      <label className={wrap}>
        PT Qualification
        <select value={String(windowMonths)} onChange={e => setWindowMonths(Number(e.target.value))} className={cls}>
          {(windows.length ? windows : [{ key: 3, label: 'Paid in last 3 months' }])
            .map(w => <option key={w.key} value={String(w.key)}>{w.label}</option>)}
        </select>
      </label>
    </div>,
    slot
  )
}
