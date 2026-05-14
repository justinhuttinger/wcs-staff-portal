import { Fragment, useMemo, useState } from 'react'
import { getPayrollReport } from '../../../lib/api'
import MobileLoading from '../MobileLoading'
import { useCancellableFetch } from '../../../hooks/useCancellableFetch'

const MONTH_NAMES = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
]

const SECTIONS = [
  { key: 'sales',     label: 'POS Sales' },
  { key: 'recurring', label: 'PT Sales' },
  { key: 'sessions',  label: 'Sessions' },
]

// Profit centers to exclude from POS Sale Commissions (handled separately
// under PT Sales Commissions).
const POS_EXCLUDED_CENTERS = new Set(['TRAINING'])

function lastNameKey(fullName) {
  if (!fullName) return ''
  const parts = String(fullName).trim().split(/\s+/)
  return parts[parts.length - 1].toLowerCase()
}

function sortByLastName(rows) {
  return [...rows].sort((a, b) => {
    const ln = lastNameKey(a.employee_name).localeCompare(lastNameKey(b.employee_name))
    if (ln !== 0) return ln
    return (a.employee_name || '').localeCompare(b.employee_name || '')
  })
}

function buildMonthOptions() {
  const out = []
  const now = new Date()
  for (let i = 0; i < 13; i++) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1)
    const y = d.getFullYear()
    const m = String(d.getMonth() + 1).padStart(2, '0')
    out.push({ key: `${y}-${m}`, label: `${MONTH_NAMES[d.getMonth()]} ${y}`, year: y, month: d.getMonth() + 1 })
  }
  return out
}

function defaultMonth() {
  const now = new Date()
  const d = new Date(now.getFullYear(), now.getMonth() - 1, 1)
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  return `${y}-${m}`
}

