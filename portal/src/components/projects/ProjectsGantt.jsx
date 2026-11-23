import { useState, useMemo, useRef } from 'react'
import { OPEN, STATUS } from './model'
import { ZOOMS, addDays, dayDiff, dayKey, taskSpan, barBox, groupRows, dragDates, monthBands } from './gantt'

const CARD = 'bg-surface/95 backdrop-blur-sm rounded-xl border border-border'
const LABEL_W = 240
const ROW_H = 36
const BAR = {
  not_started: 'bg-slate-400/80 border-slate-500',
  in_progress: 'bg-blue-500/85 border-blue-600',
  complete: 'bg-green-500/80 border-green-600',
  skipped: 'bg-slate-300/60 border-slate-400',
}

function Segmented({ value, options, onChange }) {
  return (
    <div className="flex rounded-lg border border-border overflow-hidden">
      {options.map(([v, label]) => (
        <button key={v} type="button" onClick={() => onChange(v)}
          className={`px-3 py-1.5 text-xs font-semibold ${value === v ? 'bg-wcs-red text-white' : 'bg-bg text-text-muted hover:text-text-primary'}`}>{label}</button>
      ))}
    </div>
  )
}

// Timeline: one bar per task from its start (or the day it was created) to
// its due date. Drag a bar to move it, or its edges to change the start or
// due date. Tasks without a due date are listed underneath.
export default function ProjectsGantt({ tasks, categories, nameOf, onOpen, onDates }) {
  const today = dayKey(new Date())
  const [by, setBy] = useState('category')
  const [zoom, setZoom] = useState('weeks')
  const [from, setFrom] = useState(() => addDays(today, -7))
  const [drag, setDrag] = useState(null) // { id, mode, x, delta }
  const moved = useRef(false)
  const { days, px } = ZOOMS[zoom]
  const width = days * px

  const scheduled = tasks.filter(t => t.due_date)
  const unscheduled = tasks.filter(t => !t.due_date)
  const rows = useMemo(() => groupRows(scheduled, by, { nameOf, categories }), [scheduled, by, nameOf, categories])
  const bands = useMemo(() => monthBands(from, days), [from, days])
  const todayLeft = dayDiff(from, today)

  const step = dir => setFrom(f => addDays(f, dir * Math.round(days / 3)))

  // The live drag is kept in a ref as well as state: pointer events can fire
  // twice before React re-renders, and a stale copy must never save twice.
  const dragRef = useRef(null)
  const setLive = d => { dragRef.current = d; setDrag(d) }
  const startDrag = (e, t, mode) => {
    e.stopPropagation()
    e.currentTarget.setPointerCapture?.(e.pointerId)
    moved.current = false
    setLive({ id: t.id, rowKey: e.currentTarget.dataset.row, mode, x: e.clientX, delta: 0 })
  }
  const onMove = e => {
    e.stopPropagation()
    const d = dragRef.current
    if (!d) return
    const delta = Math.round((e.clientX - d.x) / px)
    if (delta !== d.delta) { moved.current = true; setLive({ ...d, delta }) }
  }
  const endDrag = (e, t) => {
    e.stopPropagation()
    const d = dragRef.current
    if (!d) return
    setLive(null)
    if (!moved.current || !d.delta) { if (d.mode === 'move' && !moved.current) onOpen(t); return }
    const patch = dragDates(taskSpan(t), d.mode, d.delta)
    if (Object.keys(patch).length) onDates(t, patch)
  }

  // The span drawn for a task, including an in-flight drag.
  const spanFor = t => {
    const span = taskSpan(t)
    if (!drag || drag.id !== t.id || !drag.delta) return span
    const p = dragDates(span, drag.mode, drag.delta)
    return { ...span, start: p.start_date || span.start, end: p.due_date || span.end }
  }

  return (
    <div className="space-y-3">
      <div className={`${CARD} p-3 flex items-center gap-2 flex-wrap`}>
        <span className="text-[11px] font-semibold text-text-muted">Group</span>
        <Segmented value={by} onChange={setBy} options={[['category', 'Category'], ['person', 'Person'], ['none', 'None']]} />
        <span className="text-[11px] font-semibold text-text-muted ml-2">Show</span>
        <Segmented value={zoom} onChange={setZoom} options={Object.entries(ZOOMS).map(([k, z]) => [k, z.label])} />
        <div className="flex items-center gap-1 ml-auto">
          <button type="button" onClick={() => step(-1)} className="px-2 py-1 text-sm text-text-muted hover:text-text-primary" aria-label="Earlier">‹</button>
          <button type="button" onClick={() => setFrom(addDays(today, -7))} className="px-2 py-1 text-xs font-semibold text-text-muted hover:text-text-primary">Today</button>
          <button type="button" onClick={() => step(1)} className="px-2 py-1 text-sm text-text-muted hover:text-text-primary" aria-label="Later">›</button>
        </div>
      </div>

      <div className={`${CARD} overflow-x-auto`}>
        <div style={{ width: LABEL_W + width }} className="relative select-none">
          {/* Header: months, then days */}
          <div className="flex border-b border-border sticky top-0 bg-surface z-10">
            <div style={{ width: LABEL_W }} className="shrink-0 border-r border-border px-3 py-1 text-[10px] font-bold uppercase tracking-widest text-text-muted flex items-end">Task</div>
            <div style={{ width }} className="relative h-10">
              {bands.map(b => (
                <div key={b.key} style={{ left: b.left * px, width: b.width * px }}
                  className="absolute top-0 h-5 border-l border-border px-1 text-[10px] font-bold text-text-primary truncate">{b.label}</div>
              ))}
              {Array.from({ length: days }, (_, i) => {
                const key = addDays(from, i)
                const day = Number(key.slice(8))
                const showNum = px >= 16 || (i % 7 === 0)
                return showNum ? (
                  <div key={key} style={{ left: i * px, width: px >= 16 ? px : px * 7 }}
                    className={`absolute top-5 h-5 text-[9px] leading-5 ${px >= 16 ? 'text-center' : 'pl-0.5'} ${key === today ? 'text-wcs-red font-bold' : 'text-text-muted'}`}>{day}</div>
                ) : null
              })}
            </div>
          </div>

          {/* Weekend shading + today line, behind the rows */}
          <div className="absolute pointer-events-none" style={{ left: LABEL_W, top: 40, bottom: 0, width }}>
            {px >= 16 && Array.from({ length: days }, (_, i) => {
              const dow = new Date(`${addDays(from, i)}T12:00:00`).getDay()
              return dow === 0 || dow === 6 ? <div key={i} style={{ left: i * px, width: px }} className="absolute inset-y-0 bg-bg/70" /> : null
            })}
            {todayLeft >= 0 && todayLeft < days && (
              <div style={{ left: todayLeft * px + px / 2 }} className="absolute inset-y-0 w-0.5 -ml-px bg-wcs-red/80" title="Today" />
            )}
          </div>

          {rows.length === 0 && (
            <p className="px-4 py-6 text-sm text-text-muted relative">No tasks with a due date match these filters.</p>
          )}
          {rows.map(r => (
            <div key={r.key} className="relative">
              {by !== 'none' && (
                <div className="flex border-b border-border bg-bg/60">
                  <div style={{ width: LABEL_W }} className="shrink-0 px-3 py-1 text-[10px] font-bold uppercase tracking-widest text-text-muted truncate">
                    {r.label} <span className="font-normal">· {r.tasks.length}</span>
                  </div>
                </div>
              )}
              {r.tasks.map(t => {
                const span = spanFor(t)
                const box = barBox(span, from, days)
                const open = OPEN.includes(t.status)
                const overdue = open && t.due_date < today
                const dragging = drag?.id === t.id && drag?.rowKey === r.key
                return (
                  <div key={t.id} className="flex border-b border-border/60" style={{ height: ROW_H }}>
                    <button type="button" onClick={() => onOpen(t)} style={{ width: LABEL_W }}
                      className={`shrink-0 border-r border-border px-3 text-left text-xs truncate hover:text-wcs-red ${open ? 'text-text-primary font-semibold' : 'text-text-muted line-through'}`}
                      title={t.title}>{t.title}</button>
                    <div style={{ width }} className="relative">
                      {box ? (
                        <div data-row={r.key}
                          onPointerDown={e => startDrag(e, t, 'move')} onPointerMove={onMove} onPointerUp={e => endDrag(e, t)}
                          onPointerCancel={() => setLive(null)}
                          style={{ left: box.left * px, width: Math.max(box.width * px, 6), top: 7, height: ROW_H - 14 }}
                          title={`${t.title} · ${STATUS[t.status]?.label} · ${span.start} → ${span.end}`}
                          className={`absolute border text-[10px] font-semibold text-white px-1.5 leading-[22px] truncate cursor-grab active:cursor-grabbing touch-none
                            ${BAR[t.status] || BAR.not_started} ${overdue ? 'ring-2 ring-red-500' : ''} ${dragging ? 'opacity-80 shadow-lg' : ''}
                            ${box.clipStart ? 'rounded-l-none' : 'rounded-l-md'} ${box.clipEnd ? 'rounded-r-none' : 'rounded-r-md'}`}>
                          {!box.clipStart && (
                            <span data-row={r.key} onPointerDown={e => startDrag(e, t, 'start')} onPointerMove={onMove} onPointerUp={e => endDrag(e, t)}
                              className="absolute left-0 inset-y-0 w-1.5 cursor-ew-resize" title="Drag to change the start" />
                          )}
                          {box.width * px >= 60 ? t.title : ''}
                          {!box.clipEnd && (
                            <span data-row={r.key} onPointerDown={e => startDrag(e, t, 'end')} onPointerMove={onMove} onPointerUp={e => endDrag(e, t)}
                              className="absolute right-0 inset-y-0 w-1.5 cursor-ew-resize" title="Drag to change the due date" />
                          )}
                        </div>
                      ) : (
                        <span className="absolute inset-y-0 left-2 flex items-center text-[10px] text-text-muted">
                          {span.end < from ? `← due ${span.end}` : `due ${span.end} →`}
                        </span>
                      )}
                    </div>
                  </div>
                )
              })}
            </div>
          ))}
        </div>
      </div>

      {unscheduled.length > 0 && (
        <div className={`${CARD} p-3`}>
          <p className="text-[10px] font-bold uppercase tracking-widest text-text-muted mb-2">No due date, not on the timeline ({unscheduled.length})</p>
          <div className="flex flex-wrap gap-1.5">
            {unscheduled.map(t => (
              <button key={t.id} type="button" onClick={() => onOpen(t)}
                className="rounded border border-border bg-bg px-2 py-0.5 text-[11px] font-semibold text-text-primary hover:text-wcs-red">{t.title}</button>
            ))}
          </div>
        </div>
      )}
      <p className="text-[11px] text-text-muted px-1">Drag a bar to move it, or drag its left or right edge to change the start or due date. Bars without a start date begin on the day the task was created.</p>
    </div>
  )
}
