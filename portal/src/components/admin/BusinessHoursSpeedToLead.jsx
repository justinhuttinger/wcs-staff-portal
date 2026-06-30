import { useState, useEffect, useMemo } from 'react'
import { getSpeedToLeadBusinessAudit } from '../../lib/api'
import { exportCSV, exportPDF } from '../../lib/export'
import { formatMinutes } from '../../lib/kpiMath'
import { LOCATION_NAMES } from '../../config/locations'

function fmtDate(d) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}
function defaultRange() {
  const now = new Date()
  const start = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 29)
  return { start: fmtDate(start), end: fmtDate(now) }
}

const QUICK_RANGES = [
  { key: 'this_month', label: 'This Month' },
  { key: 'last_month', label: 'Last Month' },
  { key: 'last_30', label: 'Last 30 Days' },
  { key: 'last_90', label: 'Last 90 Days' },
  { key: 'ytd', label: 'YTD' },
]
function quickRange(key) {
  const now = new Date()
  const y = now.getFullYear(), m = now.getMonth()
  switch (key) {
    case 'this_month': return { start: fmtDate(new Date(y, m, 1)), end: fmtDate(now) }
    case 'last_month': return { start: fmtDate(new Date(y, m - 1, 1)), end: fmtDate(new Date(y, m, 0)) }
    case 'last_30': return { start: fmtDate(new Date(y, m, now.getDate() - 29)), end: fmtDate(now) }
    case 'last_90': return { start: fmtDate(new Date(y, m, now.getDate() - 89)), end: fmtDate(now) }
    case 'ytd': return { start: fmtDate(new Date(y, 0, 1)), end: fmtDate(now) }
    default: return defaultRange()
  }
}

const REASON_LABEL = {
  counted: 'Counted',
  no_human_contact: 'Awaiting contact',
  not_new_lead: 'Not a new lead',
  contact_before_create: 'Contacted before lead created',
  dnd: 'DND (excluded)',
}

const STATUS_FILTERS = [
  { key: 'all', label: 'All' },
  { key: 'counted', label: 'Counted' },
  { key: 'no_human_contact', label: 'Awaiting contact' },
  { key: 'not_new_lead', label: 'Not a new lead' },
  { key: 'contact_before_create', label: 'Contacted before created' },
  { key: 'dnd', label: 'DND' },
]

function StatCard({ label, value, hint }) {
  return (
    <div className="bg-bg rounded-lg border border-border px-4 py-3 flex-1 min-w-[140px]">
      <p className="text-[11px] uppercase tracking-wide text-text-muted">{label}</p>
      <p className="text-2xl font-bold text-text-primary mt-1">{value}</p>
      {hint && <p className="text-[11px] text-text-muted mt-0.5">{hint}</p>}
    </div>
  )
}

