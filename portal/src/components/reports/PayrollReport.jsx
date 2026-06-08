import { Fragment, useEffect, useMemo, useState } from 'react'
import {
  getPayrollReport,
  exportPayrollToSheet,
  getGoogleSheetsStatus,
  startGoogleSheetsAuth,
  disconnectGoogleSheets,
} from '../../lib/api'
import { useCancellableFetch } from '../../hooks/useCancellableFetch'
import { StatBlock, StatCell } from './StatBlock'

const MONTH_NAMES = ['January','February','March','April','May','June','July','August','September','October','November','December']

const SECTIONS = [
  { key: 'sales',     label: 'POS Sale Commissions' },
  { key: 'recurring', label: 'PT Sales Commissions' },
  { key: 'sessions',  label: 'Trainer Sessions' },
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

function csvEscape(v) {
  if (v == null) return ''
  const s = String(v)
  if (/[",\n]/.test(s)) return '"' + s.replace(/"/g, '""') + '"'
  return s
}

function downloadCsv(filename, rows) {
  const csv = rows.map((row) => row.map(csvEscape).join(',')).join('\r\n')
  const blob = new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8;' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
  URL.revokeObjectURL(url)
}

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

function SalesTable({ rows }) {
  // Collect all profit-center keys present (excluding POS-excluded centers
  // like TRAINING, which belongs under PT Sales Commissions).
  const allCenters = useMemo(() => {
    const set = new Set()
    for (const r of rows) {
      for (const k of Object.keys(r.by_profit_center || {})) {
        if (!POS_EXCLUDED_CENTERS.has(k)) set.add(k)
      }
    }
    return [...set].sort()
  }, [rows])

  // Recompute per-row totals excluding the dropped centers, then drop rows
  // that have no remaining commissions.
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
    return <p className="text-sm text-text-muted">No commissions for this period.</p>
  }

  const totals = {}
  for (const c of allCenters) totals[c] = 0
  let grand = 0
  for (const r of visibleRows) {
    for (const c of allCenters) totals[c] += Number(r.by_profit_center?.[c] || 0)
    grand += r._displayTotal
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
          {visibleRows.map((r) => (
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
              <td className="px-3 py-2 text-right tabular-nums font-semibold text-text-primary">${fmtMoney(r._displayTotal)}</td>
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
  const sortedRows = useMemo(() => sortByLastName(rows), [rows])
  if (!sortedRows.length) {
    return (
      <div className="text-sm text-text-muted">
        <p>No PT sales for this period.</p>
        <p className="mt-2 text-xs">If the month just ended, run the sync from Render Shell:</p>
        <pre className="mt-1 text-xs bg-bg p-2 rounded border border-border overflow-x-auto">node scripts/sync-payroll-recurring.js --month YYYY-MM</pre>
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
          {sortedRows.map((r) => {
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

function SessionsTable({ rows, eventTypes, onRefresh, refreshing }) {
  const sortedRows = useMemo(() => sortByLastName(rows), [rows])
  return (
    <div className="space-y-3">
      <div className="flex justify-end">
        <button
          onClick={onRefresh}
          disabled={refreshing}
          className="px-3 py-1.5 rounded-lg border border-border bg-bg text-text-primary text-xs font-medium hover:border-text-muted disabled:opacity-50"
        >
          {refreshing ? 'Refreshing…' : 'Refresh'}
        </button>
      </div>
      {!sortedRows.length ? (
        <p className="text-sm text-text-muted">No trainer sessions for this period.</p>
      ) : (
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
          {sortedRows.map((r) => (
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
      )}
    </div>
  )
}

export default function PayrollReport({ locationSlug }) {
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

  const [exportingSheet, setExportingSheet] = useState(false)
  const [exportError, setExportError] = useState(null)

  // ---- Per-user Google connection ----
  const [googleStatus, setGoogleStatus] = useState({ loaded: false, connected: false, email: null })
  const [connectingGoogle, setConnectingGoogle] = useState(false)

  async function refreshGoogleStatus() {
    try {
      const s = await getGoogleSheetsStatus()
      setGoogleStatus({ loaded: true, connected: !!s.connected, email: s.email || null })
    } catch {
      setGoogleStatus({ loaded: true, connected: false, email: null })
    }
  }

  useEffect(() => { refreshGoogleStatus() }, [])

  // Watch for the popup posting back after a successful connect.
  useEffect(() => {
    function onMessage(e) {
      if (e.data && e.data.type === 'google-sheets-auth') {
        refreshGoogleStatus()
      }
    }
    window.addEventListener('message', onMessage)
    return () => window.removeEventListener('message', onMessage)
  }, [])

  async function handleConnectGoogle() {
    if (connectingGoogle) return
    setConnectingGoogle(true)
    setExportError(null)
    try {
      const { url } = await startGoogleSheetsAuth()
      const popup = window.open(url, 'wcs-google-auth', 'width=520,height=720')
      if (!popup) throw new Error('Popup blocked — allow popups for this site and retry.')
      // Poll for closure as a backup if postMessage is missed.
      const timer = setInterval(() => {
        if (popup.closed) {
          clearInterval(timer)
          refreshGoogleStatus()
          setConnectingGoogle(false)
        }
      }, 800)
    } catch (e) {
      setExportError(e.message || 'Failed to start Google sign-in')
      setConnectingGoogle(false)
    }
  }

  async function handleDisconnectGoogle() {
    try {
      await disconnectGoogleSheets()
      await refreshGoogleStatus()
    } catch (e) {
      setExportError(e.message || 'Disconnect failed')
    }
  }

  async function handleExportSheet() {
    if (exportingSheet) return
    if (!googleStatus.connected) {
      handleConnectGoogle()
      return
    }
    setExportingSheet(true)
    setExportError(null)
    try {
      const params = { period }
      if (locationSlug && locationSlug !== 'all') params.location_slug = locationSlug
      const result = await exportPayrollToSheet(params)
      if (result?.url) window.open(result.url, '_blank', 'noopener')
    } catch (e) {
      const msg = e?.message || 'Export failed'
      if (/google_not_connected/i.test(msg)) {
        await refreshGoogleStatus()
        setExportError('Google not connected — click Connect Google.')
      } else {
        setExportError(msg)
      }
    } finally {
      setExportingSheet(false)
    }
  }

  function handleExport() {
    if (!data) return
    const rows = []
    const periodLabel = (() => {
      const m = monthOptions.find((o) => o.key === period)
      return m ? m.label : period
    })()
    rows.push([`Payroll Report — ${periodLabel}`])
    rows.push([`Location: ${locationSlug || 'all'}`])
    rows.push([])
    rows.push(['Summary'])
    rows.push(['POS Sales Commission', data.summary?.sales_commission ?? 0])
    rows.push(['PT Sales Commission', data.summary?.recurring_commission ?? 0])
    rows.push(['PT Sales Services Count', data.summary?.recurring_services_count ?? 0])
    rows.push(['Trainer Sessions Total', data.summary?.sessions_total ?? 0])
    rows.push(['Sessions Completed', data.summary?.sessions_completed ?? 0])
    rows.push(['Sessions Canceled-Charge', data.summary?.sessions_canceled_charge ?? 0])
    rows.push(['Grand Total Commission', data.summary?.grand_total_commission ?? 0])
    rows.push([])

    // ---- POS Sale Commissions ----
    const sales = sortByLastName(data.sales || [])
    const posCenters = new Set()
    for (const r of sales) {
      for (const k of Object.keys(r.by_profit_center || {})) {
        if (!POS_EXCLUDED_CENTERS.has(k)) posCenters.add(k)
      }
    }
    const posCols = [...posCenters].sort()
    rows.push(['POS Sale Commissions'])
    rows.push(['Employee', 'Club', ...posCols, 'Total'])
    for (const r of sales) {
      let total = 0
      const cells = posCols.map((c) => {
        const v = Number(r.by_profit_center?.[c] || 0)
        total += v
        return v.toFixed(2)
      })
      if (total === 0 && !posCols.some((c) => c in (r.by_profit_center || {}))) continue
      rows.push([r.employee_name, r.location_slug, ...cells, total.toFixed(2)])
    }
    rows.push([])

    // ---- PT Sales Commissions (per-employee summary) ----
    const recurring = sortByLastName(data.recurring || [])
    rows.push(['PT Sales Commissions'])
    rows.push(['Employee', 'Club', 'Services', 'Contract Value', 'Commission (4%)'])
    for (const r of recurring) {
      rows.push([
        r.employee_name,
        r.location_slug,
        r.services_count,
        Number(r.total_contract_value).toFixed(2),
        Number(r.total_commission).toFixed(2),
      ])
    }
    rows.push([])

    // ---- PT Sales Detail (per-service) ----
    rows.push(['PT Sales Detail'])
    rows.push(['Employee', 'Club', 'Sale Date', 'Member', 'Service', 'Type', 'Invoice', 'Periods', 'Contract Value', 'Commission'])
    for (const r of recurring) {
      for (const s of r.services || []) {
        rows.push([
          r.employee_name,
          r.location_slug,
          s.sale_date || '',
          s.member_name || '',
          s.service_item || '',
          s.recurring_type_desc || '',
          Number(s.invoice_total).toFixed(2),
          s.total_periods,
          Number(s.total_contract_value).toFixed(2),
          Number(s.commission).toFixed(2),
        ])
      }
    }
    rows.push([])

    // ---- Trainer Sessions ----
    const sessions = sortByLastName(data.sessions || [])
    const eventTypes = data.session_event_types || []
    rows.push(['Trainer Sessions'])
    rows.push(['Trainer', 'Club', ...eventTypes.flatMap((t) => [`${t} Completed`, `${t} CxlCharge`]), 'Total Completed', 'Total CxlCharge', 'Total'])
    for (const r of sessions) {
      const cells = eventTypes.flatMap((t) => {
        const cell = r.by_event_type[t] || { completed: 0, canceled_charge: 0 }
        return [cell.completed || 0, cell.canceled_charge || 0]
      })
      rows.push([r.employee_name, r.location_slug, ...cells, r.completed || 0, r.canceled_charge || 0, r.total || 0])
    }

    const filename = `payroll-${period}${locationSlug && locationSlug !== 'all' ? '-' + locationSlug : ''}.csv`
    downloadCsv(filename, rows)
  }

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
        {error && <span className="text-xs text-red-500">{error.message || String(error)}</span>}
        {exportError && <span className="text-xs text-red-500">{exportError}</span>}
        <div className="ml-auto flex items-center gap-2">
          {googleStatus.loaded && googleStatus.connected && (
            <span className="text-[11px] text-text-muted">
              Google: {googleStatus.email}{' '}
              <button
                onClick={handleDisconnectGoogle}
                className="underline hover:text-text-primary"
              >
                Disconnect
              </button>
            </span>
          )}
          <button
            onClick={handleExport}
            disabled={!data || loading}
            className="px-3 py-1.5 rounded-lg border border-border bg-bg text-text-primary text-xs font-medium hover:border-text-muted disabled:opacity-50"
          >
            Export CSV
          </button>
          {googleStatus.loaded && !googleStatus.connected ? (
            <button
              onClick={handleConnectGoogle}
              disabled={connectingGoogle}
              className="px-3 py-1.5 rounded-lg border border-wcs-red bg-wcs-red text-white text-xs font-medium hover:bg-wcs-red/90 disabled:opacity-50"
            >
              {connectingGoogle ? 'Connecting…' : 'Connect Google to Export Sheet'}
            </button>
          ) : (
            <button
              onClick={handleExportSheet}
              disabled={!data || loading || exportingSheet || !googleStatus.loaded}
              className="px-3 py-1.5 rounded-lg border border-wcs-red bg-wcs-red text-white text-xs font-medium hover:bg-wcs-red/90 disabled:opacity-50"
            >
              {exportingSheet ? 'Creating Sheet…' : 'Export to Google Sheets'}
            </button>
          )}
        </div>
      </div>

      {/* KPIs */}
      <StatBlock cols={4}>
        <StatCell
          label="POS Sales Commission"
          value={`$${fmtMoney(summary.sales_commission)}`}
          sub="From CSV upload"
        />
        <StatCell
          label="PT Sales Commission"
          value={`$${fmtMoney(summary.recurring_commission)}`}
          sub={`${summary.recurring_services_count || 0} services @ 4%`}
        />
        <StatCell
          label="Trainer Sessions"
          value={summary.sessions_total || 0}
          sub={`${summary.sessions_completed || 0} completed · ${summary.sessions_canceled_charge || 0} cxl-charge`}
        />
        <StatCell
          label="Grand Total Commission"
          value={`$${fmtMoney(summary.grand_total_commission)}`}
          sub="POS + PT Sales"
        />
      </StatBlock>

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
            <SessionsTable
              rows={data.sessions || []}
              eventTypes={data.session_event_types || []}
              onRefresh={refetch}
              refreshing={loading}
            />
          )}
        </div>
      </div>
    </div>
  )
}
