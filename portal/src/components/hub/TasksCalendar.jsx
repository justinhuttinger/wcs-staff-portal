import { useState, useMemo } from 'react'
import { gridFor, monthName, stepMonth, DOW } from '../../lib/calendarGrid'
import { tasksByDay } from './calendarTasks'

const CARD = 'bg-surface/95 backdrop-blur-sm rounded-xl border border-border'
const CHIP = {
  high: 'bg-red-500/15 text-red-700 border-red-500/30',
  medium: 'bg-amber-500/15 text-amber-800 border-amber-500/30',
  low: 'bg-slate-500/10 text-text-primary border-border',
}
const MAX_PER_DAY = 3

const todayKey = () => new Date().toLocaleDateString('en-CA')

// Month view of tasks by due date. Same tasks (and filters) as the list.
export default function TasksCalendar({ tasks, onOpen }) {
  const [month, setMonth] = useState(() => todayKey().slice(0, 7))
  const [expanded, setExpanded] = useState(null)
  const { byDay, undated } = useMemo(() => tasksByDay(tasks), [tasks])
  const cells = useMemo(() => gridFor(month), [month])
  const today = todayKey()

  return (
    <div className="space-y-3">
      <div className={`${CARD} overflow-hidden`}>
        <div className="px-4 py-2.5 border-b border-border flex items-center justify-between">
          <button onClick={() => setMonth(m => stepMonth(m, -1))} className="text-sm text-text-muted hover:text-text-primary px-2">‹</button>
          <div className="flex items-center gap-3">
            <h3 className="text-sm font-bold text-text-primary">{monthName(month)}</h3>
            {month !== today.slice(0, 7) && (
              <button onClick={() => setMonth(today.slice(0, 7))} className="text-[11px] text-text-muted hover:text-text-primary">Today</button>
            )}
          </div>
          <button onClick={() => setMonth(m => stepMonth(m, 1))} className="text-sm text-text-muted hover:text-text-primary px-2">›</button>
        </div>
        <div className="grid grid-cols-7 text-[10px] font-bold uppercase tracking-widest text-text-muted border-b border-border">
          {DOW.map(d => <div key={d} className="px-2 py-1">{d}</div>)}
        </div>
        <div className="grid grid-cols-7">
          {cells.map((c, idx) => {
            const list = byDay.get(c.key) || []
            const open = expanded === c.key
            const shown = open ? list : list.slice(0, MAX_PER_DAY)
            const past = c.key < today
            const lastCol = idx % 7 === 6
            const lastRow = idx >= cells.length - 7
            return (
              <div key={c.key} className={`min-h-[92px] border-border p-1 space-y-0.5 ${lastCol ? '' : 'border-r'} ${lastRow ? '' : 'border-b'} ${c.inMonth ? '' : 'bg-bg/50 opacity-70'}`}>
                <div className={`text-[11px] font-semibold px-1 ${c.key === today ? 'text-wcs-red' : c.inMonth ? 'text-text-primary' : 'text-text-muted'}`}>
                  {Number(c.key.slice(8))}
                </div>
                {shown.map(t => {
                  const closed = t.status === 'done' || t.status === 'dropped'
                  return (
                    <button key={t.id} onClick={() => onOpen(t)} title={t.title}
                      className={`w-full text-left truncate rounded border px-1 py-0.5 text-[10px] font-semibold ${CHIP[t.priority] || CHIP.medium} ${closed ? 'line-through opacity-60' : ''} ${past && !closed ? 'ring-1 ring-red-500/50' : ''}`}>
                      {t.title}
                    </button>
                  )
                })}
                {list.length > MAX_PER_DAY && (
                  <button onClick={() => setExpanded(open ? null : c.key)} className="text-[10px] text-text-muted hover:text-text-primary px-1">
                    {open ? 'less' : `+${list.length - MAX_PER_DAY} more`}
                  </button>
                )}
              </div>
            )
          })}
        </div>
      </div>
      {undated.length > 0 && (
        <div className={`${CARD} p-3`}>
          <p className="text-[10px] font-bold uppercase tracking-widest text-text-muted mb-2">No due date ({undated.length})</p>
          <div className="flex flex-wrap gap-1.5">
            {undated.map(t => (
              <button key={t.id} onClick={() => onOpen(t)}
                className={`rounded border px-2 py-0.5 text-[11px] font-semibold ${CHIP[t.priority] || CHIP.medium}`}>{t.title}</button>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
