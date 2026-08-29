import { useEffect, useMemo, useState } from 'react'
import { createPortal } from 'react-dom'
import { api } from '../../lib/api'
import { useCancellableFetch } from '../../hooks/useCancellableFetch'
import DesktopLoading from '../DesktopLoading'
import { fmtInt, fmtMoney, fmtMonth } from './chartPalette'
import { MultiTrend, RankedBars, zebraColumn } from './charts'
import { TOOLBAR_SLOT_ID } from './toolbarSlot'
import { LOCATION_NAMES } from '../../config/locations'

// ---------------------------------------------------------------------------
// POS Sales — Analytics (admin only)
//
// GOODS ONLY: Drinks, Snacks, Supplements, Merchandise.
//
// Pass-through — dues, personal training, guest fees, club account payments —
// is gone from this report entirely. It is real money and belongs on a revenue
// report, but it is eight times the size of the thing being managed here, and
// any figure that mixed it in described nothing anyone can act on.
//
// A MARGIN IS LEFT BLANK RATHER THAN GUESSED. Cost coverage varies by category
// (Supplements 90%, Merchandise 46%), and a margin computed as though missing
// costs were zero reads as near-100%. Where coverage is too thin the number is
// withheld and the reason given.
// ---------------------------------------------------------------------------

// Proper names from the shared config, so a rename lands everywhere at once.
const CLUB_NAMES = Object.fromEntries(LOCATION_NAMES.map(n => [n.toLowerCase(), n]))
const CLUB_LABEL = s => (s ? (CLUB_NAMES[s] || s.charAt(0).toUpperCase() + s.slice(1)) : s)

const pctOrDash = v => (v === null || v === undefined ? '—' : `${v}%`)

export default function PosSales({ startDate, endDate, locationSlug }) {
  const [asTable, setAsTable] = useState(false)
  // null means "default", which is revenue descending — the question most
  // people arrive with. Clicking a header cycles most-to-least, least-to-most,
  // then back here, so there is always a way back to the view you started on
  // without reloading.
  const [sort, setSort] = useState(null)

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
  const items = data?.items || []

  const top = useMemo(() => products.slice(0, 12), [products])

  const sortedItems = useMemo(() => {
    const rows = items.slice()
    // The default: biggest sellers first.
    const active = sort || { key: 'revenue', dir: 'desc' }
    const mul = active.dir === 'asc' ? 1 : -1
    rows.sort((a, b) => {
      const av = a[active.key]
      const bv = b[active.key]
      // Nulls always sink, whichever way the column is sorted: an item with no
      // recorded cost is not the cheapest item, and it must not head the list.
      if (av === null || av === undefined) return 1
      if (bv === null || bv === undefined) return -1
      if (typeof av === 'string') return mul * av.localeCompare(bv)
      return mul * (av - bv)
    })
    return rows
  }, [items, sort])

  /**
   * Three positions, not two: most-to-least, least-to-most, then back to the
   * default. A two-way toggle strands you in a sort you did not want with no
   * way back to the original order.
   */
  const toggleSort = (key) => setSort(prev => {
    if (!prev || prev.key !== key) return { key, dir: 'desc' }
    if (prev.dir === 'desc') return { key, dir: 'asc' }
    return null
  })

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
          {data.notes?.coverage && (
            <div className="bg-surface rounded-xl border border-amber-500/40 p-3">
              <p className="text-[11px] text-amber-600">{data.notes.coverage}</p>
            </div>
          )}

          <div className="bg-surface rounded-xl border border-border overflow-x-auto">
            <div className="flex min-w-max divide-x divide-border">
              {[
                { label: 'Revenue', value: fmtMoney(s.retailRevenue) },
                { label: 'Gross Profit', value: s.grossProfit === null || s.grossProfit === undefined ? '—' : fmtMoney(s.grossProfit) },
                { label: 'Margin', value: pctOrDash(s.marginPct) },
                { label: 'Units Sold', value: fmtInt(s.retailUnits) },
                { label: 'Items Sold', value: fmtInt(items.length), muted: true },
                {
                  label: `vs ${data.meta?.comparisonLabel || 'prior'}`,
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
            <TableView byClub={byClub} months={data.months || []} products={products} />
          ) : (
            <>
              {/* One line per category. The total alone hides that Drinks
                  moves on volume and Supplements on price. */}
              <MultiTrend
                title="Revenue by Category"
                months={data.categoryMonths || []}
                series={data.categorySeries || []}
                format="int"
                subtitle={`${(data.categorySeries || []).length} categories`}
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

              {s.retailReturns !== 0 && (
                <div className="bg-surface rounded-xl border border-border p-3">
                  <p className="text-xs font-bold text-text-primary mb-1">Product Returned</p>
                  <p className="text-lg font-bold tabular-nums text-text-primary">{fmtMoney(s.retailReturns)}</p>
                  <p className="text-[11px] text-text-muted mt-0.5">
                    Goods only. Refunded dues and account payments are not on this report.
                  </p>
                </div>
              )}

              <ItemTable rows={sortedItems} sort={sort} onSort={toggleSort} />

            </>
          )}
        </>
      )}
    </div>
  )
}


