import React, { useState, useEffect, useCallback, useRef } from 'react'
import MobileHeader from './MobileHeader'
import MobileLoading from './MobileLoading'
import { ticketing, googleChat } from '../../lib/api'
import { connectGoogleChat } from '../../lib/googleChatConnect'
import DynamicFields, { DynamicAnswers } from '../../components/admin/ticketing/DynamicFields'
import { STATUSES, STATUS_BY_KEY, fmtDate, fmtBytes, buildSubmission, summarizeErrors, findMissingRequired } from '../../components/admin/ticketing/shared'
import { MentionComposer, MentionText, parseMentions } from '../../components/admin/ticketing/mentions'

// Native ticketing tool for mobile (admin-only). Mirrors the desktop admin
// tool: inbox -> detail (status + activity) and a submit flow.
export default function MobileTicketing({ user }) {
  const [screen, setScreen] = useState('list') // list | detail | submit
  const [activeId, setActiveId] = useState(null)
  // Opening a ticket unmounts List, so its status filter is held here to
  // survive the round-trip back. Same reason as the desktop inbox.
  const [status, setStatus] = useState('open') // default to New

  if (screen === 'detail' && activeId) {
    return <Detail id={activeId} onBack={() => setScreen('list')} />
  }
  if (screen === 'submit') {
    return <Submit onCancel={() => setScreen('list')} onDone={(id) => { setActiveId(id); setScreen('detail') }} />
  }
  return <List status={status} onStatusChange={setStatus}
    onOpen={(id) => { setActiveId(id); setScreen('detail') }} onNew={() => setScreen('submit')} />
}

