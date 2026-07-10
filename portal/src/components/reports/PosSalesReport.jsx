import { useState, useEffect, useMemo, Fragment } from 'react'
import { getInventorySummary, getInventoryEmployeeSpend, getInventoryShrinkage, getInventoryCompliance, getInventoryComplianceActivity } from '../../lib/api'
import { exportCSV } from '../../lib/export'

// POS Sales report — the financial views that used to live on the Inventory page.
// Four sub-tabs: Product Sales (retail), Employee Spend (staff purchases),
// Shrinkage (physical-count variance → misplacement & theft), and Compliance.
// Date range + location come from the Reporting shell as props.

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

// --- sorting ---
// Every table on this report is click-to-sort. A column getter returns a number,
// a lowercased string, or null (nulls always sort to the bottom). `null` sort
// state means "server / natural order".
const num = (v) => (v == null || !Number.isFinite(Number(v)) ? null : Number(v))
const ts = (v) => { if (!v) return null; const t = new Date(v).getTime(); return Number.isNaN(t) ? null : t }

function useSortState(initial = null) {
  const [sort, setSort] = useState(initial)
  // desc → asc → off, then back to desc on the next click.
  const cycle = (col) => setSort(s => (!s || s.col !== col ? { col, dir: 'desc' } : s.dir === 'desc' ? { col, dir: 'asc' } : null))
  return [sort, cycle]
}

function sortRows(rows, sort, getters) {
  if (!sort || !getters[sort.col]) return rows
  const get = getters[sort.col]
  const dir = sort.dir === 'asc' ? 1 : -1
  return rows.slice().sort((a, b) => {
    const av = get(a), bv = get(b)
    if (av == null && bv == null) return 0
    if (av == null) return 1
    if (bv == null) return -1
    if (typeof av === 'string') return dir * av.localeCompare(bv)
    return dir * (av - bv)
  })
}

const CATEGORY_GETTERS = {
  category: r => (r.category || '').toLowerCase(),
  revenue: r => num(r.revenue),
  cogs: r => num(r.cogs),
  profit: r => num(r.profit),
  margin: r => num(r.margin_pct),
}
const SALES_GETTERS = {
  name: r => (r.name || '').toLowerCase(),
  units: r => num(r.units),
  revenue: r => num(r.revenue),
  cogs: r => num(r.cogs),
  profit: r => num(r.profit),
  margin: r => num(r.margin_pct),
}
const EMP_GETTERS = {
  name: r => (r.item_name || '').toLowerCase(),
  club: r => (r.location_slug || '').toLowerCase(),
  category: r => (r.category || '').toLowerCase(),
  units: r => num(r.units),
  purchases: r => num(r.purchases),
  catalog: r => num(r.abc_unit_price),
  empdisc: r => num(r.emp_discount_pct),
  empprice: r => num(r.emp_price),
  cost: r => num(r.unit_cost),
  margin: r => num(r.margin_pct),
  spend: r => num(r.emp_spend),
  profit: r => num(r.profit),
}
const SHRINK_EMP_GETTERS = {
  name: r => (r.name || '').toLowerCase(),
  events: r => num(r.events),
  net_units: r => num(r.net_units),
  shrink: r => num(r.shrink_value),
  net: r => num(r.net_value),
}
const SHRINK_ITEM_GETTERS = {
  name: r => (r.item_name || '').toLowerCase(),
  club: r => (r.location_slug || '').toLowerCase(),
  events: r => num(r.events),
  net_units: r => num(r.net_units),
  net: r => num(r.net_value),
}
const SHRINK_EVENT_GETTERS = {
  when: r => ts(r.occurred_at),
  item: r => (r.item_name || '').toLowerCase(),
  club: r => (r.location_slug || '').toLowerCase(),
  by: r => (r.created_by_name || '').toLowerCase(),
  expected: r => num(r.expected),
  counted: r => num(r.counted),
  delta: r => num(r.delta),
  impact: r => num(r.impact),
}
const COMPLIANCE_GETTERS = {
  club: r => String(r.location_slug || r.club_number || '').toLowerCase(),
  lastcount: r => ts(r.last_count_at),
  counted: r => num(r.last_count_items),
  dayssince: r => num(r.days_since_count),
  lastrestock: r => ts(r.last_restock_at),
  tracked: r => num(r.tracked_items),
  never: r => num(r.never_counted_items),
  status: r => (r.status || '').toLowerCase(),
}

