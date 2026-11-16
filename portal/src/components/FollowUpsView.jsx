import { useState, useEffect, useCallback, useMemo } from 'react'
import { followUps } from '../lib/api'
import { Modal, Field, TextInput, TextArea, Button, ErrorBanner, EmptyState, Spinner } from './adsmanager/ui'

// Owner-only tracker for things he is waiting on from people. A new follow-up
// emails the person from his Gmail (Claude drafts it in his voice, he edits it
// first). Nudge drafts a fresh, differently-worded reminder that goes as a
// reply in the same thread. When they reply, the card moves to "Replied" for
// him to review. Nothing sends on its own.

const CARD = 'bg-surface/95 backdrop-blur-sm rounded-xl border border-border'

const todayIso = () => new Date().toLocaleDateString('en-CA')

function daysFrom(iso) {
  if (!iso) return null
  const d = new Date(iso.length === 10 ? iso + 'T12:00:00' : iso)
  return Math.round((d.getTime() - Date.now()) / 86400000)
}

function ago(iso) {
  if (!iso) return ''
  const days = -daysFrom(iso)
  if (days <= 0) return 'today'
  if (days === 1) return 'yesterday'
  return `${days} days ago`
}

function dueLabel(due) {
  if (!due) return null
  const d = daysFrom(due)
  if (d < 0) return { text: `${-d} day${d === -1 ? '' : 's'} overdue`, tone: 'text-red-600 bg-red-500/10 border-red-500/30' }
  if (d === 0) return { text: 'Due today', tone: 'text-amber-700 bg-amber-500/10 border-amber-500/30' }
  return {
    text: `Due ${new Date(due + 'T12:00:00').toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}`,
    tone: 'text-text-muted bg-bg border-border',
  }
}

function gmailLink(threadId) {
  return `https://mail.google.com/mail/u/0/#all/${threadId}`
}

function ConnectCard({ status, onConnected }) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  useEffect(() => {
    const onMsg = (e) => { if (e.data?.type === 'follow-ups-auth') onConnected() }
    window.addEventListener('message', onMsg)
    return () => window.removeEventListener('message', onMsg)
  }, [onConnected])
  const connect = async () => {
    setBusy(true); setError('')
    try {
      const { url } = await followUps.authUrl()
      window.open(url, 'follow-ups-auth', 'width=520,height=680')
    } catch (e) { setError(e.message) } finally { setBusy(false) }
  }
  return (
    <div className={`${CARD} p-6 space-y-3`}>
      <h3 className="text-base font-bold text-text-primary">Connect your Gmail</h3>
      <p className="text-sm text-text-muted">
        Follow-ups sends from your own Gmail and checks those threads for replies.
        {status?.connected && !status?.ready && ' Your Google account is connected, but without Gmail access yet.'}
      </p>
      <ErrorBanner error={error} />
      <Button onClick={connect} disabled={busy}>{busy ? 'Opening…' : 'Connect Gmail'}</Button>
    </div>
  )
}

// Draft → edit → send, shared by New and Nudge.
function Composer({ draft, setDraft, drafting, onRewrite, showSubject }) {
  const [instructions, setInstructions] = useState('')
  if (drafting && !draft) return <Spinner label="Writing in your voice…" />
  if (!draft) return null
  return (
    <div className="space-y-4">
      {showSubject && (
        <Field label="Subject">
          <TextInput value={draft.subject} onChange={e => setDraft({ ...draft, subject: e.target.value })} />
        </Field>
      )}
      <Field label="Message" hint="Edit anything. This is exactly what gets sent.">
        <TextArea rows={9} value={draft.body} onChange={e => setDraft({ ...draft, body: e.target.value })} />
      </Field>
      <div className="flex items-end gap-2">
        <div className="flex-1">
          <Field label="Rewrite with a note (optional)">
            <TextInput value={instructions} placeholder="e.g. shorter, mention the budget meeting"
              onChange={e => setInstructions(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); onRewrite(instructions) } }} />
          </Field>
        </div>
        <Button variant="secondary" disabled={drafting} onClick={() => onRewrite(instructions)}>
          {drafting ? 'Writing…' : 'Rewrite'}
        </Button>
      </div>
    </div>
  )
}

