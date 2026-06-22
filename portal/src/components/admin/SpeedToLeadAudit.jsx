import { useState, useEffect, useMemo } from 'react'
import { getSpeedToLeadAudit } from '../../lib/api'
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

// Status filter chips. `all` first, then the reason buckets the backend tags.
// `counted` + `no_human_contact` are the genuine New Leads (counted = a human has
// reached out; no_human_contact = still awaiting first human outreach). The rest
// are excluded from the metric and shown for vetting.
const STATUS_FILTERS = [
  { key: 'all', label: 'All' },
  { key: 'counted', label: 'Counted' },
  { key: 'no_human_contact', label: 'Awaiting contact' },
  { key: 'not_new_lead', label: 'Not a new lead' },
  { key: 'contact_before_create', label: 'Contacted before created' },
  { key: 'dnd', label: 'DND' },
]

export default function SpeedToLeadAudit() {
  const [loc, setLoc] = useState('all')
  const [range, setRange] = useState(defaultRange)
  const [rows, setRows] = useState([])
  const [meta, setMeta] = useState({ returned: 0, truncated: false })
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(null)
  const [statusFilter, setStatusFilter] = useState('all')

  function load(r = range) {
    setLoading(true)
    setError(null)
    getSpeedToLeadAudit({ location_slug: loc, start_date: r.start, end_date: r.end })
      .then(d => { setRows(d.rows || []); setMeta({ returned: d.returned || 0, truncated: !!d.truncated }) })
      .catch(e => setError(e.message || 'Failed to load audit'))
      .finally(() => setLoading(false))
  }

  function pickQuick(key) {
    const r = quickRange(key)
    setRange(r)
    load(r)
  }

  useEffect(() => { load() }, []) // initial load

  // Per-bucket counts for the filter chips (computed from the returned rows).
  const counts = useMemo(() => {
    const c = { all: rows.length }
    for (const r of rows) c[r.reason] = (c[r.reason] || 0) + 1
    return c
  }, [rows])

  const shown = statusFilter === 'all' ? rows : rows.filter(r => r.reason === statusFilter)
  const countedTotal = counts.counted || 0

  function exportRows() {
    return [
      ['Contact', 'Club', 'Lead Created', 'First Human Contact', 'Speed (min)', 'Status'],
      ...shown.map(r => [
        r.contact_name || '',
        r.club || '',
        r.opportunity_created_at ? new Date(r.opportunity_created_at).toLocaleString() : '',
        r.first_human_contact_at ? new Date(r.first_human_contact_at).toLocaleString() : '',
        r.included && r.speed_minutes != null ? r.speed_minutes : '',
        REASON_LABEL[r.reason] || r.reason || '',
      ]),
    ]
  }
  const exportName = `speed-to-lead-audit_${range.start}_to_${range.end}`

  return (
    <div className="bg-surface/95 backdrop-blur-sm rounded-xl border border-border p-5 space-y-4">
      <div>
        <h3 className="text-sm font-bold text-text-primary">Speed to Lead Audit</h3>
        <p className="text-xs text-text-muted mt-1">Every lead behind the Speed to Lead metric — counted and skipped — so you can vet the data. Speed = lead creation to first manual human SMS/call.</p>
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
        <button onClick={load} disabled={loading}
          className="text-xs bg-wcs-red text-white rounded-lg px-4 py-1.5 font-medium hover:bg-wcs-red/90 disabled:opacity-50">
          {loading ? 'Loading…' : 'Load'}
        </button>
        <div className="flex items-center gap-2 ml-auto">
          <button onClick={() => exportCSV(exportRows(), exportName)} disabled={shown.length === 0}
            className="text-xs border border-border rounded-lg px-3 py-1.5 font-medium text-text-muted hover:text-text-primary hover:border-text-muted disabled:opacity-50">
            Export (Sheets/CSV)
          </button>
          <button onClick={() => exportPDF(`Speed to Lead Audit — ${range.start} to ${range.end}`)} disabled={shown.length === 0}
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

      {/* Status filter — slice the audit by what's counted vs awaiting vs excluded */}
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
          Showing {shown.length} of {meta.returned} leads · {countedTotal} counted in the median
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
              <th className="text-right font-semibold py-2">Speed</th>
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
                <td className="py-1.5 text-right text-text-primary">{r.included ? formatMinutes(r.speed_minutes) : '—'}</td>
                <td className="py-1.5 pl-3">
                  <span className={`text-xs font-medium ${r.included ? 'text-green-600' : 'text-text-muted'}`}>
                    {REASON_LABEL[r.reason] || r.reason}
                  </span>
                </td>
              </tr>
            ))}
            {shown.length === 0 && !loading && (
              <tr><td colSpan={6} className="py-6 text-center text-text-muted text-xs">No leads for this range.</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  )
}
