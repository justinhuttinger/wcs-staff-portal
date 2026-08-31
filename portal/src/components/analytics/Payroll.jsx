import { Fragment, useEffect, useMemo, useState } from 'react'
import { createPortal } from 'react-dom'
import {
  getPayrollReport,
  exportPayrollToSheet,
  getGoogleSheetsStatus,
  startGoogleSheetsAuth,
  disconnectGoogleSheets,
} from '../../lib/api'
import { useCancellableFetch } from '../../hooks/useCancellableFetch'
import DesktopLoading from '../DesktopLoading'
import { fmtInt } from './chartPalette'
import { zebraColumn } from './charts'
import { TOOLBAR_SLOT_ID } from './toolbarSlot'
import { LOCATION_NAMES } from '../../config/locations'

// ---------------------------------------------------------------------------
// Payroll — Analytics
//
// THE GOAL IS TO RUN PAYROLL, not to compare clubs. Everything here is arranged
// for somebody working down a list and paying people: three tables on three
// tabs, one per thing that gets paid, and no ranking, no club-vs-club chart, no
// trend. A club column exists to tell you who owes the money, not to rate it.
//
// SORTED BY LAST NAME BY DEFAULT. Payroll is run against a roster, and the
// roster is alphabetical by surname; ranking by dollars would mean hunting for
// each person instead of reading straight down.
//
// IT READS THE SAME ENDPOINT THE OLD REPORT DOES. /reports/payroll already
// resolves ABC's commission recipients, the 4% PT rate and the Pacific-day
// session bounds. A second implementation would eventually disagree with the
// one payroll is actually run from, and the disagreement would surface as
// somebody's pay being wrong.
// ---------------------------------------------------------------------------

const MONTH_NAMES = ['January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December']

const TABS = [
  { key: 'sales', label: 'POS Sale Commissions' },
  { key: 'recurring', label: 'PT Sales Commissions' },
  { key: 'sessions', label: 'Trainer Sessions' },
]

// POS commissions show ONLY these retail centers, in this order. DUES,
// TRAINING and the rest are not commissionable at the counter, and including
// them would put numbers on this table that nobody is being paid for.
const POS_CENTERS = ['WCS Drinks', 'WCS Merchandise', 'WCS Snacks', 'WCS Supplements', 'WCS Tanning']
const centerLabel = c => c.replace(/^WCS\s+/i, '')

const CLUB_NAMES = Object.fromEntries(LOCATION_NAMES.map(n => [n.toLowerCase(), n]))
const CLUB_LABEL = s => (s ? (CLUB_NAMES[s] || s.charAt(0).toUpperCase() + s.slice(1)) : s)

