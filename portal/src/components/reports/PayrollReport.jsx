import { Fragment, useEffect, useMemo, useState } from 'react'
import { getPayrollReport } from '../../lib/api'

const MONTH_NAMES = ['January','February','March','April','May','June','July','August','September','October','November','December']

const SECTIONS = [
  { key: 'sales',     label: 'Sales Commissions' },
  { key: 'recurring', label: 'Recurring Services' },
  { key: 'sessions',  label: 'Trainer Sessions' },
]

// Build a list of months: last 12 months ending in the previous full month.
function buildMonthOptions() {
  const out = []
  const now = new Date()
  // Start from previous month so we don't show an in-progress month by default
  for (let i = 0; i < 13; i++) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1)
    const y = d.getFullYear()
    const m = String(d.getMonth() + 1).padStart(2, '0')
    out.push({ key: `${y}-${m}`, label: `${MONTH_NAMES[d.getMonth()]} ${y}` })
  }
  return out
}

function defaultMonth() {
  const now = new Date()
  // If we're past the 5th, default to last month (full month visible)
  // Otherwise default to two months ago.
  const d = new Date(now.getFullYear(), now.getMonth() - 1, 1)
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  return `${y}-${m}`
}

function fmtMoney(n) {
  const v = Number(n) || 0
  return v.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

function KpiCard({ label, value, sub }) {
  return (
    <div className="bg-surface rounded-xl border border-border p-6 text-center">
      <p className="text-xs text-text-muted uppercase tracking-wide">{label}</p>
      <p className="text-4xl font-bold text-text-primary mt-2">{value}</p>
      {sub && <p className="text-[11px] text-text-muted mt-1">{sub}</p>}
    </div>
  )
}

function SalesTable({ rows }) {
  // Collect all profit-center keys present, ordered alphabetically.
  const allCenters = useMemo(() => {
    const set = new Set()
    for (const r of rows) {
      for (const k of Object.keys(r.by_profit_center || {})) set.add(k)
    }
    return [...set].sort()
  }, [rows])

  if (!rows.length) {
    return <p className="text-sm text-text-muted">No commissions for this period.</p>
  }

  const totals = {}
  for (const c of allCenters) totals[c] = 0
  let grand = 0
  for (const r of rows) {
    for (const c of allCenters) totals[c] += Number(r.by_profit_center?.[c] || 0)
    grand += Number(r.total_commission) || 0
  }

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm border-collapse">
        <thead>
          <tr className="border-b border-border">
            <th className="px-3 py-2 text-left text-xs font-semibold uppercase tracking-wide text-text-muted">Employee</th>
            <th className="px-3 py-2 text-left text-xs font-semibold uppercase tracking-wide text-text-muted">Club</th>
            {allCenters.map((c) => (
              <th key={c} className="px-3 py-2 text-right text-xs font-semibold uppercase tracking-wide text-text-muted whitespace-nowrap">{c}</th>
            ))}
            <th className="px-3 py-2 text-right text-xs font-semibold uppercase tracking-wide text-text-primary">Total</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={`${r.club_number}|${r.employee_name}`} className="border-b border-border/40 hover:bg-bg/40">
              <td className="px-3 py-2 text-text-primary">{r.employee_name}</td>
              <td className="px-3 py-2 text-text-muted text-xs uppercase">{r.location_slug}</td>
              {allCenters.map((c) => {
                const v = Number(r.by_profit_center?.[c] || 0)
                return (
                  <td key={c} className="px-3 py-2 text-right tabular-nums text-text-muted">
                    {v ? `$${fmtMoney(v)}` : <span className="text-border">—</span>}
                  </td>
                )
              })}
              <td className="px-3 py-2 text-right tabular-nums font-semibold text-text-primary">${fmtMoney(r.total_commission)}</td>
            </tr>
          ))}
          <tr className="border-t-2 border-border bg-bg/40">
            <td className="px-3 py-2 font-semibold text-text-primary" colSpan={2}>Total</td>
            {allCenters.map((c) => (
              <td key={c} className="px-3 py-2 text-right tabular-nums font-semibold text-text-primary">${fmtMoney(totals[c])}</td>
            ))}
            <td className="px-3 py-2 text-right tabular-nums font-bold text-text-primary">${fmtMoney(grand)}</td>
          </tr>
        </tbody>
      </table>
    </div>
  )
}

