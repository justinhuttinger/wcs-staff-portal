import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { paychexTraining } from '../../lib/api'
import { exportCSV } from '../../lib/export'

const STATUS_OPTIONS = [
  { value: '', label: 'All statuses' },
  { value: 'Completed', label: 'Completed' },
  { value: 'In Progress', label: 'In Progress' },
  { value: 'Overdue', label: 'Overdue' },
  { value: 'Not Started', label: 'Not Started' },
]

const REQUIRED_OPTIONS = [
  { value: '', label: 'Required: any' },
  { value: 'true', label: 'Required only' },
  { value: 'false', label: 'Optional only' },
]

const PAGE_SIZE = 50

function fmtNum(n) {
  return Number(n || 0).toLocaleString()
}

function fmtDate(d) {
  if (!d) return '—'
  const dt = new Date(d + 'T00:00:00')
  if (isNaN(dt)) return d
  return `${dt.getMonth() + 1}/${dt.getDate()}/${String(dt.getFullYear()).slice(2)}`
}

function fmtDateTime(iso) {
  if (!iso) return '—'
  const dt = new Date(iso)
  if (isNaN(dt)) return iso
  return dt.toLocaleString()
}

export default function PaychexTrainingAdmin() {
  // Data
  const [summary, setSummary] = useState(null)
  const [locations, setLocations] = useState({ locations: [], unassigned: 0 })
  const [courses, setCourses] = useState([])
  const [records, setRecords] = useState({ rows: [], total: 0, page: 1, page_size: PAGE_SIZE })

  // Filters
  const [location, setLocation] = useState('')      // '' | 'salem' | ... | 'unassigned'
  const [status, setStatus] = useState('')
  const [required, setRequired] = useState('')
  const [course, setCourse] = useState('')
  const [query, setQuery] = useState('')
  const [page, setPage] = useState(1)

  // Async state
  const [loadingTop, setLoadingTop] = useState(true)
  const [loadingRows, setLoadingRows] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [error, setError] = useState(null)
  const [refreshResult, setRefreshResult] = useState(null)

  const recordsReqRef = useRef(0)

  // ---- Initial top-section load (summary + locations + courses) -----------
  const loadTop = useCallback(async () => {
    setLoadingTop(true)
    setError(null)
    try {
      const [s, l, c] = await Promise.all([
        paychexTraining.summary(),
        paychexTraining.locations(),
        paychexTraining.courses(),
      ])
      setSummary(s)
      setLocations(l)
      setCourses(c.courses || [])
    } catch (err) {
      setError(err.message)
    } finally {
      setLoadingTop(false)
    }
  }, [])

  useEffect(() => { loadTop() }, [loadTop])

  // ---- Records re-load on any filter change -------------------------------
  useEffect(() => {
    const id = ++recordsReqRef.current
    setLoadingRows(true)
    setError(null)
    paychexTraining
      .records({
        location: location || undefined,
        status: status || undefined,
        required: required || undefined,
        course: course || undefined,
        q: query.trim() || undefined,
        page,
        page_size: PAGE_SIZE,
      })
      .then(res => {
        if (id !== recordsReqRef.current) return
        setRecords(res)
        setLoadingRows(false)
      })
      .catch(err => {
        if (id !== recordsReqRef.current) return
        setError(err.message)
        setLoadingRows(false)
      })
  }, [location, status, required, course, query, page])

  // Reset to page 1 whenever any non-page filter changes.
  useEffect(() => { setPage(1) }, [location, status, required, course, query])

  // ---- Refresh Paychex HR location mapping --------------------------------
  async function handleRefreshLocations() {
    setRefreshing(true)
    setRefreshResult(null)
    setError(null)
    try {
      const result = await paychexTraining.refreshLocations()
      setRefreshResult(result)
      // Re-pull summary + location counts since they'll have changed.
      await loadTop()
    } catch (err) {
      setError(err.message)
    } finally {
      setRefreshing(false)
    }
  }

  // ---- Export CSV ---------------------------------------------------------
  function handleExportCSV() {
    if (!records.rows.length) return
    const header = [
      'User', 'Email', 'Manager', 'Location',
      'Course', 'Type', 'Status', 'Required',
      'Score', 'Enrollment Date', 'Due Date', 'Completion Date',
      'Certificate Link',
    ]
    const rows = records.rows.map(r => [
      r.user_name || '',
      r.email || '',
      r.manager_name || '',
      r.location_slug || 'unassigned',
      r.title || '',
      r.learnable_type || '',
      r.status || '',
      r.required === true ? 'Yes' : r.required === false ? 'No' : '',
      r.score != null ? r.score : '',
      r.enrollment_date || '',
      r.due_date || '',
      r.completion_date || '',
      r.certificate_link || '',
    ])
    exportCSV([header, ...rows], `paychex-training-${new Date().toISOString().slice(0, 10)}`)
  }

  const totalPages = Math.max(1, Math.ceil((records.total || 0) / PAGE_SIZE))
  const locationPills = useMemo(() => ([
    { key: '', label: 'All', count: summary?.total_records || 0 },
    ...(locations.locations || []).map(l => ({ key: l.slug, label: l.name, count: l.record_count })),
    { key: 'unassigned', label: 'Unassigned', count: locations.unassigned || 0 },
  ]), [locations, summary])

  return (
    <div className="space-y-4">
      {/* Experimental banner */}
      <div className="bg-yellow-50 border border-yellow-200 rounded-xl px-4 py-2 text-xs text-yellow-800">
        <span className="font-semibold">Experimental — Paychex Training.</span> Compliance view backed by Paychex Bridge transcript exports. Data refreshes whenever Paychex POSTs the scheduled webhook.
      </div>

      {error && (
        <div className="bg-red-50 border border-red-200 text-wcs-red rounded-xl px-4 py-3 text-sm">
          {error}
        </div>
      )}

      {/* Last-received banner + refresh-locations button */}
      <div className="bg-surface border border-border rounded-xl px-4 py-3 flex flex-wrap items-center gap-3 text-sm">
        <span className="text-text-muted">Latest delivery:</span>
        <span className="font-semibold text-text-primary">
          {summary?.latest_report
            ? `${fmtDateTime(summary.latest_report.received_at)} · ${fmtNum(summary.latest_report.record_count)} records`
            : 'No deliveries yet'}
        </span>
        {summary?.latest_report?.account_name && (
          <span className="text-text-muted text-xs">({summary.latest_report.account_name})</span>
        )}
        <div className="ml-auto flex items-center gap-2">
          <button
            onClick={handleRefreshLocations}
            disabled={refreshing}
            className="px-3 py-1.5 rounded-lg border border-border bg-bg text-text-primary text-xs hover:bg-surface disabled:opacity-50"
            title="Pull every Paychex Worker for the 7 clubs and rebuild the email → location map"
          >
            {refreshing ? 'Refreshing…' : 'Refresh Location Mapping'}
          </button>
        </div>
      </div>

      {refreshResult && (
        <div className="bg-green-50 border border-green-200 rounded-xl px-4 py-2.5 text-xs text-green-900">
          <span className="font-semibold">Location refresh done.</span> {fmtNum(refreshResult.totalRows)} workers with email mapped across{' '}
          {(refreshResult.perLocation || []).map(p => `${p.slug}:${p.with_email ?? '?'}`).join(' · ')}.
        </div>
      )}

      {/* Summary cards */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
        <SummaryCard label="Total Enrollments" value={fmtNum(summary?.total_records)} tone="default" loading={loadingTop} />
        <SummaryCard label="Required" value={fmtNum(summary?.required)} tone="amber" loading={loadingTop} />
        <SummaryCard label="Completed" value={fmtNum(summary?.completed)} tone="green" loading={loadingTop} />
        <SummaryCard label="In Progress" value={fmtNum(summary?.in_progress)} tone="blue" loading={loadingTop} />
        <SummaryCard label="Overdue" value={fmtNum(summary?.overdue)} tone="red" loading={loadingTop} />
        <SummaryCard label="Not Started" value={fmtNum(summary?.not_started)} tone="default" loading={loadingTop} />
      </div>

      {/* Location pills */}
      <div className="flex flex-wrap gap-1.5">
        {locationPills.map(p => (
          <button
            key={p.key || 'all'}
            onClick={() => setLocation(p.key)}
            className={`px-3 py-1.5 rounded-full text-xs font-medium border transition-colors ${
              location === p.key
                ? 'bg-wcs-red text-white border-wcs-red'
                : 'bg-surface text-text-muted border-border hover:text-text-primary'
            }`}
          >
            {p.label}
            <span className="ml-1.5 opacity-75">({fmtNum(p.count)})</span>
          </button>
        ))}
      </div>

      {/* Filter bar */}
      <div className="flex flex-wrap items-center gap-3">
        <select
          value={status}
          onChange={e => setStatus(e.target.value)}
          className="px-3 py-1.5 rounded-lg border border-border bg-bg text-text-primary text-xs focus:outline-none focus:ring-2 focus:ring-wcs-red"
        >
          {STATUS_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
        </select>

        <select
          value={required}
          onChange={e => setRequired(e.target.value)}
          className="px-3 py-1.5 rounded-lg border border-border bg-bg text-text-primary text-xs focus:outline-none focus:ring-2 focus:ring-wcs-red"
        >
          {REQUIRED_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
        </select>

        <select
          value={course}
          onChange={e => setCourse(e.target.value)}
          className="px-3 py-1.5 rounded-lg border border-border bg-bg text-text-primary text-xs focus:outline-none focus:ring-2 focus:ring-wcs-red max-w-[280px]"
        >
          <option value="">All courses</option>
          {courses.map(c => (
            <option key={c.learnable_id} value={c.learnable_id}>
              {c.title}{c.learnable_type ? ` (${c.learnable_type})` : ''}
            </option>
          ))}
        </select>

        <input
          type="text"
          value={query}
          onChange={e => setQuery(e.target.value)}
          placeholder="Search name, email, or course…"
          className="px-3 py-1.5 rounded-lg border border-border bg-bg text-text-primary text-xs focus:outline-none focus:ring-2 focus:ring-wcs-red min-w-[260px]"
        />

        <div className="ml-auto flex items-center gap-2">
          <span className="text-xs text-text-muted">{fmtNum(records.total)} matches</span>
          <button
            onClick={handleExportCSV}
            disabled={!records.rows.length}
            className="px-3 py-1.5 rounded-lg border border-border bg-surface text-text-muted text-xs hover:text-text-primary disabled:opacity-50"
          >
            Export CSV
          </button>
        </div>
      </div>

      {/* Records table */}
      <div className="bg-surface border border-border rounded-xl overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-bg">
              <tr className="text-xs uppercase tracking-wide text-text-muted">
                <th className="text-left px-4 py-2 font-semibold">User</th>
                <th className="text-left px-4 py-2 font-semibold">Course</th>
                <th className="text-left px-4 py-2 font-semibold">Status</th>
                <th className="text-center px-4 py-2 font-semibold">Req.</th>
                <th className="text-left px-4 py-2 font-semibold">Due</th>
                <th className="text-left px-4 py-2 font-semibold">Completed</th>
                <th className="text-left px-4 py-2 font-semibold">Location</th>
                <th className="text-left px-4 py-2 font-semibold">Manager</th>
              </tr>
            </thead>
            <tbody>
              {loadingRows ? (
                <tr><td colSpan={8} className="px-4 py-8 text-center text-text-muted text-sm">Loading…</td></tr>
              ) : records.rows.length === 0 ? (
                <tr><td colSpan={8} className="px-4 py-8 text-center text-text-muted text-sm">No training records match these filters.</td></tr>
              ) : (
                records.rows.map(r => (
                  <tr key={r.id} className="border-t border-border hover:bg-bg/60">
                    <td className="px-4 py-2">
                      <div className="font-medium text-text-primary">{r.user_name || '—'}</div>
                      <div className="text-xs text-text-muted">{r.email || ''}</div>
                    </td>
                    <td className="px-4 py-2">
                      <div className="text-text-primary">{r.title || '—'}</div>
                      <div className="text-xs text-text-muted">{r.learnable_type || ''}</div>
                    </td>
                    <td className="px-4 py-2"><StatusPill status={r.status} /></td>
                    <td className="px-4 py-2 text-center">{r.required === true ? '✓' : r.required === false ? '' : '—'}</td>
                    <td className="px-4 py-2 text-text-muted whitespace-nowrap">{fmtDate(r.due_date)}</td>
                    <td className="px-4 py-2 text-text-muted whitespace-nowrap">{fmtDate(r.completion_date)}</td>
                    <td className="px-4 py-2 text-text-muted">
                      {r.location_slug
                        ? <span className="capitalize">{r.location_slug}</span>
                        : <span className="text-text-muted/70 italic">unassigned</span>}
                    </td>
                    <td className="px-4 py-2 text-text-muted">{r.manager_name || '—'}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>

        {/* Pagination */}
        {records.total > PAGE_SIZE && (
          <div className="flex items-center justify-between px-4 py-2 border-t border-border bg-bg text-xs">
            <span className="text-text-muted">
              Page {page} of {totalPages} · showing {fmtNum((page - 1) * PAGE_SIZE + 1)}–{fmtNum(Math.min(page * PAGE_SIZE, records.total))} of {fmtNum(records.total)}
            </span>
            <div className="flex gap-1">
              <button
                onClick={() => setPage(p => Math.max(1, p - 1))}
                disabled={page <= 1}
                className="px-2 py-1 rounded-md border border-border bg-surface text-text-muted hover:text-text-primary disabled:opacity-50"
              >
                Prev
              </button>
              <button
                onClick={() => setPage(p => Math.min(totalPages, p + 1))}
                disabled={page >= totalPages}
                className="px-2 py-1 rounded-md border border-border bg-surface text-text-muted hover:text-text-primary disabled:opacity-50"
              >
                Next
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

function SummaryCard({ label, value, tone, loading }) {
  const toneCls = tone === 'green' ? 'border-green-200 bg-green-50'
    : tone === 'amber' ? 'border-amber-200 bg-amber-50'
    : tone === 'red' ? 'border-red-200 bg-red-50'
    : tone === 'blue' ? 'border-blue-200 bg-blue-50'
    : 'border-border bg-surface'
  return (
    <div className={`rounded-xl border p-3 ${toneCls}`}>
      <p className="text-[10px] font-medium text-text-muted uppercase tracking-wide">{label}</p>
      <p className="text-xl font-bold text-text-primary mt-0.5">{loading ? '…' : value}</p>
    </div>
  )
}

function StatusPill({ status }) {
  const s = String(status || '').toLowerCase()
  let cls = 'bg-bg text-text-muted border-border'
  if (s === 'completed') cls = 'bg-green-50 text-green-700 border-green-200'
  else if (s === 'overdue') cls = 'bg-red-50 text-red-700 border-red-200'
  else if (s === 'in progress') cls = 'bg-blue-50 text-blue-700 border-blue-200'
  else if (s === 'not started') cls = 'bg-amber-50 text-amber-700 border-amber-200'
  return (
    <span className={`inline-block px-2 py-0.5 rounded-full text-[11px] font-semibold border ${cls}`}>
      {status || '—'}
    </span>
  )
}
