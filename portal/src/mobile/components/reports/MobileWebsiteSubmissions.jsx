import { useEffect, useMemo, useState } from 'react'
import { getWebsiteSubmissions, getWebsiteSubmissionFilterOptions } from '../../../lib/api'
import MobileLoading from '../MobileLoading'
import { useCancellableFetch } from '../../../hooks/useCancellableFetch'

function toDateInput(d) {
  return d.toISOString().slice(0, 10)
}

function defaultRange() {
  const end = new Date()
  const start = new Date(end.getTime() - 30 * 24 * 60 * 60 * 1000)
  return { start: toDateInput(start), end: toDateInput(end) }
}

function isoDayStart(localDate) {
  return new Date(localDate + 'T00:00:00-08:00').toISOString()
}

function isoDayEndExclusive(localDate) {
  const d = new Date(localDate + 'T00:00:00-08:00')
  d.setDate(d.getDate() + 1)
  return d.toISOString()
}

function fmtWhen(iso) {
  if (!iso) return ''
  const d = new Date(iso)
  return d.toLocaleString('en-US', {
    timeZone: 'America/Los_Angeles',
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  })
}

function Pill({ active, onClick, children }) {
  return (
    <button
      onClick={onClick}
      className={`shrink-0 px-3 py-1.5 rounded-full text-xs font-medium transition-colors whitespace-nowrap ${
        active ? 'bg-wcs-red text-white' : 'bg-bg text-text-secondary border border-border'
      }`}
    >
      {children}
    </button>
  )
}

function Card({ row }) {
  const [open, setOpen] = useState(false)
  const fullName = [row.first_name, row.last_name].filter(Boolean).join(' ') || '—'
  return (
    <div className="bg-surface rounded-xl border border-border overflow-hidden">
      <button onClick={() => setOpen(o => !o)} className="w-full text-left p-3 active:bg-bg/60 transition-colors">
        <div className="flex items-start justify-between gap-2 mb-1">
          <p className="text-sm font-semibold text-text-primary leading-snug line-clamp-2 flex-1">
            {row.form_name || '(no form name)'}
          </p>
          <svg
            className={`w-4 h-4 text-text-muted shrink-0 mt-0.5 transition-transform ${open ? 'rotate-180' : ''}`}
            fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}
          >
            <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
          </svg>
        </div>
        <div className="flex items-center gap-1.5 mb-1.5">
          {row.location ? (
            <span className="text-[10px] px-1.5 py-0.5 rounded bg-blue-50 text-blue-700 font-medium">{row.location}</span>
          ) : (
            <span className="text-[10px] px-1.5 py-0.5 rounded bg-gray-100 text-text-muted">Unknown</span>
          )}
          <span className="text-[10px] text-text-muted">{fmtWhen(row.received_at)}</span>
          {row.opt_in && <span className="text-[10px] text-green-700">✓ opt-in</span>}
        </div>
        <p className="text-xs text-text-primary">{fullName}</p>
        {row.email && <p className="text-xs text-text-muted truncate">{row.email}</p>}
        {row.phone && <p className="text-xs text-text-muted">{row.phone}</p>}
        {row.message && <p className="text-xs text-text-secondary mt-1 line-clamp-2">{row.message}</p>}
      </button>
      {open && (
        <div className="border-t border-border bg-bg/40 p-3">
          <p className="text-[10px] text-text-muted uppercase tracking-wide mb-1">Full submission</p>
          <pre className="text-[11px] text-text-primary whitespace-pre-wrap break-all bg-surface border border-border rounded-lg p-2 max-h-60 overflow-auto">
{JSON.stringify(row.raw, null, 2)}
          </pre>
        </div>
      )}
    </div>
  )
}

const POOL_LOCATIONS = new Set(['Springfield', 'Clackamas'])