export default function BusinessHoursSpeedToLead() {
  const [loc, setLoc] = useState('all')
  const [range, setRange] = useState(defaultRange)
  const [rows, setRows] = useState([])
  const [summary, setSummary] = useState(null)
  const [meta, setMeta] = useState({ returned: 0, truncated: false })
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(null)
  const [statusFilter, setStatusFilter] = useState('all')

  function load(r = range) {
    setLoading(true)
    setError(null)
    getSpeedToLeadBusinessAudit({ location_slug: loc, start_date: r.start, end_date: r.end })
      .then(d => {
        setRows(d.rows || [])
        setSummary(d.summary || null)
        setMeta({ returned: d.returned || 0, truncated: !!d.truncated })
      })
      .catch(e => setError(e.message || 'Failed to load'))
      .finally(() => setLoading(false))
  }

  function pickQuick(key) {
    const r = quickRange(key)
    setRange(r)
    load(r)
  }

  useEffect(() => { load() }, []) // initial load

  const counts = useMemo(() => {
    const c = { all: rows.length }
    for (const r of rows) c[r.reason] = (c[r.reason] || 0) + 1
    return c
  }, [rows])

  const shown = statusFilter === 'all' ? rows : rows.filter(r => r.reason === statusFilter)

  function exportRows() {
    return [
      ['Contact', 'Club', 'Lead Created', 'First Human Contact', 'Raw Speed (min)', 'Business Speed (min)', 'Status'],
      ...shown.map(r => [
        r.contact_name || '',
        r.club || '',
        r.opportunity_created_at ? new Date(r.opportunity_created_at).toLocaleString() : '',
        r.first_human_contact_at ? new Date(r.first_human_contact_at).toLocaleString() : '',
        r.included && r.raw_minutes != null ? r.raw_minutes : '',
        r.included && r.business_minutes != null ? r.business_minutes : '',
        REASON_LABEL[r.reason] || r.reason || '',
      ]),
    ]
  }
  const exportName = `business-hours-speed-to-lead_${range.start}_to_${range.end}`

  return (
    <div className="bg-surface/95 backdrop-blur-sm rounded-xl border border-border p-5 space-y-4">
      <div>
        <h3 className="text-sm font-bold text-text-primary">Business-Hours Speed to Lead <span className="ml-1 text-[10px] uppercase tracking-wide text-wcs-red font-bold">Beta</span></h3>
        <p className="text-xs text-text-muted mt-1">Two numbers per lead. <span className="text-text-primary font-medium">Raw</span> = wall-clock from lead creation to first manual human SMS/call. <span className="text-text-primary font-medium">Business-hours</span> = the same span with after-hours and weekend time clamped out (staffed window 8:00am-8:00pm, every day). Raw exposes after-hours coverage gaps; business-hours coaches staff responsiveness.</p>
      </div>

      {/* Median cards */}
      <div className="flex items-stretch gap-3 flex-wrap">
        <StatCard label="Raw STL (median)" value={formatMinutes(summary?.raw_median_minutes)} hint="Honest customer-experience number" />
        <StatCard label="Business-Hours STL (median)" value={formatMinutes(summary?.business_median_minutes)} hint="After-hours / weekend clamped out" />
        <StatCard label="Counted" value={summary?.counted_count ?? 0} hint="Leads in the medians" />
        <StatCard label="Awaiting contact" value={summary?.uncontacted_count ?? 0} hint="No human outreach yet" />
      </div>

      <div className="flex items-center gap-3 flex-wrap">
        <select
          value={loc}
          onChange={e => setLoc(e.target.value)}
          className="px-3 py-1.5 rounded-lg border border-border bg-bg text-text-primary text-sm focus:outline-none focus:border-wcs-red"
        >
          <option value="all">All Locations</option>
          {LOCATION_NAMES.map(n => <option key={n} value={n.toLowerCase()}>{n}</option>)}
        </select>
        <label className="text-xs text-text-muted">From</label>
        <input type="date" value={range.start} onChange={e => setRange(r => ({ ...r, start: e.target.value }))}
          className="px-3 py-1.5 rounded-lg border border-border bg-bg text-text-primary text-sm focus:outline-none focus:border-wcs-red" />
        <label className="text-xs text-text-muted">To</label>
        <input type="date" value={range.end} onChange={e => setRange(r => ({ ...r, end: e.target.value }))}
          className="px-3 py-1.5 rounded-lg border border-border bg-bg text-text-primary text-sm focus:outline-none focus:border-wcs-red" />
        <button onClick={() => load()} disabled={loading}
          className="text-xs bg-wcs-red text-white rounded-lg px-4 py-1.5 font-medium hover:bg-wcs-red/90 disabled:opacity-50">
          {loading ? 'Loading…' : 'Load'}
        </button>
        <div className="flex items-center gap-2 ml-auto">
          <button onClick={() => exportCSV(exportRows(), exportName)} disabled={shown.length === 0}
            className="text-xs border border-border rounded-lg px-3 py-1.5 font-medium text-text-muted hover:text-text-primary hover:border-text-muted disabled:opacity-50">
            Export (Sheets/CSV)
          </button>
          <button onClick={() => exportPDF(`Business-Hours Speed to Lead — ${range.start} to ${range.end}`)} disabled={shown.length === 0}
            className="text-xs border border-border rounded-lg px-3 py-1.5 font-medium text-text-muted hover:text-text-primary hover:border-text-muted disabled:opacity-50">
            Export PDF
          </button>
        </div>
      </div>

      {/* Quick date ranges */}
      <div className="flex items-center gap-1.5 flex-wrap">
        {QUICK_RANGES.map(q => (
          <button key={q.key} onClick={() => pickQuick(q.key)}
            className="px-2.5 py-1 rounded-full text-[11px] font-semibold border border-border bg-bg text-text-muted hover:text-text-primary hover:border-text-muted transition-colors">
            {q.label}
          </button>
        ))}
      </div>

      {/* Status filter */}
      <div className="flex items-center gap-1.5 flex-wrap">
        {STATUS_FILTERS.map(f => {
          const n = counts[f.key] || 0
          const active = statusFilter === f.key
          const disabled = f.key !== 'all' && n === 0
          return (
            <button
              key={f.key}
              onClick={() => setStatusFilter(f.key)}
              disabled={disabled}
              className={`px-2.5 py-1 rounded-full text-[11px] font-semibold border transition-colors ${
                active
                  ? 'bg-wcs-red text-white border-wcs-red'
                  : 'bg-bg text-text-muted border-border hover:text-text-primary hover:border-text-muted'
              } ${disabled ? 'opacity-40 cursor-not-allowed' : ''}`}
            >
              {f.label} <span className={active ? 'text-white/80' : 'text-text-primary/70'}>{n}</span>
            </button>
          )
        })}
      </div>

      {error && <p className="text-xs text-red-500">{error}</p>}
      {!error && (
        <p className="text-xs text-text-muted">
          Showing {shown.length} of {meta.returned} leads
          {meta.truncated && ' · (capped — narrow the date range to see more)'}
        </p>
      )}

      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-[11px] uppercase tracking-wide text-text-muted border-b border-border">
              <th className="text-left font-semibold py-2">Contact</th>
              <th className="text-left font-semibold py-2">Club</th>
              <th className="text-left font-semibold py-2">Lead Created</th>
              <th className="text-left font-semibold py-2">First Human Contact</th>
              <th className="text-right font-semibold py-2">Raw</th>
              <th className="text-right font-semibold py-2">Business</th>
              <th className="text-left font-semibold py-2 pl-3">Status</th>
            </tr>
          </thead>
          <tbody>
            {shown.map((r, i) => (
              <tr key={i} className="border-b border-border/60">
                <td className="py-1.5 text-text-primary">{r.contact_name}</td>
                <td className="py-1.5 text-text-muted">{r.club}</td>
                <td className="py-1.5 text-text-muted">{r.opportunity_created_at ? new Date(r.opportunity_created_at).toLocaleString() : '—'}</td>
                <td className="py-1.5 text-text-muted">{r.first_human_contact_at ? new Date(r.first_human_contact_at).toLocaleString() : '—'}</td>
                <td className="py-1.5 text-right text-text-muted">{r.included ? formatMinutes(r.raw_minutes) : '—'}</td>
                <td className="py-1.5 text-right text-text-primary font-medium">{r.included ? formatMinutes(r.business_minutes) : '—'}</td>
                <td className="py-1.5 pl-3">
                  <span className={`text-xs font-medium ${r.included ? 'text-green-600' : 'text-text-muted'}`}>
                    {REASON_LABEL[r.reason] || r.reason}
                  </span>
                </td>
              </tr>
            ))}
            {shown.length === 0 && !loading && (
              <tr><td colSpan={7} className="py-6 text-center text-text-muted text-xs">No leads for this range.</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  )
}
