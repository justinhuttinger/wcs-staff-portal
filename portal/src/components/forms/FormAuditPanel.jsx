import { useEffect, useMemo, useState } from 'react'
import { forms as formsApi } from '../../lib/api'

const inputClass = 'w-full px-3 py-2 bg-bg border border-border rounded-lg text-sm text-text-primary focus:outline-none focus:ring-2 focus:ring-wcs-red disabled:opacity-60'

const ACTION_LABELS = {
  created: 'Created the form',
  edited: 'Edited fields',
  published: 'Published',
  archived: 'Archived',
  deleted: 'Deleted',
  shared: 'Shared with a teammate',
  unshared: "Removed a teammate's access",
  permission_changed: "Changed a teammate's permission",
  visibility_changed: 'Changed visibility',
  submission_received: 'Received a submission',
  sheet_retry: 'Retried Sheet sync',
}

const VISIBILITY_WORDS = { private: 'Private', location: 'My location', shared: 'Specific people' }

// Label for the event, using the resolved teammate name when the backend
// provided one; falls back to the generic copy otherwise.
function actionLabel(action, detail) {
  const name = detail && typeof detail === 'object' ? detail.staff_name : null
  if (name) {
    if (action === 'shared') return `Shared with ${name}`
    if (action === 'unshared') return `Removed ${name}'s access`
    if (action === 'permission_changed') return `Changed ${name}'s permission`
  }
  return ACTION_LABELS[action] || action
}

// A short, human-readable summary of the event detail. Falls back to compact
// JSON so nothing is ever silently dropped.
function summarizeDetail(action, detail) {
  if (!detail || typeof detail !== 'object') return ''
  switch (action) {
    case 'permission_changed':
    case 'shared':
      return detail.permission ? `as ${detail.permission}` : ''
    case 'unshared': {
      // The teammate's name is already in the label; nothing else to show.
      if (detail.staff_name) return ''
      const s = JSON.stringify(detail)
      return s === '{}' ? '' : s
    }
    case 'visibility_changed': {
      const parts = []
      if (detail.visibility) parts.push(VISIBILITY_WORDS[detail.visibility] || detail.visibility)
      if (detail.visibility === 'location') parts.push(detail.location_can_edit ? 'teammates can edit' : 'view only')
      return parts.join(', ')
    }
    case 'edited': {
      const parts = []
      if (detail.title) parts.push(`title "${detail.title}"`)
      if (typeof detail.field_count === 'number') parts.push(`${detail.field_count} field${detail.field_count === 1 ? '' : 's'}`)
      if (detail.description) parts.push('intro text')
      return parts.join(', ')
    }
    case 'created':
      return detail.title ? `"${detail.title}"` : ''
    case 'deleted':
      return detail.title ? `"${detail.title}"` : ''
    case 'published':
      return detail.sheet_error ? `Sheet not ready: ${detail.sheet_error}` : (detail.sheet_id ? 'Sheet connected' : '')
    case 'sheet_retry': {
      const parts = []
      if (typeof detail.synced === 'number') parts.push(`${detail.synced} synced`)
      if (typeof detail.failed === 'number') parts.push(`${detail.failed} failed`)
      return parts.join(', ')
    }
    default: {
      const s = JSON.stringify(detail)
      return s === '{}' ? '' : s
    }
  }
}

function EventRow({ event }) {
  const label = actionLabel(event.action, event.detail)
  const summary = summarizeDetail(event.action, event.detail)
  const when = event.created_at ? new Date(event.created_at).toLocaleString() : ''
  return (
    <li className="flex gap-3 px-4 py-3 border-b border-border last:border-b-0">
      <span className="mt-1.5 w-2 h-2 rounded-full bg-wcs-red shrink-0" />
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-baseline gap-x-2">
          <span className="text-sm font-medium text-text-primary">{label}</span>
          <span className="text-xs text-text-muted">by {event.actor_name || 'Unknown'}</span>
        </div>
        {summary && <p className="text-xs text-text-muted mt-0.5 break-words">{summary}</p>}
        <p className="text-[11px] text-text-muted mt-0.5">{when}</p>
      </div>
    </li>
  )
}

export default function FormAuditPanel({ form, isCorporate }) {
  const [scopeAll, setScopeAll] = useState(false)
  const [staffFilter, setStaffFilter] = useState('')
  const [formFilter, setFormFilter] = useState('')
  const [events, setEvents] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  // Applied filters, so typing does not fire a request per keystroke.
  const [applied, setApplied] = useState({ staff_id: '', form_id: '' })

  useEffect(() => {
    if (!form?.id) return
    let cancelled = false
    setLoading(true)
    setError('')
    const request = scopeAll
      ? formsApi.auditAll({
          ...(applied.staff_id ? { staff_id: applied.staff_id } : {}),
          ...(applied.form_id ? { form_id: applied.form_id } : {}),
        })
      : formsApi.audit(form.id)
    request
      .then(res => { if (!cancelled) setEvents(res.events || []) })
      .catch(err => { if (!cancelled) setError(err.message || 'Failed to load activity') })
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [form?.id, scopeAll, applied])

  const heading = useMemo(() => (scopeAll ? 'All forms activity' : 'Form activity'), [scopeAll])

  function applyFilters(e) {
    e.preventDefault()
    setApplied({ staff_id: staffFilter.trim(), form_id: formFilter.trim() })
  }

  return (
    <div className="bg-surface rounded-xl border border-border p-5 space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-sm font-bold text-text-primary">{heading}</h3>
        {isCorporate && (
          <button
            type="button"
            onClick={() => setScopeAll(v => !v)}
            className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${
              scopeAll ? 'bg-wcs-red text-white' : 'bg-bg text-text-muted hover:text-text-primary border border-border'
            }`}
          >
            {scopeAll ? 'View this form only' : 'View all forms activity'}
          </button>
        )}
      </div>

      {isCorporate && scopeAll && (
        <form onSubmit={applyFilters} className="flex flex-col sm:flex-row gap-2">
          <input
            type="text"
            value={staffFilter}
            onChange={e => setStaffFilter(e.target.value)}
            placeholder="Filter by staff ID"
            className={inputClass + ' sm:flex-1'}
          />
          <input
            type="text"
            value={formFilter}
            onChange={e => setFormFilter(e.target.value)}
            placeholder="Filter by form ID"
            className={inputClass + ' sm:flex-1'}
          />
          <button
            type="submit"
            className="px-4 py-2 text-sm font-medium bg-wcs-red text-white rounded-lg hover:opacity-90 transition-opacity shrink-0"
          >
            Apply
          </button>
        </form>
      )}

      {error && (
        <div className="bg-red-50 border border-red-200 text-wcs-red rounded-xl px-4 py-3 text-sm">{error}</div>
      )}

      {loading ? (
        <div className="loading-card" />
      ) : events.length === 0 ? (
        <p className="text-sm text-text-muted py-6 text-center">No activity yet.</p>
      ) : (
        <ul className="bg-bg rounded-xl border border-border overflow-hidden">
          {events.map(e => <EventRow key={e.id} event={e} />)}
        </ul>
      )}
    </div>
  )
}