function StatTile({ label, value, loading }) {
  return (
    <div className="shrink-0 w-[130px] bg-surface rounded-xl border border-border p-3">
      <p className="text-[10px] text-text-muted uppercase tracking-wide">{label}</p>
      <p className="text-lg font-bold text-text-primary mt-0.5">
        {loading ? <span className="text-text-muted">—</span> : Number(value || 0).toLocaleString()}
      </p>
    </div>
  )
}

export default function MobileWebsiteSubmissions() {
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

  const headerLabel = useMemo(() => {
    if (loading) return 'Loading…'
    if (rows.length < total) return `Showing ${rows.length.toLocaleString()} of ${total.toLocaleString()}`
    return `${rows.length.toLocaleString()} submission${rows.length === 1 ? '' : 's'}`
  }, [loading, rows.length, total])

  return (
    <div className="pb-6">
      <div className="mx-4 mt-4 mb-3 bg-surface/95 backdrop-blur-sm rounded-2xl border border-border p-4 space-y-2">
        <h2 className="text-lg font-bold text-text-primary">Website Submissions</h2>

        {/* Summary tiles — adjust with time + location filter; form filter ignored */}
        <div className="flex gap-2.5 overflow-x-auto no-scrollbar -mx-1 px-1 pt-1">
          <StatTile label="Total" value={summary.total} loading={loading} />
          <StatTile label="7-Day Trial" value={summary.seven_day_trial} loading={loading} />
          <StatTile label="PT Interest" value={summary.pt_interest} loading={loading} />
          {showSwimTile && (
            <StatTile label="Swim Interest" value={summary.swim_interest} loading={loading} />
          )}
        </div>

        <div>
          <p className="text-[10px] text-text-muted uppercase tracking-wide mb-1">Form</p>
          <div className="flex gap-1.5 overflow-x-auto no-scrollbar">
            <Pill active={!formName} onClick={() => setFormName('')}>All</Pill>
            {filterOptions.form_names.map(name => (
              <Pill key={name} active={formName === name} onClick={() => setFormName(name)}>{name}</Pill>
            ))}
          </div>
        </div>

        <div>
          <p className="text-[10px] text-text-muted uppercase tracking-wide mb-1">Location</p>
          <div className="flex gap-1.5 overflow-x-auto no-scrollbar">
            <Pill active={!location} onClick={() => setLocation('')}>All</Pill>
            {filterOptions.locations.map(loc => (
              <Pill key={loc} active={location === loc} onClick={() => setLocation(loc)}>{loc}</Pill>
            ))}
          </div>
        </div>

        <div className="flex gap-2 pt-1">
          <input
            type="date"
            value={start}
            onChange={e => setRange(r => ({ ...r, start: e.target.value }))}
            className="flex-1 bg-bg border border-border rounded-lg px-2.5 py-2 text-xs text-text-primary"
          />
          <input
            type="date"
            value={end}
            onChange={e => setRange(r => ({ ...r, end: e.target.value }))}
            className="flex-1 bg-bg border border-border rounded-lg px-2.5 py-2 text-xs text-text-primary"
          />
        </div>
      </div>

      <div className="px-4 mb-2">
        <p className="text-xs text-text-muted">{headerLabel}</p>
      </div>

      {error && (
        <div className="mx-4 mb-3 bg-red-50 border border-red-200 rounded-xl p-3">
          <p className="text-sm text-red-700 font-medium">Error loading submissions</p>
          <p className="text-xs text-red-600 mt-1">{error}</p>
        </div>
      )}

      {loading ? (
        <MobileLoading variant="list" count={3} />
      ) : rows.length === 0 ? (
        <div className="mx-4 bg-surface rounded-xl border border-border p-6 text-center">
          <p className="text-sm text-text-muted">No submissions in this range.</p>
        </div>
      ) : (
        <div className="px-4 space-y-2.5">
          {rows.map(row => <Card key={row.id} row={row} />)}
        </div>
      )}
    </div>
  )
}
