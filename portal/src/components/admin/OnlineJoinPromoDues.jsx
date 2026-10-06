import { useState, useEffect } from 'react'
import { onlineJoin } from '../../lib/api'

// Next-month dues promo log (prospects services/online-join/dues-promo.js):
// one row per online join on a type with "set next month's dues" on.
const STATUS_BADGE = {
  pending:         { label: 'Pending',            cls: 'bg-gray-100 text-gray-700' },
  adjusted:        { label: 'Dues adjusted',      cls: 'bg-green-100 text-green-800' },
  no_change:       { label: 'Already lower',      cls: 'bg-gray-100 text-gray-700' },
  no_dues_invoice: { label: 'No upcoming dues',   cls: 'bg-amber-100 text-amber-800' },
  error:           { label: 'Failed',             cls: 'bg-red-100 text-red-800' },
}

function StatusBadge({ status }) {
  const meta = STATUS_BADGE[status] || { label: status, cls: 'bg-gray-100 text-gray-700' }
  return <span className={`inline-block px-2 py-0.5 rounded-full text-[10px] font-semibold ${meta.cls}`}>{meta.label}</span>
}

function money(n) {
  return n == null ? '—' : `$${Number(n).toFixed(2)}`
}

function formatDate(iso) {
  if (!iso) return '—'
  const d = new Date(iso)
  if (isNaN(d.getTime())) return '—'
  return d.toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })
}

// invoice_due_date is a plain date; don't let the timezone shift it a day.
function formatDay(ymd) {
  if (!ymd) return '—'
  const [y, m, d] = ymd.split('-')
  return `${m}/${d}/${y}`
}

const needsRetry = (a) => a.status !== 'no_change' && (a.status !== 'adjusted' || !a.note_added)

export default function OnlineJoinPromoDues() {
  const [rows, setRows] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [retrying, setRetrying] = useState(null)

  async function load() {
    setLoading(true); setError(null)
    try {
      const r = await onlineJoin.listDuesAdjustments()
      setRows(r.adjustments || [])
    } catch (e) {
      setError(e.message || 'Failed to load')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { load() }, [])

  async function retry(id) {
    setRetrying(id); setError(null)
    try {
      const r = await onlineJoin.retryDuesAdjustment(id)
      setRows(prev => prev.map(a => (a.id === id ? r.adjustment : a)))
    } catch (e) {
      setError(e.message || 'Retry failed')
    } finally {
      setRetrying(null)
    }
  }

  const adjusted = rows.filter(a => a.status === 'adjusted')
  const discounted = adjusted.reduce((sum, a) => sum + Math.max(0, (Number(a.original_amount) || 0) - (Number(a.adjusted_amount) || 0)), 0)
  const problems = rows.filter(needsRetry).length

  return (
    <div className="space-y-3">
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        <div className="bg-surface border border-border rounded-xl p-4">
          <div className="text-xs text-text-muted">Promo months given</div>
          <div className="text-2xl font-bold text-text-primary">{adjusted.length}</div>
        </div>
        <div className="bg-surface border border-border rounded-xl p-4">
          <div className="text-xs text-text-muted">Dues discounted</div>
          <div className="text-2xl font-bold text-text-primary">{money(discounted)}</div>
        </div>
        <div className="bg-surface border border-border rounded-xl p-4">
          <div className="text-xs text-text-muted">Need attention</div>
          <div className={`text-2xl font-bold ${problems ? 'text-wcs-red' : 'text-text-primary'}`}>{problems}</div>
        </div>
      </div>

      {error && <div className="bg-red-50 border border-red-200 text-red-700 rounded-xl px-4 py-3 text-sm">{error}</div>}

      <div className="bg-surface border border-border rounded-xl overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="border-b border-border bg-bg/50">
            <tr>
              <th className="text-left px-3 py-2 text-xs font-semibold text-text-muted">Joined</th>
              <th className="text-left px-3 py-2 text-xs font-semibold text-text-muted">Location</th>
              <th className="text-left px-3 py-2 text-xs font-semibold text-text-muted">Member</th>
              <th className="text-left px-3 py-2 text-xs font-semibold text-text-muted">Promo type</th>
              <th className="text-left px-3 py-2 text-xs font-semibold text-text-muted">Next month</th>
              <th className="text-left px-3 py-2 text-xs font-semibold text-text-muted">Status</th>
              <th className="text-left px-3 py-2 text-xs font-semibold text-text-muted">ABC note</th>
              <th className="px-3 py-2"></th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 && !loading && (
              <tr><td colSpan={8} className="px-4 py-8 text-center text-sm text-text-muted">No promo joins yet.</td></tr>
            )}
            {loading && rows.length === 0 && (
              <tr><td colSpan={8} className="px-4 py-8 text-center text-sm text-text-muted">Loading…</td></tr>
            )}
            {rows.map(a => (
              <tr key={a.id} className="border-b border-border last:border-0 align-top">
                <td className="px-3 py-2 text-xs text-text-muted whitespace-nowrap">{formatDate(a.created_at)}</td>
                <td className="px-3 py-2 text-xs">{a.wcs_location_id}</td>
                <td className="px-3 py-2">
                  <div className="text-xs font-semibold text-text-primary">{a.member_name || '—'}</div>
                  <div className="text-[10px] text-text-muted font-mono">{a.abc_member_id}</div>
                </td>
                <td className="px-3 py-2 text-xs">{a.type_label || '—'}</td>
                <td className="px-3 py-2 text-xs whitespace-nowrap">
                  {a.invoice_due_date ? `${formatDay(a.invoice_due_date)} · ${money(a.original_amount)} → ${money(a.adjusted_amount)}` : `→ ${money(a.adjusted_amount)}`}
                </td>
                <td className="px-3 py-2">
                  <StatusBadge status={a.status} />
                  {a.error && <div className="text-[10px] text-red-700 mt-1 max-w-xs break-words">{a.error}</div>}
                </td>
                <td className="px-3 py-2 text-xs">
                  {a.note_added ? 'Added' : a.status === 'adjusted' ? <span className="text-red-700">Missing</span> : '—'}
                  {a.note_error && <div className="text-[10px] text-red-700 mt-1 max-w-xs break-words">{a.note_error}</div>}
                </td>
                <td className="px-3 py-2 text-right">
                  {needsRetry(a) && (
                    <button
                      onClick={() => retry(a.id)}
                      disabled={retrying === a.id}
                      className="px-2.5 py-1 rounded-lg text-xs font-medium bg-wcs-red text-white disabled:opacity-50"
                    >
                      {retrying === a.id ? 'Retrying…' : 'Retry'}
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}