function NewFollowUpModal({ onClose, onCreated }) {
  const [form, setForm] = useState({ recipient_name: '', recipient_email: '', title: '', details: '', due_date: '' })
  const [draft, setDraft] = useState(null)
  const [drafting, setDrafting] = useState(false)
  const [sending, setSending] = useState(false)
  const [error, setError] = useState('')
  const set = (k) => (e) => setForm({ ...form, [k]: e.target.value })
  const ready = form.recipient_name.trim() && /\S+@\S+\.\S+/.test(form.recipient_email) && form.title.trim()

  const write = async (instructions = '') => {
    setDrafting(true); setError('')
    try { setDraft(await followUps.draft({ kind: 'initial', ...form, instructions })) }
    catch (e) { setError(e.message) } finally { setDrafting(false) }
  }
  const send = async () => {
    setSending(true); setError('')
    try {
      const { project } = await followUps.create({ ...form, subject: draft.subject, body: draft.body })
      onCreated(project)
    } catch (e) { setError(e.message); setSending(false) }
  }

  return (
    <Modal title="New follow-up" subtitle="Sends from your Gmail after you review it" onClose={onClose}
      footer={draft ? (
        <>
          <Button variant="ghost" onClick={() => setDraft(null)} disabled={sending}>Back</Button>
          <Button onClick={send} disabled={sending || drafting || !draft.subject.trim() || !draft.body.trim()}>
            {sending ? 'Sending…' : `Send to ${form.recipient_name.split(' ')[0]}`}
          </Button>
        </>
      ) : (
        <>
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button onClick={() => write()} disabled={!ready || drafting}>{drafting ? 'Writing…' : 'Write email'}</Button>
        </>
      )}>
      <ErrorBanner error={error} onDismiss={() => setError('')} />
      {!draft && !drafting ? (
        <div className="space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <Field label="Name" required><TextInput value={form.recipient_name} onChange={set('recipient_name')} autoFocus /></Field>
            <Field label="Email" required><TextInput type="email" value={form.recipient_email} onChange={set('recipient_email')} /></Field>
          </div>
          <Field label="What do you need from them?" required>
            <TextInput value={form.title} onChange={set('title')} placeholder="e.g. Updated Q1 staffing plan for Keizer" />
          </Field>
          <Field label="Details" hint="Anything Claude should mention. Optional.">
            <TextArea rows={3} value={form.details} onChange={set('details')} />
          </Field>
          <Field label="Due date">
            <TextInput type="date" min={todayIso()} value={form.due_date} onChange={set('due_date')} className="sm:max-w-[200px]" />
          </Field>
        </div>
      ) : (
        <Composer draft={draft} setDraft={setDraft} drafting={drafting} onRewrite={write} showSubject />
      )}
    </Modal>
  )
}

function NudgeModal({ project, onClose, onSent }) {
  const [draft, setDraft] = useState(null)
  const [drafting, setDrafting] = useState(false)
  const [sending, setSending] = useState(false)
  const [error, setError] = useState('')
  const [history, setHistory] = useState(null)

  const write = useCallback(async (instructions = '') => {
    setDrafting(true); setError('')
    try { setDraft(await followUps.draft({ kind: 'nudge', projectId: project.id, instructions })) }
    catch (e) { setError(e.message) } finally { setDrafting(false) }
  }, [project.id])

  useEffect(() => {
    write()
    followUps.messages(project.id).then(r => setHistory(r.messages)).catch(() => setHistory([]))
  }, [project.id, write])

  const send = async () => {
    setSending(true); setError('')
    try {
      const { project: row } = await followUps.nudge(project.id, draft.body)
      onSent(row)
    } catch (e) { setError(e.message); setSending(false) }
  }

  return (
    <Modal title={`Nudge ${project.recipient_name.split(' ')[0]}`} subtitle={`Re: ${project.subject}`} onClose={onClose}
      footer={(
        <>
          <Button variant="ghost" onClick={onClose} disabled={sending}>Cancel</Button>
          <Button onClick={send} disabled={!draft || sending || drafting || !draft.body.trim()}>
            {sending ? 'Sending…' : 'Send nudge'}
          </Button>
        </>
      )}>
      <ErrorBanner error={error} onDismiss={() => setError('')} />
      <Composer draft={draft} setDraft={setDraft} drafting={drafting} onRewrite={write} />
      {history?.length > 0 && (
        <details className="text-xs">
          <summary className="cursor-pointer text-text-muted hover:text-text-primary">
            Sent so far ({history.length})
          </summary>
          <div className="mt-2 space-y-2">
            {history.map((m, i) => (
              <div key={i} className="rounded-lg border border-border bg-bg p-3">
                <p className="text-[11px] font-semibold text-text-muted mb-1">
                  {m.kind === 'initial' ? 'First email' : 'Nudge'} · {new Date(m.sent_at).toLocaleDateString()}
                </p>
                <p className="whitespace-pre-wrap text-text-primary">{m.body}</p>
              </div>
            ))}
          </div>
        </details>
      )}
    </Modal>
  )
}

