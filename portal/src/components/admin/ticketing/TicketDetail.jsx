import { useState, useEffect, useCallback } from 'react'
import { ticketing } from '../../../lib/api'
import { DynamicAnswers } from './DynamicFields'
import { STATUSES, STATUS_BY_KEY, PRIORITIES, PRIORITY_BY_KEY, fmtDate, fmtBytes } from './shared'

function StatusBadge({ status }) {
  const s = STATUS_BY_KEY[status] || STATUS_BY_KEY.open
  return <span className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold border ${s.chip}`}>
    <span className={`w-1.5 h-1.5 rounded-full ${s.dot}`} />{s.label}
  </span>
}

export default function TicketDetail({ ticketId, onBack, onChanged }) {
  const [detail, setDetail] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [comment, setComment] = useState('')
  const [posting, setPosting] = useState(false)
  const [commentFiles, setCommentFiles] = useState([])
  const [busy, setBusy] = useState(false)

  const load = useCallback(async () => {
    try {
      const res = await ticketing.get(ticketId)
      setDetail(res)
    } catch (err) { setError(err.message) } finally { setLoading(false) }
  }, [ticketId])
  useEffect(() => { load() }, [load])

  async function setStatus(status) {
    setBusy(true)
    try { await ticketing.update(ticketId, { status }); await load(); onChanged?.() }
    catch (err) { setError(err.message) } finally { setBusy(false) }
  }
  async function setPriority(priority) {
    setBusy(true)
    try { await ticketing.update(ticketId, { priority }); await load(); onChanged?.() }
    catch (err) { setError(err.message) } finally { setBusy(false) }
  }

  async function postComment() {
    if (!comment.trim() && commentFiles.length === 0) return
    setPosting(true)
    try {
      let commentId = null
      if (comment.trim()) {
        const res = await ticketing.addComment(ticketId, comment.trim())
        commentId = res.comment?.id
      }
      for (const f of commentFiles) await ticketing.uploadAttachment(ticketId, f, commentId)
      setComment(''); setCommentFiles([])
      await load(); onChanged?.()
    } catch (err) { setError(err.message) } finally { setPosting(false) }
  }

  if (loading) return <p className="loading-card mx-auto block my-6">Loading…</p>
  if (error && !detail) return <div className="space-y-3"><button onClick={onBack} className="text-sm text-text-muted hover:text-text-primary">← Back</button><p className="text-sm text-wcs-red">{error}</p></div>
  if (!detail) return null

  const { ticket, type, comments = [], attachments = [] } = detail
  const submitAttachments = attachments.filter(a => !a.comment_id)

  return (
    <div className="max-w-3xl space-y-4">
      <button onClick={onBack} className="text-sm text-text-muted hover:text-text-primary">← All tickets</button>

      {/* Header */}
      <div className="bg-surface border border-border rounded-xl p-5">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="text-[11px] font-semibold uppercase tracking-wide text-wcs-red">{ticket.type_name}</p>
            <h2 className="text-lg font-bold text-text-primary mt-0.5">{ticket.title}</h2>
            <p className="text-xs text-text-muted mt-1">
              Submitted by <span className="font-semibold text-text-primary">{ticket.submitter_name}</span> · {fmtDate(ticket.created_at)}
            </p>
          </div>
          <StatusBadge status={ticket.status} />
        </div>

        {/* Status controls */}
        <div className="mt-4 pt-4 border-t border-border flex flex-wrap items-center gap-2">
          <span className="text-xs font-semibold text-text-muted mr-1">Set status:</span>
          {STATUSES.map(s => (
            <button key={s.key} disabled={busy || ticket.status === s.key} onClick={() => setStatus(s.key)}
              className={`px-3 py-1 text-xs font-semibold rounded-lg border transition-colors ${ticket.status === s.key ? 'bg-wcs-red text-white border-wcs-red' : 'bg-bg text-text-muted border-border hover:text-text-primary disabled:opacity-40'}`}>
              {s.label}
            </button>
          ))}
          {ticket.status !== 'complete' && (
            <button disabled={busy} onClick={() => setStatus('complete')}
              className="ml-auto px-3 py-1 text-xs font-bold rounded-lg bg-green-600 text-white hover:bg-green-700 disabled:opacity-40">
              ✓ Mark Complete
            </button>
          )}
        </div>
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <span className="text-xs font-semibold text-text-muted mr-1">Priority:</span>
          {PRIORITIES.map(p => (
            <button key={p.key} disabled={busy || ticket.priority === p.key} onClick={() => setPriority(p.key)}
              className={`px-2.5 py-1 text-xs font-semibold rounded-lg border transition-colors ${ticket.priority === p.key ? `${p.chip}` : 'bg-bg text-text-muted border-border hover:text-text-primary disabled:opacity-40'}`}>
              {p.label}
            </button>
          ))}
        </div>
      </div>

      {/* Answers */}
      <div className="bg-surface border border-border rounded-xl p-5">
        <h3 className="text-sm font-bold text-text-primary mb-2">Details</h3>
        <DynamicAnswers schema={type?.schema || []} data={ticket.data || {}} />
      </div>

      {/* Submitted attachments */}
      {submitAttachments.length > 0 && (
        <div className="bg-surface border border-border rounded-xl p-5">
          <h3 className="text-sm font-bold text-text-primary mb-2">Attachments</h3>
          <ul className="space-y-1.5">
            {submitAttachments.map(a => <AttachmentRow key={a.id} att={a} />)}
          </ul>
        </div>
      )}

      {/* Activity / comments */}
      <div className="bg-surface border border-border rounded-xl p-5">
        <h3 className="text-sm font-bold text-text-primary mb-3">Activity</h3>
        <div className="space-y-3">
          {comments.length === 0 && <p className="text-sm text-text-muted">No activity yet.</p>}
          {comments.map(c => {
            const catt = attachments.filter(a => a.comment_id === c.id)
            return (
              <div key={c.id} className={c.system ? 'flex items-center gap-2 text-xs text-text-muted' : 'border border-border rounded-lg p-3 bg-bg/40'}>
                {c.system ? (
                  <><span className="w-1.5 h-1.5 rounded-full bg-text-muted/50 shrink-0" /><span className="font-medium text-text-primary">{c.author_name}</span><span>{c.body}</span><span className="ml-auto">{fmtDate(c.created_at)}</span></>
                ) : (
                  <>
                    <div className="flex items-center justify-between mb-1">
                      <span className="text-xs font-semibold text-text-primary">{c.author_name}</span>
                      <span className="text-[11px] text-text-muted">{fmtDate(c.created_at)}</span>
                    </div>
                    <p className="text-sm text-text-primary whitespace-pre-wrap">{c.body}</p>
                    {catt.length > 0 && <ul className="mt-2 space-y-1">{catt.map(a => <AttachmentRow key={a.id} att={a} />)}</ul>}
                  </>
                )}
              </div>
            )
          })}
        </div>

        {/* Add comment */}
        <div className="mt-4 pt-4 border-t border-border space-y-2">
          <textarea value={comment} onChange={e => setComment(e.target.value)} rows={2} placeholder="Add a progress note…"
            className="w-full px-3 py-2 bg-bg border border-border rounded-lg text-sm text-text-primary focus:outline-none focus:ring-2 focus:ring-wcs-red" />
          <div className="flex items-center justify-between gap-2">
            <input type="file" multiple onChange={e => setCommentFiles(prev => [...prev, ...Array.from(e.target.files)])}
              className="block text-xs text-text-muted file:mr-2 file:py-1 file:px-2 file:rounded-md file:border-0 file:text-xs file:font-semibold file:bg-wcs-red/10 file:text-wcs-red" />
            <button onClick={postComment} disabled={posting || (!comment.trim() && commentFiles.length === 0)}
              className="px-4 py-1.5 text-sm font-semibold rounded-lg bg-wcs-red text-white hover:bg-wcs-red/90 disabled:opacity-40 shrink-0">
              {posting ? 'Posting…' : 'Post'}
            </button>
          </div>
          {commentFiles.length > 0 && (
            <ul className="space-y-1">
              {commentFiles.map((f, i) => (
                <li key={i} className="flex items-center justify-between text-xs bg-bg border border-border rounded-lg px-2.5 py-1.5">
                  <span className="truncate">{f.name} <span className="text-text-muted">({fmtBytes(f.size)})</span></span>
                  <button onClick={() => setCommentFiles(commentFiles.filter((_, idx) => idx !== i))} className="text-red-500 ml-2 shrink-0">✕</button>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </div>
  )
}

function AttachmentRow({ att }) {
  async function open() {
    try {
      // The signed URL from the detail payload may have expired; mint a fresh one.
      const res = await ticketing.attachmentUrl(att.id)
      window.open(res.url || att.url, '_blank', 'noopener')
    } catch {
      if (att.url) window.open(att.url, '_blank', 'noopener')
    }
  }
  return (
    <li>
      <button onClick={open} className="flex items-center gap-2 text-xs bg-bg border border-border rounded-lg px-2.5 py-1.5 w-full text-left hover:border-wcs-red">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" className="w-3.5 h-3.5 text-wcs-red shrink-0">
          <path strokeLinecap="round" strokeLinejoin="round" d="M18.375 12.739l-7.693 7.693a4.5 4.5 0 01-6.364-6.364l10.94-10.94A3 3 0 1119.5 7.372L8.552 18.32m.009-.01l-.01.01m5.699-9.941l-7.81 7.81a1.5 1.5 0 002.112 2.13" />
        </svg>
        <span className="truncate text-text-primary font-medium">{att.file_name}</span>
        <span className="text-text-muted ml-auto shrink-0">{fmtBytes(att.size_bytes)}</span>
      </button>
    </li>
  )
}
