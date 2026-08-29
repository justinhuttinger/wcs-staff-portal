import { Fragment, useEffect, useMemo, useState } from 'react'
import { createPortal } from 'react-dom'
import { api } from '../../lib/api'
import { useCancellableFetch } from '../../hooks/useCancellableFetch'
import DesktopLoading from '../DesktopLoading'
import { fmtInt, fmtMoney, fmtMonth, GOOD_COLOR, BAD_COLOR } from './chartPalette'
import { MultiTrend, RankedBars } from './charts'
import { TOOLBAR_SLOT_ID } from './toolbarSlot'
import { LOCATION_NAMES } from '../../config/locations'

// ---------------------------------------------------------------------------
// Revenue — Analytics (admin only)
//
// Every profit centre against the same span a month ago and a year ago.
//
// BOTH COMPARISONS ARE THE SAME NUMBER OF DAYS as the window on screen. The
// default is month-to-date, so 27 days of August against all 31 of July would
// report a 13% fall that is nothing but a shorter window.
//
// THE EIGHT MANAGED CATEGORIES LEAD; EVERY OTHER CENTRE STILL GETS ITS OWN ROW.
// A revenue report that hides $289,021 of guest fees behind "Other" is not a
// revenue report.
//
// EACH CATEGORY OPENS INTO THE RAW CENTRES BEHIND IT, because Dues folds ten
// spellings and Training folds a rename, and a reader has no way to check that
// mapping — or to spot a new code landing in the wrong place — unless the
// report shows its working.
// ---------------------------------------------------------------------------

const CLUB_NAMES = Object.fromEntries(LOCATION_NAMES.map(n => [n.toLowerCase(), n]))
const CLUB_LABEL = s => (s ? (CLUB_NAMES[s] || s.charAt(0).toUpperCase() + s.slice(1)) : s)

/** A change, coloured, with its sign always printed. */
function Change({ pct, delta }) {
  if (pct === null || pct === undefined) {
    // No base to compare against. The absolute delta is still real, so it is
    // shown rather than leaving the cell blank.
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

function CategoryRows({ rows, openKey, setOpenKey }) {
  return rows.map(r => {
    const open = openKey === r.category
    const canOpen = r.centers && r.centers.length > 1
    return (
      <Fragment key={r.category}>
        <tr
          className={`border-b border-border/60 ${canOpen ? 'cursor-pointer hover:bg-bg/50' : ''}`}
          onClick={() => canOpen && setOpenKey(open ? null : r.category)}
        >
          <td className="py-1.5 text-text-primary">
            <span className="inline-flex items-center gap-1.5">
              {/* Only categories made of more than one centre can be opened —
                  an arrow on a single-centre row promises detail that is just
                  the row again. */}
              <span className="text-text-muted text-[10px] w-2" aria-hidden="true">
                {canOpen ? (open ? '▼' : '▶') : ''}
              </span>
              {r.category}
              {r.negative && (
                <span className="text-[10px] text-text-muted border border-border rounded px-1">
                  reduces revenue
                </span>
              )}
            </span>
          </td>
          <td className="py-1.5 text-right tabular-nums text-text-primary font-semibold">{fmtMoney(r.revenue)}</td>
          <td className="py-1.5 text-right tabular-nums text-text-muted">{fmtMoney(r.lastMonthRevenue)}</td>
          <td className="py-1.5 text-right"><Change pct={r.momChange} delta={r.momDelta} /></td>
          <td className="py-1.5 text-right tabular-nums text-text-muted">{fmtMoney(r.lastYearRevenue)}</td>
          <td className="py-1.5 text-right"><Change pct={r.yoyChange} delta={r.yoyDelta} /></td>
        </tr>

        {open && (
          <tr className="border-b border-border/60">
            <td colSpan={6} className="p-0">
              <div className="bg-bg/40 px-6 py-2">
                <p className="text-[11px] text-text-muted mb-1">
                  Profit centres folded into {r.category}. A centre showing nothing this period
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
            </td>
          </tr>
        )}
      </Fragment>
    )
  })
}

export default function Revenue({ startDate, endDate, locationSlug }) {
  const [openKey, setOpenKey] = useState(null)
  const [showAll, setShowAll] = useState(false)

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
  const others = data?.others || []

  return (
    <div className="space-y-3">
      <Toolbar showAll={showAll} setShowAll={setShowAll} />

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
                { label: 'Profit Centres', value: fmtInt(s.categories), muted: true },
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
            title="Revenue by Category"
            months={data.trendMonths || []}
            series={data.trendSeries || []}
            format="int"
            subtitle={`${(data.trendSeries || []).length} categories`}
          />

          <div className="bg-surface rounded-xl border border-border p-3 overflow-x-auto">
            <div className="flex items-baseline justify-between gap-3 mb-2">
              <p className="text-xs font-bold text-text-primary">By Profit Centre</p>
              <p className="text-[11px] text-text-muted">click a category to see the centres behind it</p>
            </div>
            <table className="w-full text-sm">
              <thead>
                <tr className="text-[11px] uppercase tracking-wide text-text-muted border-b border-border">
                  <th className="text-left font-semibold py-1.5">Category</th>
                  <th className="text-right font-semibold py-1.5">This Period</th>
                  <th className="text-right font-semibold py-1.5">Last Month</th>
                  <th className="text-right font-semibold py-1.5">MoM</th>
                  <th className="text-right font-semibold py-1.5">Last Year</th>
                  <th className="text-right font-semibold py-1.5">YoY</th>
                </tr>
              </thead>
              <tbody>
                <CategoryRows rows={headline} openKey={openKey} setOpenKey={setOpenKey} />

                {others.length > 0 && (
                  <tr className="border-b border-border">
                    <td colSpan={6} className="py-2">
                      <button
                        type="button"
                        onClick={() => setShowAll(v => !v)}
                        className="text-[11px] font-semibold text-text-muted hover:text-wcs-red transition-colors"
                      >
                        {showAll
                          ? 'Hide the other profit centres'
                          : `Show the other ${others.length} profit centres`}
                      </button>
                    </td>
                  </tr>
                )}

                {showAll && <CategoryRows rows={others} openKey={openKey} setOpenKey={setOpenKey} />}
              </tbody>
            </table>
          </div>

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

function Toolbar({ showAll, setShowAll }) {
  const [slot, setSlot] = useState(null)
  useEffect(() => { setSlot(document.getElementById(TOOLBAR_SLOT_ID)) }, [])
  if (!slot) return null
  return createPortal(
    <div className="flex items-center gap-3 flex-wrap">
      <button
        type="button"
        onClick={() => setShowAll(v => !v)}
        className="text-xs font-semibold text-text-muted hover:text-wcs-red transition-colors"
      >
        {showAll ? 'Headline categories only' : 'Show every profit centre'}
      </button>
    </div>,
    slot
  )
}
