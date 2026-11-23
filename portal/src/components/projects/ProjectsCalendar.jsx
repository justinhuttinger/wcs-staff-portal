import { useState, useMemo } from 'react'
import { gridFor, monthName, stepMonth, DOW } from '../../lib/calendarGrid'
import { OPEN, PRIORITY } from './model'
import { tasksByDue, rescheduleTo } from './calendar'

const CARD = 'bg-surface/95 backdrop-blur-sm rounded-xl border border-border'
const CHIP = {
  urgent: 'bg-red-500/15 text-red-700 border-red-500/30',
  high: 'bg-orange-500/15 text-orange-800 border-orange-500/30',
  medium: 'bg-amber-500/15 text-amber-800 border-amber-500/30',
  low: 'bg-slate-500/10 text-text-primary border-border',
}
const MAX_PER_DAY = 3
const todayKey = () => new Date().toLocaleDateString('en-CA')

function Chip({ t, today, onOpen, onDragStart, onDragEnd, className = '' }) {
  const closed = !OPEN.includes(t.status)
  const overdue = !closed && t.due_date && t.due_date < today
  return (
    <button type="button" draggable onClick={() => onOpen(t)} onDragStart={e => onDragStart(e, t)} onDragEnd={onDragEnd}
      title={`${t.title} · ${PRIORITY[t.priority]?.label || ''} priority`}
      className={`text-left truncate rounded border px-1 py-0.5 text-[10px] font-semibold cursor-grab active:cursor-grabbing ${CHIP[t.priority] || CHIP.medium} ${closed ? 'line-through opacity-60' : ''} ${overdue ? 'ring-1 ring-red-500/60' : ''} ${className}`}>
      {t.title}
    </button>
  )
}

// Month view by due date, using the same filters as the list. Drag a task to
// another day to change its due date, or onto "No due date" to clear it.
export default function ProjectsCalendar({ tasks, onOpen, onReschedule }) {
  const [month, setMonth] = useState(() => todayKey().slice(0, 7))
  const [expanded, setExpanded] = useState(null)
  const [dragId, setDragId] = useState(null)
  const [over, setOver] = useState(null) // day key, or 'none'
  const { byDay, undated } = useMemo(() => tasksByDue(tasks), [tasks])
  const cells = useMemo(() => gridFor(month), [month])
  const today = todayKey()

  const onDragStart = (e, t) => {
    setDragId(t.id)
    e.dataTransfer.effectAllowed = 'move'
    try { e.dataTransfer.setData('text/plain', t.id) } catch { /* ignore */ }
  }
  const reset = () => { setDragId(null); setOver(null) }
  const dropOn = (e, dayKey) => {
    e.preventDefault()
    const task = tasks.find(t => t.id === (dragId || e.dataTransfer.getData('text/plain')))
    reset()
    if (!task) return
    const next = rescheduleTo(task, dayKey)
    if (next !== undefined) onReschedule(task, next)
  }
  const target = key => ({
    onDragOver: e => { if (dragId) { e.preventDefault(); setOver(key) } },
    onDragLeave: e => { if (!e.currentTarget.contains(e.relatedTarget)) setOver(o => (o === key ? null : o)) },
    onDrop: e => dropOn(e, key === 'none' ? null : key),
  })

  return (
    <div className="space-y-3">
      <div className={`${CARD} overflow-hidden`}>
        <div className="px-4 py-2.5 border-b border-border flex items-center justify-between">
          <button onClick={() => setMonth(m => stepMonth(m, -1))} className="text-sm text-text-muted hover:text-text-primary px-2" aria-label="Previous month">‹</button>
          <div className="flex items-center gap-3">
            <h3 className="text-sm font-bold text-text-primary">{monthName(month)}</h3>
            {month !== today.slice(0, 7) && (
              <button onClick={() => setMonth(today.slice(0, 7))} className="text-[11px] text-text-muted hover:text-text-primary">Today</button>
            )}
          </div>
          <button onClick={() => setMonth(m => stepMonth(m, 1))} className="text-sm text-text-muted hover:text-text-primary px-2" aria-label="Next month">›</button>
        </div>
        <div className="grid grid-cols-7 text-[10px] font-bold uppercase tracking-widest text-text-muted border-b border-border">
          {DOW.map(d => <div key={d} className="px-2 py-1">{d}</div>)}
        </div>
        <div className="grid grid-cols-7">
          {cells.map((c, idx) => {
            const list = byDay.get(c.key) || []
            const open = expanded === c.key
            const shown = open ? list : list.slice(0, MAX_PER_DAY)
            const lastCol = idx % 7 === 6
            const lastRow = idx >= cells.length - 7
            return (
              <div key={c.key} {...target(c.key)} data-day={c.key}
                className={`min-h-[96px] border-border p-1 space-y-0.5 flex flex-col ${lastCol ? '' : 'border-r'} ${lastRow ? '' : 'border-b'} ${c.inMonth ? '' : 'bg-bg/50 opacity-70'} ${over === c.key ? 'bg-wcs-red/10' : ''}`}>
                <div className={`text-[11px] font-semibold px-1 ${c.key === today ? 'text-wcs-red' : c.inMonth ? 'text-text-primary' : 'text-text-muted'}`}>
                  {Number(c.key.slice(8))}
                </div>
                {shown.map(t => (
                  <Chip key={t.id} t={t} today={today} onOpen={onOpen} onDragStart={onDragStart} onDragEnd={reset}
                    className={`w-full ${t.id === dragId ? 'opacity-40' : ''}`} />
                ))}
                {list.length > MAX_PER_DAY && (
                  <button onClick={() => setExpanded(open ? null : c.key)} className="text-[10px] text-text-muted hover:text-text-primary px-1 text-left">
                    {open ? 'less' : `+${list.length - MAX_PER_DAY} more`}
                  </button>
                )}
              </div>
            )
          })}
        </div>
      </div>

      <div {...target('none')} data-day="none"
        className={`${CARD} p-3 transition-colors ${over === 'none' ? 'ring-2 ring-wcs-red/40' : ''}`}>
        <p className="text-[10px] font-bold uppercase tracking-widest text-text-muted mb-2">No due date ({undated.length})</p>
        {undated.length === 0
          ? <p className="text-[11px] text-text-muted">Drop a task here to clear its due date.</p>
          : (
            <div className="flex flex-wrap gap-1.5">
              {undated.map(t => (
                <Chip key={t.id} t={t} today={today} onOpen={onOpen} onDragStart={onDragStart} onDragEnd={reset}
                  className={`!text-[11px] px-2 ${t.id === dragId ? 'opacity-40' : ''}`} />
              ))}
            </div>
          )}
      </div>
    </div>
  )
}