function StatusPill({ status }) {
  const s = STATUS_BY_KEY[status] || STATUS_BY_KEY.open
  return <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-semibold border ${s.chip}`}>
    <span className={`w-1.5 h-1.5 rounded-full ${s.dot}`} />{s.label}
  </span>
}

function List({ onOpen, onNew, status, onStatusChange }) {
  const [tickets, setTickets] = useState([])
  const [loading, setLoading] = useState(true)

  const load = useCallback(async () => {
    setLoading(true)
    try { const r = await ticketing.list({ status }); setTickets(r.tickets || []) }
    catch { /* silent */ } finally { setLoading(false) }
  }, [status])
  useEffect(() => { load() }, [load])

  return (
    <div className="pt-4 px-4 space-y-3">
      <MobileHeader title="Ticketing" subtitle="Submit & track" rightAction={
        <button onClick={onNew} className="px-4 py-2.5 text-sm font-bold rounded-lg bg-wcs-red text-white shadow-sm">+ New</button>
      } />

      <div className="flex gap-1.5 overflow-x-auto pb-1">
        {[{ key: '', label: 'All' }, ...STATUSES].map(s => (
          <button key={s.key || 'all'} onClick={() => onStatusChange(s.key)}
            className={`px-3 py-1 text-xs font-semibold rounded-lg border whitespace-nowrap ${status === s.key ? 'bg-wcs-red text-white border-wcs-red' : 'bg-surface text-text-muted border-border'}`}>
            {s.label}
          </button>
        ))}
      </div>

      {loading ? <MobileLoading /> : tickets.length === 0 ? (
        <p className="text-sm text-text-muted text-center py-10 bg-surface border border-border rounded-2xl">No tickets yet.</p>
      ) : (
        <div className="space-y-2">
          {tickets.map(t => {
            const s = STATUS_BY_KEY[t.status] || STATUS_BY_KEY.open
            return (
              <button key={t.id} onClick={() => onOpen(t.id)}
                className="w-full text-left bg-surface border border-border rounded-2xl p-3 flex items-center gap-3 active:scale-[0.99] transition-transform">
                <span className={`w-2 h-2 rounded-full shrink-0 ${s.dot}`} />
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-semibold text-text-primary truncate">{t.title}</p>
                  <p className="text-[11px] text-text-muted truncate mt-0.5">{t.type_name} · {t.submitter_name}</p>
                </div>
                <StatusPill status={t.status} />
              </button>
            )
          })}
        </div>
      )}
    </div>
  )
}

function Detail({ id, onBack }) {
  const [detail, setDetail] = useState(null)
  const [loading, setLoading] = useState(true)
  const [comment, setComment] = useState('')
  const [busy, setBusy] = useState(false)
  const [staff, setStaff] = useState([])
  const [chat, setChat] = useState(null)

  const load = useCallback(async () => {
    try { setDetail(await ticketing.get(id)) } catch { /* silent */ } finally { setLoading(false) }
  }, [id])
  useEffect(() => { load() }, [load])
  useEffect(() => {
    ticketing.staffDirectory().then(r => setStaff(r.staff || [])).catch(() => {})
    googleChat.status().then(setChat).catch(() => {})
  }, [])

  // Fire the connect request the moment someone tries to notify a coworker.
  async function ensureChatConnected() {
    if (!chat || (chat.connected && chat.has_chat)) return
    await connectGoogleChat()
    try { setChat(await googleChat.status()) } catch { /* ignore */ }
  }

  async function setStatus(s) { setBusy(true); try { await ticketing.update(id, { status: s }); await load() } finally { setBusy(false) } }
  async function setAssignee(assigned_to) {
    const me = detail?.current_user_id
    if (assigned_to && assigned_to !== me) await ensureChatConnected()
    setBusy(true); try { await ticketing.update(id, { assigned_to: assigned_to || null }); await load() } finally { setBusy(false) }
  }
  async function post() {
    if (!comment.trim()) return
    const me = String(detail?.current_user_id || '').toLowerCase()
    if (parseMentions(comment).some(p => p.id !== me)) await ensureChatConnected()
    setBusy(true)
    try { await ticketing.addComment(id, comment.trim()); setComment(''); await load() } finally { setBusy(false) }
  }

  if (loading) return <div className="pt-4 px-4"><MobileHeader title="Ticket" onBack={onBack} /><MobileLoading /></div>
  if (!detail) return null
  const { ticket, type, comments = [], attachments = [], can_handle = false, is_submitter = false, current_user_id } = detail
  const submitAtt = attachments.filter(a => !a.comment_id)
  const canComment = can_handle || is_submitter

  return (
    <div className="pt-4 px-4 space-y-3 pb-6">
      <MobileHeader title={ticket.type_name} onBack={onBack} />

      <div className="bg-surface border border-border rounded-2xl p-4">
        <div className="flex items-start justify-between gap-2">
          <h2 className="text-base font-bold text-text-primary">{ticket.title}</h2>
          <StatusPill status={ticket.status} />
        </div>
        <p className="text-[11px] text-text-muted mt-1">
          {ticket.submitter_name} · {fmtDate(ticket.created_at)}
          {ticket.assignee_name && <> · Assigned to <span className="font-semibold text-text-primary">{ticket.assignee_name}</span></>}
        </p>

        {can_handle ? (
          <>
            <div className="mt-3 pt-3 border-t border-border flex flex-wrap gap-1.5">
              {STATUSES.map(s => (
                <button key={s.key} disabled={busy || ticket.status === s.key} onClick={() => setStatus(s.key)}
                  className={`px-2.5 py-1 text-xs font-semibold rounded-lg border ${ticket.status === s.key ? 'bg-wcs-red text-white border-wcs-red' : 'bg-bg text-text-muted border-border disabled:opacity-40'}`}>
                  {s.label}
                </button>
              ))}
            </div>
            <div className="mt-2 flex items-center gap-2">
              <label className="text-[11px] font-semibold text-text-muted shrink-0">Assign to</label>
              <select value={ticket.assigned_to || ''} disabled={busy} onChange={e => setAssignee(e.target.value)}
                className="flex-1 px-2.5 py-1.5 text-sm bg-bg border border-border rounded-lg text-text-primary focus:outline-none focus:ring-2 focus:ring-wcs-red disabled:opacity-40">
                <option value="">Unassigned</option>
                {staff.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
              </select>
            </div>
            {ticket.status !== 'complete' && (
              <button disabled={busy} onClick={() => setStatus('complete')}
                className="mt-2 w-full py-2 text-sm font-bold rounded-lg bg-green-600 text-white disabled:opacity-40">✓ Mark Complete</button>
            )}
          </>
        ) : (
          <p className="mt-3 pt-3 border-t border-border text-xs text-text-muted">Only this type's handlers can change the status.</p>
        )}
      </div>

      <div className="bg-surface border border-border rounded-2xl p-4">
        <h3 className="text-sm font-bold text-text-primary mb-2">Details</h3>
        <DynamicAnswers schema={type?.schema || []} data={ticket.data || {}} />
        {submitAtt.length > 0 && (
          <ul className="mt-3 space-y-1.5">
            {submitAtt.map(a => <AttRow key={a.id} att={a} canShare={can_handle} />)}
          </ul>
        )}
      </div>

      <div className="bg-surface border border-border rounded-2xl p-4">
        <h3 className="text-sm font-bold text-text-primary mb-2">Activity</h3>
        <div className="space-y-2">
          {comments.length === 0 && <p className="text-sm text-text-muted">No activity yet.</p>}
          {comments.map(c => (
            <div key={c.id} className={c.system ? 'text-[11px] text-text-muted flex items-center gap-1.5' : 'border border-border rounded-lg p-2.5 bg-bg/40'}>
              {c.system ? (
                <><span className="w-1.5 h-1.5 rounded-full bg-text-muted/50" /><span className="font-medium text-text-primary">{c.author_name}</span> {c.body}</>
              ) : (
                <>
                  <div className="flex justify-between mb-0.5">
                    <span className="text-xs font-semibold text-text-primary">{c.author_name}</span>
                    <span className="text-[10px] text-text-muted">{fmtDate(c.created_at)}</span>
                  </div>
                  <p className="text-sm text-text-primary"><MentionText body={c.body} currentUserId={current_user_id} /></p>
                </>
              )}
            </div>
          ))}
        </div>
        {canComment && (
          <div className="mt-3 space-y-2">
            <MentionComposer
              value={comment}
              onChange={setComment}
              staff={staff}
              currentUserId={current_user_id}
              rows={2}
              placeholder="Add a note… use @ to mention someone"
              onEnter={post}
            />
            <button onClick={post} disabled={busy || !comment.trim()} className="w-full py-2 text-sm font-semibold rounded-lg bg-wcs-red text-white disabled:opacity-40">Post</button>
          </div>
        )}
      </div>
    </div>
  )
}

function AttRow({ att, canShare = false }) {
  // Same public-link control as the desktop detail view: mint once, paste
  // anywhere, revoke when done. See TicketDetail's AttachmentRow.
  const [shareUrl, setShareUrl] = useState(att.share_url || null)
  const [busy, setBusy] = useState(false)
  const [copied, setCopied] = useState(false)

  async function open() {
    try { const r = await ticketing.attachmentUrl(att.id); window.open(r.url || att.url, '_blank', 'noopener') }
    catch { if (att.url) window.open(att.url, '_blank', 'noopener') }
  }

  async function toggleShare() {
    setBusy(true)
    try {
      const res = shareUrl ? await ticketing.unshareAttachment(att.id) : await ticketing.shareAttachment(att.id)
      setShareUrl(res.share_url || null)
    } catch { /* leave the row as-is; the desktop view surfaces the reason */ }
    finally { setBusy(false) }
  }

  function copyLink() {
    navigator.clipboard.writeText(shareUrl).then(() => {
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    }).catch(() => {})
  }

  return (
    <li>
      <div className="flex items-center gap-2 text-xs bg-bg border border-border rounded-lg px-2.5 py-2">
        <button onClick={open} className="flex-1 min-w-0 text-left truncate text-text-primary font-medium">{att.file_name}</button>
        <span className="text-text-muted shrink-0">{fmtBytes(att.size_bytes)}</span>
        {canShare && (
          <button onClick={toggleShare} disabled={busy}
            className={`shrink-0 px-2 py-1 rounded-md border text-[11px] font-semibold disabled:opacity-50 ${
              shareUrl ? 'border-green-300 bg-green-100 text-green-700' : 'border-border text-text-muted'
            }`}>
            {busy ? '…' : shareUrl ? 'Shared' : 'Share'}
          </button>
        )}
      </div>
      {shareUrl && (
        <div className="mt-1 flex items-center gap-2">
          <code className="flex-1 min-w-0 truncate text-[11px] text-text-muted bg-bg/60 border border-border rounded px-2 py-1">{shareUrl}</code>
          <button onClick={copyLink}
            className={`shrink-0 px-2 py-1 rounded-md border text-[11px] font-semibold ${
              copied ? 'bg-green-100 text-green-700 border-green-300' : 'border-border text-text-muted'
            }`}>
            {copied ? 'Copied!' : 'Copy link'}
          </button>
        </div>
      )}
    </li>
  )
}

function Submit({ onCancel, onDone }) {
  const [types, setTypes] = useState([])
  const [loading, setLoading] = useState(true)
  const [type, setType] = useState(null)
  const [values, setValues] = useState({})
  const [errors, setErrors] = useState({})
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState('')
  // Same retry guard as the desktop form: reuse the row a failed attempt left
  // behind instead of creating another ticket. See TicketSubmit.jsx.
  const pendingId = useRef(null)
  const stored = useRef(new Set())

  useEffect(() => {
    ticketing.listTypes(true).then(r => setTypes(r.types || [])).catch(() => {}).finally(() => setLoading(false))
  }, [])

  async function submit() {
    // Catch blank required fields here so the message names them right away.
    const missing = findMissingRequired(type.schema || [], values)
    if (Object.keys(missing).length > 0) {
      setErrors(missing)
      setError(summarizeErrors(type.schema || [], missing))
      return
    }
    setSubmitting(true); setError(''); setErrors({})
    try {
      const { data, files } = buildSubmission(type.schema || [], values)
      const res = await ticketing.create({
        type_id: type.id,
        data,
        reuse_ticket_id: pendingId.current || undefined,
      })
      pendingId.current = res.ticket.id
      for (const f of files) {
        if (stored.current.has(f)) continue
        await ticketing.uploadAttachment(res.ticket.id, f)
        stored.current.add(f)
      }
      pendingId.current = null; stored.current = new Set()
      onDone(res.ticket.id)
    } catch (err) {
      if (err.errors) {
        setErrors(err.errors)
        setError(summarizeErrors(type.schema || [], err.errors) || err.message)
      } else if (pendingId.current) {
        setError(`${err.message || 'The file could not be attached'}. Your ticket is saved — fix the file and submit again; this won't create a duplicate.`)
      } else {
        setError(err.message || 'Could not submit')
      }
    } finally { setSubmitting(false) }
  }

  if (loading) return <div className="pt-4 px-4"><MobileHeader title="New Ticket" onBack={onCancel} /><MobileLoading /></div>

  if (!type) {
    return (
      <div className="pt-4 px-4 space-y-3">
        <MobileHeader title="New Ticket" subtitle="Choose a type" onBack={onCancel} />
        {types.length === 0 ? (
          <p className="text-sm text-text-muted text-center py-10 bg-surface border border-border rounded-2xl">No active ticket types.</p>
        ) : types.map(t => (
          <button key={t.id} onClick={() => { setType(t); setValues({}); setErrors({}); pendingId.current = null; stored.current = new Set() }}
            className="w-full flex flex-col justify-center text-left bg-surface border border-border rounded-2xl p-5 min-h-[92px] active:scale-[0.99] transition-transform">
            <p className="text-base font-bold text-text-primary">{t.name}</p>
            {t.description && <p className="text-sm text-text-muted mt-1">{t.description}</p>}
          </button>
        ))}
      </div>
    )
  }

  return (
    <div className="pt-4 px-4 space-y-3 pb-6">
      <MobileHeader title={type.name} onBack={() => setType(null)} />
      <div className="bg-surface border border-border rounded-2xl p-4 space-y-4">
        <DynamicFields schema={type.schema || []} values={values} errors={errors}
          onChange={(id, v) => setValues(prev => ({ ...prev, [id]: v }))} />

        {error && <p className="text-sm text-wcs-red">{error}</p>}
        <button onClick={submit} disabled={submitting} className="w-full py-2.5 text-sm font-semibold rounded-lg bg-wcs-red text-white disabled:opacity-40">
          {submitting ? 'Submitting…' : 'Submit Ticket'}
        </button>
      </div>
    </div>
  )
}
