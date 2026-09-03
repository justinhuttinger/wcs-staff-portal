import { useCallback, useEffect, useState } from 'react'
import { api } from '../../../lib/api'

// Landing screen for the Member App section: find a member, or pick up a
// conversation someone is waiting on.
export default function MemberAppMembers({ onOpen }) {
  const [q, setQ] = useState('')
  const [members, setMembers] = useState([])
  const [threads, setThreads] = useState([])
  const [searched, setSearched] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)

  const loadThreads = useCallback(async () => {
    try {
      const r = await api('/member-app/threads')
      setThreads(r.threads || [])
    } catch {
      // The list is a convenience; search still works without it.
      setThreads([])
    }
  }, [])

  useEffect(() => { loadThreads() }, [loadThreads])

  async function search(e) {
    e?.preventDefault()
    if (q.trim().length < 2) return
    setBusy(true); setError(null)
    try {
      const r = await api(`/member-app/members?q=${encodeURIComponent(q.trim())}`)
      setMembers(r.members || [])
      setSearched(true)
    } catch (err) {
      setError(err.message)
    } finally {
      setBusy(false)
    }
  }

  const waiting = threads.filter(t => t.unread > 0)

  return (
    <div className="space-y-6">
      <form onSubmit={search} className="flex gap-2">
        <input
          value={q}
          onChange={e => setQ(e.target.value)}
          placeholder="Search members by name or email"
          className="flex-1 px-3 py-3 rounded-lg border border-border bg-surface text-text-primary text-base"
        />
        <button
          type="submit"
          disabled={busy || q.trim().length < 2}
          className="px-4 py-2 rounded-lg bg-wcs-red text-white font-semibold disabled:opacity-50"
        >
          {busy ? 'Searching…' : 'Search'}
        </button>
      </form>

      {error ? <p className="text-sm text-wcs-red">{error}</p> : null}

      {searched ? (
        members.length === 0 ? (
          <p className="text-sm text-text-muted">No active members matched that.</p>
        ) : (
          <ul className="space-y-2">
            {members.map(m => (
              <li key={`${m.member_id}-${m.club_number}`}>
                <button
                  onClick={() => onOpen(m)}
                  className="w-full flex items-center gap-3 text-left border border-border rounded-lg px-4 py-3 bg-surface hover:border-text-muted transition-colors"
                >
                  <span className="flex-1">
                    <span className="block font-semibold">{m.first_name} {m.last_name}</span>
                    <span className="block text-xs text-text-muted">
                      {m.email || 'no email'} &middot; club {m.club_number}
                    </span>
                  </span>
                  <span className={[
                    'text-xs px-2 py-1 rounded font-semibold',
                    m.tier === 'training' ? 'bg-wcs-red text-white' : 'bg-bg text-text-muted',
                  ].join(' ')}>
                    {m.tier === 'training' ? 'Training' : 'Basic'}
                  </span>
                  <span className="text-wcs-red font-semibold text-sm">Open</span>
                </button>
              </li>
            ))}
          </ul>
        )
      ) : null}

      {waiting.length > 0 ? (
        <div>
          <h3 className="text-sm font-semibold text-text-muted mb-2">Waiting on a reply</h3>
          <ul className="space-y-2">
            {waiting.map(t => (
              <li key={`${t.member_id}-${t.club_number}`}>
                <button
                  onClick={() => onOpen({
                    member_id: t.member_id, club_number: t.club_number,
                    first_name: t.name, last_name: '', tier: 'training',
                  })}
                  className="w-full flex items-center gap-3 text-left border border-border rounded-lg px-4 py-3 bg-surface hover:border-text-muted transition-colors"
                >
                  <span className="flex-1 min-w-0">
                    <span className="block font-semibold">{t.name}</span>
                    <span className="block text-xs text-text-muted truncate">{t.last_body}</span>
                  </span>
                  <span className="text-xs bg-wcs-red text-white rounded-full px-2 py-0.5">{t.unread}</span>
                </button>
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {!searched && waiting.length === 0 ? (
        <p className="text-sm text-text-muted">
          Search for a member to open their programs and messages.
        </p>
      ) : null}
    </div>
  )
}
