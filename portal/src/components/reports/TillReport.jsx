import { useState, useEffect, useMemo } from 'react'
import { getTillReconciliation } from '../../lib/api'
import { exportCSV } from '../../lib/export'

// Till report — cash drawer reconciliation. Compares ABC POS cash tender (auto)
// against the Operandio open/close drawer counts. Three sub-tabs: Daily (counted
// vs expected, over/short, bag drop), By Employee (cumulative over/short by the
// person who closed), and Compliance (which days got an open + close count).
// Date range + location come from the Reporting shell as props.

function fmtMoney(v) {
  if (v === null || v === undefined) return '—'
  const n = Number(v)
  if (!Number.isFinite(n)) return '—'
  return n.toLocaleString('en-US', { style: 'currency', currency: 'USD' })
}
function fmtSignedMoney(v) {
  if (v === null || v === undefined || !Number.isFinite(Number(v))) return '—'
  const n = Number(v)
  return (n > 0 ? '+' : '') + fmtMoney(n)
}

const SUB_TABS = [
  { key: 'daily', label: 'Daily' },
  { key: 'employee', label: 'By Employee' },
  { key: 'compliance', label: 'Compliance' },
]

// Over/short coloring: exact = green, short (negative) = red, over (positive) = amber.
const shortClass = (n) =>
  n == null ? 'text-text-muted'
    : Number(n) === 0 ? 'text-emerald-600 font-semibold'
    : Number(n) < 0 ? 'text-wcs-red font-semibold'
    : 'text-amber-600 font-semibold'

function StatusChip({ status }) {
  const map = {
    complete: ['Counted', 'bg-emerald-100 text-emerald-700'],
    missing_close: ['No close', 'bg-red-100 text-wcs-red'],
    missing_open: ['No open', 'bg-amber-100 text-amber-700'],
    missing_both: ['Missing', 'bg-red-100 text-wcs-red'],
  }
  const [label, cls] = map[status] || [status || '—', 'bg-bg text-text-muted']
  return <span className={`inline-block px-2 py-0.5 rounded text-xs font-semibold ${cls}`}>{label}</span>
}

