import { useCallback, useEffect, useState } from 'react'
import { api } from '../../../lib/api'

const when = (iso) => new Date(iso).toLocaleString('en-US', {
  month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit',
})

export default function MemberAppMessages({ member, onSelect }) {
  const [threads, setThreads] = useState([])
  const [messages, setMessages] = useState([])
  const [draft, setDraft] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)

  const loadThreads = useCallback(async () => {
    try {
      const r = await api('/member-app/threads')
      setThreads(r.threads || [])
    } catch (err) {
      setError(err.message)
    }
  }, [])

  const loadMessages = useCallback(async () => {
    if (!member) { setMessages([]); return }
    try {
      const r = await api(
        `/member-app/messages?member_id=${encodeURIComponent(member.member_id)}` +
        `&club_number=${encodeURIComponent(member.club_number)}`
      )
      setMessages(r.messages || [])
      // Opening a thread marks it read, so the unread counts need refreshing.
      loadThreads()
    } catch (err) {
      setError(err.message)
    }
  }, [member, loadThreads])

  useEffect(() => { loadThreads() }, [loadThreads])
  useEffect(() => { loadMessages() }, [loadMessages])

  async function send(e) {
    e.preventDefault()
    if (!draft.trim() || !member) return
    setBusy(true); setError(null)
    try {
      await api('/member-app/messages', {
        method: 'POST',
        body: JSON.stringify({
          member_id: member.member_id,
          club_number: member.club_number,
          body: draft.trim(),
        }),
      })
      setDraft('')
      loadMessages()
    } catch (err) {
      setError(err.message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="grid gap-4 lg:grid-cols-[280px_1fr]">
      {/* On a phone the list stacks above the thread; on desktop it is a column. */}
      <div className="space-y-2 lg:max-h-[70vh] lg:overflow-y-auto">
        <h3 className="text-sm font-semibold text-text-muted">Conversations</h3>
        {threads.length === 0 ? (
          <p className="text-sm text-text-muted">No messages yet.</p>
        ) : (
          <ul className="space-y-1">
            {threads.map(t => (
              <li key={`${t.member_id}-${t.club_number}`}>
                <button
                  onClick={() => onSelect({
                    member_id: t.member_id, club_number: t.club_number,
                    first_name: t.name, last_name: '',
                  })}
                  className={[
                    'w-full text-left px-3 py-2 rounded-lg border transition-colors',
                    member?.member_id === t.member_id
                      ? 'border-wcs-red bg-surface'
                      : 'border-border bg-surface hover:border-text-muted',
                  ].join(' ')}
                >
                  <div className="flex items-center gap-2">
                    <span className="font-semibold text-sm flex-1 truncate">{t.name}</span>
                    {t.unread > 0 ? (
                      <span className="text-xs bg-wcs-red text-white rounded-full px-2 py-0.5">{t.unread}</span>
                    ) : null}
                  </div>
                  <div className="text-xs text-text-muted truncate">{t.last_body}</div>
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>

      <div className="space-y-3">
        {error ? <p className="text-sm text-wcs-red">{error}</p> : null}

        {!member ? (
          <p className="text-sm text-text-muted">
            Pick a conversation, or choose a member on the Members tab to start one.
          </p>
        ) : (
          <>
            <div className="border border-border rounded-lg bg-surface p-4 max-h-[52vh] lg:max-h-[420px] overflow-y-auto space-y-3">
              {messages.length === 0 ? (
                <p className="text-sm text-text-muted">
                  No messages yet. Say hello — it arrives on their phone.
                </p>
              ) : messages.map(m => (
                <div
                  key={m.id}
                  className={m.sender === 'coach' ? 'text-right' : 'text-left'}
                >
                  <div className={[
                    'inline-block px-3 py-2 rounded-lg text-sm max-w-[80%]',
                    m.sender === 'coach' ? 'bg-wcs-red text-white' : 'bg-bg text-text-primary',
                  ].join(' ')}>
                    {m.body}
                  </div>
                  <div className="text-xs text-text-muted mt-1">{when(m.created_at)}</div>
                </div>
              ))}
            </div>

            <form onSubmit={send} className="flex gap-2">
              <input
                value={draft}
                onChange={e => setDraft(e.target.value)}
                placeholder="Write a message"
                className="flex-1 px-3 py-3 rounded-lg border border-border bg-surface text-base"
              />
              <button
                type="submit" disabled={busy || !draft.trim()}
                className="px-4 py-2 rounded-lg bg-wcs-red text-white font-semibold disabled:opacity-50"
              >
                {busy ? 'Sending…' : 'Send'}
              </button>
            </form>
          </>
        )}
      </div>
    </div>
  )
}
