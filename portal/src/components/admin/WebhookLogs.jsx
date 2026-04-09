import { useState, useEffect, Fragment } from 'react'
import { getWebhookLogs } from '../../lib/api'

const LOCATION_OPTIONS = [
  { label: 'All Locations', value: '' },
  { label: 'Salem', value: 'salem' },
  { label: 'Keizer', value: 'keizer' },
  { label: 'Eugene', value: 'eugene' },
  { label: 'Springfield', value: 'springfield' },
  { label: 'Clackamas', value: 'clackamas' },
  { label: 'Milwaukie', value: 'milwaukie' },
  { label: 'Medford', value: 'medford' },
]

const STATUS_OPTIONS = [
  { label: 'All', value: '' },
  { label: 'Sent', value: 'sent' },
  { label: 'Failed', value: 'failed' },
]

function formatDate(dateStr) {
  if (!dateStr) return '—'
  const d = new Date(dateStr)
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) +
    ' ' + d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })
}

export default function WebhookLogs() {
  const [logs, setLogs] = useState([])
  const [total, setTotal] = useState(0)
  const [loading, setLoading] = useState(true)
  const [page, setPage] = useState(1)
  const [locationFilter, setLocationFilter] = useState('')
  const [statusFilter, setStatusFilter] = useState('')
  const [startDate, setStartDate] = useState('')
  const [endDate, setEndDate] = useState('')
  const [expandedId, setExpandedId] = useState(null)
  const limit = 25

  useEffect(() => {
    loadLogs()
  }, [page, locationFilter, statusFilter, startDate, endDate])

  async function loadLogs() {
    setLoading(true)
    try {
      const params = { page, limit }
      if (locationFilter) params.location_slug = locationFilter
      if (statusFilter) params.status = statusFilter
      if (startDate) params.start_date = startDate
      if (endDate) params.end_date = endDate
      const res = await getWebhookLogs(params)
      setLogs(res.logs || [])
      setTotal(res.total || 0)
    } catch (err) {
      console.error('Failed to load webhook logs:', err)
    }
    setLoading(false)
  }

  const totalPages = Math.ceil(total / limit)

  return (
    <div>
      {/* Filters */}
      <div className="flex gap-3 mb-4">
        <select
          value={locationFilter}
          onChange={e => { setLocationFilter(e.target.value); setPage(1) }}
          className="px-3 py-1.5 rounded-lg border border-border bg-surface text-sm text-text-primary"
        >
          {LOCATION_OPTIONS.map(o => (
            <option key={o.value} value={o.value}>{o.label}</option>
          ))}
        </select>
        <select
          value={statusFilter}
          onChange={e => { setStatusFilter(e.target.value); setPage(1) }}
          className="px-3 py-1.5 rounded-lg border border-border bg-surface text-sm text-text-primary"
        >
          {STATUS_OPTIONS.map(o => (
            <option key={o.value} value={o.value}>{o.label}</option>
          ))}
        </select>
        <input
          type="date"
          value={startDate}
          onChange={e => { setStartDate(e.target.value); setPage(1) }}
          className="px-3 py-1.5 rounded-lg border border-border bg-surface text-sm text-text-primary"
          placeholder="Start date"
        />
        <input
          type="date"
          value={endDate}
          onChange={e => { setEndDate(e.target.value); setPage(1) }}
          className="px-3 py-1.5 rounded-lg border border-border bg-surface text-sm text-text-primary"
          placeholder="End date"
        />
        <button
          onClick={() => { setPage(1); loadLogs() }}
          className="px-3 py-1.5 rounded-lg border border-border text-sm text-text-muted hover:text-text-primary"
        >
          Refresh
        </button>
      </div>

      {/* Table */}
      <div className="border border-border rounded-xl overflow-hidden">
        <table className="w-full text-sm">
          <thead>
            <tr className="bg-bg text-text-muted text-left">
              <th className="px-4 py-2 font-medium">Time</th>
              <th className="px-4 py-2 font-medium">Location</th>
              <th className="px-4 py-2 font-medium">Contact</th>
              <th className="px-4 py-2 font-medium">Trainer</th>
              <th className="px-4 py-2 font-medium">Status</th>
              <th className="px-4 py-2 font-medium">Error</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td colSpan={6} className="px-4 py-8 text-center text-text-muted">Loading...</td></tr>
            ) : logs.length === 0 ? (
              <tr><td colSpan={6} className="px-4 py-8 text-center text-text-muted">No webhook logs found</td></tr>
            ) : logs.map(log => (
              <Fragment key={log.id}>
                <tr
                  onClick={() => setExpandedId(expandedId === log.id ? null : log.id)}
                  className="border-t border-border hover:bg-bg/50 cursor-pointer"
                >
                  <td className="px-4 py-2">{formatDate(log.sent_at)}</td>
                  <td className="px-4 py-2 capitalize">{log.payload?.locationSlug || '—'}</td>
                  <td className="px-4 py-2">{[log.payload?.contactFirstName, log.payload?.contactLastName].filter(Boolean).join(' ') || log.payload?.contactName || '—'}</td>
                  <td className="px-4 py-2">{log.payload?.trainerName || '—'}</td>
                  <td className="px-4 py-2">
                    <span className={`inline-block px-2 py-0.5 rounded-full text-xs font-medium ${
                      log.status === 'sent'
                        ? 'bg-green-500/10 text-green-400'
                        : 'bg-red-500/10 text-red-400'
                    }`}>
                      {log.status}
                    </span>
                  </td>
                  <td className="px-4 py-2 text-text-muted text-xs truncate max-w-[200px]">{log.error || '—'}</td>
                </tr>
                {expandedId === log.id && (
                  <tr className="border-t border-border bg-bg/30">
                    <td colSpan={6} className="px-4 py-3">
                      <p className="text-xs text-text-muted mb-1 font-medium">Payload:</p>
                      <pre className="text-xs text-text-primary bg-bg rounded-lg p-3 overflow-x-auto">
                        {JSON.stringify(log.payload, null, 2)}
                      </pre>
                    </td>
                  </tr>
                )}
              </Fragment>
            ))}
          </tbody>
        </table>
      </div>

      {/* Pagination */}
      {totalPages > 1 && (
        <div className="flex items-center justify-between mt-3">
          <p className="text-xs text-text-muted">{total} total</p>
          <div className="flex gap-2">
            <button
              onClick={() => setPage(p => Math.max(1, p - 1))}
              disabled={page === 1}
              className="px-3 py-1 rounded border border-border text-sm disabled:opacity-30"
            >
              Prev
            </button>
            <span className="text-sm text-text-muted px-2 py-1">{page} / {totalPages}</span>
            <button
              onClick={() => setPage(p => Math.min(totalPages, p + 1))}
              disabled={page === totalPages}
              className="px-3 py-1 rounded border border-border text-sm disabled:opacity-30"
            >
              Next
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