// Cents, always. The shared fmtMoney rounds to whole dollars, which is right
// for a revenue axis and wrong here: commission lines are $12.51, and a report
// that says $13 cannot be reconciled against what is actually paid.
function money(n) {
  const v = Number(n) || 0
  return `$${v.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
}

function lastNameKey(name) {
  if (!name) return ''
  const parts = String(name).trim().split(/\s+/)
  return parts[parts.length - 1].toLowerCase()
}

function byLastName(rows) {
  return [...rows].sort((a, b) =>
    lastNameKey(a.employee_name).localeCompare(lastNameKey(b.employee_name))
    || (a.employee_name || '').localeCompare(b.employee_name || ''))
}

// Twelve months back from the current one. Payroll is run for a month that has
// finished, so the previous month is the default rather than the live one.
function monthOptions() {
  const out = []
  const now = new Date()
  for (let i = 0; i < 13; i++) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1)
    out.push({
      key: `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`,
      label: `${MONTH_NAMES[d.getMonth()]} ${d.getFullYear()}`,
    })
  }
  return out
}

function defaultMonth() {
  const now = new Date()
  const d = new Date(now.getFullYear(), now.getMonth() - 1, 1)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
}

const HEAD = 'py-2 px-2 text-[11px] font-semibold uppercase tracking-wide'
const DASH = <span className="text-border">—</span>

function SortArrow({ active, dir }) {
  if (!active) return null
  return <span className="ml-1 text-wcs-red">{dir === 'asc' ? '▲' : '▼'}</span>
}

// --- POS sale commissions ---------------------------------------------------

function SalesTable({ rows }) {
  // Click a column to sort: highest first, then lowest, then back to the
  // roster order. The default has to be reachable again, or somebody who
  // sorted once can no longer read down the list the way payroll is run.
  const [sort, setSort] = useState({ key: null, dir: null })

  const centers = useMemo(() => {
    const present = new Set()
    for (const r of rows) for (const k of Object.keys(r.by_profit_center || {})) present.add(k)
    return POS_CENTERS.filter(c => present.has(c))
  }, [rows])

  const visible = useMemo(() => {
    const out = []
    for (const r of rows) {
      const total = centers.reduce((a, c) => a + Number(r.by_profit_center?.[c] || 0), 0)
      // Someone with no retail commission is not on this payroll page at all.
      if (total === 0 && !centers.some(c => c in (r.by_profit_center || {}))) continue
      out.push({ ...r, _total: total })
    }
    if (!sort.key) return byLastName(out)
    const mul = sort.dir === 'asc' ? 1 : -1
    const val = r => (sort.key === '_total' ? r._total : Number(r.by_profit_center?.[sort.key] || 0))
    return [...out].sort((a, b) => (val(a) - val(b)) * mul
      || lastNameKey(a.employee_name).localeCompare(lastNameKey(b.employee_name)))
  }, [rows, centers, sort])

  function toggle(key) {
    setSort(p => (p.key !== key ? { key, dir: 'desc' }
      : p.dir === 'desc' ? { key, dir: 'asc' } : { key: null, dir: null }))
  }

  if (visible.length === 0) {
    return <p className="text-sm text-text-muted text-center py-8">No POS commission in this period.</p>
  }

  const totals = Object.fromEntries(centers.map(c => [c, 0]))
  let grand = 0
  for (const r of visible) {
    for (const c of centers) totals[c] += Number(r.by_profit_center?.[c] || 0)
    grand += r._total
  }

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-border text-text-muted">
            <th className={`${HEAD} text-left`} style={zebraColumn(0)}>Employee</th>
            <th className={`${HEAD} text-left`} style={zebraColumn(1)}>Club</th>
            {centers.map((c, i) => (
              <th key={c} onClick={() => toggle(c)} title="Click to sort"
                className={`${HEAD} text-right cursor-pointer select-none whitespace-nowrap hover:text-wcs-red ${sort.key === c ? 'text-wcs-red' : ''}`}
                style={zebraColumn(i + 2)}>
                {centerLabel(c)}<SortArrow active={sort.key === c} dir={sort.dir} />
              </th>
            ))}
            <th onClick={() => toggle('_total')} title="Click to sort"
              className={`${HEAD} text-right cursor-pointer select-none hover:text-wcs-red ${sort.key === '_total' ? 'text-wcs-red' : 'text-text-primary'}`}
              style={zebraColumn(centers.length + 2)}>
              Total<SortArrow active={sort.key === '_total'} dir={sort.dir} />
            </th>
          </tr>
        </thead>
        <tbody>
          {visible.map(r => (
            <tr key={`${r.club_number}|${r.employee_name}`} className="border-b border-border/60 last:border-0">
              <td className="py-1.5 px-2 text-text-primary whitespace-nowrap" style={zebraColumn(0)}>{r.employee_name}</td>
              <td className="py-1.5 px-2 text-text-muted whitespace-nowrap" style={zebraColumn(1)}>{CLUB_LABEL(r.location_slug)}</td>
              {centers.map((c, i) => {
                const v = Number(r.by_profit_center?.[c] || 0)
                return (
                  <td key={c} className="py-1.5 px-2 text-right tabular-nums text-text-muted" style={zebraColumn(i + 2)}>
                    {v ? money(v) : DASH}
                  </td>
                )
              })}
              <td className="py-1.5 px-2 text-right tabular-nums font-semibold text-text-primary" style={zebraColumn(centers.length + 2)}>
                {money(r._total)}
              </td>
            </tr>
          ))}
        </tbody>
        <tfoot>
          <tr className="border-t-2 border-border font-semibold text-text-primary">
            <td className="py-1.5 px-2" colSpan={2}>Total</td>
            {centers.map(c => (
              <td key={c} className="py-1.5 px-2 text-right tabular-nums">{money(totals[c])}</td>
            ))}
            <td className="py-1.5 px-2 text-right tabular-nums">{money(grand)}</td>
          </tr>
        </tfoot>
      </table>
    </div>
  )
}

// --- PT sales commissions ---------------------------------------------------

function RecurringTable({ rows }) {
  const [openKey, setOpenKey] = useState(null)
  const sorted = useMemo(() => byLastName(rows), [rows])

  if (sorted.length === 0) {
    return (
      <div className="text-sm text-text-muted text-center py-8">
        <p>No PT sales in this period.</p>
        {/* The recurring pull is a script, not a nightly job — an empty month
            straight after month end usually means it has not been run. */}
        <p className="mt-2 text-xs">If the month has just ended, run the sync from the Render shell:</p>
        <code className="mt-1 inline-block text-xs bg-bg border border-border rounded px-2 py-1">
          node scripts/sync-payroll-recurring.js --month YYYY-MM
        </code>
      </div>
    )
  }

  const totals = sorted.reduce((a, r) => ({
    services: a.services + (r.services_count || 0),
    value: a.value + (Number(r.total_contract_value) || 0),
    commission: a.commission + (Number(r.total_commission) || 0),
  }), { services: 0, value: 0, commission: 0 })

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-border text-text-muted">
            {['Employee', 'Club', 'Services', 'Contract Value', 'Commission (4%)', ''].map((h, i) => (
              <th key={h || 'x'} className={`${HEAD} ${i >= 2 && i <= 4 ? 'text-right' : 'text-left'} ${i === 4 ? 'text-text-primary' : ''}`}
                style={zebraColumn(i)}>{h}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {sorted.map(r => {
            const key = `${r.club_number}|${r.employee_id || ''}|${r.employee_name}`
            const open = openKey === key
            return (
              <Fragment key={key}>
                {/* Every commission line is auditable: the row opens onto the
                    individual sales it was calculated from, which is what gets
                    checked when somebody queries their cheque. */}
                <tr className="border-b border-border/60 cursor-pointer hover:bg-bg/40"
                  onClick={() => setOpenKey(open ? null : key)}>
                  <td className="py-1.5 px-2 text-text-primary whitespace-nowrap" style={zebraColumn(0)}>{r.employee_name}</td>
                  <td className="py-1.5 px-2 text-text-muted whitespace-nowrap" style={zebraColumn(1)}>{CLUB_LABEL(r.location_slug)}</td>
                  <td className="py-1.5 px-2 text-right tabular-nums text-text-muted" style={zebraColumn(2)}>{fmtInt(r.services_count)}</td>
                  <td className="py-1.5 px-2 text-right tabular-nums text-text-muted" style={zebraColumn(3)}>{money(r.total_contract_value)}</td>
                  <td className="py-1.5 px-2 text-right tabular-nums font-semibold text-text-primary" style={zebraColumn(4)}>{money(r.total_commission)}</td>
                  <td className="py-1.5 px-2 text-right text-[11px] text-text-muted" style={zebraColumn(5)}>{open ? '▼' : '▶'}</td>
                </tr>
                {open && (
                  <tr className="bg-bg/30">
                    <td colSpan={6} className="px-2 py-3">
                      <div className="overflow-x-auto">
                        <table className="w-full text-xs">
                          <thead>
                            <tr className="text-text-muted">
                              {['Sale Date', 'Member', 'Service', 'Type', 'Invoice', 'Periods', 'Contract Value', 'Commission'].map((h, i) => (
                                <th key={h} className={`px-2 py-1 font-medium ${i >= 4 ? 'text-right' : 'text-left'}`}>{h}</th>
                              ))}
                            </tr>
                          </thead>
                          <tbody>
                            {(r.services || []).map(s => (
                              <tr key={s.recurring_service_id} className="border-t border-border/40">
                                <td className="px-2 py-1 text-text-muted whitespace-nowrap">{s.sale_date || DASH}</td>
                                <td className="px-2 py-1 text-text-primary">{s.member_name || DASH}</td>
                                <td className="px-2 py-1 text-text-muted">{s.service_item || DASH}</td>
                                <td className="px-2 py-1 text-text-muted">{s.recurring_type_desc || DASH}</td>
                                <td className="px-2 py-1 text-right tabular-nums text-text-muted">{money(s.invoice_total)}</td>
                                <td className="px-2 py-1 text-right tabular-nums text-text-muted">{fmtInt(s.total_periods)}</td>
                                <td className="px-2 py-1 text-right tabular-nums text-text-muted">{money(s.total_contract_value)}</td>
                                <td className="px-2 py-1 text-right tabular-nums font-semibold text-text-primary">{money(s.commission)}</td>
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
        <tfoot>
          <tr className="border-t-2 border-border font-semibold text-text-primary">
            <td className="py-1.5 px-2" colSpan={2}>Total</td>
            <td className="py-1.5 px-2 text-right tabular-nums">{fmtInt(totals.services)}</td>
            <td className="py-1.5 px-2 text-right tabular-nums">{money(totals.value)}</td>
            <td className="py-1.5 px-2 text-right tabular-nums">{money(totals.commission)}</td>
            <td />
          </tr>
        </tfoot>
      </table>
    </div>
  )
}

// --- Trainer sessions -------------------------------------------------------

function SessionsTable({ rows, eventTypes }) {
  const sorted = useMemo(() => byLastName(rows), [rows])
  if (sorted.length === 0) {
    return <p className="text-sm text-text-muted text-center py-8">No trainer sessions in this period.</p>
  }

  const totals = Object.fromEntries(eventTypes.map(t => [t, { completed: 0, canceled_charge: 0 }]))
  let grand = 0
  for (const r of sorted) {
    for (const t of eventTypes) {
      const c = r.by_event_type?.[t]
      if (!c) continue
      totals[t].completed += c.completed || 0
      totals[t].canceled_charge += c.canceled_charge || 0
    }
    grand += r.total || 0
  }

  const cell = c => {
    if (!c) return DASH
    const done = c.completed || 0
    const cxl = c.canceled_charge || 0
    return <>{fmtInt(done)}{cxl > 0 && <span className="text-text-muted/60"> +{cxl}</span>}</>
  }

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-border text-text-muted">
            <th className={`${HEAD} text-left`} style={zebraColumn(0)}>Trainer</th>
            <th className={`${HEAD} text-left`} style={zebraColumn(1)}>Club</th>
            {eventTypes.map((t, i) => (
              <th key={t} className={`${HEAD} text-right whitespace-nowrap`} style={zebraColumn(i + 2)}>{t}</th>
            ))}
            <th className={`${HEAD} text-right text-text-primary`} style={zebraColumn(eventTypes.length + 2)}>Total</th>
          </tr>
        </thead>
        <tbody>
          {sorted.map(r => (
            <tr key={`${r.club_number}|${r.employee_id}`} className="border-b border-border/60 last:border-0">
              <td className="py-1.5 px-2 text-text-primary whitespace-nowrap" style={zebraColumn(0)}>{r.employee_name}</td>
              <td className="py-1.5 px-2 text-text-muted whitespace-nowrap" style={zebraColumn(1)}>{CLUB_LABEL(r.location_slug)}</td>
              {eventTypes.map((t, i) => (
                <td key={t} className="py-1.5 px-2 text-right tabular-nums text-text-muted" style={zebraColumn(i + 2)}>
                  {cell(r.by_event_type?.[t])}
                </td>
              ))}
              <td className="py-1.5 px-2 text-right tabular-nums font-semibold text-text-primary" style={zebraColumn(eventTypes.length + 2)}>
                {fmtInt(r.total)}
              </td>
            </tr>
          ))}
        </tbody>
        <tfoot>
          <tr className="border-t-2 border-border font-semibold text-text-primary">
            <td className="py-1.5 px-2" colSpan={2}>Total</td>
            {eventTypes.map(t => (
              <td key={t} className="py-1.5 px-2 text-right tabular-nums">{cell(totals[t])}</td>
            ))}
            <td className="py-1.5 px-2 text-right tabular-nums">{fmtInt(grand)}</td>
          </tr>
        </tfoot>
      </table>
      {/* Canceled-Charge is billable and paid, so it cannot be dropped, but it
          is not a session that happened either. Kept beside the count rather
          than added into it. */}
      <p className="text-[11px] text-text-muted mt-2">
        Counts are Completed sessions. "+N" is additional Canceled-Charge sessions, which are billable.
      </p>
    </div>
  )
}

// --- export -----------------------------------------------------------------
//
// Payroll leaves this screen. It gets pasted into a payroll run, mailed to an
// accountant, or checked line by line against ABC, and none of that happens in
// a browser tab. Both exports carry ALL THREE TABS plus the per-service PT
// detail, not whichever tab happens to be open: an export that silently held
// only part of the month is worse than no export, because it looks complete.

function csvEscape(v) {
  if (v === null || v === undefined) return ''
  const str = String(v)
  return /[",\n]/.test(str) ? `"${str.replace(/"/g, '""')}"` : str
}

