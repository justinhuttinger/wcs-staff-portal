import { useCallback, useEffect, useRef, useState } from 'react'
import { api } from '../../lib/api'
import MobileHeader from './MobileHeader'
import MobilePrograms from './MobilePrograms'
import MobileHabits from './MobileHabits'
import MobileNutrition from './MobileNutrition'

// Coach-side messaging for a phone. Deliberately only the conversation: the
// desktop Admin section owns tiers and program authoring, which need a
// keyboard. This is the thing you do standing on the gym floor.

const clock = (iso) => new Date(iso).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })
const dayKey = (iso) => new Date(iso).toDateString()

function dayLabel(iso) {
  const d = new Date(iso)
  const today = new Date()
  const yesterday = new Date(today)
  yesterday.setDate(today.getDate() - 1)
  if (d.toDateString() === today.toDateString()) return 'Today'
  if (d.toDateString() === yesterday.toDateString()) return 'Yesterday'
  return d.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })
}

function Thread({ member, onBack }) {
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
  useEffect(() => { endRef.current?.scrollIntoView?.({ block: 'end' }) }, [messages])

  async function send(e) {
    e.preventDefault()
    const text = draft.trim()
    if (!text) return
    setBusy(true)
    setError(null)
    setDraft('')
    try {
      await api('/member-app/messages', {
        method: 'POST',
        body: JSON.stringify({
          member_id: member.member_id, club_number: member.club_number, body: text,
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

  let lastDay = null

  return (
    // Fixed height with the composer pinned, so the input sits on the bottom
    // edge rather than drifting up the page as the thread grows.
    <div className="flex flex-col" style={{ height: 'calc(100dvh - 64px)' }}>
      <div className="px-4 pt-4">
        <MobileHeader title={member.name || 'Member'} onBack={onBack} />
      </div>

      {error ? <p className="px-4 text-sm text-wcs-red">{error}</p> : null}

      <div className="flex-1 min-h-0 overflow-y-auto px-4 py-2 space-y-2">
        {messages === null ? (
          <p className="text-sm text-text-muted">Loading…</p>
        ) : messages.length === 0 ? (
          <p className="text-sm text-text-muted">No messages yet. Say hello.</p>
        ) : messages.map(m => {
          const show = dayKey(m.created_at) !== lastDay
          lastDay = dayKey(m.created_at)
          return (
            <div key={m.id}>
              {show ? (
                <p className="text-center text-[10px] uppercase tracking-widest text-text-muted my-3">
                  {dayLabel(m.created_at)}
                </p>
              ) : null}
              <div className={m.sender === 'coach' ? 'text-right' : 'text-left'}>
                <span className={[
                  'inline-block px-3 py-2 rounded-2xl text-sm max-w-[80%] text-left',
                  m.sender === 'coach' ? 'bg-wcs-red text-white' : 'bg-bg text-text-primary',
                ].join(' ')}>
                  {m.body}
                </span>
                <div className="text-[11px] text-text-muted mt-1">{clock(m.created_at)}</div>
              </div>
            </div>
          )
        })}
        <div ref={endRef} />
      </div>

      <form
        onSubmit={send}
        className="flex gap-2 items-center px-4 py-3 border-t border-border bg-surface"
        style={{ paddingBottom: 'calc(12px + env(safe-area-inset-bottom))' }}
      >
        <input
          value={draft}
          onChange={e => setDraft(e.target.value)}
          placeholder="Message"
          aria-label="Message"
          enterKeyHint="send"
          /* 16px stops iOS zooming the viewport when the keyboard opens. */
          className="flex-1 px-4 py-3 rounded-full border border-border bg-bg text-base"
        />
        <button
          type="submit" disabled={busy || !draft.trim()}
          className="w-11 h-11 grid place-items-center rounded-full bg-wcs-red text-white disabled:opacity-40"
          aria-label="Send"
        >
          <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor"
               strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M5 12h13M12 5l7 7-7 7" />
          </svg>
        </button>
      </form>
    </div>
  )
}

function MemberHub({ member, onBack }) {
  const [view, setView] = useState(null)

  if (view === 'messages') return <Thread member={member} onBack={() => setView(null)} />
  if (view === 'programs') return <MobilePrograms member={member} onBack={() => setView(null)} />
  if (view === 'habits') return <MobileHabits member={member} onBack={() => setView(null)} />
  if (view === 'nutrition') return <MobileNutrition member={member} onBack={() => setView(null)} />

  const item = 'w-full text-left border border-border rounded-xl px-4 py-4 bg-surface'
  return (
    <div className="pt-4 px-4">
      <MobileHeader title={member.name || `${member.first_name || ''} ${member.last_name || ''}`.trim()} onBack={onBack} />
      <div className="space-y-2">
        <button className={item} onClick={() => setView('messages')}>
          <span className="block font-semibold">Messages</span>
          <span className="block text-xs text-text-muted">Talk to them in the app</span>
        </button>
        <button className={item} onClick={() => setView('programs')}>
          <span className="block font-semibold">Programs</span>
          <span className="block text-xs text-text-muted">Write, edit, or run a workout</span>
        </button>
        <button className={item} onClick={() => setView('habits')}>
          <span className="block font-semibold">Habits</span>
          <span className="block text-xs text-text-muted">Daily tiles on their home screen</span>
        </button>
        <button className={item} onClick={() => setView('nutrition')}>
          <span className="block font-semibold">Nutrition</span>
          <span className="block text-xs text-text-muted">Goals and what they actually eat</span>
        </button>
      </div>
    </div>
  )
}

export default function MobileCoaching() {
  const [threads, setThreads] = useState(null)
  const [open, setOpen] = useState(null)
  const [q, setQ] = useState('')
  const [found, setFound] = useState(null)
  const [searching, setSearching] = useState(false)
  const [error, setError] = useState(null)

  const load = useCallback(async () => {
    try {
      const r = await api('/member-app/threads')
      setThreads(r.threads || [])
    } catch (err) {
      setError(err.message)
    }
  }, [])

  useEffect(() => { load() }, [load])

  async function search(e) {
    e.preventDefault()
    if (q.trim().length < 2) return
    setSearching(true); setError(null)
    try {
      const r = await api(`/member-app/members?q=${encodeURIComponent(q.trim())}`)
      setFound(r.members || [])
    } catch (err) {
      setError(err.message)
    } finally {
      setSearching(false)
    }
  }

  if (open) {
    return <MemberHub member={open} onBack={() => { setOpen(null); setFound(null); setQ(''); load() }} />
  }

  return (
    <div className="pt-4 px-4">
      <MobileHeader title="Coaching" />

      <form onSubmit={search} className="flex gap-2 mb-4">
        <input
          value={q} onChange={e => setQ(e.target.value)}
          placeholder="Find a member"
          className="flex-1 px-3 py-3 rounded-lg border border-border bg-bg text-base"
        />
        <button
          type="submit" disabled={searching || q.trim().length < 2}
          className="px-4 rounded-lg bg-wcs-red text-white font-semibold disabled:opacity-50"
        >
          {searching ? '…' : 'Find'}
        </button>
      </form>

      {error ? <p className="text-sm text-wcs-red">{error}</p> : null}

      {found !== null ? (
        <ul className="space-y-2 mb-6">
          {found.length === 0 ? (
            <li className="text-sm text-text-muted">No active members matched that.</li>
          ) : found.map(m => (
            <li key={`${m.member_id}-${m.club_number}`}>
              <button
                onClick={() => setOpen(m)}
                className="w-full flex items-center gap-3 text-left border border-border rounded-xl px-4 py-3 bg-surface"
              >
                <span className="flex-1 min-w-0">
                  <span className="block font-semibold">{m.first_name} {m.last_name}</span>
                  <span className="block text-xs text-text-muted">club {m.club_number}</span>
                </span>
                <span className={[
                  'text-[11px] px-2 py-1 rounded font-semibold',
                  m.tier === 'training' ? 'bg-wcs-red text-white' : 'bg-bg text-text-muted',
                ].join(' ')}>
                  {m.tier === 'training' ? 'Training' : 'Basic'}
                </span>
              </button>
            </li>
          ))}
        </ul>
      ) : null}

      {threads === null ? (
        <p className="text-sm text-text-muted">Loading…</p>
      ) : threads.length === 0 ? (
        <p className="text-sm text-text-muted">
          No conversations yet. A member who messages you shows up here.
        </p>
      ) : (
        <ul className="space-y-2">
          {threads.map(t => (
            <li key={`${t.member_id}-${t.club_number}`}>
              <button
                onClick={() => setOpen(t)}
                className="w-full flex items-center gap-3 text-left border border-border rounded-xl px-4 py-3 bg-surface"
              >
                <span className="flex-1 min-w-0">
                  <span className="block font-semibold">{t.name}</span>
                  <span className="block text-xs text-text-muted truncate">
                    {t.last_sender === 'coach' ? 'You: ' : ''}{t.last_body}
                  </span>
                </span>
                {t.unread > 0 ? (
                  <span className="text-xs bg-wcs-red text-white rounded-full px-2 py-0.5">{t.unread}</span>
                ) : null}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
