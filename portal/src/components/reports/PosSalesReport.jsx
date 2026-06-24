import { useState, useEffect, useMemo } from 'react'
import { getInventorySummary, getInventoryEmployeeSpend, getInventoryShrinkage } from '../../lib/api'
import { exportCSV } from '../../lib/export'

// POS Sales report — the financial views that used to live on the Inventory page.
// Three sub-tabs: Product Sales (retail), Employee Spend (staff purchases), and
// Shrinkage (physical-count variance → misplacement & theft). Date range +
// location come from the Reporting shell as props.

// --- helpers ---
function fmtMoney(v) {
  if (v === null || v === undefined) return '—'
  const n = Number(v)
  if (!Number.isFinite(n)) return '—'
  return n.toLocaleString('en-US', { style: 'currency', currency: 'USD' })
}
function fmtQty(v) {
  const n = Number(v)
  if (!Number.isFinite(n)) return '—'
  return Number.isInteger(n) ? String(n) : n.toFixed(2)
}
function fmtSigned(v) {
  if (v === null || v === undefined || !Number.isFinite(Number(v))) return '—'
  const n = Number(v)
  return (n > 0 ? '+' : '') + (Number.isInteger(n) ? String(n) : n.toFixed(2))
}
function fmtDateTime(iso) {
  if (!iso) return '—'
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return '—'
  return d.toLocaleString('en-US', { month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' })
}

// Sortable column header (desc → asc → none), mirrors the Inventory tables.
function SortHeader({ label, col, sort, onSort, align = 'right' }) {
  const active = sort?.col === col
  const arrow = !active ? '' : sort.dir === 'desc' ? ' ▾' : ' ▴'
  return (
    <th
      onClick={() => onSort(col)}
      className={`py-2.5 px-2 cursor-pointer select-none hover:text-text-primary ${align === 'left' ? 'text-left px-4' : 'text-right'} ${active ? 'text-text-primary' : ''}`}
    >
      {label}{arrow}
    </th>
  )
}

const SUB_TABS = [
  { key: 'sales', label: 'Product Sales' },
  { key: 'employee', label: 'Employee Spend' },
  { key: 'shrinkage', label: 'Shrinkage' },
]

const moneyClass = (n) => (Number(n) < 0 ? 'text-wcs-red font-semibold' : Number(n) > 0 ? 'text-emerald-600 font-semibold' : 'text-text-primary')

// Roll a list of { category, revenue, cogs } lines up into per-category revenue /
// COGS / profit / margin. cogs may be null for a line whose item has no cost on
// file — those lines still count toward revenue but flag the category so we can
// note that profit is overstated where cost is missing.
function rollupByCategory(items) {
  const m = new Map()
  for (const r of items) {
    const cat = r.category || 'Uncategorized'
    const e = m.get(cat) || { category: cat, revenue: 0, cogs: 0, anyNoCost: false }
    e.revenue += Number(r.revenue) || 0
    if (r.cogs == null) e.anyNoCost = true
    else e.cogs += Number(r.cogs) || 0
    m.set(cat, e)
  }
  return [...m.values()].map(e => ({
    category: e.category,
    revenue: +e.revenue.toFixed(2),
    cogs: +e.cogs.toFixed(2),
    profit: +(e.revenue - e.cogs).toFixed(2),
    margin_pct: e.revenue > 0 ? +(((e.revenue - e.cogs) / e.revenue) * 100).toFixed(1) : null,
    anyNoCost: e.anyNoCost,
  })).sort((a, b) => b.revenue - a.revenue)
}

// Shared by-category summary table (Product Sales + Employee Spend).
function CategoryTable({ rows, revenueLabel = 'Revenue' }) {
  if (!rows.length) return null
  const tot = rows.reduce((a, r) => ({ revenue: a.revenue + r.revenue, cogs: a.cogs + r.cogs, profit: a.profit + r.profit }), { revenue: 0, cogs: 0, profit: 0 })
  const totMargin = tot.revenue > 0 ? (tot.profit / tot.revenue) * 100 : null
  const someNoCost = rows.some(r => r.anyNoCost)
  return (
    <div className="bg-surface/95 backdrop-blur-sm rounded-xl border border-border overflow-hidden">
      <div className="px-4 py-2.5 border-b border-border bg-bg/40"><p className="text-xs font-bold uppercase tracking-wider text-text-muted">By Category</p></div>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-[10px] uppercase tracking-wider text-text-muted border-b border-border bg-bg/50">
              <th className="py-2.5 px-4">Category</th>
              <th className="py-2.5 px-2 text-right">{revenueLabel}</th>
              <th className="py-2.5 px-2 text-right">COGS</th>
              <th className="py-2.5 px-2 text-right">Profit</th>
              <th className="py-2.5 px-4 text-right">Margin</th>
            </tr>
          </thead>
          <tbody>
            {rows.map(r => (
              <tr key={r.category} className="border-b border-border/50 hover:bg-bg/40">
                <td className="py-2 px-4 font-medium text-text-primary">{r.category}{r.anyNoCost && <span className="ml-1 text-text-muted">*</span>}</td>
                <td className="py-2 px-2 text-right">{fmtMoney(r.revenue)}</td>
                <td className="py-2 px-2 text-right">{fmtMoney(r.cogs)}</td>
                <td className={`py-2 px-2 text-right ${moneyClass(r.profit)}`}>{fmtMoney(r.profit)}</td>
                <td className="py-2 px-4 text-right">
                  {r.margin_pct != null ? <span className={r.margin_pct < 0 ? 'text-wcs-red font-semibold' : 'text-emerald-600 font-semibold'}>{r.margin_pct}%</span> : '—'}
                </td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr className="border-t border-border bg-bg/40 font-semibold">
              <td className="py-2 px-4 text-text-primary">Total</td>
              <td className="py-2 px-2 text-right">{fmtMoney(tot.revenue)}</td>
              <td className="py-2 px-2 text-right">{fmtMoney(tot.cogs)}</td>
              <td className={`py-2 px-2 text-right ${moneyClass(tot.profit)}`}>{fmtMoney(tot.profit)}</td>
              <td className="py-2 px-4 text-right">{totMargin != null ? `${totMargin.toFixed(1)}%` : '—'}</td>
            </tr>
          </tfoot>
        </table>
      </div>
      {someNoCost && (
        <p className="text-xs text-text-muted px-4 py-2.5 border-t border-border">* Some items in this category have no cost on file — COGS and profit exclude them, so profit is overstated there.</p>
      )}
    </div>
  )
}

export default function PosSalesReport({ startDate, endDate, locationSlug }) {
  const [subTab, setSubTab] = useState('sales')
  const [search, setSearch] = useState('')
  const [salesSort, setSalesSort] = useState(null)

  const [summary, setSummary] = useState(null)
  const [empSpend, setEmpSpend] = useState(null)
  const [shrinkage, setShrinkage] = useState(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  const allLoc = locationSlug === 'all' || !locationSlug
  const params = useMemo(
    () => ({ location_slug: allLoc ? '' : locationSlug, from: startDate, to: endDate }),
    [allLoc, locationSlug, startDate, endDate]
  )

  // Invalidate cached tab data whenever the date range / location changes so a
  // stale tab doesn't flash old numbers when revisited.
  useEffect(() => { setSummary(null); setEmpSpend(null); setShrinkage(null) }, [params])

  useEffect(() => {
    let ignore = false
    const need =
      (subTab === 'sales' && summary === null) ||
      (subTab === 'employee' && empSpend === null) ||
      (subTab === 'shrinkage' && shrinkage === null)
    if (!need) return
    setLoading(true); setError('')
    const fetcher =
      subTab === 'sales' ? getInventorySummary(params).then(r => { if (!ignore) setSummary(r.summary || []) })
      : subTab === 'employee' ? getInventoryEmployeeSpend(params).then(r => { if (!ignore) setEmpSpend(r) })
      : getInventoryShrinkage(params).then(r => { if (!ignore) setShrinkage(r) })
    fetcher.catch(err => { if (!ignore) setError(err.message) }).finally(() => { if (!ignore) setLoading(false) })
    return () => { ignore = true }
  }, [subTab, params, summary, empSpend, shrinkage])

  function cycleSalesSort(col) {
    setSalesSort(s => (!s || s.col !== col ? { col, dir: 'desc' } : s.dir === 'desc' ? { col, dir: 'asc' } : null))
  }

  // On the All-Clubs view, blend the same product (same UPC) across clubs into a
  // single line: units / revenue / COGS sum; COGS is only "known" if every club's
  // contribution had a cost. Single-club view is already one row per item.
  const consolidatedSummary = useMemo(() => {
    if (!summary) return []
    if (!allLoc) return summary
    const byProduct = new Map()
    for (const r of summary) {
      const key = r.upc ? `upc:${r.upc}` : (r.item_id ? `id:${r.item_id}` : `un:${r.name}`)
      const e = byProduct.get(key) || { item_id: r.item_id, name: r.name, upc: r.upc, category: r.category || null, units: 0, revenue: 0, cogs: 0, cogsKnown: true }
      e.units += Number(r.units) || 0
      e.revenue += Number(r.revenue) || 0
      if (r.cogs == null) { if ((Number(r.units) || 0) !== 0) e.cogsKnown = false }
      else e.cogs += Number(r.cogs)
      if (!e.category && r.category) e.category = r.category
      byProduct.set(key, e)
    }
    return [...byProduct.values()].map(e => ({
      item_id: e.item_id, name: e.name, upc: e.upc, category: e.category,
      units: +e.units.toFixed(2),
      revenue: +e.revenue.toFixed(2),
      cogs: e.cogsKnown ? +e.cogs.toFixed(2) : null,
      profit: e.cogsKnown ? +(e.revenue - e.cogs).toFixed(2) : null,
      margin_pct: e.cogsKnown && e.revenue > 0 ? +(((e.revenue - e.cogs) / e.revenue) * 100).toFixed(1) : null,
    }))
  }, [summary, allLoc])

  // Product Sales by-category rollup (top summary).
  const salesCategoryRollup = useMemo(() => rollupByCategory(consolidatedSummary), [consolidatedSummary])

  // Employee Spend by-category rollup. Revenue = staff spend; per-row COGS =
  // spend − profit where profit is known (else the item has no cost on file).
  const empCategoryRollup = useMemo(() => {
    if (!empSpend) return []
    return rollupByCategory(empSpend.rows.map(r => ({
      category: r.category,
      revenue: Number(r.emp_spend) || 0,
      cogs: r.profit != null ? (Number(r.emp_spend) || 0) - Number(r.profit) : null,
    })))
  }, [empSpend])

  // Product Sales: search + sort over the consolidated rows.
  const displaySummary = useMemo(() => {
    const q = search.trim().toLowerCase()
    let rows = q ? consolidatedSummary.filter(r => (r.name || '').toLowerCase().includes(q) || (r.upc || '').includes(q)) : consolidatedSummary.slice()
    if (salesSort) {
      const getters = {
        name: r => (r.name || '').toLowerCase(),
        units: r => Number(r.units),
        revenue: r => Number(r.revenue),
        cogs: r => (r.cogs == null ? null : Number(r.cogs)),
        profit: r => (r.profit == null ? null : Number(r.profit)),
        margin: r => (r.margin_pct == null ? null : Number(r.margin_pct)),
      }
      const get = getters[salesSort.col]
      const dir = salesSort.dir === 'asc' ? 1 : -1
      rows.sort((a, b) => {
        const av = get(a), bv = get(b)
        if (av == null && bv == null) return 0
        if (av == null) return 1
        if (bv == null) return -1
        if (typeof av === 'string') return dir * av.localeCompare(bv)
        return dir * (av - bv)
      })
    }
    return rows
  }, [consolidatedSummary, search, salesSort])

  const rangeLabel = `${startDate}_to_${endDate}`

  function exportSales() {
    exportCSV(
      [['Item', 'Units', 'Revenue', 'COGS', 'Profit', 'Margin %'],
        ...displaySummary.map(r => [r.name, r.units, r.revenue, r.cogs ?? '', r.profit ?? '', r.margin_pct ?? ''])],
      `pos-sales-${rangeLabel}`
    )
  }
  function exportEmployee() {
    if (!empSpend) return
    exportCSV(
      [['Item', 'Club', 'Category', 'Units', 'Purchases', 'Catalog', 'Emp Disc %', 'Emp Price', 'Cost', 'Margin %', 'Spend', 'Profit'],
        ...empSpend.rows.map(r => [r.item_name, r.location_slug || '', r.category || '', r.units, r.purchases, r.abc_unit_price, r.emp_discount_pct, r.emp_price, r.unit_cost, r.margin_pct ?? '', r.emp_spend, r.profit ?? ''])],
      `employee-spend-${rangeLabel}`
    )
  }
  function exportShrinkage() {
    if (!shrinkage) return
    exportCSV(
      [['Date', 'Item', 'Club', 'Counted By', 'Expected', 'Counted', 'Net Units', 'Unit Cost', 'Impact', 'Note'],
        ...shrinkage.events.map(e => [fmtDateTime(e.occurred_at), e.item_name || '', e.location_slug || '', e.created_by_name || '', e.expected ?? '', e.counted ?? '', e.delta, e.unit_cost ?? '', e.impact ?? '', e.note || ''])],
      `shrinkage-${rangeLabel}`
    )
  }

  return (
    <div className="space-y-4">
      {/* Sub-tab switcher + per-tab export */}
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div className="flex gap-1 bg-bg rounded-lg p-1">
          {SUB_TABS.map(t => (
            <button key={t.key} onClick={() => setSubTab(t.key)}
              className={`px-3 py-1.5 rounded-md text-xs font-medium transition-colors ${subTab === t.key ? 'bg-white text-text-primary shadow-sm' : 'text-text-muted hover:text-text-primary'}`}>
              {t.label}
            </button>
          ))}
        </div>
        <div className="flex items-center gap-2">
          {subTab === 'sales' && (
            <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Name or UPC..."
              className="px-3 py-1.5 rounded-lg border border-border bg-bg text-text-primary text-sm focus:outline-none focus:ring-2 focus:ring-wcs-red w-48" />
          )}
          <button
            onClick={subTab === 'sales' ? exportSales : subTab === 'employee' ? exportEmployee : exportShrinkage}
            className="px-3 py-1.5 rounded-lg text-xs font-semibold border border-border bg-bg text-text-muted hover:text-text-primary transition-colors">
            Export CSV
          </button>
        </div>
      </div>

      {error && <p className="text-sm text-wcs-red bg-surface border border-border rounded-lg px-3 py-2">{error}</p>}

      {/* === Product Sales === */}
      {subTab === 'sales' && (
        <div className="space-y-4">
        {salesCategoryRollup.length > 0 && <CategoryTable rows={salesCategoryRollup} />}
        <div className="bg-surface/95 backdrop-blur-sm rounded-xl border border-border overflow-hidden">
          {loading && summary === null ? (
            <p className="text-sm text-text-muted p-6 text-center">Crunching numbers...</p>
          ) : !summary || summary.length === 0 ? (
            <p className="text-sm text-text-muted p-6 text-center">No sales in this range yet.</p>
          ) : displaySummary.length === 0 ? (
            <p className="text-sm text-text-muted p-6 text-center">No items match your search.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-[10px] uppercase tracking-wider text-text-muted border-b border-border bg-bg/50">
                    <SortHeader label="Item" col="name" sort={salesSort} onSort={cycleSalesSort} align="left" />
                    <SortHeader label="Units" col="units" sort={salesSort} onSort={cycleSalesSort} />
                    <SortHeader label="Revenue" col="revenue" sort={salesSort} onSort={cycleSalesSort} />
                    <SortHeader label="COGS" col="cogs" sort={salesSort} onSort={cycleSalesSort} />
                    <SortHeader label="Profit" col="profit" sort={salesSort} onSort={cycleSalesSort} />
                    <SortHeader label="Margin" col="margin" sort={salesSort} onSort={cycleSalesSort} />
                  </tr>
                </thead>
                <tbody>
                  {displaySummary.map((r, idx) => (
                    <tr key={r.item_id || idx} className="border-b border-border/50 hover:bg-bg/40">
                      <td className="py-2 px-4 font-medium text-text-primary">
                        {r.name}
                        {!r.item_id && <span className="ml-2 text-[10px] font-bold uppercase text-text-muted">(unmatched)</span>}
                      </td>
                      <td className="py-2 px-2 text-right">{fmtQty(r.units)}</td>
                      <td className="py-2 px-2 text-right">{fmtMoney(r.revenue)}</td>
                      <td className="py-2 px-2 text-right">{r.cogs != null ? fmtMoney(r.cogs) : <span className="text-text-muted text-xs">no cost data</span>}</td>
                      <td className="py-2 px-2 text-right font-semibold">{r.profit != null ? fmtMoney(r.profit) : '—'}</td>
                      <td className="py-2 px-4 text-right">
                        {r.margin_pct != null
                          ? <span className={r.margin_pct < 0 ? 'text-wcs-red font-semibold' : 'text-emerald-600 font-semibold'}>{r.margin_pct}%</span>
                          : '—'}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          {summary && summary.length > 0 && summary.some(r => r.cogs == null) && (
            <p className="text-xs text-text-muted px-4 py-3 border-t border-border">
              Items showing "no cost data" need a received invoice to establish their unit cost.
            </p>
          )}
        </div>
        </div>
      )}

      {/* === Employee Spend === */}
      {subTab === 'employee' && (
        <>
          {loading && empSpend === null && <p className="text-sm text-text-muted bg-surface rounded-xl border border-border p-6 text-center">Loading employee spend...</p>}
          {empSpend && (
            <>
              <div className="bg-surface/95 backdrop-blur-sm rounded-xl border border-border p-4 flex flex-wrap items-center gap-x-5 gap-y-2">
                <p className="text-sm text-text-primary"><span className="font-bold">{empSpend.rows.length}</span> items bought by staff</p>
                <span className="text-xs text-text-muted">{empSpend.buyers} staff member account(s)</span>
                <span className="text-[11px] text-text-muted">Employee price = catalog × (1 − discount); margin uses item cost.</span>
                <span className="ml-auto text-sm text-text-primary">Spend: <span className="font-bold">{fmtMoney(empSpend.totals.spend)}</span></span>
                <span className="text-sm text-text-primary">Profit: <span className="font-bold">{empSpend.totals.profit != null ? fmtMoney(empSpend.totals.profit) : '—'}</span></span>
              </div>

              {empCategoryRollup.length > 0 && <div className="mt-4"><CategoryTable rows={empCategoryRollup} revenueLabel="Spend" /></div>}

              <div className="bg-surface/95 backdrop-blur-sm rounded-xl border border-border overflow-hidden mt-4">
                {empSpend.rows.length === 0 ? (
                  <p className="text-sm text-text-muted p-8 text-center">No staff purchases in this date range.</p>
                ) : (
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="text-left text-[10px] uppercase tracking-wider text-text-muted border-b border-border bg-bg/50">
                          <th className="py-2.5 px-4">Item</th>
                          {allLoc && <th className="py-2.5 px-2">Club</th>}
                          <th className="py-2.5 px-2">Category</th>
                          <th className="py-2.5 px-2 text-right">Units</th>
                          <th className="py-2.5 px-2 text-right">Purchases</th>
                          <th className="py-2.5 px-2 text-right">Catalog</th>
                          <th className="py-2.5 px-2 text-right">Emp&nbsp;Disc</th>
                          <th className="py-2.5 px-2 text-right">Emp&nbsp;Price</th>
                          <th className="py-2.5 px-2 text-right">Cost</th>
                          <th className="py-2.5 px-2 text-right">Margin</th>
                          <th className="py-2.5 px-2 text-right">Spend</th>
                          <th className="py-2.5 px-4 text-right">Profit</th>
                        </tr>
                      </thead>
                      <tbody>
                        {empSpend.rows.map(r => (
                          <tr key={r.item_id} className="border-b border-border/50 hover:bg-bg/40">
                            <td className="py-2 px-4 font-medium text-text-primary">{r.item_name}</td>
                            {allLoc && <td className="py-2 px-2 capitalize text-text-muted">{r.location_slug || '—'}</td>}
                            <td className="py-2 px-2 text-text-muted">{r.category || '—'}</td>
                            <td className="py-2 px-2 text-right font-semibold text-text-primary">{fmtQty(r.units)}</td>
                            <td className="py-2 px-2 text-right text-text-muted">{r.purchases}</td>
                            <td className="py-2 px-2 text-right">{fmtMoney(r.abc_unit_price)}</td>
                            <td className="py-2 px-2 text-right text-text-muted">{r.emp_discount_pct}%</td>
                            <td className="py-2 px-2 text-right">{fmtMoney(r.emp_price)}</td>
                            <td className="py-2 px-2 text-right">{fmtMoney(r.unit_cost)}</td>
                            <td className="py-2 px-2 text-right">
                              {r.margin_pct != null
                                ? <span className={r.margin_pct < 0 ? 'text-wcs-red font-semibold' : 'text-emerald-600 font-semibold'}>{r.margin_pct}%</span>
                                : '—'}
                            </td>
                            <td className="py-2 px-2 text-right">{fmtMoney(r.emp_spend)}</td>
                            <td className="py-2 px-4 text-right">{r.profit != null ? fmtMoney(r.profit) : '—'}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            </>
          )}
        </>
      )}

      {/* === Shrinkage === */}
      {subTab === 'shrinkage' && (
        <>
          {loading && shrinkage === null && <p className="text-sm text-text-muted bg-surface rounded-xl border border-border p-6 text-center">Tallying count variances...</p>}
          {shrinkage && (
            <div className="space-y-4">
              {/* Summary cards */}
              <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
                <div className="bg-surface rounded-xl border border-border p-4">
                  <p className="text-xs font-semibold text-text-muted uppercase tracking-wide">Net Variance</p>
                  <p className={`text-2xl font-bold mt-1 ${moneyClass(shrinkage.totals.net_value)}`}>{fmtMoney(shrinkage.totals.net_value)}</p>
                </div>
                <div className="bg-surface rounded-xl border border-border p-4">
                  <p className="text-xs font-semibold text-text-muted uppercase tracking-wide">Shrink (loss)</p>
                  <p className="text-2xl font-bold mt-1 text-wcs-red">{fmtMoney(shrinkage.totals.shrink_value)}</p>
                </div>
                <div className="bg-surface rounded-xl border border-border p-4">
                  <p className="text-xs font-semibold text-text-muted uppercase tracking-wide">Found (extra)</p>
                  <p className="text-2xl font-bold mt-1 text-emerald-600">{fmtMoney(shrinkage.totals.found_value)}</p>
                </div>
                <div className="bg-surface rounded-xl border border-border p-4">
                  <p className="text-xs font-semibold text-text-muted uppercase tracking-wide">Count Events</p>
                  <p className="text-2xl font-bold mt-1 text-text-primary">{shrinkage.totals.events}</p>
                </div>
              </div>

              {shrinkage.totals.no_cost_events > 0 && (
                <p className="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">
                  {shrinkage.totals.no_cost_events} count event{shrinkage.totals.no_cost_events === 1 ? ' is' : 's are'} on items with no cost on file — their dollar impact is not included in the totals above.
                </p>
              )}

              {shrinkage.totals.events === 0 ? (
                <p className="text-sm text-text-muted bg-surface rounded-xl border border-border p-8 text-center">No physical counts recorded in this date range.</p>
              ) : (
                <>
                  {/* By Employee */}
                  <div className="bg-surface/95 backdrop-blur-sm rounded-xl border border-border overflow-hidden">
                    <div className="px-4 py-2.5 border-b border-border bg-bg/40"><p className="text-xs font-bold uppercase tracking-wider text-text-muted">By Employee</p></div>
                    <div className="overflow-x-auto">
                      <table className="w-full text-sm">
                        <thead>
                          <tr className="text-left text-[10px] uppercase tracking-wider text-text-muted border-b border-border bg-bg/50">
                            <th className="py-2.5 px-4">Counted By</th>
                            <th className="py-2.5 px-2 text-right">Counts</th>
                            <th className="py-2.5 px-2 text-right">Net Units</th>
                            <th className="py-2.5 px-2 text-right">Shrink $</th>
                            <th className="py-2.5 px-4 text-right">Net $</th>
                          </tr>
                        </thead>
                        <tbody>
                          {shrinkage.by_employee.map(e => (
                            <tr key={e.name} className="border-b border-border/50 hover:bg-bg/40">
                              <td className="py-2 px-4 font-medium text-text-primary">{e.name}</td>
                              <td className="py-2 px-2 text-right text-text-muted">{e.events}</td>
                              <td className={`py-2 px-2 text-right ${moneyClass(e.net_units)}`}>{fmtSigned(e.net_units)}</td>
                              <td className="py-2 px-2 text-right text-wcs-red font-semibold">{e.shrink_value < 0 ? fmtMoney(e.shrink_value) : '—'}</td>
                              <td className={`py-2 px-4 text-right ${moneyClass(e.net_value)}`}>{fmtMoney(e.net_value)}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>

                  {/* By Item */}
                  <div className="bg-surface/95 backdrop-blur-sm rounded-xl border border-border overflow-hidden">
                    <div className="px-4 py-2.5 border-b border-border bg-bg/40"><p className="text-xs font-bold uppercase tracking-wider text-text-muted">By Item</p></div>
                    <div className="overflow-x-auto">
                      <table className="w-full text-sm">
                        <thead>
                          <tr className="text-left text-[10px] uppercase tracking-wider text-text-muted border-b border-border bg-bg/50">
                            <th className="py-2.5 px-4">Item</th>
                            {allLoc && <th className="py-2.5 px-2">Club</th>}
                            <th className="py-2.5 px-2 text-right">Counts</th>
                            <th className="py-2.5 px-2 text-right">Net Units</th>
                            <th className="py-2.5 px-4 text-right">Net $</th>
                          </tr>
                        </thead>
                        <tbody>
                          {shrinkage.by_item.map(i => (
                            <tr key={i.item_id} className="border-b border-border/50 hover:bg-bg/40">
                              <td className="py-2 px-4 font-medium text-text-primary">{i.item_name || '—'}</td>
                              {allLoc && <td className="py-2 px-2 capitalize text-text-muted">{i.location_slug || '—'}</td>}
                              <td className="py-2 px-2 text-right text-text-muted">{i.events}</td>
                              <td className={`py-2 px-2 text-right ${moneyClass(i.net_units)}`}>{fmtSigned(i.net_units)}</td>
                              <td className={`py-2 px-4 text-right ${moneyClass(i.net_value)}`}>{fmtMoney(i.net_value)}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>

                  {/* Event log */}
                  <div className="bg-surface/95 backdrop-blur-sm rounded-xl border border-border overflow-hidden">
                    <div className="px-4 py-2.5 border-b border-border bg-bg/40"><p className="text-xs font-bold uppercase tracking-wider text-text-muted">Count Log</p></div>
                    <div className="overflow-x-auto">
                      <table className="w-full text-sm">
                        <thead>
                          <tr className="text-left text-[10px] uppercase tracking-wider text-text-muted border-b border-border bg-bg/50">
                            <th className="py-2.5 px-4">When</th>
                            <th className="py-2.5 px-2">Item</th>
                            {allLoc && <th className="py-2.5 px-2">Club</th>}
                            <th className="py-2.5 px-2">Counted By</th>
                            <th className="py-2.5 px-2 text-right">Expected</th>
                            <th className="py-2.5 px-2 text-right">Counted</th>
                            <th className="py-2.5 px-2 text-right">Δ Units</th>
                            <th className="py-2.5 px-4 text-right">$ Impact</th>
                          </tr>
                        </thead>
                        <tbody>
                          {shrinkage.events.map(e => (
                            <tr key={e.id} className="border-b border-border/50 hover:bg-bg/40">
                              <td className="py-2 px-4 text-text-muted whitespace-nowrap">{fmtDateTime(e.occurred_at)}</td>
                              <td className="py-2 px-2 font-medium text-text-primary">
                                {e.item_name || '—'}
                                {e.note && <span className="block text-[11px] text-text-muted font-normal">{e.note}</span>}
                              </td>
                              {allLoc && <td className="py-2 px-2 capitalize text-text-muted">{e.location_slug || '—'}</td>}
                              <td className="py-2 px-2 text-text-muted">{e.created_by_name || '—'}</td>
                              <td className="py-2 px-2 text-right text-text-muted">{fmtQty(e.expected)}</td>
                              <td className="py-2 px-2 text-right text-text-primary">{fmtQty(e.counted)}</td>
                              <td className={`py-2 px-2 text-right ${moneyClass(e.delta)}`}>{fmtSigned(e.delta)}</td>
                              <td className={`py-2 px-4 text-right ${e.impact == null ? 'text-text-muted' : moneyClass(e.impact)}`}>
                                {e.impact == null ? 'no cost' : fmtMoney(e.impact)}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>
                </>
              )}
            </div>
          )}
        </>
      )}
    </div>
  )
}