function downloadCsv(filename, rows) {
  const csv = rows.map(r => r.map(csvEscape).join(',')).join('\r\n')
  // The BOM is what makes Excel read UTF-8 rather than mangling names.
  const url = URL.createObjectURL(new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8;' }))
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
  URL.revokeObjectURL(url)
}

// Numbers go out unformatted, so the receiving sheet can add them up. A
// "$1,234.56" cell is text and silently breaks every downstream total.
function payrollCsvRows(data, periodLabel, locationSlug) {
  const rows = []
  rows.push([`Payroll — ${periodLabel}`])
  rows.push([`Location: ${locationSlug && locationSlug !== 'all' ? CLUB_LABEL(locationSlug) : 'All Clubs'}`])
  rows.push([])

  const s = data.summary || {}
  rows.push(['Summary'])
  rows.push(['POS Sales Commission', Number(s.sales_commission || 0).toFixed(2)])
  rows.push(['PT Sales Commission', Number(s.recurring_commission || 0).toFixed(2)])
  rows.push(['PT Services', s.recurring_services_count || 0])
  rows.push(['Trainer Sessions', s.sessions_total || 0])
  rows.push(['Sessions Completed', s.sessions_completed || 0])
  rows.push(['Sessions Canceled-Charge', s.sessions_canceled_charge || 0])
  rows.push(['Total Commission', Number(s.grand_total_commission || 0).toFixed(2)])
  rows.push([])

  const sales = byLastName(data.sales || [])
  const present = new Set()
  for (const r of sales) for (const k of Object.keys(r.by_profit_center || {})) present.add(k)
  const centers = POS_CENTERS.filter(c => present.has(c))
  rows.push(['POS Sale Commissions'])
  rows.push(['Employee', 'Club', ...centers.map(centerLabel), 'Total'])
  for (const r of sales) {
    let total = 0
    const cells = centers.map(c => {
      const v = Number(r.by_profit_center?.[c] || 0)
      total += v
      return v.toFixed(2)
    })
    if (total === 0 && !centers.some(c => c in (r.by_profit_center || {}))) continue
    rows.push([r.employee_name, CLUB_LABEL(r.location_slug), ...cells, total.toFixed(2)])
  }
  rows.push([])

  const recurring = byLastName(data.recurring || [])
  rows.push(['PT Sales Commissions'])
  rows.push(['Employee', 'Club', 'Services', 'Contract Value', 'Commission (4%)'])
  for (const r of recurring) {
    rows.push([r.employee_name, CLUB_LABEL(r.location_slug), r.services_count,
      Number(r.total_contract_value || 0).toFixed(2), Number(r.total_commission || 0).toFixed(2)])
  }
  rows.push([])

  rows.push(['PT Sales Detail'])
  rows.push(['Employee', 'Club', 'Sale Date', 'Member', 'Service', 'Type', 'Invoice', 'Periods', 'Contract Value', 'Commission'])
  for (const r of recurring) {
    for (const sv of r.services || []) {
      rows.push([r.employee_name, CLUB_LABEL(r.location_slug), sv.sale_date || '', sv.member_name || '',
        sv.service_item || '', sv.recurring_type_desc || '', Number(sv.invoice_total || 0).toFixed(2),
        sv.total_periods, Number(sv.total_contract_value || 0).toFixed(2), Number(sv.commission || 0).toFixed(2)])
    }
  }
  rows.push([])

  const sessions = byLastName(data.sessions || [])
  const types = data.session_event_types || []
  rows.push(['Trainer Sessions'])
  // Completed and Canceled-Charge get their own columns here. On screen they
  // share a cell as "8 +1"; in a spreadsheet that is a string nobody can sum.
  rows.push(['Trainer', 'Club', ...types.flatMap(t => [`${t} Completed`, `${t} CxlCharge`]),
    'Total Completed', 'Total CxlCharge', 'Total'])
  for (const r of sessions) {
    const cells = types.flatMap(t => {
      const c = r.by_event_type?.[t] || {}
      return [c.completed || 0, c.canceled_charge || 0]
    })
    rows.push([r.employee_name, CLUB_LABEL(r.location_slug), ...cells,
      r.completed || 0, r.canceled_charge || 0, r.total || 0])
  }
  return rows
}

// --- report -----------------------------------------------------------------

export default function Payroll({ locationSlug }) {
  const months = useMemo(monthOptions, [])
  const [period, setPeriod] = useState(defaultMonth)
  const [tab, setTab] = useState('sales')

  const { data, loading, error, retrying } = useCancellableFetch(
    signal => {
      const params = { period }
      if (locationSlug && locationSlug !== 'all') params.location_slug = locationSlug
      return getPayrollReport(params, { cache: true, signal })
    },
    [period, locationSlug]
  )

  const s = data?.summary || {}
  const periodLabel = (months.find(m => m.key === period) || {}).label || period

  const [exportError, setExportError] = useState(null)
  const [exportingSheet, setExportingSheet] = useState(false)
  const [google, setGoogle] = useState({ loaded: false, connected: false, email: null })
  const [connecting, setConnecting] = useState(false)

  async function refreshGoogle() {
    try {
      const st = await getGoogleSheetsStatus()
      setGoogle({ loaded: true, connected: !!st.connected, email: st.email || null })
    } catch {
      setGoogle({ loaded: true, connected: false, email: null })
    }
  }

  useEffect(() => { refreshGoogle() }, [])

  // The OAuth popup posts back on success. Polling for close is the backup,
  // because a browser that blocks the message still closes the window.
  useEffect(() => {
    function onMessage(e) {
      if (e.data && e.data.type === 'google-sheets-auth') refreshGoogle()
    }
    window.addEventListener('message', onMessage)
    return () => window.removeEventListener('message', onMessage)
  }, [])

  async function connectGoogle() {
    if (connecting) return
    setConnecting(true)
    setExportError(null)
    try {
      const { url } = await startGoogleSheetsAuth()
      const popup = window.open(url, 'wcs-google-auth', 'width=520,height=720')
      if (!popup) throw new Error('Popup blocked. Allow popups for this site and try again.')
      const timer = setInterval(() => {
        if (popup.closed) {
          clearInterval(timer)
          refreshGoogle()
          setConnecting(false)
        }
      }, 800)
    } catch (err) {
      setExportError(err.message || 'Could not start Google sign-in')
      setConnecting(false)
    }
  }

  function exportCsv() {
    if (!data) return
    const scope = locationSlug && locationSlug !== 'all' ? `-${locationSlug}` : ''
    downloadCsv(`payroll-${period}${scope}.csv`, payrollCsvRows(data, periodLabel, locationSlug))
  }

  async function exportSheet() {
    if (exportingSheet) return
    if (!google.connected) return connectGoogle()
    setExportingSheet(true)
    setExportError(null)
    try {
      const params = { period }
      if (locationSlug && locationSlug !== 'all') params.location_slug = locationSlug
      const result = await exportPayrollToSheet(params)
      if (result?.url) window.open(result.url, '_blank', 'noopener')
    } catch (err) {
      const msg = err?.message || 'Export failed'
      // The token can expire between loading the page and clicking export.
      if (/google_not_connected/i.test(msg)) {
        await refreshGoogle()
        setExportError('Google is not connected. Click Connect Google and try again.')
      } else {
        setExportError(msg)
      }
    } finally {
      setExportingSheet(false)
    }
  }

  return (
    <div className="space-y-3">
      <Toolbar
        months={months} period={period} setPeriod={setPeriod}
        canExport={!!data && !loading}
        onCsv={exportCsv}
        onSheet={exportSheet}
        onDisconnect={async () => {
          try { await disconnectGoogleSheets(); await refreshGoogle() }
          catch (err) { setExportError(err.message || 'Disconnect failed') }
        }}
        google={google} connecting={connecting} exportingSheet={exportingSheet}
      />

      {exportError && (
        <div className="bg-surface rounded-xl border border-amber-500/40 p-3">
          <p className="text-[11px] text-amber-600">{exportError}</p>
        </div>
      )}

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
                { label: 'POS Sales Commission', value: money(s.sales_commission), sub: 'From the monthly upload' },
                { label: 'PT Sales Commission', value: money(s.recurring_commission), sub: `${fmtInt(s.recurring_services_count)} services at 4%` },
                { label: 'Trainer Sessions', value: fmtInt(s.sessions_total), sub: `${fmtInt(s.sessions_completed)} completed, ${fmtInt(s.sessions_canceled_charge)} cxl-charge`, muted: true },
                { label: 'Total Commission', value: money(s.grand_total_commission), sub: 'POS plus PT' },
              ].map(t => (
                <div key={t.label} className="px-5 py-4 text-center min-w-[170px] flex-1">
                  <p className={`text-xl font-bold tabular-nums ${t.muted ? 'text-text-muted' : 'text-text-primary'}`}>{t.value}</p>
                  <p className="text-[11px] text-text-muted mt-0.5 leading-tight">{t.label}</p>
                  <p className="text-[10px] text-text-muted/70 mt-0.5 leading-tight">{t.sub}</p>
                </div>
              ))}
            </div>
          </div>

          <div className="bg-surface rounded-xl border border-border">
            <div className="flex border-b border-border overflow-x-auto">
              {TABS.map(t => (
                <button key={t.key} onClick={() => setTab(t.key)}
                  className={`px-4 py-2.5 text-xs font-semibold whitespace-nowrap transition-colors ${
                    tab === t.key
                      ? 'text-wcs-red border-b-2 border-wcs-red'
                      : 'text-text-muted hover:text-text-primary'
                  }`}>
                  {t.label}
                </button>
              ))}
            </div>
            <div className="p-3">
              {tab === 'sales' && <SalesTable rows={data.sales || []} />}
              {tab === 'recurring' && <RecurringTable rows={data.recurring || []} />}
              {tab === 'sessions' && (
                <SessionsTable rows={data.sessions || []} eventTypes={data.session_event_types || []} />
              )}
            </div>
          </div>
        </>
      )}
    </div>
  )
}

