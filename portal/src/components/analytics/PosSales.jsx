import { useEffect, useMemo, useState } from 'react'
import { createPortal } from 'react-dom'
import { api } from '../../lib/api'
import { useCancellableFetch } from '../../hooks/useCancellableFetch'
import DesktopLoading from '../DesktopLoading'
import { fmtInt, fmtMoney, fmtMonth } from './chartPalette'
import { MonthlyTrend, RankedBars } from './charts'
import { TOOLBAR_SLOT_ID } from './toolbarSlot'

// ---------------------------------------------------------------------------
// POS Sales — Analytics (admin only)
//
// TWO STREAMS, SHOWN APART. Retail is goods sold. Pass-through is dues,
// personal training, guest fees and account payments taken at the desk — money
// collected, but nothing sold, so no margin is ever computed on it.
//
// That split is the whole report. 89% of what crosses the till is
// pass-through, so a blended "POS Sales" figure of $430k describes something
// nobody can manage, while retail is about $58k and has a real margin.
//
// A MARGIN IS LEFT BLANK RATHER THAN GUESSED. Six clubs cost 79-91% of their
// retail lines; Milwaukie costs 1.9%, where a margin would come from $55 of a
// $2,955 month. Blank with an explanation beats a confident wrong number.
// ---------------------------------------------------------------------------

const CLUB_LABEL = s => (s ? s.charAt(0).toUpperCase() + s.slice(1) : s)

const pctOrDash = v => (v === null || v === undefined ? '—' : `${v}%`)

