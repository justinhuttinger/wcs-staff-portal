import { useState, useEffect, useCallback, useMemo } from 'react'
import { projects } from '../../lib/api'
import { Button, ErrorBanner, Spinner } from '../adsmanager/ui'
import { MentionComposer, MentionText } from '../admin/ticketing/mentions'
import { describeActivity, mergeThread } from './model'

function when(iso) {
  const d = new Date(iso)
  return d.toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })
}

function Comment({ c, me, nameOf, members, onSave }) {
  const [editing, setEditing] = useState(false)
  const [text, setText] = useState(c.body)
  const [busy, setBusy] = useState(false)
  const save = async () => {
    if (!text.trim()) return
    setBusy(true)
    try { await onSave(c, text); setEditing(false) } finally { setBusy(false) }
  }
  return (
    <div className="rounded-lg border border-border bg-bg px-3 py-2">
      <div className="flex items-baseline justify-between gap-2">
        <p className="text-xs font-bold text-text-primary">{c.author_id ? nameOf(c.author_id) : 'Someone'}</p>
        <p className="text-[10px] text-text-muted shrink-0">
          {when(c.created_at)}{c.edited_at ? ' · edited' : ''}
          {c.author_id === me && !editing && (
            <button type="button" onClick={() => { setText(c.body); setEditing(true) }} className="ml-2 hover:text-text-primary">Edit</button>
          )}
        </p>
      </div>
      {editing ? (
        <div className="mt-1.5 space-y-2">
          <MentionComposer value={text} onChange={setText} staff={members} currentUserId={me} rows={3} onEnter={save} />
          <div className="flex gap-2 justify-end">
            <Button variant="ghost" onClick={() => setEditing(false)}>Cancel</Button>
            <Button onClick={save} disabled={busy || !text.trim()}>Save</Button>
          </div>
        </div>
      ) : (
        <p className="text-sm text-text-primary mt-0.5"><MentionText body={c.body} currentUserId={me} /></p>
      )}
    </div>
  )
}

// Comments and history for one task, oldest first, with a composer at the
// bottom. Anyone with the tile can comment, assigned or not.
export default function TaskThread({ taskId, me, members, nameOf, categoryName, onCommented }) {
  const [thread, setThread] = useState(null)
  const [draft, setDraft] = useState('')
  const [posting, setPosting] = useState(false)
  const [showHistory, setShowHistory] = useState(true)
  const [error, setError] = useState('')

  const load = useCallback(async () => {
    try { setThread(await projects.tasks.thread(taskId)) } catch (e) { setError(e.message) }
  }, [taskId])
  useEffect(() => { load() }, [load])

  const items = useMemo(() => {
    if (!thread) return []
    return mergeThread(thread.comments, showHistory ? thread.activity : [])
  }, [thread, showHistory])

  const post = async () => {
    if (!draft.trim() || posting) return
    setPosting(true); setError('')
    try {
      const { comment } = await projects.tasks.comment(taskId, draft)
      setThread(t => ({ ...t, comments: [...t.comments, comment] }))
      setDraft('')
      onCommented?.()
    } catch (e) { setError(e.message) } finally { setPosting(false) }
  }

  const saveEdit = async (c, body) => {
    try {
      const { comment } = await projects.tasks.editComment(taskId, c.id, body)
      setThread(t => ({ ...t, comments: t.comments.map(x => (x.id === comment.id ? comment : x)) }))
    } catch (e) { setError(e.message); throw e }
  }

  return (
    <div className="space-y-3 border-t border-border pt-5">
      <div className="flex items-center justify-between">
        <h4 className="text-sm font-bold text-text-primary">Comments</h4>
        <label className="flex items-center gap-1.5 text-[11px] text-text-muted cursor-pointer">
          <input type="checkbox" checked={showHistory} onChange={e => setShowHistory(e.target.checked)} className="accent-wcs-red" />
          Show history
        </label>
      </div>
      <ErrorBanner error={error} onDismiss={() => setError('')} />
      {!thread && !error && <Spinner />}
      {thread && items.length === 0 && <p className="text-xs text-text-muted">No comments yet.</p>}
      <div className="space-y-2">
        {items.map(x => (x.type === 'comment'
          ? <Comment key={'c' + x.item.id} c={x.item} me={me} nameOf={nameOf} members={members} onSave={saveEdit} />
          : (
            <p key={'a' + x.item.id} className="text-[11px] text-text-muted px-1">
              {describeActivity(x.item, { nameOf, categoryName })} · {when(x.item.created_at)}
            </p>
          )))}
      </div>
      <MentionComposer value={draft} onChange={setDraft} staff={members} currentUserId={me} rows={2}
        placeholder="Write a comment… use @ to mention someone" onEnter={post} disabled={posting} />
      <div className="flex justify-end">
        <Button onClick={post} disabled={posting || !draft.trim()}>{posting ? 'Posting…' : 'Comment'}</Button>
      </div>
    </div>
  )
}
