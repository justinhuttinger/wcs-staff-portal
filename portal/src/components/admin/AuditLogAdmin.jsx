import { useState, useEffect, useMemo } from 'react'
import { api, getStaff } from '../../lib/api'

const EVENT_LABELS = {
  'session.login': 'Logged in',
  'session.logout': 'Logged out',
  'view.admin': 'Opened Admin Panel',
  'view.calendar': 'Opened Calendar',
  'view.reporting': 'Opened Reporting',
  'view.trainer_availability': 'Opened D1 Availability',
  'view.marketing': 'Opened Marketing',
  'view.leaderboard': 'Opened Leaderboard',
  'view.communication_notes': 'Opened Comm Notes',
  'view.hr': 'Opened HR',
  'view.help_center': 'Opened Help Center',
  'view.tickets': 'Opened Tickets',
  'view.drive': 'Opened Drive',
}

const EVENT_COLORS = {
  'session.login': 'bg-green-50 text-green-700 border-green-200',
  'session.logout': 'bg-gray-100 text-gray-600 border-gray-200',
}

function formatTime(iso) {
  const d = new Date(iso)
  const now = new Date()
  const diff = (now - d) / 1000
  if (diff < 60) return Math.floor(diff) + 's ago'
  if (diff < 3600) return Math.floor(diff / 60) + 'm ago'
  if (diff < 86400) return Math.floor(diff / 3600) + 'h ago'
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) +
    ' ' + d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })
}

function formatEvent(eventType) {
  return EVENT_LABELS[eventType] || eventType
}

function eventColorClass(eventType) {
  if (EVENT_COLORS[eventType]) return EVENT_COLORS[eventType]
  if (eventType.startsWith('view.')) return 'bg-blue-50 text-blue-700 border-blue-200'
  if (eventType.startsWith('action.')) return 'bg-purple-50 text-purple-700 border-purple-200'
  return 'bg-amber-50 text-amber-700 border-amber-200'
}

