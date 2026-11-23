import { useState, useEffect, useCallback, useMemo, useRef } from 'react'
import { projects } from '../../lib/api'
import { ErrorBanner, Spinner } from '../adsmanager/ui'
import { MentionComposer, MentionText } from '../admin/ticketing/mentions'
import { describeActivity, mergeThread } from './model'
import { Avatar } from './Dropdown'
import useLiveRefresh from './useLiveRefresh'

function when(iso) {
  return new Date(iso).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })
}

function Message({ c, me, nameOf, members, onSave }) {
  const mine = c.author_id === me
  const [editing, setEditing] = useState(false)
  const [text, setText] = useState(c.body)
  const [busy, setBusy] = useState(false)
  const save = async () => {
    if (!text.trim()) return
    setBusy(true)
    try { await onSave(c, text); setEditing(false) } catch { /* error shown above */ } finally { setBusy(false) }
  }
  const name = c.author_id ? nameOf(c.author_id) : 'Someone'
  return (
    <div className={`flex gap-2.5 items-start ${mine ? 'flex-row-reverse' : ''}`}>
      <Avatar id={c.author_id} name={name} size={26} />
      <div className={`min-w-0 max-w-[85%] flex flex-col ${mine ? 'items-end' : 'items-start'}`}>
        <p className="text-[11px] text-text-muted mb-0.5 px-1">
          <span className="font-bold text-text-primary">{mine ? 'You' : name}</span> · {when(c.created_at)}{c.edited_at ? ' · edited' : ''}
          {mine && !editing && (
            <button type="button" onClick={() => { setText(c.body); setEditing(true) }} className="ml-2 underline hover:text-text-primary">Edit</button>
          )}
        </p>
        {editing ? (
          <div className="w-full min-w-[260px] space-y-2">
            <MentionComposer value={text} onChange={setText} staff={members} currentUserId={me} rows={3} onEnter={save} />
            <div className="flex gap-2 justify-end">
              <button type="button" onClick={() => setEditing(false)} className="text-xs text-text-muted hover:text-text-primary px-2">Cancel</button>
              <button type="button" onClick={save} disabled={busy || !text.trim()}
                className="px-3 py-1.5 rounded-lg text-xs font-semibold bg-wcs-red text-white disabled:opacity-50">Save</button>
            </div>
          </div>
        ) : (
          <div className={`text-sm leading-relaxed px-3 py-2 border ${mine
            ? 'bg-wcs-red/10 border-transparent rounded-2xl rounded-tr-md'
            : 'bg-surface border-border rounded-2xl rounded-tl-md'} text-text-primary break-words`}>
            <MentionText body={c.body} currentUserId={me} />
          </div>
        )}
      </div>
    </div>
  )
}

// The task view's right-hand column: comments and history as a chat, oldest
// first, scrolled to the newest, with the composer pinned at the bottom.
// Anyone with the tile can comment, assigned or not.
export default function TaskThread({ taskId, me, members, nameOf, categoryName, onCommented }) {
  const [thread, setThread] = useState(null)
  const [draft, setDraft] = useState('')
  const [posting, setPosting] = useState(false)
  const [showHistory, setShowHistory] = useState(true)
  const [error, setError] = useState('')
  const endRef = useRef(null)

  const load = useCallback(async () => {
    try { setThread(await projects.tasks.thread(taskId)) } catch (e) { setError(e.message) }
  }, [taskId])
  useEffect(() => { load() }, [load])

  // New comments from others appear while the task is open (quietly; a
  // draft being typed is separate state and is never touched).
  const busy = useRef(false)
  const quiet = useCallback(async () => {
    if (busy.current) return
    try {
      const next = await projects.tasks.thread(taskId, { silent: true })
      if (busy.current) return
      setThread(prev => (prev && JSON.stringify(prev) === JSON.stringify(next) ? prev : next))
    } catch { /* next tick */ }
  }, [taskId])
  useLiveRefresh(quiet, { ms: 10000, enabled: !!thread })

  const items = useMemo(() => (thread ? mergeThread(thread.comments, showHistory ? thread.activity : []) : []), [thread, showHistory])
  useEffect(() => { endRef.current?.scrollIntoView({ block: 'end' }) }, [items.length])

  const post = async () => {
    if (!draft.trim() || posting) return
    setPosting(true); setError('')
    busy.current = true
    try {
      const { comment } = await projects.tasks.comment(taskId, draft)
      setThread(t => ({ ...t, comments: [...t.comments, comment] }))
      setDraft('')
      onCommented?.()
    } catch (e) { setError(e.message) } finally { setPosting(false); busy.current = false }
  }

  const saveEdit = async (c, body) => {
    try {
      const { comment } = await projects.tasks.editComment(taskId, c.id, body)
      setThread(t => ({ ...t, comments: t.comments.map(x => (x.id === comment.id ? comment : x)) }))
    } catch (e) { setError(e.message); throw e }
  }

  const count = thread?.comments.length || 0
  return (
    <div className="flex flex-col h-full min-h-0">
      <div className="px-5 py-3.5 border-b border-border bg-surface flex items-center justify-between gap-3">
        <h4 className="text-sm font-bold text-text-primary">Comments{count ? <span className="text-text-muted font-semibold"> · {count}</span> : null}</h4>
        <label className="flex items-center gap-1.5 text-[11px] text-text-muted cursor-pointer">
          <input type="checkbox" checked={showHistory} onChange={e => setShowHistory(e.target.checked)} className="accent-wcs-red" />
          Show history
        </label>
      </div>
      <div className="flex-1 min-h-0 overflow-y-auto px-5 py-4 space-y-3">
        <ErrorBanner error={error} onDismiss={() => setError('')} />
        {!thread && !error && <Spinner />}
        {thread && items.length === 0 && (
          <p className="text-xs text-text-muted text-center py-8">No comments yet. Ask a question or post an update; assignees get it in Google Chat.</p>
        )}
        {items.map(x => (x.type === 'comment'
          ? <Message key={'c' + x.item.id} c={x.item} me={me} nameOf={nameOf} members={members} onSave={saveEdit} />
          : (
            <p key={'a' + x.item.id} className="text-[11px] text-text-muted text-center px-4">
              {describeActivity(x.item, { nameOf, categoryName })} · {when(x.item.created_at)}
            </p>
          )))}
        <div ref={endRef} />
      </div>
      <div className="border-t border-border bg-surface px-4 py-3 space-y-2">
        <MentionComposer value={draft} onChange={setDraft} staff={members} currentUserId={me} rows={2}
          placeholder="Write a comment… use @ to mention someone" onEnter={post} disabled={posting} />
        <div className="flex items-center justify-between">
          <span className="text-[11px] text-text-muted">Enter to send · Shift+Enter for a new line</span>
          <button type="button" onClick={post} disabled={posting || !draft.trim()}
            className="px-4 py-1.5 rounded-lg text-sm font-semibold bg-wcs-red text-white hover:bg-wcs-red/90 disabled:opacity-50">
            {posting ? 'Sending…' : 'Send'}
          </button>
        </div>
      </div>
    </div>
  )
}