function ProjectCard({ p, onNudge, onStatus }) {
  const due = dueLabel(p.due_date)
  const closed = p.status === 'done' || p.status === 'cancelled'
  return (
    <div className={`${CARD} p-4 space-y-2`}>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-sm font-bold text-text-primary truncate">{p.title}</p>
          <p className="text-xs text-text-muted truncate">{p.recipient_name} · {p.recipient_email}</p>
        </div>
        {due && !closed && <span className={`shrink-0 px-2 py-0.5 rounded-full text-[10px] font-bold border ${due.tone}`}>{due.text}</span>}
      </div>

      {p.status === 'replied' && p.last_reply_snippet && (
        <div className="rounded-lg border border-green-500/30 bg-green-500/10 px-3 py-2">
          <p className="text-[11px] font-semibold text-green-700 mb-0.5">Replied {ago(p.last_reply_at)}</p>
          <p className="text-xs text-text-primary line-clamp-3">{p.last_reply_snippet}</p>
        </div>
      )}

      <p className="text-[11px] text-text-muted">
        {closed
          ? `${p.status === 'done' ? 'Done' : 'Dropped'} ${ago(p.completed_at || p.updated_at)}`
          : `Last email ${ago(p.last_sent_at)}${p.nudge_count ? ` · ${p.nudge_count} nudge${p.nudge_count === 1 ? '' : 's'}` : ''}`}
      </p>

      <div className="flex items-center gap-2 flex-wrap pt-1">
        {p.status === 'active' && <Button className="!px-3 !py-1.5 !text-xs" onClick={() => onNudge(p)}>Nudge</Button>}
        {p.status === 'replied' && (
          <>
            <Button className="!px-3 !py-1.5 !text-xs" onClick={() => onStatus(p, 'done')}>Mark done</Button>
            <Button variant="secondary" className="!px-3 !py-1.5 !text-xs" onClick={() => onStatus(p, 'active')}>Still waiting</Button>
          </>
        )}
        {p.status === 'active' && (
          <Button variant="secondary" className="!px-3 !py-1.5 !text-xs" onClick={() => onStatus(p, 'done')}>Mark done</Button>
        )}
        {closed && <Button variant="secondary" className="!px-3 !py-1.5 !text-xs" onClick={() => onStatus(p, 'active')}>Reopen</Button>}
        {p.gmail_thread_id && (
          <a href={gmailLink(p.gmail_thread_id)} target="_blank" rel="noreferrer"
            className="text-xs text-text-muted hover:text-text-primary px-2">Open in Gmail</a>
        )}
        {p.status === 'active' && (
          <button onClick={() => onStatus(p, 'cancelled')} className="text-xs text-text-muted hover:text-red-600 ml-auto">Drop</button>
        )}
      </div>
    </div>
  )
}

