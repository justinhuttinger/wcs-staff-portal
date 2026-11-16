import { useState, useEffect, useCallback } from 'react'
import { hub } from '../../lib/api'
import { CLUBS } from '../../config/locations'
import { Modal, Field, TextInput, TextArea, Button, ErrorBanner } from '../adsmanager/ui'
import Composer from './Composer'
import DeliverablesGrid from './DeliverablesGrid'
import IncomingTray from './IncomingTray'
import EmailFiles from './EmailFiles'
import PeoplePicker from './PeoplePicker'
import { ago, dueLabel } from './dates'
import { isGmailDisconnected } from './gmailState'

const STATE_PILL = {
  new: { text: 'Not emailed', tone: 'text-text-muted bg-bg border-border' },
  waiting: { text: 'Waiting', tone: 'text-amber-700 bg-amber-500/10 border-amber-500/30' },
  replied: { text: 'Replied', tone: 'text-green-700 bg-green-500/10 border-green-500/30' },
  delivered: { text: 'Delivered', tone: 'text-green-700 bg-green-500/10 border-green-500/30' },
}
const CLUB_NAME = slug => CLUBS.find(c => c.slug === slug)?.name || slug
const SMALL = '!px-3 !py-1.5 !text-xs'

// kind: initial | nudge | ask. Ask first collects what to say, then drafts.
function ComposeModal({ person, kind, onClose, onSent, onGmailLost }) {
  const [note, setNote] = useState('')
  const [draft, setDraft] = useState(null)
  const [drafting, setDrafting] = useState(false)
  const [sending, setSending] = useState(false)
  const [error, setError] = useState('')
  const newThread = !person.gmail_thread_id

  const write = useCallback(async (instructions = '') => {
    setDrafting(true); setError('')
    try {
      const text = kind === 'ask' ? [note, instructions].filter(Boolean).join('. ') : instructions
      setDraft(await hub.people.draft(person.id, { kind, instructions: text }))
    } catch (e) { setError(e.message); if (isGmailDisconnected(e)) onGmailLost?.() } finally { setDrafting(false) }
  }, [kind, note, person.id])

  useEffect(() => { if (kind !== 'ask') write() }, []) // eslint-disable-line react-hooks/exhaustive-deps

  const send = async () => {
    setSending(true); setError('')
    try { onSent(await hub.people.send(person.id, { kind, subject: draft.subject, body: draft.body })) }
    catch (e) { setError(e.message); setSending(false); if (isGmailDisconnected(e)) onGmailLost?.() }
  }

  const first = person.name.split(' ')[0]
  const title = kind === 'nudge' ? `Nudge ${first}` : kind === 'ask' ? `Ask ${first}` : `Email ${first}`
  return (
    <Modal title={title} subtitle={newThread ? 'Sends from your Gmail after you review it' : `Re: ${person.subject}`} onClose={onClose}
      footer={(
        <>
          <Button variant="ghost" onClick={onClose} disabled={sending}>Cancel</Button>
          {kind === 'ask' && !draft
            ? <Button onClick={() => write()} disabled={!note.trim() || drafting}>{drafting ? 'Writing…' : 'Write it'}</Button>
            : <Button onClick={send} disabled={!draft || sending || drafting || !draft.body.trim() || (newThread && !draft.subject?.trim())}>
                {sending ? 'Sending…' : 'Send'}
              </Button>}
        </>
      )}>
      <ErrorBanner error={error} onDismiss={() => setError('')} />
      {kind === 'ask' && !draft && (
        <Field label={`What do you want to say to ${first}?`} hint="Rough is fine. Claude writes it in your voice.">
          <TextArea rows={3} value={note} autoFocus onChange={e => setNote(e.target.value)} />
        </Field>
      )}
      <Composer draft={draft} setDraft={setDraft} drafting={drafting} onRewrite={write} showSubject={newThread} />
    </Modal>
  )
}

function History({ person }) {
  const [messages, setMessages] = useState(null)
  useEffect(() => { hub.people.messages(person.id).then(r => setMessages(r.messages)).catch(() => setMessages([])) }, [person.id])
  if (!messages) return <p className="text-xs text-text-muted">Loading…</p>
  if (!messages.length) return <p className="text-xs text-text-muted">Nothing sent yet.</p>
  return (
    <div className="space-y-2">
      {messages.map((m, i) => (
        <div key={i} className="rounded-lg border border-border bg-bg p-3">
          <p className="text-[11px] font-semibold text-text-muted mb-1">
            {m.kind === 'initial' ? 'First email' : m.kind === 'nudge' ? 'Nudge' : 'Note'} · {new Date(m.sent_at).toLocaleString()}
          </p>
          <p className="text-xs whitespace-pre-wrap text-text-primary">{m.body}</p>
        </div>
      ))}
    </div>
  )
}

