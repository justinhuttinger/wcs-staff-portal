import { useEffect, useMemo, useState } from 'react'
import { getWebsiteSubmissions, getWebsiteSubmissionFilterOptions } from '../../lib/api'
import { useCancellableFetch } from '../../hooks/useCancellableFetch'

function toDateInput(d) {
  return d.toISOString().slice(0, 10)
}

function defaultRange() {
  const end = new Date()
  const start = new Date(end.getTime() - 30 * 24 * 60 * 60 * 1000)
  return { start: toDateInput(start), end: toDateInput(end) }
}

function fmtDateTime(iso) {
  if (!iso) return ''
  const d = new Date(iso)
  return d.toLocaleString('en-US', {
    timeZone: 'America/Los_Angeles',
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  })
}

function isoDayStart(localDate) {
  return new Date(localDate + 'T00:00:00-08:00').toISOString()
}

function isoDayEndExclusive(localDate) {
  const d = new Date(localDate + 'T00:00:00-08:00')
  d.setDate(d.getDate() + 1)
  return d.toISOString()
}

function Row({ row }) {
  const [open, setOpen] = useState(false)
  const fullName = [row.first_name, row.last_name].filter(Boolean).join(' ') || '—'
  const messagePreview = row.message ? (row.message.length > 80 ? row.message.slice(0, 80) + '…' : row.message) : '—'
  return (
    <>
      <tr
        className="border-t border-border hover:bg-bg/60 cursor-pointer"
        onClick={() => setOpen(o => !o)}
      >
        <td className="px-3 py-2 text-xs text-text-muted whitespace-nowrap">{fmtDateTime(row.received_at)}</td>
        <td className="px-3 py-2 text-sm text-text-primary">{row.form_name || <span className="text-text-muted">—</span>}</td>
        <td className="px-3 py-2 text-sm">
          {row.location ? (
            <span className="text-[11px] px-1.5 py-0.5 rounded bg-blue-50 text-blue-700 font-medium">{row.location}</span>
          ) : (
            <span className="text-[11px] text-text-muted">Unknown</span>
          )}
        </td>
        <td className="px-3 py-2 text-sm text-text-primary">{fullName}</td>
        <td className="px-3 py-2 text-sm text-text-primary">{row.email || <span className="text-text-muted">—</span>}</td>
        <td className="px-3 py-2 text-sm text-text-primary">{row.phone || <span className="text-text-muted">—</span>}</td>
        <td className="px-3 py-2 text-sm text-text-muted">{messagePreview}</td>
        <td className="px-3 py-2 text-sm text-center">
          {row.opt_in ? <span className="text-green-700">✓</span> : <span className="text-text-muted">—</span>}
        </td>
      </tr>
      {open && (
        <tr className="bg-bg/40">
          <td colSpan={8} className="px-3 py-3">
            <p className="text-[11px] text-text-muted uppercase tracking-wide mb-1">Full submission</p>
            <pre className="text-xs text-text-primary whitespace-pre-wrap break-all bg-surface border border-border rounded-lg p-3 max-h-72 overflow-auto">
{JSON.stringify(row.raw, null, 2)}
            </pre>
          </td>
        </tr>
      )}
    </>
  )
}

// Locations with a pool — swim-interest tile only shows for these (plus All).
const POOL_LOCATIONS = new Set(['Springfield', 'Clackamas'])

function StatTile({ label, value, sub, loading }) {
  return (
    <div className="bg-surface rounded-xl border border-border p-4">
      <p className="text-[10px] text-text-muted uppercase tracking-wide">{label}</p>
      <p className="text-3xl font-bold text-text-primary mt-1">
        {loading ? <span className="text-text-muted">—</span> : value.toLocaleString()}
      </p>
      {sub && <p className="text-[11px] text-text-muted mt-1">{sub}</p>}
    </div>
  )
}

