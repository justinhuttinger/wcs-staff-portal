import { useEffect, useMemo, useState } from 'react'
import { createPortal } from 'react-dom'
import { api } from '../../lib/api'
import { useCancellableFetch } from '../../hooks/useCancellableFetch'
import { useChartWidth } from './useChartWidth'
import DesktopLoading from '../DesktopLoading'
import { colorFor, fmtInt, fmtMonth } from './chartPalette'
import { TOOLBAR_SLOT_ID } from './toolbarSlot'

// ---------------------------------------------------------------------------
// Check-ins — Analytics (admin only)
//
// VOLUME AND TIMING COME FROM DIFFERENT TABLES, AND ONLY ONE OF THEM IS SOUND.
// Totals, the trend and the per-club bars are drawn from the monthly source,
// which is complete. Hour of day and weekday come from the hourly feed, which
// has been missing about 40% of visits since May 2026, so those two charts show
// SHARES and never counts, and the report says so above them when capture is
// short.
//
// The report this replaces drew everything from the hourly feed and so showed
// check-ins down 43% since January. They were up. That is the whole reason the
// two sources are kept apart here rather than summed into one number.
// ---------------------------------------------------------------------------

const PANEL_H = 190
const PAD_L = 46
const PAD_R = 12
const PAD_T = 12
const PAD_B = 22

const HOUR_LABELS = ['12a', '1a', '2a', '3a', '4a', '5a', '6a', '7a', '8a', '9a', '10a', '11a',
  '12p', '1p', '2p', '3p', '4p', '5p', '6p', '7p', '8p', '9p', '10p', '11p']

const DOW_SHORT = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']

const CLUB_LABEL = s => (s ? s.charAt(0).toUpperCase() + s.slice(1) : s)

function hourLabel(h) {
  return HOUR_LABELS[h] ?? String(h)
}

