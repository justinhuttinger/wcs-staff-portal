import React, { useState, useEffect, useCallback } from 'react'
import MobileHeader from './MobileHeader'
import MobileLoading from './MobileLoading'
import { ticketing } from '../../lib/api'
import DynamicFields, { DynamicAnswers } from '../../components/admin/ticketing/DynamicFields'
import { STATUSES, STATUS_BY_KEY, PRIORITIES, fmtDate, fmtBytes, buildSubmission } from '../../components/admin/ticketing/shared'

// Native ticketing tool for mobile (admin-only). Mirrors the desktop admin
// tool: inbox -> detail (status + activity) and a submit flow.
export default function MobileTicketing({ user }) {
  const [screen, setScreen] = useState('list') // list | detail | submit
  const [activeId, setActiveId] = useState(null)

  if (screen === 'detail' && activeId) {
    return <Detail id={activeId} onBack={() => setScreen('list')} />
  }
  if (screen === 'submit') {
    return <Submit onCancel={() => setScreen('list')} onDone={(id) => { setActiveId(id); setScreen('detail') }} />
  }
  return <List onOpen={(id) => { setActiveId(id); setScreen('detail') }} onNew={() => setScreen('submit')} />
}

function StatusPill({ status }) {
  const s = STATUS_BY_KEY[status] || STATUS_BY_KEY.open
  return <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-semibold border ${s.chip}`}>
    <span className={`w-1.5 h-1.5 rounded-full ${s.dot}`} />{s.label}
  </span>
}

function List({ onOpen, onNew }) {
  const [tickets, setTickets] = useState([])
  const [status, setStatus] = useState('open') // default to New
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
        <button onClick={onNew} className="px-3 py-1.5 text-xs font-semibold rounded-lg bg-wcs-red text-white">+ New</button>
      } />

      <div className="flex gap-1.5 overflow-x-auto pb-1">
        {[{ key: '', label: 'All' }, ...STATUSES].map(s => (
          <button key={s.key || 'all'} onClick={() => setStatus(s.key)}
            className={`px-3 py-1 text-xs font-semibold rounded-lg border whitespace-nowrap ${status === s.key ? 'bg-wcs-red text-white border-wcs-red' : 'bg-surface text-text-muted border-border'}`}>
            {s.label}
          </button>
        ))}
      </div>

      {loading ? <MobileLoading /> : tickets.length === 0 ? (
        <p className="text-sm text-text-muted text-center py-10">No tickets yet.</p>
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

  const load = useCallback(async () => {
    try { setDetail(await ticketing.get(id)) } catch { /* silent */ } finally { setLoading(false) }
  }, [id])
  useEffect(() => { load() }, [load])

  async function setStatus(s) { setBusy(true); try { await ticketing.update(id, { status: s }); await load() } finally { setBusy(false) } }
  async function post() {
    if (!comment.trim()) return
    setBusy(true)
    try { await ticketing.addComment(id, comment.trim()); setComment(''); await load() } finally { setBusy(false) }
  }

  if (loading) return <div className="pt-4 px-4"><MobileHeader title="Ticket" onBack={onBack} /><MobileLoading /></div>
  if (!detail) return null
  const { ticket, type, comments = [], attachments = [], can_handle = false, is_submitter = false } = detail
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
        <p className="text-[11px] text-text-muted mt-1">{ticket.submitter_name} · {fmtDate(ticket.created_at)}</p>

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
            {submitAtt.map(a => <AttRow key={a.id} att={a} />)}
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
                  <p className="text-sm text-text-primary whitespace-pre-wrap">{c.body}</p>
                </>
              )}
            </div>
          ))}
        </div>
        {canComment && (
          <div className="mt-3 flex gap-2">
            <input value={comment} onChange={e => setComment(e.target.value)} placeholder="Add a note…"
              className="flex-1 px-3 py-2 bg-bg border border-border rounded-lg text-sm text-text-primary focus:outline-none focus:ring-2 focus:ring-wcs-red" />
            <button onClick={post} disabled={busy || !comment.trim()} className="px-3 py-2 text-sm font-semibold rounded-lg bg-wcs-red text-white disabled:opacity-40">Post</button>
          </div>
        )}
      </div>
    </div>
  )
}

function AttRow({ att }) {
  async function open() {
    try { const r = await ticketing.attachmentUrl(att.id); window.open(r.url || att.url, '_blank', 'noopener') }
    catch { if (att.url) window.open(att.url, '_blank', 'noopener') }
  }
  return (
    <li>
      <button onClick={open} className="flex items-center gap-2 text-xs bg-bg border border-border rounded-lg px-2.5 py-2 w-full text-left">
        <span className="truncate text-text-primary font-medium">{att.file_name}</span>
        <span className="text-text-muted ml-auto shrink-0">{fmtBytes(att.size_bytes)}</span>
      </button>
    </li>
  )
}

function Submit({ onCancel, onDone }) {
  const [types, setTypes] = useState([])
  const [loading, setLoading] = useState(true)
  const [type, setType] = useState(null)
  const [values, setValues] = useState({})
  const [priority, setPriority] = useState('normal')
  const [errors, setErrors] = useState({})
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    ticketing.listTypes(true).then(r => setTypes(r.types || [])).catch(() => {}).finally(() => setLoading(false))
  }, [])

  async function submit() {
    setSubmitting(true); setError(''); setErrors({})
    try {
      const { data, files } = buildSubmission(type.schema || [], values)
      const res = await ticketing.create({ type_id: type.id, data, priority })
      for (const f of files) await ticketing.uploadAttachment(res.ticket.id, f)
      onDone(res.ticket.id)
    } catch (err) {
      if (err.errors) setErrors(err.errors)
      setError(err.message || 'Could not submit')
    } finally { setSubmitting(false) }
  }

  if (loading) return <div className="pt-4 px-4"><MobileHeader title="New Ticket" onBack={onCancel} /><MobileLoading /></div>

  if (!type) {
    return (
      <div className="pt-4 px-4 space-y-3">
        <MobileHeader title="New Ticket" subtitle="Choose a type" onBack={onCancel} />
        {types.length === 0 ? (
          <p className="text-sm text-text-muted text-center py-10">No active ticket types.</p>
        ) : types.map(t => (
          <button key={t.id} onClick={() => { setType(t); setValues({}); setErrors({}) }}
            className="w-full text-left bg-surface border border-border rounded-2xl p-4 active:scale-[0.99] transition-transform">
            <p className="text-sm font-bold text-text-primary">{t.name}</p>
            {t.description && <p className="text-xs text-text-muted mt-1">{t.description}</p>}
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

        <div>
          <label className="block text-sm font-semibold text-text-primary mb-1">Priority</label>
          <div className="flex flex-wrap gap-1.5">
            {PRIORITIES.map(p => (
              <button key={p.key} onClick={() => setPriority(p.key)}
                className={`px-3 py-1 text-xs font-semibold rounded-lg border ${priority === p.key ? 'bg-wcs-red text-white border-wcs-red' : 'bg-bg text-text-muted border-border'}`}>{p.label}</button>
            ))}
          </div>
        </div>

        {error && <p className="text-sm text-wcs-red">{error}</p>}
        <button onClick={submit} disabled={submitting} className="w-full py-2.5 text-sm font-semibold rounded-lg bg-wcs-red text-white disabled:opacity-40">
          {submitting ? 'Submitting…' : 'Submit Ticket'}
        </button>
      </div>
    </div>
  )
}