function RecurringTable({ rows }) {
  const [openKey, setOpenKey] = useState(null)
  if (!rows.length) {
    return (
      <div className="text-sm text-text-muted">
        <p>No recurring services for this period.</p>
        <p className="mt-2 text-xs">If April just ended, run the sync from Render Shell:</p>
        <pre className="mt-1 text-xs bg-bg p-2 rounded border border-border overflow-x-auto">cd ghl-sync && node scripts/sync-payroll-recurring.js --month 2026-04</pre>
      </div>
    )
  }

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm border-collapse">
        <thead>
          <tr className="border-b border-border">
            <th className="px-3 py-2 text-left text-xs font-semibold uppercase tracking-wide text-text-muted">Employee</th>
            <th className="px-3 py-2 text-left text-xs font-semibold uppercase tracking-wide text-text-muted">Club</th>
            <th className="px-3 py-2 text-right text-xs font-semibold uppercase tracking-wide text-text-muted">Services</th>
            <th className="px-3 py-2 text-right text-xs font-semibold uppercase tracking-wide text-text-muted">Contract Value</th>
            <th className="px-3 py-2 text-right text-xs font-semibold uppercase tracking-wide text-text-primary">Commission (4%)</th>
            <th className="px-3 py-2"></th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => {
            const key = `${r.club_number}|${r.employee_id || ''}|${r.employee_name}`
            const isOpen = openKey === key
            return (
              <Fragment key={key}>
                <tr
                  className="border-b border-border/40 hover:bg-bg/40 cursor-pointer"
                  onClick={() => setOpenKey(isOpen ? null : key)}
                >
                  <td className="px-3 py-2 text-text-primary">{r.employee_name}</td>
                  <td className="px-3 py-2 text-text-muted text-xs uppercase">{r.location_slug}</td>
                  <td className="px-3 py-2 text-right tabular-nums text-text-muted">{r.services_count}</td>
                  <td className="px-3 py-2 text-right tabular-nums text-text-muted">${fmtMoney(r.total_contract_value)}</td>
                  <td className="px-3 py-2 text-right tabular-nums font-semibold text-text-primary">${fmtMoney(r.total_commission)}</td>
                  <td className="px-3 py-2 text-right text-text-muted text-xs">{isOpen ? '▼' : '▶'}</td>
                </tr>
                {isOpen && (
                  <tr className="bg-bg/30">
                    <td colSpan={6} className="px-3 py-3">
                      <div className="overflow-x-auto">
                        <table className="w-full text-xs border-collapse">
                          <thead>
                            <tr className="text-text-muted">
                              <th className="px-2 py-1 text-left font-medium">Sale Date</th>
                              <th className="px-2 py-1 text-left font-medium">Member</th>
                              <th className="px-2 py-1 text-left font-medium">Service</th>
                              <th className="px-2 py-1 text-left font-medium">Type</th>
                              <th className="px-2 py-1 text-right font-medium">Invoice</th>
                              <th className="px-2 py-1 text-right font-medium">Periods</th>
                              <th className="px-2 py-1 text-right font-medium">Contract Value</th>
                              <th className="px-2 py-1 text-right font-medium">Commission</th>
                            </tr>
                          </thead>
                          <tbody>
                            {r.services.map((s) => (
                              <tr key={s.recurring_service_id} className="border-t border-border/40">
                                <td className="px-2 py-1 text-text-muted">{s.sale_date || '—'}</td>
                                <td className="px-2 py-1 text-text-primary">{s.member_name || '—'}</td>
                                <td className="px-2 py-1 text-text-muted">{s.service_item || '—'}</td>
                                <td className="px-2 py-1 text-text-muted">{s.recurring_type_desc || '—'}</td>
                                <td className="px-2 py-1 text-right tabular-nums text-text-muted">${fmtMoney(s.invoice_total)}</td>
                                <td className="px-2 py-1 text-right tabular-nums text-text-muted">{s.total_periods}</td>
                                <td className="px-2 py-1 text-right tabular-nums text-text-muted">${fmtMoney(s.total_contract_value)}</td>
                                <td className="px-2 py-1 text-right tabular-nums font-semibold text-text-primary">${fmtMoney(s.commission)}</td>
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
          })}
        </tbody>
      </table>
    </div>
  )
}

function SessionsTable({ rows, eventTypes }) {
  if (!rows.length) {
    return <p className="text-sm text-text-muted">No trainer sessions for this period.</p>
  }
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm border-collapse">
        <thead>
          <tr className="border-b border-border">
            <th className="px-3 py-2 text-left text-xs font-semibold uppercase tracking-wide text-text-muted">Trainer</th>
            <th className="px-3 py-2 text-left text-xs font-semibold uppercase tracking-wide text-text-muted">Club</th>
            {eventTypes.map((t) => (
              <th key={t} className="px-3 py-2 text-right text-xs font-semibold uppercase tracking-wide text-text-muted whitespace-nowrap">{t}</th>
            ))}
            <th className="px-3 py-2 text-right text-xs font-semibold uppercase tracking-wide text-text-primary">Total</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={`${r.club_number}|${r.employee_id}`} className="border-b border-border/40 hover:bg-bg/40">
              <td className="px-3 py-2 text-text-primary">{r.employee_name}</td>
              <td className="px-3 py-2 text-text-muted text-xs uppercase">{r.location_slug}</td>
              {eventTypes.map((t) => {
                const cell = r.by_event_type[t]
                if (!cell) return <td key={t} className="px-3 py-2 text-right text-border">—</td>
                const c = cell.completed || 0
                const cc = cell.canceled_charge || 0
                return (
                  <td key={t} className="px-3 py-2 text-right tabular-nums text-text-muted">
                    {c}{cc > 0 ? <span className="text-text-muted/60"> +{cc}</span> : ''}
                  </td>
                )
              })}
              <td className="px-3 py-2 text-right tabular-nums font-semibold text-text-primary">{r.total}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="text-[11px] text-text-muted mt-2">Counts show Completed; "+N" indicates additional Canceled-Charge sessions.</p>
    </div>
  )
}

export default function PayrollReport({ locationSlug }) {
  const monthOptions = useMemo(buildMonthOptions, [])
  const [period, setPeriod] = useState(defaultMonth())
  const [activeTab, setActiveTab] = useState('sales')
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(null)

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    setError(null)
    const params = { period }
    if (locationSlug && locationSlug !== 'all') params.location_slug = locationSlug
    getPayrollReport(params)
      .then((d) => { if (!cancelled) setData(d) })
      .catch((e) => { if (!cancelled) setError(e.message || 'Failed to load') })
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [period, locationSlug])

  const summary = data?.summary || {}

  return (
    <div className="space-y-5">
      {/* Period picker */}
      <div className="bg-surface rounded-xl border border-border p-4 flex flex-wrap items-center gap-3">
        <label className="text-xs text-text-muted uppercase tracking-wide font-semibold">Pay Period</label>
        <select
          value={period}
          onChange={(e) => setPeriod(e.target.value)}
          className="px-3 py-1.5 rounded-lg border border-border bg-bg text-text-primary text-sm focus:outline-none focus:ring-2 focus:ring-wcs-red"
        >
          {monthOptions.map((m) => (
            <option key={m.key} value={m.key}>{m.label}</option>
          ))}
        </select>
        {loading && <span className="text-xs text-text-muted">Loading…</span>}
        {error && <span className="text-xs text-red-500">{error}</span>}
      </div>

      {/* KPIs */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <KpiCard
          label="Sales Commission"
          value={`$${fmtMoney(summary.sales_commission)}`}
          sub="From CSV upload"
        />
        <KpiCard
          label="Recurring Commission"
          value={`$${fmtMoney(summary.recurring_commission)}`}
          sub={`${summary.recurring_services_count || 0} services @ 4%`}
        />
        <KpiCard
          label="Trainer Sessions"
          value={summary.sessions_total || 0}
          sub={`${summary.sessions_completed || 0} completed · ${summary.sessions_canceled_charge || 0} cxl-charge`}
        />
        <KpiCard
          label="Grand Total Commission"
          value={`$${fmtMoney(summary.grand_total_commission)}`}
          sub="Sales + Recurring"
        />
      </div>

      {/* Tabs */}
      <div className="bg-surface rounded-xl border border-border">
        <div className="flex border-b border-border">
          {SECTIONS.map((s) => (
            <button
              key={s.key}
              onClick={() => setActiveTab(s.key)}
              className={`px-4 py-3 text-sm font-medium transition-colors ${
                activeTab === s.key
                  ? 'text-wcs-red border-b-2 border-wcs-red'
                  : 'text-text-muted hover:text-text-primary'
              }`}
            >
              {s.label}
            </button>
          ))}
        </div>
        <div className="p-4">
          {!data && !loading && <p className="text-sm text-text-muted">No data.</p>}
          {data && activeTab === 'sales' && <SalesTable rows={data.sales || []} />}
          {data && activeTab === 'recurring' && <RecurringTable rows={data.recurring || []} />}
          {data && activeTab === 'sessions' && (
            <SessionsTable rows={data.sessions || []} eventTypes={data.session_event_types || []} />
          )}
        </div>
      </div>
    </div>
  )
}