function Toolbar({
  months, period, setPeriod, canExport, onCsv, onSheet, onDisconnect,
  google, connecting, exportingSheet,
}) {
  const [slot, setSlot] = useState(null)
  useEffect(() => { setSlot(document.getElementById(TOOLBAR_SLOT_ID)) }, [])
  if (!slot) return null
  const cls = 'px-2.5 py-1.5 rounded-lg text-xs bg-bg border border-border text-text-primary normal-case tracking-normal font-medium'
  const btn = `${cls} disabled:opacity-50 hover:border-text-muted`
  return createPortal(
    <div className="flex flex-wrap items-center gap-2">
      <label className="flex items-center gap-1.5 text-[11px] font-semibold text-text-muted uppercase tracking-wide">
        Pay Period
        <select value={period} onChange={e => setPeriod(e.target.value)} className={cls}>
          {months.map(m => <option key={m.key} value={m.key}>{m.label}</option>)}
        </select>
      </label>

      <button type="button" onClick={onCsv} disabled={!canExport} className={btn}>
        Export CSV
      </button>

      {google.loaded && !google.connected ? (
        <button type="button" onClick={onSheet} disabled={connecting}
          className={`${btn} border-wcs-red bg-wcs-red text-white hover:border-wcs-red`}>
          {connecting ? 'Connecting…' : 'Connect Google to Export Sheet'}
        </button>
      ) : (
        <button type="button" onClick={onSheet} disabled={!canExport || exportingSheet || !google.loaded}
          className={`${btn} border-wcs-red bg-wcs-red text-white hover:border-wcs-red`}>
          {exportingSheet ? 'Creating Sheet…' : 'Export to Google Sheets'}
        </button>
      )}

      {/* The Sheet lands in the signed-in person's own Drive, so whose account
          is connected is part of where the file went. */}
      {google.loaded && google.connected && google.email && (
        <span className="text-[10px] text-text-muted normal-case tracking-normal">
          {google.email}
          <button type="button" onClick={onDisconnect} className="ml-1 underline hover:text-text-primary">
            Disconnect
          </button>
        </span>
      )}
    </div>,
    slot
  )
}
