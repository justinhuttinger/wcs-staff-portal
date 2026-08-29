import { Fragment, useEffect, useMemo, useState } from 'react'
import { createPortal } from 'react-dom'
import { api } from '../../lib/api'
import { useCancellableFetch } from '../../hooks/useCancellableFetch'
import DesktopLoading from '../DesktopLoading'
import { fmtInt, fmtMoney, fmtMonth, GOOD_COLOR, BAD_COLOR, colorFor } from './chartPalette'
import { MultiTrend, RankedBars, zebraColumn } from './charts'
import { TOOLBAR_SLOT_ID } from './toolbarSlot'
import { LOCATION_NAMES } from '../../config/locations'

// ---------------------------------------------------------------------------
// Revenue Analysis — Analytics (admin only)
//
// Every profit center against the same span a month ago and a year ago.
//
// TWO TABLES, BOTH ALWAYS PRESENT. Priority carries the centers that get
// managed; All carries every one of them. Hiding the long tail behind a toggle
// meant a $289,021 guest-fee line was one click further away than a $4,138
// snack line, which is backwards.
//
// ANY ROW OPENS INTO ITS LAST SIX MONTHS. A single period against two
// comparisons says whether something moved; it does not say whether the move is
// a trend or a blip, and that is usually the actual question. Small rows get
// the same treatment as large ones — the reason to open a small row is to ask
// whether it is small and shrinking or small and growing.
// ---------------------------------------------------------------------------

const CLUB_NAMES = Object.fromEntries(LOCATION_NAMES.map(n => [n.toLowerCase(), n]))
const CLUB_LABEL = s => (s ? (CLUB_NAMES[s] || s.charAt(0).toUpperCase() + s.slice(1)) : s)

const COLUMNS = [
  { label: 'Profit Center', align: 'left' },
  { label: 'This Period', align: 'right' },
  { label: 'Last Month', align: 'right' },
  { label: 'MoM', align: 'right' },
  { label: 'Last Year', align: 'right' },
  { label: 'YoY', align: 'right' },
]

/** A change, coloured, with its sign always printed. */
function Change({ pct, delta }) {
  if (pct === null || pct === undefined) {
    // No base to compare against. The absolute movement is still real, so it is
    // shown rather than leaving the cell empty.
    return (
      <span className="tabular-nums text-text-muted">
        {delta === null || delta === undefined || delta === 0 ? '—' : fmtMoney(delta)}
      </span>
    )
  }
  const colour = pct === 0 ? undefined : pct > 0 ? GOOD_COLOR : BAD_COLOR
  return (
    <span className="tabular-nums" style={colour ? { color: colour } : undefined}>
      {pct > 0 ? '+' : ''}{pct}%
    </span>
  )
}

/**
 * Six months of one category, drawn small.
 *
 * Zero-based, because these are revenue amounts and a floating baseline would
 * turn a 3% wobble into a cliff on a chart this size — exactly the misreading a
 * sparkline invites when it is glanced at rather than studied.
 */
function Sparkline({ points, width = 420, height = 78 }) {
  const real = points.filter(p => Number.isFinite(p.value))
  if (real.length < 2) {
    return <p className="text-[11px] text-text-muted">Not enough history to draw a trend.</p>
  }

  const padL = 4
  const padB = 16
  const plotW = width - padL * 2
  const plotH = height - padB
  const max = Math.max(...real.map(p => p.value)) * 1.12 || 1
  const n = points.length

  const x = i => padL + (n <= 1 ? plotW / 2 : (i / (n - 1)) * plotW)
  const y = v => plotH - (Math.max(0, v) / max) * plotH
  const colour = colorFor('revenue', 0)

  return (
    <div>
      <svg viewBox={`0 0 ${width} ${height}`} width={width} height={height} className="block" role="img"
        aria-label="Revenue over the last six months">
        <line x1={padL} x2={width - padL} y1={plotH} y2={plotH} stroke="currentColor"
          className="text-border" strokeWidth="1" />
        <polyline
          points={points.map((p, i) => `${x(i)},${y(p.value || 0)}`).join(' ')}
          fill="none" stroke={colour} strokeWidth="2" strokeLinejoin="round" strokeLinecap="round"
        />
        {points.map((p, i) => (
          <circle key={p.month} cx={x(i)} cy={y(p.value || 0)} r="2.5" fill={colour}>
            <title>{`${fmtMonth(p.month)}: ${fmtMoney(p.value || 0)}`}</title>
          </circle>
        ))}
        {points.map((p, i) => (
          <text key={`l-${p.month}`} x={x(i)} y={height - 4} textAnchor="middle"
            className="fill-text-muted" style={{ fontSize: 9 }}>
            {fmtMonth(p.month)}
          </text>
        ))}
      </svg>
    </div>
  )
}