// Sortable column header (desc → asc → none). Every sortable column shows a
// persistent up/down glyph so it's obvious it can be clicked; the glyph turns
// red and points the active direction when that column is the sort key.
function SortHeader({ label, col, sort, onSort, align = 'right' }) {
  const active = sort?.col === col
  return (
    <th
      onClick={() => onSort(col)}
      title="Click to sort"
      className={`py-2.5 px-2 cursor-pointer select-none group ${align === 'left' ? 'text-left px-4' : 'text-right'}`}
    >
      <span className={`inline-flex items-center gap-1 ${align === 'left' ? '' : 'justify-end'} ${active ? 'text-wcs-red' : 'text-text-muted group-hover:text-text-primary'}`}>
        {label}
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" className={`w-3 h-3 flex-shrink-0 ${active ? '' : 'opacity-40 group-hover:opacity-70'}`}>
          {!active
            ? <path strokeLinecap="round" strokeLinejoin="round" d="M8.25 15 12 18.75 15.75 15m-7.5-6L12 5.25 15.75 9" />
            : sort.dir === 'desc'
              ? <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 8.25l-7.5 7.5-7.5-7.5" />
              : <path strokeLinecap="round" strokeLinejoin="round" d="M4.5 15.75l7.5-7.5 7.5 7.5" />}
        </svg>
      </span>
    </th>
  )
}

const SUB_TABS = [
  { key: 'sales', label: 'Product Sales' },
  { key: 'employee', label: 'Employee Spend' },
  { key: 'shrinkage', label: 'Shrinkage' },
  { key: 'compliance', label: 'Compliance' },
]

const moneyClass = (n) => (Number(n) < 0 ? 'text-wcs-red font-semibold' : Number(n) > 0 ? 'text-emerald-600 font-semibold' : 'text-text-primary')

// Roll a list of { category, revenue, cogs } lines up into per-category revenue /
// COGS / profit / margin. cogs may be null for a line whose item has no cost on
// file — those lines still count toward revenue; their COGS just isn't added in.
function rollupByCategory(items) {
  const m = new Map()
  for (const r of items) {
    const cat = r.category || 'Uncategorized'
    const e = m.get(cat) || { category: cat, revenue: 0, cogs: 0 }
    e.revenue += Number(r.revenue) || 0
    if (r.cogs != null) e.cogs += Number(r.cogs) || 0
    m.set(cat, e)
  }
  return [...m.values()].map(e => ({
    category: e.category,
    revenue: +e.revenue.toFixed(2),
    cogs: +e.cogs.toFixed(2),
    profit: +(e.revenue - e.cogs).toFixed(2),
    margin_pct: e.revenue > 0 ? +(((e.revenue - e.cogs) / e.revenue) * 100).toFixed(1) : null,
  })).sort((a, b) => b.revenue - a.revenue)
}