export default function PosSales({ startDate, endDate, locationSlug }) {
  const [asTable, setAsTable] = useState(false)

  const query = useMemo(() => {
    const p = new URLSearchParams({ clubs: locationSlug || 'all' })
    if (startDate) p.set('start', startDate)
    if (endDate) p.set('end', endDate)
    return p.toString()
  }, [startDate, endDate, locationSlug])

  const { data, loading, error, retrying } = useCancellableFetch(
    signal => api(`/analytics/pos-sales?${query}`, { cache: true, signal }),
    [query]
  )

  const s = data?.summary || {}
  const byClub = data?.byClub || []
  const products = data?.topProducts || []
  const centers = data?.profitCenters || []

  const top = useMemo(() => products.slice(0, 12), [products])

  return (
    <div className="space-y-3">
      <Toolbar asTable={asTable} setAsTable={setAsTable} />

      {loading && <DesktopLoading retrying={retrying} />}

      {!loading && error && (
        <div className="bg-surface rounded-xl border border-border p-8 text-center">
          <p className="text-sm text-wcs-red font-semibold">Could not load the report</p>
          <p className="text-xs text-text-muted mt-1">{String(error.message || error)}</p>
        </div>
      )}

      {!loading && !error && data && (
        <>
          <div className="bg-surface rounded-xl border border-border p-3">
            <p className="text-[11px] text-text-muted">{data.notes?.streams}</p>
          </div>

          {data.notes?.coverage && (
            <div className="bg-surface rounded-xl border border-amber-500/40 p-3">
              <p className="text-[11px] text-amber-600">{data.notes.coverage}</p>
            </div>
          )}

          <div className="bg-surface rounded-xl border border-border overflow-x-auto">
            <div className="flex min-w-max divide-x divide-border">
              {[
                { label: 'Retail Revenue', value: fmtMoney(s.retailRevenue) },
                { label: 'Gross Profit', value: s.grossProfit === null || s.grossProfit === undefined ? '—' : fmtMoney(s.grossProfit) },
                { label: 'Margin', value: pctOrDash(s.marginPct) },
                { label: 'Units Sold', value: fmtInt(s.retailUnits) },
                // Muted: real money, but not a sale, and it must not read as
                // the headline.
                { label: 'Pass-Through', value: fmtMoney(s.passthroughRevenue), muted: true },
                { label: 'Transactions', value: fmtInt(s.transactions), muted: true },
                {
                  label: `Retail vs ${data.meta?.comparisonLabel || 'prior'}`,
                  value: s.retailChange === null || s.retailChange === undefined
                    ? 'N/A' : `${s.retailChange > 0 ? '+' : ''}${s.retailChange}%`,
                },
              ].map(t => (
                <div key={t.label} className="px-5 py-4 text-center min-w-[130px] flex-1">
                  <p className={`text-xl font-bold tabular-nums ${t.muted ? 'text-text-muted' : 'text-text-primary'}`}>
                    {t.value}
                  </p>
                  <p className="text-[11px] text-text-muted mt-0.5 leading-tight">{t.label}</p>
                </div>
              ))}
            </div>
          </div>

          {asTable ? (
            <TableView byClub={byClub} months={data.months || []} products={products} centers={centers} />
          ) : (
            <>
              <MonthlyTrend
                title="Retail Revenue by Month"
                months={data.months || []}
                valueKey="retailRevenue"
                format="int"
                seriesName="retail"
                subtitle="goods only"
              />

              <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
                <RankedBars
                  title="Retail Revenue by Club"
                  rows={byClub.map(c => ({ ...c, label: CLUB_LABEL(c.slug) }))}
                  labelKey="label" valueKey="retailRevenue" format="int"
                  secondary={c => (c.reliable
                    ? `${c.marginPct}% margin`
                    : `margin unavailable · ${c.costCoverage ?? 0}% costed`)}
                  emptyText="No retail sales in this selection."
                />
                <RankedBars
                  title="Top Products"
                  rows={top.map(p => ({ ...p, label: p.name }))}
                  labelKey="label" valueKey="revenue" format="int"
                  secondary={p => `${fmtInt(p.units)} units${p.marginPct === null ? '' : ` · ${p.marginPct}%`}`}
                  emptyText="No products sold in this selection."
                />
              </div>

              {/* The split made visible, so nobody has to take my word for it. */}
              <div className="bg-surface rounded-xl border border-border p-3 overflow-x-auto">
                <div className="flex items-baseline justify-between gap-3 mb-2">
                  <p className="text-xs font-bold text-text-primary">Profit Centres</p>
                  <p className="text-[11px] text-text-muted">retail carries a cost; pass-through does not</p>
                </div>
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-[11px] uppercase tracking-wide text-text-muted border-b border-border">
                      <th className="text-left font-semibold py-1.5">Profit Centre</th>
                      <th className="text-left font-semibold py-1.5">Stream</th>
                      <th className="text-right font-semibold py-1.5">Revenue</th>
                      <th className="text-right font-semibold py-1.5">Lines</th>
                      <th className="text-right font-semibold py-1.5">Lines Costed</th>
                    </tr>
                  </thead>
                  <tbody>
                    {centers.map((c, i) => (
                      <tr key={`${c.profitCenter}-${i}`} className="border-b border-border/60 last:border-0">
                        <td className="py-1.5 text-text-primary">{c.profitCenter}</td>
                        <td className="py-1.5">
                          <span className={`text-[10px] font-semibold rounded px-1.5 py-0.5 border ${
                            c.isRetail
                              ? 'text-wcs-red border-wcs-red/40'
                              : 'text-text-muted border-border'
                          }`}>
                            {c.isRetail ? 'retail' : 'pass-through'}
                          </span>
                        </td>
                        <td className="py-1.5 text-right tabular-nums text-text-primary">{fmtMoney(c.revenue)}</td>
                        <td className="py-1.5 text-right tabular-nums text-text-muted">{fmtInt(c.lines)}</td>
                        <td className="py-1.5 text-right tabular-nums text-text-muted">{pctOrDash(c.pctCosted)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              {(s.retailReturns !== 0 || s.passthroughReturns !== 0) && (
                <div className="bg-surface rounded-xl border border-border p-3">
                  <p className="text-xs font-bold text-text-primary mb-1">Returns</p>
                  <p className="text-[11px] text-text-muted mb-2">
                    Split by stream. Most refunds are reversed dues and account payments, not
                    product coming back, and one combined figure would read as a return rate on goods.
                  </p>
                  <div className="flex gap-6">
                    <div>
                      <p className="text-lg font-bold tabular-nums text-text-primary">{fmtMoney(s.retailReturns)}</p>
                      <p className="text-[11px] text-text-muted">Product returned</p>
                    </div>
                    <div>
                      <p className="text-lg font-bold tabular-nums text-text-muted">{fmtMoney(s.passthroughReturns)}</p>
                      <p className="text-[11px] text-text-muted">Pass-through refunded</p>
                    </div>
                  </div>
                </div>
              )}
            </>
          )}
        </>
      )}
    </div>
  )
}

function TableView({ byClub, months, products, centers }) {
  return (
    <div className="space-y-3">
      <div className="bg-surface rounded-xl border border-border p-3 overflow-x-auto">
        <p className="text-xs font-bold text-text-primary mb-2">By Club</p>
        <table className="w-full text-sm">
          <thead>
            <tr className="text-[11px] uppercase tracking-wide text-text-muted border-b border-border">
              <th className="text-left font-semibold py-1.5">Club</th>
              <th className="text-right font-semibold py-1.5">Retail</th>
              <th className="text-right font-semibold py-1.5">Gross Profit</th>
              <th className="text-right font-semibold py-1.5">Margin</th>
              <th className="text-right font-semibold py-1.5">Costed</th>
              <th className="text-right font-semibold py-1.5">Units</th>
              <th className="text-right font-semibold py-1.5">Pass-Through</th>
            </tr>
          </thead>
          <tbody>
            {byClub.map(c => (
              <tr key={c.slug} className="border-b border-border/60 last:border-0">
                <td className="py-1.5 text-text-primary">{CLUB_LABEL(c.slug)}</td>
                <td className="py-1.5 text-right tabular-nums text-text-primary">{fmtMoney(c.retailRevenue)}</td>
                <td className="py-1.5 text-right tabular-nums text-text-muted">
                  {c.grossProfit === null ? '—' : fmtMoney(c.grossProfit)}
                </td>
                <td className="py-1.5 text-right tabular-nums text-text-primary">{pctOrDash(c.marginPct)}</td>
                <td className={`py-1.5 text-right tabular-nums ${c.reliable ? 'text-text-muted' : 'text-amber-600'}`}>
                  {pctOrDash(c.costCoverage)}
                </td>
                <td className="py-1.5 text-right tabular-nums text-text-muted">{fmtInt(c.retailUnits)}</td>
                <td className="py-1.5 text-right tabular-nums text-text-muted">{fmtMoney(c.passthroughRevenue)}</td>
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
              <th className="text-right font-semibold py-1.5">Retail</th>
              <th className="text-right font-semibold py-1.5">Margin</th>
              <th className="text-right font-semibold py-1.5">Units</th>
              <th className="text-right font-semibold py-1.5">Pass-Through</th>
            </tr>
          </thead>
          <tbody>
            {months.map(m => (
              <tr key={m.month} className="border-b border-border/60 last:border-0">
                <td className="py-1.5 text-text-primary">{fmtMonth(m.month)}</td>
                <td className="py-1.5 text-right tabular-nums text-text-primary">{fmtMoney(m.retailRevenue)}</td>
                <td className="py-1.5 text-right tabular-nums text-text-muted">{pctOrDash(m.marginPct)}</td>
                <td className="py-1.5 text-right tabular-nums text-text-muted">{fmtInt(m.retailUnits)}</td>
                <td className="py-1.5 text-right tabular-nums text-text-muted">{fmtMoney(m.passthroughRevenue)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="bg-surface rounded-xl border border-border p-3 overflow-x-auto">
        <p className="text-xs font-bold text-text-primary mb-2">Products</p>
        <table className="w-full text-sm">
          <thead>
            <tr className="text-[11px] uppercase tracking-wide text-text-muted border-b border-border">
              <th className="text-left font-semibold py-1.5">Product</th>
              <th className="text-left font-semibold py-1.5">Profit Centre</th>
              <th className="text-right font-semibold py-1.5">Units</th>
              <th className="text-right font-semibold py-1.5">Revenue</th>
              <th className="text-right font-semibold py-1.5">Margin</th>
            </tr>
          </thead>
          <tbody>
            {products.map((p, i) => (
              <tr key={`${p.name}-${i}`} className="border-b border-border/60 last:border-0">
                <td className="py-1.5 text-text-primary">{p.name}</td>
                <td className="py-1.5 text-text-muted">{p.profitCenter}</td>
                <td className="py-1.5 text-right tabular-nums text-text-muted">{fmtInt(p.units)}</td>
                <td className="py-1.5 text-right tabular-nums text-text-primary">{fmtMoney(p.revenue)}</td>
                <td className="py-1.5 text-right tabular-nums text-text-muted">{pctOrDash(p.marginPct)}</td>
              </tr>
            ))}
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
