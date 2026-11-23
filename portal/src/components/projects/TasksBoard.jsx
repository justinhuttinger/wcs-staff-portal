import { useState, useRef } from 'react'
import { PRIORITY, OPEN, boardColumns, dropOrder } from './model'
import { dueLabel } from '../hub/dates'
import { AvatarStack } from './Dropdown'

const CARD = 'bg-surface/95 backdrop-blur-sm rounded-xl border border-border'

function Card({ t, nameOf, categoryName, dragging, onOpen, onDragStart, onDragEnd }) {
  const pr = PRIORITY[t.priority]
  const due = OPEN.includes(t.status) ? dueLabel(t.due_date) : null
  const cat = categoryName(t.category_id)
  return (
    <div data-card={t.id} draggable onDragStart={e => onDragStart(e, t)} onDragEnd={onDragEnd}
      onClick={() => onOpen(t)}
      className={`rounded-lg border border-border bg-bg p-3 cursor-grab active:cursor-grabbing hover:border-text-muted/50 transition-opacity ${dragging ? 'opacity-40' : ''}`}>
      <div className="flex items-start gap-2">
        <span className={`mt-1.5 w-2 h-2 rounded-full shrink-0 ${pr?.dot}`} title={`${pr?.label} priority`} />
        <p className={`text-sm font-semibold leading-snug ${t.status === 'skipped' ? 'line-through text-text-muted' : 'text-text-primary'}`}>{t.title}</p>
      </div>
      {cat && <p className="text-[11px] text-text-muted mt-1 pl-4 truncate">{cat}</p>}
      <div className="flex items-center justify-between gap-2 mt-2 pl-4">
        <div className="flex items-center gap-2 min-w-0">
          {due && <span className={`px-2 py-0.5 rounded-full text-[10px] font-bold border whitespace-nowrap ${due.tone}`}>{due.text}</span>}
          {t.file_count > 0 && (
            <span className="inline-flex items-center gap-1 text-[11px] text-text-muted" title="Files and links">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" className="w-3.5 h-3.5" aria-hidden="true">
                <path strokeLinecap="round" strokeLinejoin="round" d="m18.375 12.739-7.693 7.693a4.5 4.5 0 0 1-6.364-6.364l10.94-10.94A3 3 0 1 1 19.5 7.372L8.552 18.32m.009-.01-.01.01m5.699-9.941-7.81 7.81a1.5 1.5 0 0 0 2.112 2.13" />
              </svg>
              {t.file_count}
            </span>
          )}
          {t.comment_count > 0 && (
            <span className="inline-flex items-center gap-1 text-[11px] text-text-muted" title="Comments">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" className="w-3.5 h-3.5" aria-hidden="true">
                <path strokeLinecap="round" strokeLinejoin="round" d="M2.25 12.76c0 1.6 1.123 2.994 2.707 3.227 1.087.16 2.185.283 3.293.369V21l4.076-4.076a1.526 1.526 0 0 1 1.037-.443 48.282 48.282 0 0 0 5.68-.494c1.584-.233 2.707-1.626 2.707-3.228V6.741c0-1.602-1.123-2.995-2.707-3.228A48.394 48.394 0 0 0 12 3c-2.392 0-4.744.175-7.043.513C3.373 3.746 2.25 5.14 2.25 6.741v6.018Z" />
              </svg>
              {t.comment_count}
            </span>
          )}
        </div>
        <div className="flex shrink-0">
          <AvatarStack ids={t.assignees.map(a => a.staff_id)} nameOf={nameOf} max={3} />
        </div>
      </div>
    </div>
  )
}

// Columns by status. Drag a card to another column (or within one) to change
// its status and position. Touch devices: tap a card and set status in the
// editor (browsers don't drag on touch).
export default function TasksBoard({ tasks, showSkipped, sort = 'manual', nameOf, categoryName, onOpen, onMove }) {
  const columns = boardColumns(tasks, { showSkipped, sort })
  const manual = sort === 'manual'
  const [dragId, setDragId] = useState(null)
  const [drop, setDrop] = useState(null) // { status, index }
  const colRefs = useRef({})

  const onDragStart = (e, t) => {
    setDragId(t.id)
    e.dataTransfer.effectAllowed = 'move'
    try { e.dataTransfer.setData('text/plain', t.id) } catch { /* some browsers */ }
  }
  const reset = () => { setDragId(null); setDrop(null) }
  const dragStatus = tasks.find(t => t.id === dragId)?.status

  // Where in this column the pointer is: index among cards other than the
  // one being dragged.
  const indexAt = (status, clientY) => {
    const el = colRefs.current[status]
    if (!el) return 0
    const cards = [...el.querySelectorAll('[data-card]')].filter(c => c.dataset.card !== dragId)
    const i = cards.findIndex(c => {
      const r = c.getBoundingClientRect()
      return clientY < r.top + r.height / 2
    })
    return i === -1 ? cards.length : i
  }

  const handleDrop = (e, col) => {
    e.preventDefault()
    const id = dragId || e.dataTransfer.getData('text/plain')
    const task = tasks.find(t => t.id === id)
    const index = indexAt(col.value, e.clientY)
    reset()
    if (!task) return
    const others = col.items.filter(t => t.id !== id)
    const unchanged = task.status === col.value && col.items.indexOf(task) === index
    // Under a chosen sort the order inside a column is the sort's, so a drop
    // in the same column changes nothing.
    if (unchanged || (!manual && task.status === col.value)) return
    onMove(task, col.value, dropOrder(others, index))
  }

  return (
    <div className={`grid gap-4 items-start grid-cols-1 sm:grid-cols-2 ${showSkipped ? 'lg:grid-cols-4' : 'lg:grid-cols-3'}`}>
      {columns.map(col => {
        const others = col.items.filter(t => t.id !== dragId)
        const target = drop?.status === col.value
        return (
          <div key={col.value} className={`${CARD} p-3 transition-colors ${target ? 'ring-2 ring-wcs-red/40' : ''}`}
            onDragOver={e => { if (!dragId) return; e.preventDefault(); setDrop({ status: col.value, index: indexAt(col.value, e.clientY) }) }}
            onDragLeave={e => { if (!e.currentTarget.contains(e.relatedTarget)) setDrop(d => (d?.status === col.value ? null : d)) }}
            onDrop={e => handleDrop(e, col)}>
            <div className="flex items-center justify-between px-1 mb-3">
              <span className="text-[11px] font-bold uppercase tracking-widest text-text-muted">{col.label}</span>
              <span className="text-[11px] text-text-muted">{col.items.length}</span>
            </div>
            <div ref={el => { colRefs.current[col.value] = el }} className="space-y-2 min-h-[80px]">
              {col.items.map(t => {
                const idx = others.indexOf(t)
                return (
                  <div key={t.id}>
                    {target && (manual || drop.status !== dragStatus) && drop.index === idx && idx !== -1 && <div className="h-1 rounded bg-wcs-red/60 mb-2" />}
                    <Card t={t} nameOf={nameOf} categoryName={categoryName} dragging={t.id === dragId}
                      onOpen={onOpen} onDragStart={onDragStart} onDragEnd={reset} />
                  </div>
                )
              })}
              {target && (manual || drop.status !== dragStatus) && drop.index >= others.length && <div className="h-1 rounded bg-wcs-red/60" />}
              {col.items.length === 0 && !target && (
                <p className="text-[11px] text-text-muted text-center py-6">Drop tasks here</p>
              )}
            </div>
          </div>
        )
      })}
    </div>
  )
}