function fmtMoney(n) {
  const v = Number(n) || 0
  return v.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

// ---- POS Sale Commissions section ----
function SalesSection({ rows }) {
  const allCenters = useMemo(() => {
    const set = new Set()
    for (const r of rows) {
      for (const k of Object.keys(r.by_profit_center || {})) {
        if (!POS_EXCLUDED_CENTERS.has(k)) set.add(k)
      }
    }
    return [...set].sort()
  }, [rows])

  const visibleRows = useMemo(() => {
    const out = []
    for (const r of rows) {
      let total = 0
      for (const c of allCenters) total += Number(r.by_profit_center?.[c] || 0)
      if (total === 0 && !allCenters.some((c) => c in (r.by_profit_center || {}))) continue
      out.push({ ...r, _displayTotal: total })
    }
    return sortByLastName(out)
  }, [rows, allCenters])

  if (!visibleRows.length) {
    return <p className="text-sm text-text-muted py-2">No commissions for this period.</p>
  }

  let grand = 0
  for (const r of visibleRows) grand += r._displayTotal

  return (
    <div className="space-y-2">
      {visibleRows.map((r) => (
        <div
          key={`${r.club_number}|${r.employee_name}`}
          className="bg-surface rounded-2xl border border-border p-4"
        >
          <div className="flex items-start justify-between mb-1">
            <p className="text-sm font-semibold text-text-primary leading-tight">{r.employee_name}</p>
            <p className="text-sm font-bold text-text-primary tabular-nums ml-2">${fmtMoney(r._displayTotal)}</p>
          </div>
          <p className="text-xs text-text-muted uppercase mb-2">{r.location_slug}</p>
          {allCenters.length > 1 && (
            <div className="flex flex-wrap gap-1.5 mt-1">
              {allCenters.map((c) => {
                const v = Number(r.by_profit_center?.[c] || 0)
                if (!v) return null
                return (
                  <span
                    key={c}
                    className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs bg-bg border border-border text-text-muted"
                  >
                    <span className="font-medium text-text-primary">{c}</span>
                    <span>${fmtMoney(v)}</span>
                  </span>
                )
              })}
            </div>
          )}
        </div>
      ))}
      {/* Grand total row */}
      <div className="bg-surface rounded-2xl border-2 border-wcs-red p-4 flex items-center justify-between">
        <p className="text-sm font-bold text-text-primary">Total</p>
        <p className="text-sm font-bold text-wcs-red tabular-nums">${fmtMoney(grand)}</p>
      </div>
    </div>
  )
}

// ---- PT Sales Commissions section ----
function RecurringSection({ rows }) {
  const [openKey, setOpenKey] = useState(null)
  const sortedRows = useMemo(() => sortByLastName(rows), [rows])

  if (!sortedRows.length) {
    return (
      <div className="py-2 space-y-1">
        <p className="text-sm text-text-muted">No PT sales for this period.</p>
        <p className="text-xs text-text-muted">If the month just ended, run the sync from Render Shell:</p>
        <pre className="text-xs bg-bg p-2 rounded border border-border overflow-x-auto">
          node scripts/sync-payroll-recurring.js --month YYYY-MM
        </pre>
      </div>
    )
  }

  const grandCommission = sortedRows.reduce((sum, r) => sum + Number(r.total_commission || 0), 0)
  const grandServices = sortedRows.reduce((sum, r) => sum + Number(r.services_count || 0), 0)

  return (
    <div className="space-y-2">
      {sortedRows.map((r) => {
        const key = `${r.club_number}|${r.employee_id || ''}|${r.employee_name}`
        const isOpen = openKey === key
        return (
          <div key={key} className="bg-surface rounded-2xl border border-border overflow-hidden">
            <button
              className="w-full p-4 text-left"
              onClick={() => setOpenKey(isOpen ? null : key)}
            >
              <div className="flex items-start justify-between">
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-semibold text-text-primary leading-tight">{r.employee_name}</p>
                  <p className="text-xs text-text-muted uppercase mt-0.5">{r.location_slug}</p>
                </div>
                <div className="flex items-center gap-2 ml-2 shrink-0">
                  <p className="text-sm font-bold text-text-primary tabular-nums">${fmtMoney(r.total_commission)}</p>
                  <span className="text-text-muted text-xs">{isOpen ? '▼' : '▶'}</span>
                </div>
              </div>
              <div className="flex gap-3 mt-2">
                <span className="text-xs text-text-muted">
                  <span className="font-medium text-text-primary">{r.services_count}</span> services
                </span>
                <span className="text-xs text-text-muted">
                  Contract: <span className="font-medium text-text-primary">${fmtMoney(r.total_contract_value)}</span>
                </span>
                <span className="text-xs text-text-muted">4% commission</span>
              </div>
            </button>

            {isOpen && (r.services || []).length > 0 && (
              <div className="border-t border-border bg-bg/40 p-3 space-y-2">
                {r.services.map((s) => (
                  <div
                    key={s.recurring_service_id}
                    className="bg-surface rounded-xl border border-border p-3 text-xs"
                  >
                    <div className="flex items-start justify-between mb-1">
                      <p className="font-medium text-text-primary leading-tight">{s.member_name || '—'}</p>
                      <p className="font-semibold text-text-primary tabular-nums ml-2">${fmtMoney(s.commission)}</p>
                    </div>
                    <p className="text-text-muted">{s.service_item || '—'}</p>
                    <div className="flex flex-wrap gap-x-3 gap-y-0.5 mt-1 text-text-muted">
                      {s.sale_date && <span>Date: {s.sale_date}</span>}
                      {s.recurring_type_desc && <span>{s.recurring_type_desc}</span>}
                      {s.invoice_total != null && <span>Invoice: ${fmtMoney(s.invoice_total)}</span>}
                      {s.total_periods != null && <span>Periods: {s.total_periods}</span>}
                      {s.total_contract_value != null && <span>Contract: ${fmtMoney(s.total_contract_value)}</span>}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )
      })}
      {/* Grand total */}
      <div className="bg-surface rounded-2xl border-2 border-wcs-red p-4">
        <div className="flex items-center justify-between">
          <p className="text-sm font-bold text-text-primary">Total</p>
          <p className="text-sm font-bold text-wcs-red tabular-nums">${fmtMoney(grandCommission)}</p>
        </div>
        <p className="text-xs text-text-muted mt-0.5">{grandServices} services @ 4%</p>
      </div>
    </div>
  )
}

// ---- Trainer Sessions section ----
function SessionsSection({ rows, eventTypes, onRefresh, refreshing }) {
  const sortedRows = useMemo(() => sortByLastName(rows), [rows])

  if (!sortedRows.length) {
    return <p className="text-sm text-text-muted py-2">No trainer sessions for this period.</p>
  }

  return (
    <div className="space-y-2">
      <div className="flex justify-end">
        <button
          onClick={onRefresh}
          disabled={refreshing}
          className="px-3 py-1.5 rounded-lg border border-border bg-bg text-text-primary text-xs font-medium hover:border-text-muted disabled:opacity-50"
        >
          {refreshing ? 'Refreshing…' : 'Refresh'}
        </button>
      </div>

      {sortedRows.map((r) => (
        <div
          key={`${r.club_number}|${r.employee_id}`}
          className="bg-surface rounded-2xl border border-border p-4"
        >
          <div className="flex items-start justify-between mb-1">
            <p className="text-sm font-semibold text-text-primary leading-tight">{r.employee_name}</p>
            <p className="text-sm font-bold text-text-primary tabular-nums ml-2">{r.total} total</p>
          </div>
          <p className="text-xs text-text-muted uppercase mb-2">{r.location_slug}</p>
          {eventTypes.length > 0 && (
            <div className="flex flex-wrap gap-1.5">
              {eventTypes.map((t) => {
                const cell = r.by_event_type?.[t]
                if (!cell) return null
                const c = cell.completed || 0
                const cc = cell.canceled_charge || 0
                if (!c && !cc) return null
                return (
                  <span
                    key={t}
                    className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs bg-bg border border-border text-text-muted"
                  >
                    <span className="font-medium text-text-primary">{t}</span>
                    <span>{c}{cc > 0 ? ` +${cc}` : ''}</span>
                  </span>
                )
              })}
            </div>
          )}
          {(r.canceled_charge > 0) && (
            <p className="text-[11px] text-text-muted mt-1">
              {r.completed || 0} completed · {r.canceled_charge} cxl-charge
            </p>
          )}
        </div>
      ))}

      <p className="text-[11px] text-text-muted px-1">
        Counts show Completed; "+N" indicates additional Canceled-Charge sessions.
      </p>
    </div>
  )
}

// ---- Main component ----
export default function MobilePayroll({ locationSlug }) {
  const monthOptions = useMemo(buildMonthOptions, [])
  const [period, setPeriod] = useState(defaultMonth())
  const [activeTab, setActiveTab] = useState('sales')

  const { data, loading, error, refetch } = useCancellableFetch(
    (signal) => {
      const params = { period }
      if (locationSlug && locationSlug !== 'all') params.location_slug = locationSlug
      return getPayrollReport(params, { cache: true, signal })
    },
    [period, locationSlug]
  )

  const summary = data?.summary || {}

  if (loading && !data) return <MobileLoading variant="report" />

  if (error) {
    return (
      <div className="p-4">
        <div className="bg-red-50 border border-red-200 rounded-2xl p-4 text-center">
          <p className="text-sm text-red-600">{error.message || String(error)}</p>
        </div>
      </div>
    )
  }

  return (
    <div className="p-4 space-y-3">
      {/* Month picker */}
      <div className="bg-surface rounded-2xl border border-border p-4 space-y-2">
        <p className="text-xs text-text-muted uppercase tracking-wide font-semibold">Pay Period</p>
        <select
          value={period}
          onChange={(e) => setPeriod(e.target.value)}
          className="w-full px-3 py-2 rounded-xl border border-border bg-bg text-text-primary text-sm focus:outline-none focus:ring-2 focus:ring-wcs-red"
        >
          {monthOptions.map((m) => (
            <option key={m.key} value={m.key}>{m.label}</option>
          ))}
        </select>
        {loading && <p className="text-xs text-text-muted">Loading…</p>}
      </div>

      {/* KPI summary cards */}
      {data && (
        <div className="overflow-x-auto scrollbar-hide">
          <div className="flex gap-3 min-w-max">
            <StatCard
              label="POS Commission"
              value={`$${fmtMoney(summary.sales_commission)}`}
              sub="From CSV upload"
            />
            <StatCard
              label="PT Commission"
              value={`$${fmtMoney(summary.recurring_commission)}`}
              sub={`${summary.recurring_services_count || 0} svcs @ 4%`}
            />
            <StatCard
              label="Trainer Sessions"
              value={summary.sessions_total || 0}
              sub={`${summary.sessions_completed || 0} done · ${summary.sessions_canceled_charge || 0} cxl`}
            />
            <StatCard
              label="Grand Total"
              value={`$${fmtMoney(summary.grand_total_commission)}`}
              sub="POS + PT"
            />
          </div>
        </div>
      )}

      {/* Section tab pills */}
      <div className="overflow-x-auto scrollbar-hide">
        <div className="flex gap-2 min-w-max">
          {SECTIONS.map((s) => (
            <button
              key={s.key}
              onClick={() => setActiveTab(s.key)}
              className={`px-4 py-1.5 rounded-full text-xs font-medium whitespace-nowrap transition-colors ${
                activeTab === s.key
                  ? 'bg-wcs-red text-white'
                  : 'bg-surface border border-border text-text-secondary'
              }`}
            >
              {s.label}
            </button>
          ))}
        </div>
      </div>

      {/* Section content */}
      {!data && !loading && (
        <p className="text-sm text-text-muted py-4 text-center">No data.</p>
      )}

      {data && activeTab === 'sales' && (
        <SalesSection rows={data.sales || []} />
      )}
      {data && activeTab === 'recurring' && (
        <RecurringSection rows={data.recurring || []} />
      )}
      {data && activeTab === 'sessions' && (
        <SessionsSection
          rows={data.sessions || []}
          eventTypes={data.session_event_types || []}
          onRefresh={refetch}
          refreshing={loading}
        />
      )}
    </div>
  )
}

function StatCard({ label, value, sub }) {
  return (
    <div className="min-w-[140px] bg-surface rounded-2xl border border-border p-4 flex-shrink-0">
      <p className="text-2xl font-bold text-text-primary tabular-nums">{value}</p>
      {sub && <p className="text-[11px] text-text-muted mt-0.5">{sub}</p>}
      <p className="text-xs text-text-muted uppercase mt-1">{label}</p>
    </div>
  )
}
