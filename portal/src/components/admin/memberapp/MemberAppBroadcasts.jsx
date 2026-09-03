import { useCallback, useEffect, useState } from 'react'
import { api } from '../../../lib/api'

const CLUBS = [
  { clubNumber: '30935', name: 'Salem' },
  { clubNumber: '31599', name: 'Keizer' },
  { clubNumber: '7655', name: 'Eugene' },
  { clubNumber: '31598', name: 'Springfield' },
  { clubNumber: '31600', name: 'Clackamas' },
  { clubNumber: '31601', name: 'Milwaukie' },
  { clubNumber: '32073', name: 'Medford' },
]

const when = (iso) => (iso
  ? new Date(iso).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })
  : '—')

const STATUS_STYLE = {
  scheduled: 'bg-bg text-text-muted',
  sending: 'bg-amber-100 text-amber-800',
  sent: 'bg-green-100 text-green-800',
  failed: 'bg-red-100 text-red-800',
  canceled: 'bg-bg text-text-muted line-through',
}

const empty = { title: '', body: '', url: '', audience: 'all', club_number: '', tier: 'training', member_id: '', scheduled_for: '' }

export default function MemberAppBroadcasts() {
  const [form, setForm] = useState(empty)
  const [list, setList] = useState([])
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)
  const [notice, setNotice] = useState(null)

  const load = useCallback(async () => {
    try {
      const r = await api('/member-app/broadcasts')
      setList(r.broadcasts || [])
    } catch (err) {
      setError(err.message)
    }
  }, [])

  useEffect(() => { load() }, [load])

  async function submit(e) {
    e.preventDefault()
    setBusy(true); setError(null); setNotice(null)
    try {
      await api('/member-app/broadcasts', { method: 'POST', body: JSON.stringify(form) })
      setNotice(form.scheduled_for
        ? 'Scheduled. It goes out at the time you picked.'
        : 'Queued. It goes out within a minute.')
      setForm(empty)
      load()
    } catch (err) {
      setError(err.message)
    } finally {
      setBusy(false)
    }
  }

  async function cancel(id) {
    try {
      await api(`/member-app/broadcasts/${id}/cancel`, { method: 'POST' })
      load()
    } catch (err) {
      setError(err.message)
    }
  }

  const field = 'px-3 py-2 rounded-lg border border-border bg-surface text-text-primary w-full'
  const set = (patch) => setForm(f => ({ ...f, ...patch }))

  return (
    <div className="space-y-6">
      <form onSubmit={submit} className="space-y-3 border border-border rounded-lg p-4 bg-surface">
        <div className="grid gap-3 sm:grid-cols-2">
          <label className="text-sm">
            <span className="block text-text-muted mb-1">Title</span>
            <input className={field} value={form.title} maxLength={120}
                   placeholder="New class at Keizer"
                   onChange={e => set({ title: e.target.value })} />
          </label>
          <label className="text-sm">
            <span className="block text-text-muted mb-1">Link (optional)</span>
            <input className={field} value={form.url}
                   placeholder="/classes"
                   onChange={e => set({ url: e.target.value })} />
          </label>
        </div>

        <label className="text-sm block">
          <span className="block text-text-muted mb-1">Message</span>
          <textarea className={field} rows={2} value={form.body} maxLength={500}
                    placeholder="Boxing HIIT starts Tuesday at 6pm."
                    onChange={e => set({ body: e.target.value })} />
        </label>

        <div className="grid gap-3 sm:grid-cols-3">
          <label className="text-sm">
            <span className="block text-text-muted mb-1">Who gets it</span>
            <select className={field} value={form.audience} onChange={e => set({ audience: e.target.value })}>
              <option value="all">Everyone</option>
              <option value="club">One club</option>
              <option value="tier">One tier</option>
              <option value="member">One member</option>
            </select>
          </label>

          {form.audience === 'club' ? (
            <label className="text-sm">
              <span className="block text-text-muted mb-1">Club</span>
              <select className={field} value={form.club_number} onChange={e => set({ club_number: e.target.value })}>
                <option value="">Pick a club</option>
                {CLUBS.map(c => <option key={c.clubNumber} value={c.clubNumber}>{c.name}</option>)}
              </select>
            </label>
          ) : null}

          {form.audience === 'tier' ? (
            <label className="text-sm">
              <span className="block text-text-muted mb-1">Tier</span>
              <select className={field} value={form.tier} onChange={e => set({ tier: e.target.value })}>
                <option value="training">Training clients</option>
                <option value="basic">Basic members</option>
              </select>
            </label>
          ) : null}

          {form.audience === 'member' ? (
            <label className="text-sm">
              <span className="block text-text-muted mb-1">ABC member id</span>
              <input className={field} value={form.member_id}
                     onChange={e => set({ member_id: e.target.value })} />
            </label>
          ) : null}

          <label className="text-sm">
            <span className="block text-text-muted mb-1">When</span>
            <input type="datetime-local" className={field} value={form.scheduled_for}
                   onChange={e => set({ scheduled_for: e.target.value })} />
            <span className="block text-xs text-text-muted mt-1">Leave empty to send now.</span>
          </label>
        </div>

        {error ? <p className="text-sm text-wcs-red">{error}</p> : null}
        {notice ? <p className="text-sm text-green-700">{notice}</p> : null}

        <button
          type="submit" disabled={busy || !form.title.trim()}
          className="px-4 py-2 rounded-lg bg-wcs-red text-white font-semibold disabled:opacity-50"
        >
          {busy ? 'Saving…' : form.scheduled_for ? 'Schedule' : 'Send now'}
        </button>
      </form>

      <div>
        <h3 className="text-sm font-semibold text-text-muted mb-2">Recent</h3>
        {list.length === 0 ? (
          <p className="text-sm text-text-muted">Nothing sent yet.</p>
        ) : (
          <ul className="space-y-2">
            {list.map(b => (
              <li key={b.id} className="border border-border rounded-lg px-4 py-3 bg-surface">
                <div className="flex items-start gap-3">
                  <div className="flex-1">
                    <div className="font-semibold">{b.title}</div>
                    {b.body ? <div className="text-sm text-text-muted">{b.body}</div> : null}
                    <div className="text-xs text-text-muted mt-1">
                      {b.audience}
                      {b.club_number ? ` ${b.club_number}` : ''}
                      {b.tier ? ` ${b.tier}` : ''}
                      {' · '}
                      {b.status === 'sent'
                        ? `sent ${when(b.sent_at)} to ${b.sent_count} device(s)`
                        : `for ${when(b.scheduled_for) === '—' ? 'immediately' : when(b.scheduled_for)}`}
                    </div>
                    {b.error ? <div className="text-xs text-wcs-red mt-1">{b.error}</div> : null}
                  </div>
                  <span className={`text-xs px-2 py-1 rounded ${STATUS_STYLE[b.status] || ''}`}>
                    {b.status}
                  </span>
                  {b.status === 'scheduled' ? (
                    <button onClick={() => cancel(b.id)} className="text-xs text-text-muted hover:text-wcs-red">
                      Cancel
                    </button>
                  ) : null}
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  )
}
