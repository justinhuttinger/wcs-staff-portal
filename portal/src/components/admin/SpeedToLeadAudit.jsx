import { useState, useEffect } from 'react'
import { getSpeedToLeadAudit } from '../../lib/api'
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

const REASON_LABEL = {
  counted: 'Counted',
  no_human_contact: 'No human contact yet',
  not_new_lead: 'Not a new lead',
  contact_before_create: 'Contacted before lead created',
}

export default function SpeedToLeadAudit() {
  const [loc, setLoc] = useState('all')
  const [range, setRange] = useState(defaultRange)
  const [rows, setRows] = useState([])
  const [meta, setMeta] = useState({ returned: 0, truncated: false })
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(null)
  const [onlyCounted, setOnlyCounted] = useState(false)

  function load() {
    setLoading(true)
    setError(null)
    getSpeedToLeadAudit({ location_slug: loc, start_date: range.start, end_date: range.end })
      .then(d => { setRows(d.rows || []); setMeta({ returned: d.returned || 0, truncated: !!d.truncated }) })
      .catch(e => setError(e.message || 'Failed to load audit'))
      .finally(() => setLoading(false))
  }

  useEffect(() => { load() }, []) // initial load

  const shown = onlyCounted ? rows.filter(r => r.included) : rows
  const countedTotal = rows.filter(r => r.included).length

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
        <label className="flex items-center gap-1.5 text-xs text-text-muted ml-2">
          <input type="checkbox" checked={onlyCounted} onChange={e => setOnlyCounted(e.target.checked)} className="accent-wcs-red" />
          Counted only
        </label>
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