/** Check-ins across the trailing months. One series, so no legend box. */
function TrendChart({ months }) {
  const [wrapRef, W] = useChartWidth()
  const [hover, setHover] = useState(null)

  const plotW = Math.max(0, (W || 0) - PAD_L - PAD_R)
  const plotH = PANEL_H - PAD_T - PAD_B
  const n = months.length

  const values = months.map(m => m.checkins).filter(Number.isFinite)
  const rawMax = Math.max(0, ...values)
  // Zero-based, so a bar's height means what it looks like. A check-ins axis
  // starting at 40,000 would turn a steady year into a cliff.
  const max = rawMax > 0 ? rawMax * 1.12 : 1

  const x = i => (n <= 1 ? plotW / 2 : (i / (n - 1)) * plotW)
  const y = v => plotH - (Math.max(0, Math.min(v, max)) / max) * plotH
  const ticks = [0, 0.25, 0.5, 0.75, 1].map(f => f * max)

  const active = hover !== null ? months[hover] : null

  return (
    <div className="bg-surface rounded-xl border border-border p-3">
      <div className="flex items-baseline justify-between gap-3 mb-1">
        <p className="text-xs font-bold text-text-primary">Check-ins by Month</p>
        <p className="text-[11px] text-text-muted tabular-nums truncate max-w-[60%] text-right">
          {active
            ? `${fmtMonth(active.month)} · ${fmtInt(active.checkins)} check-ins · ${active.visitsPerMember ?? 'N/A'} per member`
            : `${n} months`}
        </p>
      </div>

      <div ref={wrapRef}>
        {W ? (
          <svg
            viewBox={`0 0 ${W} ${PANEL_H}`} width={W} height={PANEL_H} className="block"
            role="img" aria-label={`Check-ins across ${n} months`}
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
                    style={{ fontSize: 9 }}>
                    {t >= 1000 ? `${Math.round(t / 1000)}k` : Math.round(t)}
                  </text>
                </g>
              ))}

              {active && (
                <line x1={x(hover)} x2={x(hover)} y1={0} y2={plotH} stroke="currentColor"
                  className="text-text-muted" strokeWidth="1" strokeDasharray="2 2" />
              )}

              {/* colorFor takes (name, index) — both. */}
              <polyline
                points={months.map((m, i) => `${x(i)},${y(m.checkins)}`).join(' ')}
                fill="none" stroke={colorFor('checkins', 0)} strokeWidth="2"
                strokeLinejoin="round" strokeLinecap="round"
              />
              {months.map((m, i) => (
                <circle key={m.month} cx={x(i)} cy={y(m.checkins)} r={hover === i ? 4 : 2.5}
                  fill={colorFor('checkins', 0)} />
              ))}
            </g>

            {months.map((m, i) =>
              i % Math.ceil(n / 12) === 0 ? (
                <text key={m.month} x={PAD_L + x(i)} y={PANEL_H - 6} textAnchor="middle"
                  className="fill-text-muted" style={{ fontSize: 9 }}>
                  {fmtMonth(m.month)}
                </text>
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
 * Vertical columns for a distribution that is read left to right — hour of day,
 * or weekday. Values are SHARES, because the feed behind them is short.
 */
function ShareColumns({ title, rows, labelFor, subtitle }) {
  const [wrapRef, W] = useChartWidth()
  const [hover, setHover] = useState(null)

  const plotW = Math.max(0, (W || 0) - PAD_L - PAD_R)
  const plotH = PANEL_H - PAD_T - PAD_B
  const n = rows.length
  const max = Math.max(0.001, ...rows.map(r => r.share)) * 1.12

  const bw = n ? Math.max(2, (plotW / n) - 3) : 0
  const x = i => (n ? (i / n) * plotW : 0)
  const y = v => plotH - (v / max) * plotH
  const ticks = [0, 0.5, 1].map(f => f * max)

  const active = hover !== null ? rows[hover] : null

  return (
    <div className="bg-surface rounded-xl border border-border p-3">
      <div className="flex items-baseline justify-between gap-3 mb-1">
        <p className="text-xs font-bold text-text-primary">{title}</p>
        <p className="text-[11px] text-text-muted tabular-nums truncate max-w-[60%] text-right">
          {active ? `${labelFor(active)} · ${active.share}% of visits` : subtitle}
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
                    style={{ fontSize: 9 }}>{t.toFixed(0)}%</text>
                </g>
              ))}

              {rows.map((r, i) => (
                <rect
                  key={i} x={x(i)} y={y(r.share)} width={bw} height={Math.max(0, plotH - y(r.share))}
                  rx="2" fill={colorFor('checkins', 0)}
                  opacity={hover === null || hover === i ? 1 : 0.4}
                  onMouseEnter={() => setHover(i)}
                >
                  <title>{`${labelFor(r)}: ${r.share}% of visits`}</title>
                </rect>
              ))}
            </g>

            {rows.map((r, i) =>
              i % Math.ceil(n / 12) === 0 ? (
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
 * Clubs, ranked by volume, each carrying its own rate.
 *
 * Volume and rate travel together because ranking on volume alone buries the
 * interesting case: Milwaukie has the most members visiting and the lowest
 * visits per member, Salem the reverse.
 */
function ClubBars({ clubs }) {
  const max = Math.max(1, ...clubs.map(c => c.checkins))
  return (
    <div className="bg-surface rounded-xl border border-border p-3">
      <p className="text-xs font-bold text-text-primary mb-2">By Club</p>
      <div className="space-y-1.5">
        {clubs.map((c, i) => (
          <div key={c.slug} className="flex items-center gap-3">
            <span className="text-xs text-text-primary w-24 text-right flex-shrink-0 truncate">
              {CLUB_LABEL(c.slug)}
            </span>
            <div className="flex-1 min-w-[120px] h-6 rounded-sm bg-bg overflow-hidden">
              <div className="h-full rounded-sm flex items-center justify-end pr-1.5"
                style={{ width: `${(c.checkins / max) * 100}%`, background: colorFor(c.slug, i) }}>
                <span className="text-[10px] font-semibold text-white drop-shadow-[0_1px_1px_rgba(0,0,0,0.45)]">
                  {fmtInt(c.checkins)}
                </span>
              </div>
            </div>
            <span className="text-[11px] text-text-muted tabular-nums w-28 text-right flex-shrink-0">
              {c.visitsPerMember ?? 'N/A'} / member
            </span>
            <span className="text-[11px] text-text-muted tabular-nums w-24 text-right flex-shrink-0">
              {fmtInt(c.membersVisiting)} visiting
            </span>
          </div>
        ))}
        {clubs.length === 0 && (
          <p className="text-sm text-text-muted text-center py-8">No check-ins in this selection.</p>
        )}
      </div>
    </div>
  )
}

export default function Checkins({ startDate, endDate, locationSlug }) {
  const [asTable, setAsTable] = useState(false)

  const query = useMemo(() => {
    const p = new URLSearchParams({ clubs: locationSlug || 'all' })
    if (startDate) p.set('start', startDate)
    if (endDate) p.set('end', endDate)
    return p.toString()
  }, [startDate, endDate, locationSlug])

  const { data, loading, error } = useCancellableFetch(
    signal => api(`/analytics/checkins?${query}`, { cache: true, signal }),
    [query]
  )

  const s = data?.summary || {}
  const clubs = data?.byClub || []
  const trend = data?.trend || []
  const hours = data?.hours || []
  const dow = data?.dow || []

  return (
    <div className="space-y-3">
      <Toolbar asTable={asTable} setAsTable={setAsTable} />

      {loading && <DesktopLoading />}

      {!loading && error && (
        <div className="bg-surface rounded-xl border border-border p-8 text-center">
          <p className="text-sm text-wcs-red font-semibold">Could not load the report</p>
          <p className="text-xs text-text-muted mt-1">{String(error.message || error)}</p>
        </div>
      )}

      {!loading && !error && data && (
        <>
          {/* Above the numbers, not below them: a reader who has already drawn a
              conclusion will not come back for a footnote. */}
          {data.notes?.capture && (
            <div className="bg-surface rounded-xl border border-amber-500/40 p-3">
              <p className="text-[11px] text-amber-600">{data.notes.capture}</p>
            </div>
          )}

          <div className="bg-surface rounded-xl border border-border overflow-x-auto">
            <div className="flex min-w-max divide-x divide-border">
              {[
                { label: 'Check-ins', value: fmtInt(s.checkins) },
                { label: 'Members Visiting', value: fmtInt(s.membersVisiting) },
                { label: 'Visits per Member', value: s.visitsPerMember ?? 'N/A' },
                { label: 'Busiest Day', value: s.busiestDay || 'N/A' },
                { label: 'Busiest Hour', value: s.busiestHour === null || s.busiestHour === undefined ? 'N/A' : hourLabel(s.busiestHour) },
                {
                  label: `vs ${data.meta?.comparisonLabel || 'prior'}`,
                  value: s.checkinsChange === null || s.checkinsChange === undefined
                    ? 'N/A' : `${s.checkinsChange > 0 ? '+' : ''}${s.checkinsChange}%`,
                },
              ].map(t => (
                <div key={t.label} className="px-5 py-4 text-center min-w-[130px] flex-1">
                  <p className="text-xl font-bold tabular-nums text-text-primary">{t.value}</p>
                  <p className="text-[11px] text-text-muted mt-0.5 leading-tight">{t.label}</p>
                </div>
              ))}
            </div>
          </div>

          {asTable ? (
            <TableView clubs={clubs} trend={trend} coverage={data.coverage || []} />
          ) : (
            <>
              <TrendChart months={trend} />

              <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
                <ShareColumns
                  title="When Members Come — Hour of Day"
                  rows={hours} labelFor={r => hourLabel(r.hour)}
                  subtitle="share of visits"
                />
                <ShareColumns
                  title="When Members Come — Day of Week"
                  rows={dow} labelFor={r => DOW_SHORT[r.dow] ?? r.dow}
                  subtitle="share of visits"
                />
              </div>

              <ClubBars clubs={clubs} />
            </>
          )}
        </>
      )}
    </div>
  )
}

function TableView({ clubs, trend, coverage }) {
  return (
    <div className="space-y-3">
      <div className="bg-surface rounded-xl border border-border p-3 overflow-x-auto">
        <p className="text-xs font-bold text-text-primary mb-2">By Club</p>
        <table className="w-full text-sm">
          <thead>
            <tr className="text-[11px] uppercase tracking-wide text-text-muted border-b border-border">
              <th className="text-left font-semibold py-1.5">Club</th>
              <th className="text-right font-semibold py-1.5">Check-ins</th>
              <th className="text-right font-semibold py-1.5">Members Visiting</th>
              <th className="text-right font-semibold py-1.5">Visits per Member</th>
            </tr>
          </thead>
          <tbody>
            {clubs.map(c => (
              <tr key={c.slug} className="border-b border-border/60 last:border-0">
                <td className="py-1.5 text-text-primary">{CLUB_LABEL(c.slug)}</td>
                <td className="py-1.5 text-right tabular-nums text-text-primary">{fmtInt(c.checkins)}</td>
                <td className="py-1.5 text-right tabular-nums text-text-muted">{fmtInt(c.membersVisiting)}</td>
                <td className="py-1.5 text-right tabular-nums text-text-primary">{c.visitsPerMember ?? 'N/A'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="bg-surface rounded-xl border border-border p-3 overflow-x-auto">
        <p className="text-xs font-bold text-text-primary mb-2">By Month</p>
        <table className="w-full text-sm">
          <thead>
            <tr className="text-[11px] uppercase tracking-wide text-text-muted border-b border-border">
              <th className="text-left font-semibold py-1.5">Month</th>
              <th className="text-right font-semibold py-1.5">Check-ins</th>
              <th className="text-right font-semibold py-1.5">Visits per Member</th>
              {/* The feed's own health, in the table rather than only in a
                  banner, so it can be read month by month. */}
              <th className="text-right font-semibold py-1.5">Hourly Feed Capture</th>
            </tr>
          </thead>
          <tbody>
            {trend.map(m => {
              const cov = coverage.find(c => c.month === m.month)
              return (
                <tr key={m.month} className="border-b border-border/60 last:border-0">
                  <td className="py-1.5 text-text-primary">{fmtMonth(m.month)}</td>
                  <td className="py-1.5 text-right tabular-nums text-text-primary">{fmtInt(m.checkins)}</td>
                  <td className="py-1.5 text-right tabular-nums text-text-muted">{m.visitsPerMember ?? 'N/A'}</td>
                  <td className={`py-1.5 text-right tabular-nums ${cov && cov.capture !== null && cov.capture < 90 ? 'text-amber-600' : 'text-text-muted'}`}>
                    {cov && cov.capture !== null ? `${cov.capture}%` : 'N/A'}
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    </div>
  )
}

function Toolbar({ asTable, setAsTable }) {
  const [slot, setSlot] = useState(null)
  useEffect(() => { setSlot(document.getElementById(TOOLBAR_SLOT_ID)) }, [])
  if (!slot) return null
  return createPortal(
    <div className="flex items-center gap-3 flex-wrap">
      <button
        type="button"
        onClick={() => setAsTable(v => !v)}
        className="text-xs font-semibold text-text-muted hover:text-wcs-red transition-colors"
      >
        {asTable ? 'Show charts' : 'Show table'}
      </button>
    </div>,
    slot
  )
}