function CategoryTable({ title, subtitle, rows, sparklines, openKey, setOpenKey }) {
  return (
    <div className="bg-surface rounded-xl border border-border p-3 overflow-x-auto">
      <div className="flex items-baseline justify-between gap-3 mb-2">
        <p className="text-xs font-bold text-text-primary">{title}</p>
        <p className="text-[11px] text-text-muted">{subtitle}</p>
      </div>
      <table className="w-full text-sm">
        <thead>
          <tr className="text-[11px] uppercase tracking-wide text-text-muted border-b border-border">
            {COLUMNS.map((c, i) => (
              <th
                key={c.label}
                className={`py-1.5 px-2 font-semibold ${c.align === 'right' ? 'text-right' : 'text-left'}`}
                style={zebraColumn(i)}
              >
                {c.label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map(r => {
            const open = openKey === r.category
            const points = sparklines[r.category] || []
            return (
              <Fragment key={r.category}>
                <tr
                  className="border-b border-border/60 cursor-pointer hover:bg-black/[0.03]"
                  onClick={() => setOpenKey(open ? null : r.category)}
                >
                  <td className="py-1.5 px-2 text-text-primary" style={zebraColumn(0)}>
                    <span className="inline-flex items-center gap-1.5">
                      <span className="text-text-muted text-[10px] w-2" aria-hidden="true">
                        {open ? '▼' : '▶'}
                      </span>
                      {r.category}
                      {r.negative && (
                        <span className="text-[10px] text-text-muted border border-border rounded px-1">
                          reduces revenue
                        </span>
                      )}
                    </span>
                  </td>
                  <td className="py-1.5 px-2 text-right tabular-nums text-text-primary font-semibold" style={zebraColumn(1)}>
                    {fmtMoney(r.revenue)}
                  </td>
                  <td className="py-1.5 px-2 text-right tabular-nums text-text-muted" style={zebraColumn(2)}>
                    {fmtMoney(r.lastMonthRevenue)}
                  </td>
                  <td className="py-1.5 px-2 text-right" style={zebraColumn(3)}>
                    <Change pct={r.momChange} delta={r.momDelta} />
                  </td>
                  <td className="py-1.5 px-2 text-right tabular-nums text-text-muted" style={zebraColumn(4)}>
                    {fmtMoney(r.lastYearRevenue)}
                  </td>
                  <td className="py-1.5 px-2 text-right" style={zebraColumn(5)}>
                    <Change pct={r.yoyChange} delta={r.yoyDelta} />
                  </td>
                </tr>

                {open && (
                  <tr className="border-b border-border/60">
                    <td colSpan={6} className="p-0">
                      <div className="px-6 py-3" style={{ background: 'rgba(128,128,128,0.05)' }}>
                        <p className="text-[11px] font-semibold text-text-primary mb-1">
                          {r.category} — last six months
                        </p>
                        <Sparkline points={points} />

                        {/* The centers folded into this category. A reader has
                            no way to audit a mapping, or to notice a new code
                            landing in the wrong place, unless it is shown. */}
                        {r.centers && r.centers.length > 1 && (
                          <div className="mt-2">
                            <p className="text-[11px] text-text-muted mb-1">
                              Profit centers folded into {r.category}. One showing nothing this period
                              and something last year has been renamed, not lost.
                            </p>
                            <table className="w-full text-sm">
                              <tbody>
                                {r.centers.map(c => (
                                  <tr key={c.profitCenter} className="border-b border-border/30 last:border-0">
                                    <td className="py-1 text-text-muted">{c.profitCenter}</td>
                                    <td className="py-1 text-right tabular-nums text-text-primary">{fmtMoney(c.revenue)}</td>
                                    <td className="py-1 text-right tabular-nums text-text-muted">{fmtMoney(c.lastMonthRevenue)}</td>
                                    <td className="py-1 text-right tabular-nums text-text-muted">{fmtMoney(c.lastYearRevenue)}</td>
                                  </tr>
                                ))}
                              </tbody>
                            </table>
                          </div>
                        )}
                      </div>
                    </td>
                  </tr>
                )}
              </Fragment>
            )
          })}
        </tbody>
      </table>
      {rows.length === 0 && (
        <p className="text-sm text-text-muted text-center py-8">Nothing in this selection.</p>
      )}
    </div>
  )
}

export default function Revenue({ startDate, endDate, locationSlug }) {
  const [openKey, setOpenKey] = useState(null)

  const query = useMemo(() => {
    const p = new URLSearchParams({ clubs: locationSlug || 'all' })
    if (startDate) p.set('start', startDate)
    if (endDate) p.set('end', endDate)
    return p.toString()
  }, [startDate, endDate, locationSlug])

  const { data, loading, error, retrying } = useCancellableFetch(
    signal => api(`/analytics/revenue?${query}`, { cache: true, signal }),
    [query]
  )

  const s = data?.summary || {}
  const headline = data?.headline || []
  const all = data?.all || []
  const sparklines = data?.sparklines || {}

  return (
    <div className="space-y-3">
      <Toolbar />

      {loading && <DesktopLoading retrying={retrying} />}

      {!loading && error && (
        <div className="bg-surface rounded-xl border border-border p-8 text-center">
          <p className="text-sm text-wcs-red font-semibold">Could not load the report</p>
          <p className="text-xs text-text-muted mt-1">{String(error.message || error)}</p>
        </div>
      )}

      {!loading && !error && data && (
        <>
          <div className="bg-surface rounded-xl border border-border overflow-x-auto">
            <div className="flex min-w-max divide-x divide-border">
              {[
                { label: 'Gross Revenue', value: fmtMoney(s.gross) },
                {
                  label: 'vs Last Month',
                  value: s.grossMom === null || s.grossMom === undefined
                    ? '—' : `${s.grossMom > 0 ? '+' : ''}${s.grossMom}%`,
                  tone: s.grossMom,
                },
                {
                  label: 'vs Last Year',
                  value: s.grossYoy === null || s.grossYoy === undefined
                    ? '—' : `${s.grossYoy > 0 ? '+' : ''}${s.grossYoy}%`,
                  tone: s.grossYoy,
                },
                { label: 'Refunds', value: fmtMoney(s.refunds), muted: true },
                { label: 'Net', value: fmtMoney(s.net), muted: true },
                { label: 'Profit Centers', value: fmtInt(s.categories), muted: true },
              ].map(t => (
                <div key={t.label} className="px-5 py-4 text-center min-w-[130px] flex-1">
                  <p
                    className={`text-xl font-bold tabular-nums ${t.muted ? 'text-text-muted' : 'text-text-primary'}`}
                    style={t.tone !== undefined && t.tone !== null && t.tone !== 0
                      ? { color: t.tone > 0 ? GOOD_COLOR : BAD_COLOR } : undefined}
                  >
                    {t.value}
                  </p>
                  <p className="text-[11px] text-text-muted mt-0.5 leading-tight">{t.label}</p>
                </div>
              ))}
            </div>
          </div>

          {/* The windows being compared, stated plainly. A percentage against an
              unnamed period is a number nobody can check. */}
          <div className="bg-surface rounded-xl border border-border p-3">
            <p className="text-[11px] text-text-muted">
              {data.meta?.spanDays} days ending {data.meta?.end}, against{' '}
              {data.meta?.lastMonthStart} to {data.meta?.lastMonthEnd} and{' '}
              {data.meta?.lastYearStart} to {data.meta?.lastYearEnd} — the same number of days each
              time, so a short month cannot read as a decline. {data.notes?.totals}
            </p>
          </div>

          <MultiTrend
            title="Revenue by Priority Profit Center"
            months={data.trendMonths || []}
            series={data.trendSeries || []}
            format="int"
            subtitle={`${(data.trendSeries || []).length} centers`}
          />

          <CategoryTable
            title="Priority Profit Centers"
            subtitle="click a row for its last six months"
            rows={headline}
            sparklines={sparklines}
            openKey={openKey}
            setOpenKey={setOpenKey}
          />

          <CategoryTable
            title="All Profit Centers"
            subtitle={`every center, largest first — ${all.length} in total`}
            rows={all}
            sparklines={sparklines}
            openKey={openKey}
            setOpenKey={setOpenKey}
          />

          <RankedBars
            title="Revenue by Club"
            rows={(data.byClub || []).map(c => ({ ...c, label: CLUB_LABEL(c.slug) }))}
            labelKey="label" valueKey="revenue" format="int"
            emptyText="No revenue in this selection."
          />

          <p className="text-[11px] text-text-muted px-1">{data.notes?.mapping}</p>
        </>
      )}
    </div>
  )
}

function Toolbar() {
  const [slot, setSlot] = useState(null)
  useEffect(() => { setSlot(document.getElementById(TOOLBAR_SLOT_ID)) }, [])
  if (!slot) return null
  return createPortal(
    <span className="text-[11px] text-text-muted">
      Both tables open a row for its six-month trend
    </span>,
    slot
  )
}