// Shared by-category summary table (Product Sales + Employee Spend). Sortable;
// defaults to highest revenue first.
function CategoryTable({ rows, revenueLabel = 'Revenue' }) {
  const [sort, cycle] = useSortState({ col: 'revenue', dir: 'desc' })
  if (!rows.length) return null
  const tot = rows.reduce((a, r) => ({ revenue: a.revenue + r.revenue, cogs: a.cogs + r.cogs, profit: a.profit + r.profit }), { revenue: 0, cogs: 0, profit: 0 })
  const totMargin = tot.revenue > 0 ? (tot.profit / tot.revenue) * 100 : null
  const sorted = sortRows(rows, sort, CATEGORY_GETTERS)
  return (
    <div className="bg-surface/95 backdrop-blur-sm rounded-xl border border-border overflow-hidden">
      <div className="px-4 py-2.5 border-b border-border bg-bg/40"><p className="text-xs font-bold uppercase tracking-wider text-text-muted">By Category</p></div>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-[10px] uppercase tracking-wider text-text-muted border-b border-border bg-bg/50">
              <SortHeader label="Category" col="category" sort={sort} onSort={cycle} align="left" />
              <SortHeader label={revenueLabel} col="revenue" sort={sort} onSort={cycle} />
              <SortHeader label="COGS" col="cogs" sort={sort} onSort={cycle} />
              <SortHeader label="Profit" col="profit" sort={sort} onSort={cycle} />
              <SortHeader label="Margin" col="margin" sort={sort} onSort={cycle} />
            </tr>
          </thead>
          <tbody>
            {sorted.map(r => (
              <tr key={r.category} className="border-b border-border/50 hover:bg-bg/40">
                <td className="py-2 px-4 font-medium text-text-primary">{r.category}</td>
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
    </div>
  )
}

export default function PosSalesReport({ startDate, endDate, locationSlug }) {
  const [subTab, setSubTab] = useState('sales')
  const [search, setSearch] = useState('')
  const [salesSort, cycleSalesSort] = useSortState({ col: 'name', dir: 'asc' }) // default: alphabetical by item
  const [empSort, cycleEmpSort] = useSortState()
  const [byEmpSort, cycleByEmpSort] = useSortState()
  const [byItemSort, cycleByItemSort] = useSortState()
  const [eventsSort, cycleEventsSort] = useSortState()
  const [complianceSort, cycleComplianceSort] = useSortState()

  const [summary, setSummary] = useState(null)
  const [empSpend, setEmpSpend] = useState(null)
  const [shrinkage, setShrinkage] = useState(null)
  const [compliance, setCompliance] = useState(null)
  const [overdueDays, setOverdueDays] = useState(30)
  // Compliance drill-down: which club row is expanded, and its per-day activity
  // (keyed by club_number → { loading, days, error }).
  const [openClub, setOpenClub] = useState(null)
  const [activity, setActivity] = useState({})
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  const allLoc = locationSlug === 'all' || !locationSlug
  const params = useMemo(
    () => ({ location_slug: allLoc ? '' : locationSlug, from: startDate, to: endDate }),
    [allLoc, locationSlug, startDate, endDate]
  )

  // Invalidate cached tab data whenever the date range / location changes so a
  // stale tab doesn't flash old numbers when revisited.
  useEffect(() => { setSummary(null); setEmpSpend(null); setShrinkage(null); setCompliance(null); setActivity({}); setOpenClub(null) }, [params])

  useEffect(() => { setCompliance(null) }, [overdueDays])

  useEffect(() => {
    let ignore = false
    const need =
      (subTab === 'sales' && summary === null) ||
      (subTab === 'employee' && empSpend === null) ||
      (subTab === 'shrinkage' && shrinkage === null) ||
      (subTab === 'compliance' && compliance === null)
    if (!need) return
    setLoading(true); setError('')
    const fetcher =
      subTab === 'sales' ? getInventorySummary(params).then(r => { if (!ignore) setSummary(r.summary || []) })
      : subTab === 'employee' ? getInventoryEmployeeSpend(params).then(r => { if (!ignore) setEmpSpend(r) })
      : subTab === 'compliance' ? getInventoryCompliance({ location_slug: params.location_slug, overdue_days: overdueDays }).then(r => { if (!ignore) setCompliance(r) })
      : getInventoryShrinkage(params).then(r => { if (!ignore) setShrinkage(r) })
    fetcher.catch(err => { if (!ignore) setError(err.message) }).finally(() => { if (!ignore) setLoading(false) })
    return () => { ignore = true }
  }, [subTab, params, summary, empSpend, shrinkage, compliance, overdueDays])

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
    const rows = q ? consolidatedSummary.filter(r => (r.name || '').toLowerCase().includes(q) || (r.upc || '').includes(q)) : consolidatedSummary
    return sortRows(rows, salesSort, SALES_GETTERS)
  }, [consolidatedSummary, search, salesSort])

  // Sorted views for the remaining tabs (export follows the on-screen order).
  const displayEmp = useMemo(() => sortRows(empSpend?.rows || [], empSort, EMP_GETTERS), [empSpend, empSort])
  const displayByEmp = useMemo(() => sortRows(shrinkage?.by_employee || [], byEmpSort, SHRINK_EMP_GETTERS), [shrinkage, byEmpSort])
  const displayByItem = useMemo(() => sortRows(shrinkage?.by_item || [], byItemSort, SHRINK_ITEM_GETTERS), [shrinkage, byItemSort])
  const displayEvents = useMemo(() => sortRows(shrinkage?.events || [], eventsSort, SHRINK_EVENT_GETTERS), [shrinkage, eventsSort])
  const displayClubs = useMemo(() => sortRows(compliance?.clubs || [], complianceSort, COMPLIANCE_GETTERS), [compliance, complianceSort])

  // Expand/collapse a club row, lazy-loading its per-day restock/count activity
  // for the current date range on first open.
  function toggleClubActivity(c) {
    const key = c.club_number
    if (openClub === key) { setOpenClub(null); return }
    setOpenClub(key)
    if (!activity[key]) {
      setActivity(a => ({ ...a, [key]: { loading: true } }))
      getInventoryComplianceActivity({ location_slug: c.location_slug || '', from: startDate, to: endDate })
        .then(r => setActivity(a => ({ ...a, [key]: { loading: false, days: r.days || [] } })))
        .catch(err => setActivity(a => ({ ...a, [key]: { loading: false, error: err.message } })))
    }
  }

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
        ...displayEmp.map(r => [r.item_name, r.location_slug || '', r.category || '', r.units, r.purchases, r.abc_unit_price, r.emp_discount_pct, r.emp_price, r.unit_cost, r.margin_pct ?? '', r.emp_spend, r.profit ?? ''])],
      `employee-spend-${rangeLabel}`
    )
  }
  function exportShrinkage() {
    if (!shrinkage) return
    exportCSV(
      [['Date', 'Item', 'Club', 'Counted By', 'Expected', 'Counted', 'Net Units', 'Unit Cost', 'Impact', 'Note'],
        ...displayEvents.map(e => [fmtDateTime(e.occurred_at), e.item_name || '', e.location_slug || '', e.created_by_name || '', e.expected ?? '', e.counted ?? '', e.delta, e.unit_cost ?? '', e.impact ?? '', e.note || ''])],
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
          {subTab !== 'compliance' && (
            <button
              onClick={subTab === 'sales' ? exportSales : subTab === 'employee' ? exportEmployee : exportShrinkage}
              className="px-3 py-1.5 rounded-lg text-xs font-semibold border border-border bg-bg text-text-muted hover:text-text-primary transition-colors">
              Export CSV
            </button>
          )}
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
              {empCategoryRollup.length > 0 && <CategoryTable rows={empCategoryRollup} revenueLabel="Spend" />}

              <div className="bg-surface/95 backdrop-blur-sm rounded-xl border border-border overflow-hidden mt-4">
                {empSpend.rows.length === 0 ? (
                  <p className="text-sm text-text-muted p-8 text-center">No staff purchases in this date range.</p>
                ) : (
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="text-left text-[10px] uppercase tracking-wider text-text-muted border-b border-border bg-bg/50">
                          <SortHeader label="Item" col="name" sort={empSort} onSort={cycleEmpSort} align="left" />
                          {allLoc && <SortHeader label="Club" col="club" sort={empSort} onSort={cycleEmpSort} align="left" />}
                          <SortHeader label="Category" col="category" sort={empSort} onSort={cycleEmpSort} align="left" />
                          <SortHeader label="Units" col="units" sort={empSort} onSort={cycleEmpSort} />
                          <SortHeader label="Purchases" col="purchases" sort={empSort} onSort={cycleEmpSort} />
                          <SortHeader label="Catalog" col="catalog" sort={empSort} onSort={cycleEmpSort} />
                          <SortHeader label={'Emp Disc'} col="empdisc" sort={empSort} onSort={cycleEmpSort} />
                          <SortHeader label={'Emp Price'} col="empprice" sort={empSort} onSort={cycleEmpSort} />
                          <SortHeader label="Cost" col="cost" sort={empSort} onSort={cycleEmpSort} />
                          <SortHeader label="Margin" col="margin" sort={empSort} onSort={cycleEmpSort} />
                          <SortHeader label="Spend" col="spend" sort={empSort} onSort={cycleEmpSort} />
                          <SortHeader label="Profit" col="profit" sort={empSort} onSort={cycleEmpSort} />
                        </tr>
                      </thead>
                      <tbody>
                        {displayEmp.map(r => (
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

      {/* === Compliance === */}
      {subTab === 'compliance' && (
  <div className="space-y-3">
    <div className="flex flex-wrap items-center gap-2 text-sm">
      <label className="text-text-muted">Overdue after</label>
      <input type="number" min="1" max="365" value={overdueDays}
        onChange={(e) => setOverdueDays(Math.max(1, Math.min(365, Number(e.target.value) || 30)))}
        className="w-20 px-2 py-1 rounded border border-border bg-surface text-right" />
      <span className="text-text-muted">days without a count</span>
      {compliance && (
        <span className="ml-auto text-xs text-text-muted">
          {compliance.rollup.overdue} overdue &middot; {compliance.rollup.never} never counted &middot; {compliance.rollup.ok} on track
        </span>
      )}
    </div>
    <div className="bg-surface/95 backdrop-blur-sm rounded-xl border border-border overflow-hidden">
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-[10px] uppercase tracking-wider text-text-muted border-b border-border bg-bg/50">
              <SortHeader label="Club" col="club" sort={complianceSort} onSort={cycleComplianceSort} align="left" />
              <SortHeader label="Last count" col="lastcount" sort={complianceSort} onSort={cycleComplianceSort} />
              <SortHeader label="Items counted" col="counted" sort={complianceSort} onSort={cycleComplianceSort} />
              <SortHeader label="Days since" col="dayssince" sort={complianceSort} onSort={cycleComplianceSort} />
              <SortHeader label="Last restock" col="lastrestock" sort={complianceSort} onSort={cycleComplianceSort} />
              <SortHeader label="Tracked" col="tracked" sort={complianceSort} onSort={cycleComplianceSort} />
              <SortHeader label="Never counted" col="never" sort={complianceSort} onSort={cycleComplianceSort} />
              <SortHeader label="Status" col="status" sort={complianceSort} onSort={cycleComplianceSort} />
            </tr>
          </thead>
          <tbody>
            {displayClubs.map((c) => {
              const badge = c.status === 'overdue' ? 'bg-red-100 text-wcs-red'
                : c.status === 'never' ? 'bg-bg text-text-muted'
                : 'bg-emerald-100 text-emerald-700'
              const label = c.status === 'overdue' ? 'Overdue' : c.status === 'never' ? 'Never' : 'OK'
              const isOpen = openClub === c.club_number
              const act = activity[c.club_number]
              return (
                <Fragment key={c.club_number}>
                  <tr className="border-b border-border/50 hover:bg-bg/40 cursor-pointer" onClick={() => toggleClubActivity(c)}>
                    <td className="py-2 px-4 font-medium text-text-primary capitalize">
                      <span className="inline-flex items-center gap-1.5">
                        <span className={`text-text-muted transition-transform ${isOpen ? 'rotate-90' : ''}`}>▶</span>
                        {c.location_slug || c.club_number}
                      </span>
                    </td>
                    <td className="py-2 px-2 text-right">{fmtDateTime(c.last_count_at)}</td>
                    <td className="py-2 px-2 text-right">{c.last_count_at ? c.last_count_items : '—'}</td>
                    <td className={`py-2 px-2 text-right ${c.status === 'overdue' ? 'text-wcs-red font-semibold' : ''}`}>{c.days_since_count == null ? '—' : c.days_since_count}</td>
                    <td className="py-2 px-2 text-right">{fmtDateTime(c.last_restock_at)}</td>
                    <td className="py-2 px-2 text-right">{c.tracked_items}</td>
                    <td className="py-2 px-2 text-right">{c.never_counted_items}</td>
                    <td className="py-2 px-4 text-right"><span className={`inline-block px-2 py-0.5 rounded text-xs font-semibold ${badge}`}>{label}</span></td>
                  </tr>
                  {isOpen && (
                    <tr className="bg-bg/30">
                      <td colSpan="8" className="px-4 py-3">
                        <p className="text-[11px] uppercase tracking-wider text-text-muted mb-2">
                          Restock &amp; count activity by day{startDate && endDate ? ` · ${startDate} to ${endDate}` : ''}
                        </p>
                        {!act || act.loading ? (
                          <p className="text-sm text-text-muted py-2">Loading activity…</p>
                        ) : act.error ? (
                          <p className="text-sm text-wcs-red py-2">{act.error}</p>
                        ) : act.days.length === 0 ? (
                          <p className="text-sm text-text-muted py-2">No restock or count activity in this date range.</p>
                        ) : (
                          <div className="overflow-x-auto">
                            <table className="w-full text-sm">
                              <thead>
                                <tr className="text-left text-[10px] uppercase tracking-wider text-text-muted border-b border-border">
                                  <th className="py-1.5 px-2">Day</th>
                                  <th className="py-1.5 px-2 text-right">Items counted</th>
                                  <th className="py-1.5 px-2 text-right">Items restocked</th>
                                  <th className="py-1.5 px-2 text-right">Units added</th>
                                </tr>
                              </thead>
                              <tbody>
                                {act.days.map((d) => (
                                  <tr key={d.date} className="border-b border-border/40">
                                    <td className="py-1.5 px-2 font-medium text-text-primary">{d.date}</td>
                                    <td className="py-1.5 px-2 text-right">{d.counted_items || '—'}</td>
                                    <td className="py-1.5 px-2 text-right">{d.restocked_items || '—'}</td>
                                    <td className="py-1.5 px-2 text-right">{d.units_added ? fmtQty(d.units_added) : '—'}</td>
                                  </tr>
                                ))}
                              </tbody>
                            </table>
                          </div>
                        )}
                      </td>
                    </tr>
                  )}
                </Fragment>
              )
            })}
            {compliance && compliance.clubs.length === 0 && (
              <tr><td colSpan="8" className="py-6 text-center text-text-muted">No data</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  </div>
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
                            <SortHeader label="Counted By" col="name" sort={byEmpSort} onSort={cycleByEmpSort} align="left" />
                            <SortHeader label="Counts" col="events" sort={byEmpSort} onSort={cycleByEmpSort} />
                            <SortHeader label="Net Units" col="net_units" sort={byEmpSort} onSort={cycleByEmpSort} />
                            <SortHeader label="Shrink $" col="shrink" sort={byEmpSort} onSort={cycleByEmpSort} />
                            <SortHeader label="Net $" col="net" sort={byEmpSort} onSort={cycleByEmpSort} />
                          </tr>
                        </thead>
                        <tbody>
                          {displayByEmp.map(e => (
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
                            <SortHeader label="Item" col="name" sort={byItemSort} onSort={cycleByItemSort} align="left" />
                            {allLoc && <SortHeader label="Club" col="club" sort={byItemSort} onSort={cycleByItemSort} align="left" />}
                            <SortHeader label="Counts" col="events" sort={byItemSort} onSort={cycleByItemSort} />
                            <SortHeader label="Net Units" col="net_units" sort={byItemSort} onSort={cycleByItemSort} />
                            <SortHeader label="Net $" col="net" sort={byItemSort} onSort={cycleByItemSort} />
                          </tr>
                        </thead>
                        <tbody>
                          {displayByItem.map(i => (
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
                            <SortHeader label="When" col="when" sort={eventsSort} onSort={cycleEventsSort} align="left" />
                            <SortHeader label="Item" col="item" sort={eventsSort} onSort={cycleEventsSort} align="left" />
                            {allLoc && <SortHeader label="Club" col="club" sort={eventsSort} onSort={cycleEventsSort} align="left" />}
                            <SortHeader label="Counted By" col="by" sort={eventsSort} onSort={cycleEventsSort} align="left" />
                            <SortHeader label="Expected" col="expected" sort={eventsSort} onSort={cycleEventsSort} />
                            <SortHeader label="Counted" col="counted" sort={eventsSort} onSort={cycleEventsSort} />
                            <SortHeader label="Δ Units" col="delta" sort={eventsSort} onSort={cycleEventsSort} />
                            <SortHeader label="$ Impact" col="impact" sort={eventsSort} onSort={cycleEventsSort} />
                          </tr>
                        </thead>
                        <tbody>
                          {displayEvents.map(e => (
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