// Sortable columns. Every header is a button so the sort is reachable by
// keyboard and announces its direction, rather than being a click target only a
// mouse can find.
const ITEM_COLUMNS = [
  { key: 'name', label: 'Item', align: 'left' },
  { key: 'profitCenter', label: 'Category', align: 'left' },
  { key: 'unitCost', label: 'Cost', align: 'right' },
  { key: 'unitPrice', label: 'Sales Price', align: 'right' },
  { key: 'marginPct', label: 'Margin', align: 'right' },
  { key: 'units', label: 'Units Sold', align: 'right' },
  { key: 'revenue', label: 'Revenue', align: 'right' },
]

// Zebra by COLUMN, not by row. Reading this table means running an eye down a
// column — cost against price, or margin against units — and row stripes work
// against that by tying neighbouring columns together.
//
// The first attempt used `bg-bg/40`, which rendered nothing: in one theme
// --color-bg is #ffffff, identical to --color-surface. zebraColumn uses a
// neutral grey alpha that shows on any surface.

function ItemTable({ rows, sort, onSort }) {
  return (
    <div className="bg-surface rounded-xl border border-border p-3 overflow-x-auto">
      <div className="flex items-baseline justify-between gap-3 mb-2">
        <p className="text-xs font-bold text-text-primary">Items</p>
        <p className="text-[11px] text-text-muted">
          click a column to sort: most, least, then back to default
        </p>
      </div>
      <table className="w-full text-sm">
        <thead>
          <tr className="text-[11px] uppercase tracking-wide text-text-muted border-b border-border">
            {ITEM_COLUMNS.map((c, i) => {
              const active = sort && sort.key === c.key
              return (
                <th
                  key={c.key}
                  className={`py-1.5 px-2 font-semibold ${c.align === 'right' ? 'text-right' : 'text-left'}`}
                  style={zebraColumn(i)}
                >
                  <button
                    type="button"
                    onClick={() => onSort(c.key)}
                    className={`inline-flex items-center gap-1 uppercase tracking-wide transition-colors ${
                      active ? 'text-text-primary' : 'hover:text-text-primary'
                    }`}
                    aria-sort={active ? (sort.dir === 'asc' ? 'ascending' : 'descending') : 'none'}
                    title={active
                      ? (sort.dir === 'desc' ? 'Sort least to most' : 'Back to default')
                      : 'Sort most to least'}
                  >
                    {c.label}
                    {/* Only the active column shows an arrow. Reserving space on
                        every header would push the numbers off their alignment. */}
                    {active && <span aria-hidden="true">{sort.dir === 'asc' ? '\u25B2' : '\u25BC'}</span>}
                  </button>
                </th>
              )
            })}
          </tr>
        </thead>
        <tbody>
          {rows.map((r, ri) => (
            <tr key={`${r.name}-${r.profitCenter}-${ri}`} className="border-b border-border/60 last:border-0">
              <td className="py-1.5 px-2 text-text-primary" style={zebraColumn(0)}>{r.name}</td>
              <td className="py-1.5 px-2 text-text-muted" style={zebraColumn(1)}>
                {String(r.profitCenter || '').replace(/^WCS /, '')}
              </td>
              <td className="py-1.5 px-2 text-right tabular-nums text-text-muted" style={zebraColumn(2)}>
                {r.unitCost === null ? '—' : fmtMoney(r.unitCost)}
              </td>
              <td className="py-1.5 px-2 text-right tabular-nums text-text-muted" style={zebraColumn(3)}>
                {r.unitPrice === null ? '—' : fmtMoney(r.unitPrice)}
              </td>
              <td className="py-1.5 px-2 text-right tabular-nums text-text-primary" style={zebraColumn(4)}>
                {r.marginPct === null ? '—' : `${r.marginPct}%`}
              </td>
              <td className="py-1.5 px-2 text-right tabular-nums text-text-muted" style={zebraColumn(5)}>{fmtInt(r.units)}</td>
              <td className="py-1.5 px-2 text-right tabular-nums text-text-primary font-semibold" style={zebraColumn(6)}>
                {fmtMoney(r.revenue)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {rows.length === 0 && <p className="text-sm text-text-muted text-center py-8">No items sold in this selection.</p>}
    </div>
  )
}

function TableView({ byClub, months, products }) {
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
            </tr>
          </thead>
          <tbody>
            {months.map(m => (
              <tr key={m.month} className="border-b border-border/60 last:border-0">
                <td className="py-1.5 text-text-primary">{fmtMonth(m.month)}</td>
                <td className="py-1.5 text-right tabular-nums text-text-primary">{fmtMoney(m.retailRevenue)}</td>
                <td className="py-1.5 text-right tabular-nums text-text-muted">{pctOrDash(m.marginPct)}</td>
                <td className="py-1.5 text-right tabular-nums text-text-muted">{fmtInt(m.retailUnits)}</td>
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
              <th className="text-left font-semibold py-1.5">Category</th>
              <th className="text-right font-semibold py-1.5">Units</th>
              <th className="text-right font-semibold py-1.5">Revenue</th>
              <th className="text-right font-semibold py-1.5">Margin</th>
            </tr>
          </thead>
          <tbody>
            {products.map((p, i) => (
              <tr key={`${p.name}-${i}`} className="border-b border-border/60 last:border-0">
                <td className="py-1.5 text-text-primary">{p.name}</td>
                <td className="py-1.5 text-text-muted">{String(p.profitCenter || '').replace(/^WCS /, '')}</td>
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