export default function TillReport({ startDate, endDate, locationSlug }) {
  const [subTab, setSubTab] = useState('daily')
  const [rows, setRows] = useState(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  const allLoc = locationSlug === 'all' || !locationSlug
  const params = useMemo(
    () => ({ location_slug: allLoc ? '' : locationSlug, from: startDate, to: endDate }),
    [allLoc, locationSlug, startDate, endDate]
  )

  useEffect(() => {
    let ignore = false
    setLoading(true); setError('')
    getTillReconciliation(params)
      .then(r => { if (!ignore) setRows(r.rows || []) })
      .catch(err => { if (!ignore) setError(err.message) })
      .finally(() => { if (!ignore) setLoading(false) })
    return () => { ignore = true }
  }, [params])

  // Cumulative over/short per person who closed the drawer — a running tell on
  // whose drawers don't reconcile.
  const byEmployee = useMemo(() => {
    const m = new Map()
    for (const r of (rows || [])) {
      if (!r.closeBy || r.overShort == null) continue
      const e = m.get(r.closeBy) || { name: r.closeBy, days: 0, overShort: 0, shortDays: 0 }
      e.days++
      e.overShort += Number(r.overShort) || 0
      if (Number(r.overShort) < 0) e.shortDays++
      m.set(r.closeBy, e)
    }
    return [...m.values()]
      .map(e => ({ ...e, overShort: Math.round(e.overShort * 100) / 100 }))
      .sort((a, b) => a.overShort - b.overShort)
  }, [rows])

  // Daily tables show the most recent day at the top.
  const sortedRows = useMemo(() => (
    [...(rows || [])].sort((a, b) => (
      a.business_date < b.business_date ? 1 : a.business_date > b.business_date ? -1
      : (a.location_slug || '').localeCompare(b.location_slug || '')
    ))
  ), [rows])

  const totals = useMemo(() => {
    const t = { overShort: 0, bagDrop: 0, counted: 0, missing: 0 }
    for (const r of (rows || [])) {
      if (r.overShort != null) t.overShort += Number(r.overShort) || 0
      if (r.bagDrop != null) t.bagDrop += Number(r.bagDrop) || 0
      if (r.status === 'complete') t.counted++
      else t.missing++
    }
    t.overShort = Math.round(t.overShort * 100) / 100
    t.bagDrop = Math.round(t.bagDrop * 100) / 100
    return t
  }, [rows])

  const rangeLabel = `${startDate}_to_${endDate}`
  function exportDaily() {
    exportCSV(
      [['Date', 'Club', 'Float', 'Cash Sales', 'Refunds', 'Drops', 'Expected', 'Counted', 'Over/Short', 'Bag Drop', 'Status', 'Opened By', 'Closed By'],
        ...(rows || []).map(r => [r.business_date, r.location_slug, r.openingFloat, r.cashSales, r.cashRefunds, r.cashDrops,
          r.expectedClose, r.countedClose ?? '', r.overShort ?? '', r.bagDrop ?? '', r.status, r.openBy || '', r.closeBy || ''])],
      `till-${rangeLabel}`
    )
  }

  return (
    <div className="space-y-4">
      {/* Sub-tab switcher + export */}
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div className="flex gap-1 bg-bg rounded-lg p-1">
          {SUB_TABS.map(t => (
            <button key={t.key} onClick={() => setSubTab(t.key)}
              className={`px-3 py-1.5 rounded-md text-xs font-medium transition-colors ${subTab === t.key ? 'bg-white text-text-primary shadow-sm' : 'text-text-muted hover:text-text-primary'}`}>
              {t.label}
            </button>
          ))}
        </div>
        <button onClick={exportDaily}
          className="px-3 py-1.5 rounded-lg text-xs font-semibold border border-border bg-bg text-text-muted hover:text-text-primary transition-colors">
          Export Daily CSV
        </button>
      </div>

      {error && <p className="text-sm text-wcs-red bg-surface border border-border rounded-lg px-3 py-2">{error}</p>}

      {/* Summary cards */}
      {rows && rows.length > 0 && (
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
          <div className="bg-surface rounded-xl border border-border p-4">
            <p className="text-xs font-semibold text-text-muted uppercase tracking-wide">Net Over / Short</p>
            <p className={`text-2xl font-bold mt-1 ${shortClass(totals.overShort)}`}>{fmtSignedMoney(totals.overShort)}</p>
          </div>
          <div className="bg-surface rounded-xl border border-border p-4">
            <p className="text-xs font-semibold text-text-muted uppercase tracking-wide">Total Bag Drop</p>
            <p className="text-2xl font-bold mt-1 text-text-primary">{fmtMoney(totals.bagDrop)}</p>
          </div>
          <div className="bg-surface rounded-xl border border-border p-4">
            <p className="text-xs font-semibold text-text-muted uppercase tracking-wide">Days Counted</p>
            <p className="text-2xl font-bold mt-1 text-emerald-600">{totals.counted}</p>
          </div>
          <div className="bg-surface rounded-xl border border-border p-4">
            <p className="text-xs font-semibold text-text-muted uppercase tracking-wide">Days Missing a Count</p>
            <p className={`text-2xl font-bold mt-1 ${totals.missing ? 'text-wcs-red' : 'text-text-primary'}`}>{totals.missing}</p>
          </div>
        </div>
      )}

      {loading && rows === null && <p className="text-sm text-text-muted bg-surface rounded-xl border border-border p-6 text-center">Reconciling drawers...</p>}
      {rows && rows.length === 0 && <p className="text-sm text-text-muted bg-surface rounded-xl border border-border p-8 text-center">No till activity in this date range.</p>}

      {/* === Daily === */}
      {subTab === 'daily' && rows && rows.length > 0 && (
        <div className="bg-surface/95 backdrop-blur-sm rounded-xl border border-border overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-[10px] uppercase tracking-wider text-text-muted border-b border-border bg-bg/50">
                  <th className="py-2.5 px-4">Date</th>
                  {allLoc && <th className="py-2.5 px-2">Club</th>}
                  <th className="py-2.5 px-2 text-right">Float</th>
                  <th className="py-2.5 px-2 text-right">Cash&nbsp;Sales</th>
                  <th className="py-2.5 px-2 text-right">Refunds</th>
                  <th className="py-2.5 px-2 text-right">Drops</th>
                  <th className="py-2.5 px-2 text-right">Expected</th>
                  <th className="py-2.5 px-2 text-right">Counted</th>
                  <th className="py-2.5 px-2 text-right">Over/Short</th>
                  <th className="py-2.5 px-2 text-right">Bag&nbsp;Drop</th>
                  <th className="py-2.5 px-2">Status</th>
                  <th className="py-2.5 px-4">Closed&nbsp;By</th>
                </tr>
              </thead>
              <tbody>
                {sortedRows.map((r) => (
                  <tr key={`${r.business_date}|${r.club_number}`} className="border-b border-border/50 hover:bg-bg/40">
                    <td className="py-2 px-4 text-text-primary whitespace-nowrap">{r.business_date}</td>
                    {allLoc && <td className="py-2 px-2 capitalize text-text-muted">{r.location_slug || '—'}</td>}
                    <td className={`py-2 px-2 text-right ${r.floatVariance ? 'text-amber-600' : 'text-text-muted'}`} title={r.floatVariance ? 'Opening count differs from the standard float' : ''}>{fmtMoney(r.openingFloat)}</td>
                    <td className="py-2 px-2 text-right">{fmtMoney(r.cashSales)}</td>
                    <td className="py-2 px-2 text-right text-text-muted">{fmtMoney(r.cashRefunds)}</td>
                    <td className="py-2 px-2 text-right text-text-muted">{fmtMoney(r.cashDrops)}</td>
                    <td className="py-2 px-2 text-right">{fmtMoney(r.expectedClose)}</td>
                    <td className="py-2 px-2 text-right text-text-primary">{r.countedClose == null ? '—' : fmtMoney(r.countedClose)}</td>
                    <td className={`py-2 px-2 text-right ${shortClass(r.overShort)}`}>{r.overShort == null ? '—' : fmtSignedMoney(r.overShort)}</td>
                    <td className="py-2 px-2 text-right">{r.bagDrop == null ? '—' : fmtMoney(r.bagDrop)}</td>
                    <td className="py-2 px-2"><StatusChip status={r.status} /></td>
                    <td className="py-2 px-4 text-text-muted">{r.closeBy || '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* === By Employee === */}
      {subTab === 'employee' && rows && rows.length > 0 && (
        <div className="bg-surface/95 backdrop-blur-sm rounded-xl border border-border overflow-hidden">
          {byEmployee.length === 0 ? (
            <p className="text-sm text-text-muted p-8 text-center">No counted closes with a named closer in this range.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-[10px] uppercase tracking-wider text-text-muted border-b border-border bg-bg/50">
                    <th className="py-2.5 px-4">Closed By</th>
                    <th className="py-2.5 px-2 text-right">Closes</th>
                    <th className="py-2.5 px-2 text-right">Short Days</th>
                    <th className="py-2.5 px-4 text-right">Cumulative Over/Short</th>
                  </tr>
                </thead>
                <tbody>
                  {byEmployee.map((e, i) => (
                    <tr key={i} className="border-b border-border/50 hover:bg-bg/40">
                      <td className="py-2 px-4 font-medium text-text-primary">{e.name}</td>
                      <td className="py-2 px-2 text-right text-text-muted">{e.days}</td>
                      <td className={`py-2 px-2 text-right ${e.shortDays ? 'text-wcs-red font-semibold' : 'text-text-muted'}`}>{e.shortDays}</td>
                      <td className={`py-2 px-4 text-right ${shortClass(e.overShort)}`}>{fmtSignedMoney(e.overShort)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {/* === Compliance === */}
      {subTab === 'compliance' && rows && rows.length > 0 && (
        <div className="bg-surface/95 backdrop-blur-sm rounded-xl border border-border overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-[10px] uppercase tracking-wider text-text-muted border-b border-border bg-bg/50">
                  <th className="py-2.5 px-4">Date</th>
                  {allLoc && <th className="py-2.5 px-2">Club</th>}
                  <th className="py-2.5 px-2">Opened By</th>
                  <th className="py-2.5 px-2">Closed By</th>
                  <th className="py-2.5 px-4">Status</th>
                </tr>
              </thead>
              <tbody>
                {sortedRows.map((r) => (
                  <tr key={`${r.business_date}|${r.club_number}`} className="border-b border-border/50 hover:bg-bg/40">
                    <td className="py-2 px-4 text-text-primary whitespace-nowrap">{r.business_date}</td>
                    {allLoc && <td className="py-2 px-2 capitalize text-text-muted">{r.location_slug || '—'}</td>}
                    <td className="py-2 px-2 text-text-muted">{r.openBy || '—'}</td>
                    <td className="py-2 px-2 text-text-muted">{r.closeBy || '—'}</td>
                    <td className="py-2 px-4"><StatusChip status={r.status} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  )
}