function Section({ title, items, emptyHint, ...cardProps }) {
  return (
    <div className="space-y-3">
      <h3 className="inline-block bg-surface/95 backdrop-blur-sm border border-border rounded-full px-3 py-1 text-xs font-semibold text-text-primary uppercase tracking-widest shadow-sm">
        {title} <span className="text-text-muted">({items.length})</span>
      </h3>
      {items.length === 0
        ? emptyHint && <div className={`${CARD} p-4 text-xs text-text-muted`}>{emptyHint}</div>
        : <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">{items.map(p => <ProjectCard key={p.id} p={p} {...cardProps} />)}</div>}
    </div>
  )
}

export default function FollowUpsView({ onBack }) {
  const [status, setStatus] = useState(null)
  const [projects, setProjects] = useState(null)
  const [error, setError] = useState('')
  const [checking, setChecking] = useState(false)
  const [showNew, setShowNew] = useState(false)
  const [nudging, setNudging] = useState(null)
  const [showClosed, setShowClosed] = useState(false)

  const upsert = (row) => setProjects(list => [row, ...(list || []).filter(p => p.id !== row.id)])

  const checkReplies = useCallback(async () => {
    setChecking(true)
    try {
      const { updated } = await followUps.checkReplies()
      if (updated?.length) setProjects(list => (list || []).map(p => updated.find(u => u.id === p.id) || p))
    } catch (e) { setError(e.message) } finally { setChecking(false) }
  }, [])

  const load = useCallback(async () => {
    setError('')
    try {
      const s = await followUps.status()
      setStatus(s)
      if (!s.ready) return
      const { projects: rows } = await followUps.list()
      setProjects(rows)
      checkReplies()
    } catch (e) { setError(e.message) }
  }, [checkReplies])

  useEffect(() => { load() }, [load])

  const changeStatus = async (p, next) => {
    try { upsert((await followUps.update(p.id, { status: next })).project) }
    catch (e) { setError(e.message) }
  }

  const groups = useMemo(() => {
    const list = projects || []
    const byDue = (a, b) => (a.due_date || '9999').localeCompare(b.due_date || '9999')
    return {
      replied: list.filter(p => p.status === 'replied').sort((a, b) => String(b.last_reply_at).localeCompare(String(a.last_reply_at))),
      waiting: list.filter(p => p.status === 'active').sort(byDue),
      closed: list.filter(p => p.status === 'done' || p.status === 'cancelled'),
    }
  }, [projects])

  const cardProps = { onNudge: setNudging, onStatus: changeStatus }

  return (
    <div className="max-w-6xl mx-auto px-4 py-6 space-y-5">
      <div className={`${CARD} px-5 py-4 flex items-center justify-between gap-3 flex-wrap`}>
        <div className="flex items-center gap-3">
          <button onClick={onBack} className="text-text-muted hover:text-text-primary text-sm">← Back</button>
          <div>
            <h2 className="text-lg font-bold text-text-primary">Follow-ups</h2>
            <p className="text-xs text-text-muted">What you're waiting on from people{status?.email ? ` · sends as ${status.email}` : ''}</p>
          </div>
        </div>
        {status?.ready && (
          <div className="flex items-center gap-2">
            <Button variant="secondary" onClick={checkReplies} disabled={checking}>{checking ? 'Checking…' : 'Check replies'}</Button>
            <Button onClick={() => setShowNew(true)}>New follow-up</Button>
          </div>
        )}
      </div>

      <ErrorBanner error={error} onDismiss={() => setError('')} />

      {!status && !error && <div className={CARD}><Spinner /></div>}
      {status && !status.ready && <ConnectCard status={status} onConnected={load} />}
      {status?.ready && !status.aiReady && (
        <div className={`${CARD} p-4 text-sm text-amber-700`}>Claude isn't configured on the API (ANTHROPIC_API_KEY), so drafts will fail.</div>
      )}

      {status?.ready && projects && (
        projects.length === 0 ? (
          <div className={CARD}>
            <EmptyState title="Nothing outstanding" hint="Add something you need from someone and it'll email them from your Gmail."
              action={<Button onClick={() => setShowNew(true)}>New follow-up</Button>} />
          </div>
        ) : (
          <>
            {groups.replied.length > 0 && <Section title="Replied, review" items={groups.replied} {...cardProps} />}
            <Section title="Waiting on" items={groups.waiting} emptyHint="Nobody owes you anything right now." {...cardProps} />
            {groups.closed.length > 0 && (
              <div>
                <button onClick={() => setShowClosed(v => !v)}
                  className="bg-surface/95 backdrop-blur-sm border border-border rounded-full px-3 py-1 text-xs font-semibold text-text-muted hover:text-text-primary shadow-sm">
                  {showClosed ? 'Hide' : 'Show'} closed ({groups.closed.length})
                </button>
                {showClosed && <div className="mt-3"><Section title="Closed" items={groups.closed} {...cardProps} /></div>}
              </div>
            )}
          </>
        )
      )}
      {status?.ready && !projects && !error && <div className={CARD}><Spinner /></div>}

      {showNew && (
        <NewFollowUpModal onClose={() => setShowNew(false)}
          onCreated={(row) => { upsert(row); setShowNew(false) }} />
      )}
      {nudging && (
        <NudgeModal project={nudging} onClose={() => setNudging(null)}
          onSent={(row) => { upsert(row); setNudging(null) }} />
      )}
    </div>
  )
}
