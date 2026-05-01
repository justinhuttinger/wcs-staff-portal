import { useState, useEffect } from 'react'
import { api } from '../../lib/api'

export default function MembershipSkipListAdmin() {
  const [items, setItems] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [newType, setNewType] = useState('')
  const [newNote, setNewNote] = useState('')
  const [adding, setAdding] = useState(false)
  const [removing, setRemoving] = useState(null)

  async function load() {
    setLoading(true)
    setError(null)
    try {
      const res = await api('/abc-sync/skip-list')
      setItems(res.items || [])
    } catch (err) {
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { load() }, [])

  async function handleAdd(e) {
    e.preventDefault()
    const trimmed = newType.trim()
    if (!trimmed) return
    setAdding(true)
    setError(null)
    try {
      await api('/abc-sync/skip-list', {
        method: 'POST',
        body: JSON.stringify({ membership_type: trimmed, note: newNote.trim() || undefined }),
      })
      setNewType('')
      setNewNote('')
      await load()
    } catch (err) {
      setError(err.message)
    } finally {
      setAdding(false)
    }
  }

  async function handleRemove(type) {
    if (!confirm(`Remove "${type}" from the skip list?\n\nThis type will be included in all reports and the next ABC sync run.`)) return
    setRemoving(type)
    setError(null)
    try {
      await api(`/abc-sync/skip-list/${encodeURIComponent(type)}`, { method: 'DELETE' })
      await load()
    } catch (err) {
      setError(err.message)
    } finally {
      setRemoving(null)
    }
  }

  return (
    <div className="bg-surface/95 backdrop-blur-sm rounded-xl border border-border p-5 space-y-6">
      <div>
        <h3 className="text-sm font-bold text-text-primary">Excluded Membership Types</h3>
        <p className="text-xs text-text-muted mt-1">
          Membership types listed here are excluded from all reports, leaderboards, and sales metrics, and are skipped during ABC → GHL reconciliation.
          Match the value exactly as it appears in ABC (case-sensitive).
        </p>
        <p className="text-[11px] text-text-muted mt-1">
          Changes propagate within ~1 minute (cached server-side).
        </p>
      </div>

      <form onSubmit={handleAdd} className="bg-surface border border-border rounded-xl p-4 space-y-3">
        <div className="grid grid-cols-[1fr_2fr_auto] gap-3 items-end">
          <div>
            <label className="block text-[11px] font-semibold text-text-muted uppercase tracking-wide mb-1">Membership Type</label>
            <input
              type="text"
              value={newType}
              onChange={e => setNewType(e.target.value)}
              placeholder="e.g. CHILDCARE"
              className="w-full px-3 py-2 text-xs rounded-lg border border-border bg-bg text-text-primary focus:outline-none focus:border-wcs-red"
            />
          </div>
          <div>
            <label className="block text-[11px] font-semibold text-text-muted uppercase tracking-wide mb-1">Note (optional)</label>
            <input
              type="text"
              value={newNote}
              onChange={e => setNewNote(e.target.value)}
              placeholder="Why is this excluded?"
              className="w-full px-3 py-2 text-xs rounded-lg border border-border bg-bg text-text-primary focus:outline-none focus:border-wcs-red"
            />
          </div>
          <button
            type="submit"
            disabled={adding || !newType.trim()}
            className="text-xs bg-wcs-red text-white rounded-lg px-4 py-2 font-medium hover:bg-wcs-red/90 disabled:opacity-50"
          >
            {adding ? 'Adding...' : 'Add'}
          </button>
        </div>
      </form>

      {error && (
        <div className="text-xs text-red-500 bg-red-50 border border-red-200 rounded-lg px-3 py-2">{error}</div>
      )}

      <div className="bg-surface border border-border rounded-xl overflow-hidden">
        <div className="grid grid-cols-[1fr_2fr_auto] gap-2 px-4 py-2 text-[11px] font-semibold text-text-muted uppercase tracking-wide bg-bg border-b border-border">
          <span>Type</span>
          <span>Note</span>
          <span></span>
        </div>
        {loading ? (
          <p className="text-sm text-text-muted px-4 py-6 text-center">Loading...</p>
        ) : items.length === 0 ? (
          <p className="text-sm text-text-muted px-4 py-6 text-center">No excluded types — all membership types are counted in reports.</p>
        ) : (
          items.map(item => (
            <div key={item.membership_type} className="grid grid-cols-[1fr_2fr_auto] gap-2 px-4 py-2 text-sm border-b border-border last:border-0 items-center">
              <span className="text-text-primary font-medium">{item.membership_type}</span>
              <span className="text-text-muted">{item.note || <em className="opacity-60">—</em>}</span>
              <button
                onClick={() => handleRemove(item.membership_type)}
                disabled={removing === item.membership_type}
                className="text-xs text-red-500 hover:text-red-700 font-medium disabled:opacity-50"
              >
                {removing === item.membership_type ? 'Removing...' : 'Remove'}
              </button>
            </div>
          ))
        )}
      </div>
    </div>
  )
}
