import { useMemo, useState } from 'react'
import { api } from '../../lib/api'
import { useCancellableFetch } from '../../hooks/useCancellableFetch'
import { useChartWidth } from './useChartWidth'
import DesktopLoading from '../DesktopLoading'
import { colorFor, fmtInt, fmtMoney } from './chartPalette'

// ---------------------------------------------------------------------------
// Member Journey — Analytics (admin only)
//
// The x-axis is MONTH OF MEMBERSHIP, not a calendar month. Everybody's first
// month is 0, so a member who joined last week sits beside one who joined two
// years ago at the same point in their own membership. That is the whole idea:
// it answers "what happens to a member over time", which a calendar axis cannot.
//
// THE SOURCE TOOL PUTS CHECK-INS AND DURATION ON ONE CHART WITH TWO Y-AXES.
// This does not, for two reasons. We hold no visit-duration data at all, and a
// second axis lets any two series be made to look correlated by choosing the
// scales — the reader cannot tell a real relationship from a chosen one.
// ---------------------------------------------------------------------------

const PANEL_H = 190
const PAD_L = 52
const PAD_R = 12
const PAD_T = 14
const PAD_B = 24

function fmtBy(v, format) {
  if (v === null || v === undefined) return 'N/A'
  return format === 'money' ? fmtMoney(v) : (Math.round(v * 100) / 100).toLocaleString()
}

function fmtAxis(v, format) {
  if (format === 'money') {
    return Math.abs(v) >= 1000 ? `$${Math.round(v / 100) / 10}k` : `$${Math.round(v)}`
  }
  return String(Math.round(v * 10) / 10)
}

/**
 * A chart over tenure months. `series` is [{ key, label, points:[{month,value}] }].
 *
 * Every series shares one scale, starting at zero. Starting anywhere else on a
 * per-member average would exaggerate a difference of a few visits into a cliff.
 */