function CopyLink({ personId }) {
  const [state, setState] = useState('')
  const copy = async () => {
    try {
      const { url } = await hub.deliverables.uploadLink(personId)
      await navigator.clipboard.writeText(url)
      setState('Copied!'); setTimeout(() => setState(''), 1500)
    } catch { setState('Copy failed') }
  }
  return (
    <button onClick={copy} className={`text-xs px-1 transition-colors ${state === 'Copied!' ? 'text-green-600 font-semibold' : 'text-text-muted hover:text-text-primary'}`}>
      {state || 'Copy upload link'}
    </button>
  )
}

// The clubs this person covers on the task (their slots follow these).
function PersonClubs({ p, task, closed, onChanged }) {
  const options = task.clubs.length ? task.clubs : []
  if (!options.length) return null
  // Show the change at once; save in the background and undo it if the save fails.
  const toggle = async slug => {
    const before = p.clubs || []
    const next = before.includes(slug) ? before.filter(c => c !== slug) : [...before, slug]
    onChanged({ ...p, clubs: next }, { optimistic: true })
    try { onChanged((await hub.people.update(p.id, { clubs: next })).person) }
    catch { onChanged({ ...p, clubs: before }, { optimistic: true }) }
  }
  return (
    <div className="flex flex-wrap gap-1">
      {options.map(slug => {
        const on = (p.clubs || []).includes(slug)
        return (
          <button key={slug} type="button" disabled={closed} onClick={() => toggle(slug)}
            className={`px-2 py-0.5 rounded-full text-[10px] font-semibold border ${on ? 'bg-wcs-red text-white border-wcs-red' : 'bg-bg text-text-muted border-border hover:text-text-primary'}`}>
            {CLUB_NAME(slug)}
          </button>
        )
      })}
    </div>
  )
}

function PersonCard({ p, task, closed, gmailReady, onCompose, onRemove, onChanged }) {
  const [showHistory, setShowHistory] = useState(false)
  const pill = STATE_PILL[p.state] || STATE_PILL.new
  return (
    <div className="rounded-xl border border-border bg-bg/60 p-3 space-y-2">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-sm font-semibold text-text-primary truncate">{p.name}</p>
          <p className="text-[11px] text-text-muted truncate">{p.email}</p>
          <div className="mt-1"><PersonClubs p={p} task={task} closed={closed} onChanged={onChanged} /></div>
        </div>
        <span className={`shrink-0 px-2 py-0.5 rounded-full text-[10px] font-bold border ${pill.tone}`}>{pill.text}</span>
      </div>
      {p.last_reply_snippet && (p.state === 'replied' || p.last_reply_at) && (
        <div className="rounded-lg border border-green-500/30 bg-green-500/10 px-3 py-2">
          <p className="text-[11px] font-semibold text-green-700 mb-0.5">Replied {ago(p.last_reply_at)}</p>
          <p className="text-xs text-text-primary line-clamp-3">{p.last_reply_snippet}</p>
        </div>
      )}
      {p.last_sent_at && <p className="text-[11px] text-text-muted">Last email {ago(p.last_sent_at)}</p>}
      <div className="flex items-center gap-2 flex-wrap">
        {!closed && gmailReady && !p.gmail_thread_id && <Button className={SMALL} onClick={() => onCompose(p, 'initial')}>Email</Button>}
        {!closed && gmailReady && p.gmail_thread_id && <Button className={SMALL} onClick={() => onCompose(p, 'nudge')}>Nudge</Button>}
        {!closed && gmailReady && <Button variant="secondary" className={SMALL} onClick={() => onCompose(p, 'ask')}>Ask</Button>}
        {p.gmail_thread_id && (
          <>
            <button onClick={() => setShowHistory(v => !v)} className="text-xs text-text-muted hover:text-text-primary px-1">
              {showHistory ? 'Hide history' : 'History'}
            </button>
            <a href={`https://mail.google.com/mail/u/0/#all/${p.gmail_thread_id}`} target="_blank" rel="noreferrer"
              className="text-xs text-text-muted hover:text-text-primary px-1">Open in Gmail</a>
          </>
        )}
        {!closed && <CopyLink personId={p.id} />}
        {!p.gmail_thread_id && (
          <button onClick={() => onRemove(p)} className="text-xs text-text-muted hover:text-red-600 ml-auto">Remove</button>
        )}
      </div>
      {showHistory && <History person={p} />}
    </div>
  )
}