export default function AuditLogAdmin() {
  const [events, setEvents] = useState([])
  const [stats, setStats] = useState(null)
  const [staff, setStaff] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  // Filters
  const [staffFilter, setStaffFilter] = useState('')
  const [typeFilter, setTypeFilter] = useState('')
  const [searchText, setSearchText] = useState('')

  function load() {
    setLoading(true)
    Promise.all([
      api('/audit-log?limit=500'),
      api('/audit-log/stats'),
      getStaff(),
    ])
      .then(([eventsRes, statsRes, staffRes]) => {
        setEvents(eventsRes.events || [])
        setStats(statsRes)
        setStaff(staffRes.staff || [])
      })
      .catch(err => setError(err.message || 'Failed to load'))
      .finally(() => setLoading(false))
  }

  useEffect(() => { load() }, [])

  const filtered = useMemo(() => {
    return events.filter(e => {
      if (staffFilter && e.staff_id !== staffFilter) return false
      if (typeFilter && e.event_type !== typeFilter) return false
      if (searchText) {
        const hay = [
          e.event_type,
          e.staff?.display_name,
          e.staff?.email,
          e.target,
          JSON.stringify(e.metadata || {}),
        ].join(' ').toLowerCase()
        if (!hay.includes(searchText.toLowerCase())) return false
      }
      return true
    })
  }, [events, staffFilter, typeFilter, searchText])

  const eventTypes = useMemo(() => {
    const set = new Set(events.map(e => e.event_type))
    return [...set].sort()
  }, [events])

  return (
    <div className="space-y-5 max-w-6xl mx-auto">
      <div className="bg-surface border border-border rounded-xl p-5">
        <p className="text-sm text-text-primary mb-1 font-semibold">Activity log</p>
        <p className="text-xs text-text-muted leading-relaxed">
          Each row is one event written from the portal or launcher: sessions (login / logout) and view opens (Reporting, HR, Calendar, etc.). Newest first. Limited to the most recent 500 events.
        </p>
      </div>

      {/* Stats summary */}
      {stats && (
        <div className="grid grid-cols-3 gap-4">
          <div className="bg-surface border border-border rounded-xl p-4 text-center">
            <p className="text-2xl font-bold text-text-primary">{stats.active_staff_count}</p>
            <p className="text-xs text-text-muted uppercase tracking-wide mt-1">Active staff (24h)</p>
          </div>
          <div className="bg-surface border border-border rounded-xl p-4 text-center">
            <p className="text-2xl font-bold text-text-primary">{stats.total_events}</p>
            <p className="text-xs text-text-muted uppercase tracking-wide mt-1">Events (24h)</p>
          </div>
          <div className="bg-surface border border-border rounded-xl p-4 text-center">
            <p className="text-2xl font-bold text-text-primary">{Object.keys(stats.by_event_type || {}).length}</p>
            <p className="text-xs text-text-muted uppercase tracking-wide mt-1">Distinct event types</p>
          </div>
        </div>
      )}

      {/* Filters */}
      <div className="bg-surface border border-border rounded-xl p-4 flex flex-wrap items-center gap-3">
        <input
          type="text"
          placeholder="Search…"
          value={searchText}
          onChange={e => setSearchText(e.target.value)}
          className="flex-1 min-w-[200px] px-3 py-2 rounded-lg border border-border bg-bg text-text-primary text-sm focus:outline-none focus:border-wcs-red"
        />
        <select
          value={staffFilter}
          onChange={e => setStaffFilter(e.target.value)}
          className="px-3 py-2 rounded-lg border border-border bg-bg text-text-primary text-sm focus:outline-none focus:border-wcs-red"
        >
          <option value="">All staff</option>
          {staff.map(s => (
            <option key={s.id} value={s.id}>{s.display_name || s.email}</option>
          ))}
        </select>
        <select
          value={typeFilter}
          onChange={e => setTypeFilter(e.target.value)}
          className="px-3 py-2 rounded-lg border border-border bg-bg text-text-primary text-sm focus:outline-none focus:border-wcs-red"
        >
          <option value="">All event types</option>
          {eventTypes.map(t => (
            <option key={t} value={t}>{formatEvent(t)}</option>
          ))}
        </select>
        <button
          onClick={load}
          className="px-4 py-2 text-sm font-semibold rounded-lg border border-border bg-bg text-text-muted hover:text-text-primary"
        >
          Refresh
        </button>
      </div>

      {error && <p className="text-sm text-wcs-red">{error}</p>}

      {/* Event list */}
      {loading ? (
        <p className="loading-card mx-auto block my-6">Loading…</p>
      ) : filtered.length === 0 ? (
        <p className="empty-card mx-auto block my-6">No events match the filters</p>
      ) : (
        <div className="bg-surface border border-border rounded-xl overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-bg/50">
              <tr className="text-left text-xs uppercase tracking-wide text-text-muted">
                <th className="px-4 py-3">Time</th>
                <th className="px-4 py-3">Staff</th>
                <th className="px-4 py-3">Event</th>
                <th className="px-4 py-3">Details</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map(e => (
                <tr key={e.id} className="border-t border-border">
                  <td className="px-4 py-3 text-text-muted text-xs whitespace-nowrap">{formatTime(e.created_at)}</td>
                  <td className="px-4 py-3 text-text-primary">{e.staff?.display_name || e.staff?.email || '—'}</td>
                  <td className="px-4 py-3">
                    <span className={`inline-block px-2 py-0.5 rounded-full text-[10px] font-medium border ${eventColorClass(e.event_type)}`}>
                      {formatEvent(e.event_type)}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-text-muted text-xs">
                    {e.target && <span className="font-mono">{e.target}</span>}
                    {e.metadata && Object.keys(e.metadata).length > 0 && (
                      <span className="ml-2">{Object.entries(e.metadata).map(([k, v]) => `${k}: ${v}`).join(', ')}</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
