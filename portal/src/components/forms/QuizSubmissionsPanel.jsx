import { useEffect, useState } from 'react'
import { webhookBadge } from './quizDefaults'

const TONES = {
  green: 'bg-green-50 border border-green-200 text-green-700',
  amber: 'bg-amber-50 border border-amber-200 text-amber-700',
  red: 'bg-red-50 border border-red-200 text-wcs-red',
  gray: 'bg-gray-100 border border-gray-200 text-gray-600',
}

export default function QuizSubmissionsPanel({ form, api, canEdit }) {
  const [clubs, setClubs] = useState([])
  const [club, setClub] = useState('')
  const [rows, setRows] = useState(null)
  const [total, setTotal] = useState(0)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(null)

  async function load() {
    setError('')
    try {
      const res = await api.submissions(form.id, 0, club)
      setRows(res.submissions || [])
      setTotal(res.total || 0)
    } catch (err) { setError(err.message || 'Failed to load submissions') }
  }
  useEffect(() => { api.clubs(form.id).then(r => setClubs((r.clubs || []).filter(c => c.active))).catch(() => {}) }, [form.id]) // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { load() }, [form.id, club]) // eslint-disable-line react-hooks/exhaustive-deps

  async function retry(subId) {
    setBusy(subId)
    try { await api.retryWebhook(form.id, subId); await load() }
    catch (err) { setError(err.message || 'Retry failed') }
    finally { setBusy(null) }
  }

  return (
    <div className="space-y-4">
      <div className="bg-surface rounded-xl border border-border p-5 flex flex-wrap items-center gap-3">
        <div className="flex-1 min-w-0">
          <h3 className="text-sm font-bold text-text-primary">Submissions</h3>
          <p className="text-xs text-text-muted mt-0.5">{total} total. The Google Sheet has every answer.</p>
        </div>
        <select value={club} onChange={e => setClub(e.target.value)}
          className="px-3 py-2 bg-bg border border-border rounded-lg text-sm text-text-primary focus:outline-none focus:ring-2 focus:ring-wcs-red">
          <option value="">All clubs</option>
          {clubs.map(c => <option key={c.location_id} value={c.location_id}>{c.name}</option>)}
        </select>
        {form.sheet_id && (
          <a href={`https://docs.google.com/spreadsheets/d/${form.sheet_id}`} target="_blank" rel="noopener noreferrer"
            className="px-4 py-2 text-sm font-medium bg-wcs-red text-white rounded-lg hover:opacity-90 transition-opacity">Open Sheet ↗</a>
        )}
      </div>
      {error && <div className="bg-red-50 border border-red-200 text-wcs-red rounded-xl px-4 py-3 text-sm">{error}</div>}
      {rows === null ? <div className="loading-card" /> : rows.length === 0 ? (
        <div className="bg-surface rounded-xl border border-border p-10 text-center text-sm text-text-muted">No submissions yet.</div>
      ) : (
        <div className="bg-surface rounded-xl border border-border divide-y divide-border">
          {rows.map(r => {
            const b = webhookBadge(r)
            const name = [r.data?.first_name, r.data?.last_name].filter(Boolean).join(' ') || '(no name)'
            return (
              <div key={r.id} className="flex flex-wrap items-center gap-3 px-5 py-3">
                <div className="flex-1 min-w-0">
                  <div className="text-sm font-semibold text-text-primary truncate">{name}</div>
                  <div className="text-xs text-text-muted truncate">{r.data?.email} · {r.club_name} · {new Date(r.submitted_at).toLocaleString()}</div>
                </div>
                <span title={r.webhook_error || undefined} className={`px-2.5 py-1 rounded-full text-[11px] font-semibold ${TONES[b.tone]}`}>{b.label}</span>
                {canEdit && r.webhook_status === 'failed' && (
                  <button onClick={() => retry(r.id)} disabled={busy === r.id}
                    className="px-3 py-1.5 text-xs text-text-primary border border-border rounded-lg hover:bg-bg transition-colors disabled:opacity-50">
                    {busy === r.id ? 'Retrying...' : 'Retry'}
                  </button>
                )}
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