export default function TaskDetail({ task, gmailReady, onGmailLost, onClose, onEdit, onRefresh }) {
  const [people, setPeople] = useState(task.people || [])
  const [compose, setCompose] = useState(null)
  const [gridKey, setGridKey] = useState(0)
  const [error, setError] = useState('')
  const closed = task.status === 'done' || task.status === 'dropped'
  const due = closed ? null : dueLabel(task.due_date)

  // Seeing the task shows every reply on it, so they stop counting as new.
  useEffect(() => {
    const unseen = (task.people || []).filter(p => p.state === 'replied' && !p.reply_seen)
    if (!unseen.length) return
    Promise.all(unseen.map(p => hub.people.seen(p.id))).then(() => onRefresh()).catch(() => {})
  }, [task.id]) // eslint-disable-line react-hooks/exhaustive-deps

  const added = person => { setPeople([...people, person]); setGridKey(k => k + 1); onRefresh() }
  // Optimistic updates only redraw the card; the saved result redraws the grid
  // (owners may have moved). The task list doesn't change with clubs.
  const personChanged = (person, { optimistic = false } = {}) => {
    setPeople(ps => ps.map(p => p.id === person.id ? { ...p, ...person } : p))
    if (!optimistic) setGridKey(k => k + 1)
  }
  const remove = async p => {
    setError('')
    try { await hub.people.remove(p.id); setPeople(people.filter(x => x.id !== p.id)); setGridKey(k => k + 1); onRefresh() }
    catch (e) { setError(e.message) }
  }
  // A warning means Gmail sent it but saving failed: close the composer anyway
  // so it is not sent twice, and say so.
  const sent = ({ person, warning }) => {
    setPeople(people.map(p => p.id === person.id ? { ...p, ...person } : p)); setCompose(null); onRefresh()
    if (warning) setError(warning)
  }

  return (
    <Modal wide title={task.title} onClose={onClose}
      subtitle={[`Added ${new Date(task.created_at).toLocaleDateString()}`, task.clubs.map(CLUB_NAME).join(', ')].filter(Boolean).join(' · ')}
      footer={<><Button variant="secondary" onClick={() => onEdit(task)}>Edit task</Button><Button variant="ghost" onClick={onClose}>Close</Button></>}>
      <ErrorBanner error={error} onDismiss={() => setError('')} />
      <div className="flex items-center gap-2 flex-wrap text-xs">
        <span className="px-2 py-0.5 rounded-full border border-border bg-bg font-semibold capitalize text-text-primary">{task.priority} priority</span>
        {due && <span className={`px-2 py-0.5 rounded-full border font-bold ${due.tone}`}>{due.text}</span>}
        {closed && <span className="px-2 py-0.5 rounded-full border border-border bg-bg font-semibold text-text-muted capitalize">{task.status}</span>}
      </div>
      {task.description && <p className="text-sm whitespace-pre-wrap text-text-primary">{task.description}</p>}

      <div className="space-y-3">
        <h4 className="text-xs font-bold uppercase tracking-widest text-text-muted">People</h4>
        {!gmailReady && <p className="text-xs text-amber-700">Connect Gmail (top of the Hub) to email people from here.</p>}
        {people.length === 0 && <p className="text-xs text-text-muted">Nobody attached yet.</p>}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          {people.map(p => (
            <PersonCard key={p.id} p={p} closed={closed} gmailReady={gmailReady}
              task={task} onChanged={personChanged}
              onCompose={(person, kind) => setCompose({ person, kind })} onRemove={remove} />
          ))}
        </div>
        {!closed && (
          <PeoplePicker task={task} onTask={people} onAdded={added} />
        )}
      </div>

      <IncomingTray task={task} people={people} reloadKey={gridKey} onChanged={() => { setGridKey(k => k + 1); onRefresh() }} />
      <EmailFiles taskId={task.id} />
      <DeliverablesGrid task={task} people={people} reloadKey={gridKey} onChanged={() => { setGridKey(k => k + 1); onRefresh() }} />

      {compose && <ComposeModal person={compose.person} kind={compose.kind} onClose={() => setCompose(null)} onSent={sent} onGmailLost={onGmailLost} />}
    </Modal>
  )
}