export default function WebsiteSubmissionsReport({ onBack }) {
  const [{ start, end }, setRange] = useState(defaultRange())
  const [formName, setFormName] = useState('')
  const [location, setLocation] = useState('')
  const [filterOptions, setFilterOptions] = useState({ form_names: [], locations: [] })

  const showSwimTile = !location || POOL_LOCATIONS.has(location)

  useEffect(() => {
    getWebsiteSubmissionFilterOptions({ cache: true })
      .then(setFilterOptions)
      .catch(() => setFilterOptions({ form_names: [], locations: [] }))
  }, [])

  const { data, loading, error: rawError } = useCancellableFetch(
    (signal) => getWebsiteSubmissions(
      {
        form_name: formName || undefined,
        location: location || undefined,
        start: isoDayStart(start),
        end: isoDayEndExclusive(end),
      },
      { cache: true, signal }
    ),
    [start, end, formName, location]
  )
  const rows = data?.rows || []
  const total = data?.total || 0
  const summary = data?.summary || { total: 0, seven_day_trial: 0, pt_interest: 0, swim_interest: 0 }
  const error = rawError ? (rawError.message || String(rawError)) : null

  const truncated = rows.length < total
  const headerLabel = useMemo(() => {
    if (loading) return 'Loading…'
    if (truncated) return `Showing first ${rows.length.toLocaleString()} of ${total.toLocaleString()} — narrow your date range`
    return `${rows.length.toLocaleString()} submission${rows.length === 1 ? '' : 's'}`
  }, [loading, rows.length, total, truncated])

  return (
    <div className="max-w-7xl mx-auto w-full px-8 py-6">
      <div className="bg-surface/95 backdrop-blur-sm rounded-xl border border-border p-5 mb-6 flex items-center gap-3">
        {onBack && (
          <button
            onClick={onBack}
            className="flex items-center gap-2 px-3 py-1.5 text-xs font-semibold rounded-lg border border-border bg-bg text-text-muted hover:text-text-primary hover:border-text-muted transition-colors"
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="w-3 h-3">
              <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" />
            </svg>
            Back
          </button>
        )}
        <div>
          <h2 className="text-xl font-bold text-text-primary">Website Submissions</h2>
          <p className="text-xs text-text-muted">Form submissions received from the WCS website</p>
        </div>
      </div>

      <div className={`grid gap-3 mb-4 ${showSwimTile ? 'grid-cols-2 md:grid-cols-4' : 'grid-cols-1 md:grid-cols-3'}`}>
        <StatTile label="Total Submissions" value={summary.total} sub="all forms in this range" loading={loading} />
        <StatTile label="7-Day Trial" value={summary.seven_day_trial} sub="trial sign-ups" loading={loading} />
        <StatTile label="PT Interest" value={summary.pt_interest} sub="training inquiries" loading={loading} />
        {showSwimTile && (
          <StatTile label="Swim Interest" value={summary.swim_interest} sub="swim inquiries" loading={loading} />
        )}
      </div>

      <div className="bg-surface rounded-xl border border-border p-4 mb-4 grid grid-cols-1 md:grid-cols-4 gap-3">
        <div>
          <label className="block text-[10px] uppercase tracking-wide text-text-muted mb-1">Form</label>
          <select
            value={formName}
            onChange={e => setFormName(e.target.value)}
            className="w-full bg-bg border border-border rounded-lg px-3 py-2 text-sm text-text-primary"
          >
            <option value="">All forms</option>
            {filterOptions.form_names.map(name => (
              <option key={name} value={name}>{name}</option>
            ))}
          </select>
        </div>
        <div>
          <label className="block text-[10px] uppercase tracking-wide text-text-muted mb-1">Location</label>
          <select
            value={location}
            onChange={e => setLocation(e.target.value)}
            className="w-full bg-bg border border-border rounded-lg px-3 py-2 text-sm text-text-primary"
          >
            <option value="">All locations</option>
            {filterOptions.locations.map(loc => (
              <option key={loc} value={loc}>{loc}</option>
            ))}
          </select>
        </div>
        <div>
          <label className="block text-[10px] uppercase tracking-wide text-text-muted mb-1">Start date</label>
          <input
            type="date"
            value={start}
            onChange={e => setRange(r => ({ ...r, start: e.target.value }))}
            className="w-full bg-bg border border-border rounded-lg px-3 py-2 text-sm text-text-primary"
          />
        </div>
        <div>
          <label className="block text-[10px] uppercase tracking-wide text-text-muted mb-1">End date</label>
          <input
            type="date"
            value={end}
            onChange={e => setRange(r => ({ ...r, end: e.target.value }))}
            className="w-full bg-bg border border-border rounded-lg px-3 py-2 text-sm text-text-primary"
          />
        </div>
      </div>

      <p className="text-xs text-text-muted mb-2">{headerLabel}</p>

      {error && (
        <div className="bg-red-50 border border-red-200 rounded-xl p-4 mb-4">
          <p className="text-sm text-red-700 font-medium">Error loading submissions</p>
          <p className="text-xs text-red-600 mt-1">{error}</p>
        </div>
      )}

      <div className="bg-surface rounded-xl border border-border overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead>
              <tr className="bg-bg/50">
                <th className="text-left text-[11px] uppercase tracking-wide text-text-muted px-3 py-2">Received</th>
                <th className="text-left text-[11px] uppercase tracking-wide text-text-muted px-3 py-2">Form</th>
                <th className="text-left text-[11px] uppercase tracking-wide text-text-muted px-3 py-2">Location</th>
                <th className="text-left text-[11px] uppercase tracking-wide text-text-muted px-3 py-2">Name</th>
                <th className="text-left text-[11px] uppercase tracking-wide text-text-muted px-3 py-2">Email</th>
                <th className="text-left text-[11px] uppercase tracking-wide text-text-muted px-3 py-2">Phone</th>
                <th className="text-left text-[11px] uppercase tracking-wide text-text-muted px-3 py-2">Message</th>
                <th className="text-center text-[11px] uppercase tracking-wide text-text-muted px-3 py-2">Opt-In</th>
              </tr>
            </thead>
            <tbody>
              {rows.length === 0 && !loading ? (
                <tr>
                  <td colSpan={8} className="px-3 py-8 text-center text-sm text-text-muted">
                    No submissions in this range.
                  </td>
                </tr>
              ) : (
                rows.map(row => <Row key={row.id} row={row} />)
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}
