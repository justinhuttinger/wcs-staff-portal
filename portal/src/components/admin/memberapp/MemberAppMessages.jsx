import { useCallback, useEffect, useRef, useState } from 'react'
import { api } from '../../../lib/api'

const when = (iso) => new Date(iso).toLocaleString('en-US', {
  month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit',
})

// One member's thread. The list of who is waiting lives on the members screen,
// so this is only ever the conversation itself.
export default function MemberAppMessages({ member }) {
  const [messages, setMessages] = useState(null)
  const [draft, setDraft] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)
  const endRef = useRef(null)

  const load = useCallback(async () => {
    try {
      const r = await api(
        `/member-app/messages?member_id=${encodeURIComponent(member.member_id)}` +
        `&club_number=${encodeURIComponent(member.club_number)}`
      )
      setMessages(r.messages || [])
    } catch (err) {
      setError(err.message)
    }
  }, [member.member_id, member.club_number])

  useEffect(() => { load() }, [load])
  useEffect(() => { endRef.current?.scrollIntoView({ block: 'end' }) }, [messages])

  async function send(e) {
    e.preventDefault()
    const text = draft.trim()
    if (!text) return
    setBusy(true); setError(null)
    setDraft('')
    try {
      await api('/member-app/messages', {
        method: 'POST',
        body: JSON.stringify({
          member_id: member.member_id,
          club_number: member.club_number,
          body: text,
        }),
      })
      load()
    } catch (err) {
      setError(err.message)
      setDraft(text)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="space-y-3">
      {error ? <p className="text-sm text-wcs-red">{error}</p> : null}

      <div className="border border-border rounded-lg bg-surface p-4 max-h-[52vh] lg:max-h-[420px] overflow-y-auto space-y-3">
        {messages === null ? (
          <p className="text-sm text-text-muted">Loading…</p>
        ) : messages.length === 0 ? (
          <p className="text-sm text-text-muted">
            No messages yet. Say hello — it arrives on their phone.
          </p>
        ) : messages.map(m => (
          <div key={m.id} className={m.sender === 'coach' ? 'text-right' : 'text-left'}>
            <div className={[
              'inline-block px-3 py-2 rounded-lg text-sm max-w-[80%] text-left',
              m.sender === 'coach' ? 'bg-wcs-red text-white' : 'bg-bg text-text-primary',
            ].join(' ')}>
              {m.body}
            </div>
            <div className="text-xs text-text-muted mt-1">{when(m.created_at)}</div>
          </div>
        ))}
        <div ref={endRef} />
      </div>

      <form onSubmit={send} className="flex gap-2">
        <input
          value={draft}
          onChange={e => setDraft(e.target.value)}
          placeholder={`Message ${member.first_name || 'this member'}`}
          className="flex-1 px-3 py-3 rounded-lg border border-border bg-surface text-base"
        />
        <button
          type="submit" disabled={busy || !draft.trim()}
          className="px-4 py-2 rounded-lg bg-wcs-red text-white font-semibold disabled:opacity-50"
        >
          {busy ? 'Sending…' : 'Send'}
        </button>
      </form>
    </div>
  )
}
