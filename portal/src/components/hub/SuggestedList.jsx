import { useState, useEffect, useCallback, forwardRef } from 'react'
import { hub } from '../../lib/api'
import TaskEditor from './TaskEditor'
import { suggestionToTaskForm, ageLabel } from './suggestionForm'

const CARD = 'bg-surface/95 backdrop-blur-sm rounded-xl border border-border'
const gmailUrl = threadId => `https://mail.google.com/mail/u/0/#all/${encodeURIComponent(threadId)}`

// Top of the Hub: asks that came in by email or text, oldest first. Add opens
// the task editor pre-filled; nothing is saved until Save. Recently skipped is
// what Claude decided was not a request, so a mistake can be rescued.
const SuggestedList = forwardRef(function SuggestedList({ reloadKey = 0, highlightId, onAdded }, ref) {
  const [data, setData] = useState(null)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [busy, setBusy] = useState(null)
  const [menu, setMenu] = useState(null)
  const [showSkipped, setShowSkipped] = useState(false)
  const [adding, setAdding] = useState(null) // { s, categories }

  const load = useCallback(() => {
    hub.suggestions.list().then(r => { setData(r); setError('') }).catch(e => setError(e.message))
  }, [])
  useEffect(() => { load() }, [load, reloadKey])
  useEffect(() => {
    const t = setInterval(load, 60_000)
    return () => clearInterval(t)
  }, [load])

  const act = async (id, fn) => {
    setBusy(id); setMenu(null); setError('')
    try { await fn(); load() } catch (e) { setError(e.message) } finally { setBusy(null) }
  }
  const startAdd = async s => {
    setBusy(s.id); setError('')
    try {
      const { categories } = await hub.tasks.list()
      setAdding({ s, categories: categories || [] })
    } catch (e) { setError(e.message) } finally { setBusy(null) }
  }

  if (!data) return error ? <div className={`${CARD} px-5 py-2.5 text-xs text-text-muted`}>Couldn't load suggestions. Retrying…</div> : null
  const { open, skipped } = data
  if (!open.length && !skipped.length) return null

  return (
    <div ref={ref} className={`${CARD} overflow-hidden`}>
      <div className="px-5 py-2.5 border-b border-border flex items-center justify-between">
        <h3 className="text-xs font-bold uppercase tracking-widest text-text-primary">
          Suggested {open.length > 0 && <span className="text-wcs-red">({open.length})</span>}
        </h3>
        <span className="text-[11px] text-text-muted">oldest first</span>
      </div>
      {error && <p className="px-5 py-2 text-xs text-red-600">{error}</p>}
      {notice && (
        <div className="px-5 py-2 text-xs text-amber-800 bg-amber-500/10 flex justify-between gap-3">
          <span>{notice}</span>
          <button onClick={() => setNotice('')} className="font-semibold">OK</button>
        </div>
      )}
      {open.length === 0 && <p className="px-5 py-3 text-xs text-text-muted">Nothing waiting on you.</p>}
      <div className="divide-y divide-border">
        {open.map(s => (
          <div key={s.id} className={`px-5 py-2.5 flex items-center gap-3 ${highlightId === s.id ? 'bg-wcs-red/5' : ''}`}>
            <span className="shrink-0 w-5 text-center" title={s.source === 'text' ? 'Text' : 'Email'}>{s.source === 'text' ? '💬' : '✉'}</span>
            <div className="min-w-0 flex-1">
              <p className="text-sm text-text-primary truncate">
                <span className="font-semibold">{s.from_name || s.from_email || 'Someone'}</span>
                <span className="text-text-muted"> · </span>{s.summary || s.subject}
              </p>
              {s.snippet && <p className="text-xs text-text-muted truncate">{s.snippet}</p>}
            </div>
            <span className="shrink-0 text-[11px] text-text-muted tabular-nums">{ageLabel(s.received_at)}</span>
            {s.you_replied && <span className="shrink-0 text-[10px] font-semibold px-2 py-0.5 rounded-full bg-bg border border-border text-text-muted">you replied</span>}
            <button disabled={busy === s.id} onClick={() => startAdd(s)}
              className="shrink-0 px-2.5 py-1 rounded-lg text-xs font-semibold bg-wcs-red text-white disabled:opacity-50">Add</button>
            <button disabled={busy === s.id} onClick={() => act(s.id, () => hub.suggestions.dismiss(s.id))}
              className="shrink-0 px-2.5 py-1 rounded-lg text-xs font-semibold border border-border text-text-muted hover:text-text-primary disabled:opacity-50">Dismiss</button>
            {s.source === 'email' && (
              <div className="relative shrink-0">
                <button onClick={() => setMenu(menu === s.id ? null : s.id)} aria-label="More"
                  className="px-2 py-1 rounded-lg text-xs text-text-muted hover:text-text-primary">⋯</button>
                {menu === s.id && (
                  <div className="absolute right-0 mt-1 z-20 w-44 rounded-lg border border-border bg-surface shadow-lg py-1 text-sm">
                    {s.gmail_thread_id && (
                      <a href={gmailUrl(s.gmail_thread_id)} target="_blank" rel="noreferrer" onClick={() => setMenu(null)}
                        className="block px-3 py-1.5 hover:bg-bg text-text-primary">Open in Gmail</a>
                    )}
                    <button onClick={() => act(s.id, () => hub.suggestions.mute(s.id))}
                      className="block w-full text-left px-3 py-1.5 hover:bg-bg text-text-primary">Mute this sender</button>
                  </div>
                )}
              </div>
            )}
          </div>
        ))}
      </div>
      {skipped.length > 0 && (
        <div className="border-t border-border">
          <button onClick={() => setShowSkipped(v => !v)} className="w-full text-left px-5 py-2 text-xs text-text-muted hover:text-text-primary">
            {showSkipped ? '▾' : '▸'} Recently skipped ({skipped.length})
          </button>
          {showSkipped && (
            <div className="divide-y divide-border">
              {skipped.map(s => (
                <div key={s.id} className="px-5 py-2 flex items-center gap-3">
                  <p className="min-w-0 flex-1 text-xs text-text-muted truncate">
                    <span className="font-semibold text-text-primary">{s.from_name || s.from_email || 'Someone'}</span> · {s.subject || s.summary}
                  </p>
                  <span className="shrink-0 text-[11px] text-text-muted">{ageLabel(s.received_at)}</span>
                  <button disabled={busy === s.id} onClick={() => act(s.id, () => hub.suggestions.restore(s.id))}
                    className="shrink-0 px-2 py-0.5 rounded-lg text-[11px] font-semibold border border-border text-text-muted hover:text-text-primary disabled:opacity-50">This is a request</button>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
      {adding && (
        <TaskEditor task={null} categories={adding.categories} heading="Add suggested task"
          initial={suggestionToTaskForm(adding.s)}
          saveWith={body => hub.suggestions.add(adding.s.id, body)}
          onClose={() => setAdding(null)}
          onSaved={(row, result) => {
            setAdding(null)
            if (result?.warning) setNotice(result.warning)
            load()
            onAdded?.(row)
          }} />
      )}
    </div>
  )
})

export default SuggestedList