function JourneyChart({ title, subtitle, series, months, format }) {
  const [wrapRef, W] = useChartWidth()
  const [hover, setHover] = useState(null)

  const plotW = Math.max(0, (W || 0) - PAD_L - PAD_R)
  const plotH = PANEL_H - PAD_T - PAD_B
  const n = months.length

  const values = series.flatMap(s => s.points.map(p => p.value)).filter(v => Number.isFinite(v))
  const rawMax = Math.max(0, ...values)
  const max = rawMax > 0 ? rawMax * 1.12 : 1

  const x = i => (n <= 1 ? plotW / 2 : (i / (n - 1)) * plotW)
  const y = v => plotH - (Math.max(0, Math.min(v, max)) / max) * plotH
  const ticks = [0, 0.25, 0.5, 0.75, 1].map(f => f * max)

  return (
    <div className="bg-surface rounded-xl border border-border p-3">
      <div className="flex items-baseline justify-between gap-3 mb-1">
        <div>
          <p className="text-xs font-bold text-text-primary">{title}</p>
          {subtitle && <p className="text-[11px] text-text-muted">{subtitle}</p>}
        </div>
        <p className="text-[11px] text-text-muted tabular-nums truncate max-w-[55%] text-right">
          {hover !== null
            ? `Month ${months[hover]} · ${series
                .map(s => `${s.label} ${fmtBy(s.points[hover]?.value, format)}`)
                .join('  ')}`
            : `${n} months of membership`}
        </p>
      </div>

      <div ref={wrapRef}>
        {W ? (
          <svg
            viewBox={`0 0 ${W} ${PANEL_H}`} width={W} height={PANEL_H} className="block"
            role="img" aria-label={`${title} by month of membership`}
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
                  <text x={-8} y={y(t) + 3} textAnchor="end" className="fill-text-muted" style={{ fontSize: 9 }}>
                    {fmtAxis(t, format)}
                  </text>
                </g>
              ))}

              {hover !== null && (
                <line x1={x(hover)} x2={x(hover)} y1={0} y2={plotH} stroke="currentColor"
                  className="text-text-muted" strokeWidth="1" strokeDasharray="2 2" />
              )}

              {series.map((s, si) => {
                // colorFor takes a NAME and an INDEX. Passing only one makes the
                // index the name and returns undefined, which SVG reads as no
                // stroke and draws nothing.
                const colour = colorFor(s.key, si)
                const pts = s.points
                  .map((p, i) => ({ i, v: p.value }))
                  .filter(p => Number.isFinite(p.v))
                if (!pts.length) return null
                return (
                  <g key={s.key}>
                    {pts.length === 1 ? (
                      <circle cx={x(pts[0].i)} cy={y(pts[0].v)} r="3" fill={colour} />
                    ) : (
                      <polyline
                        points={pts.map(p => `${x(p.i)},${y(p.v)}`).join(' ')}
                        fill="none" stroke={colour} strokeWidth="2"
                        strokeLinejoin="round" strokeLinecap="round"
                      />
                    )}
                  </g>
                )
              })}
            </g>

            {months.map((m, i) =>
              i % Math.ceil(n / 12) === 0 ? (
                <text key={m} x={PAD_L + x(i)} y={PANEL_H - 8} textAnchor="middle"
                  className="fill-text-muted" style={{ fontSize: 9 }}>{m}</text>
              ) : null
            )}
            <text x={PAD_L + plotW / 2} y={PANEL_H + 0} textAnchor="middle"
              className="fill-text-muted" style={{ fontSize: 9 }} />
          </svg>
        ) : (
          <div style={{ height: PANEL_H }} />
        )}
      </div>

      {series.length > 1 && (
        <div className="flex flex-wrap gap-x-3 gap-y-1 mt-2">
          {series.map((s, si) => (
            <span key={s.key} className="inline-flex items-center gap-1.5 text-[11px] text-text-muted">
              <span className="w-2.5 h-2.5 rounded-sm flex-shrink-0" style={{ background: colorFor(s.key, si) }} />
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
    <label className="flex flex-col gap-1 min-w-[150px]">
      <span className="text-[11px] font-semibold text-text-muted uppercase tracking-wide">{label}</span>
      <select value={value} onChange={e => onChange(e.target.value)}
        className="bg-bg border border-border rounded-lg px-2 py-1.5 text-sm text-text-primary">
        {options.map(o => <option key={o.key} value={o.key}>{o.label}</option>)}
      </select>
    </label>
  )
}

export default function MemberJourney({ locationSlug }) {
  const [status, setStatus] = useState('all')
  const [pt, setPt] = useState('all')
  const [maxMonths, setMaxMonths] = useState(24)

  const query = useMemo(() => new URLSearchParams({
    clubs: locationSlug || 'all',
    status, pt, maxMonths: String(maxMonths),
  }).toString(), [locationSlug, status, pt, maxMonths])

  const { data, loading, error } = useCancellableFetch(
    signal => api(`/analytics/member-journey?${query}`, { cache: true, signal }),
    [query]
  )

  const months = data?.months || []

  return (
    <div className="space-y-3">
      <div className="bg-surface rounded-xl border border-border p-3 flex flex-wrap gap-3 items-end">
        <Select label="Member Status" value={status} onChange={setStatus} options={[
          { key: 'all', label: 'All Members' },
          { key: 'active', label: 'Still Members' },
          { key: 'left', label: 'Have Left' },
        ]} />
        <Select label="Enrolled in PT" value={pt} onChange={setPt} options={[
          { key: 'all', label: 'All' },
          { key: 'yes', label: 'In PT' },
          { key: 'no', label: 'Not in PT' },
        ]} />
        <Select label="Months to Show" value={String(maxMonths)} onChange={v => setMaxMonths(Number(v))}
          options={[
            { key: '12', label: 'First 12 Months' },
            { key: '24', label: 'First 24 Months' },
            { key: '36', label: 'First 36 Months' },
          ]} />
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
          {/* Its own chart, not a second axis beside spend: a shared axis lets
              any two series be made to look correlated by choosing the scales. */}
          <JourneyChart
            title="Avg Check-ins per Month of Membership"
            subtitle={data.noDuration}
            series={[data.checkins]}
            months={months}
            format="num"
          />

          <JourneyChart
            title="Avg Spend per Month of Membership"
            series={[data.spendTotal]}
            months={months}
            format="money"
          />

          <JourneyChart
            title="Avg Spend by Profit Center Group"
            series={data.spend || []}
            months={months}
            format="money"
          />

          {/* How many member-months each point rests on. The cohort thins as
              tenure grows -- a member who joined three months ago cannot supply
              a month-12 figure -- so the right-hand end of every curve above is
              the thinnest evidence on the page. */}
          <JourneyChart
            title="Members Behind Each Point"
            subtitle="The cohort thins with tenure, so the far right of every curve rests on the fewest members."
            series={[{
              key: 'memberMonths',
              label: 'Member Months',
              points: (data.cohort || []).map(c => ({ month: c.tenureMonth, value: c.memberMonths })),
            }]}
            months={months}
            format="num"
          />
        </>
      )}
    </div>
  )
}
