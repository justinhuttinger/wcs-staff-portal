import { useMemo } from 'react'
import {
  DAY_START_HOUR, DAY_END_HOUR, PX_PER_MINUTE, GRID_HEIGHT_PX, WEEKDAY_LABELS,
  addDays, toISODate, fmtHour, fmtTime12, parseLocalTimestamp, layoutLanes,
} from '../../lib/weekGrid'

// Stable per-class-type color so a class keeps its color week to week. Hashing
// the event_type_id rather than the name means a rename does not reshuffle
// every color in the grid.
const CLASS_COLORS = [
  'bg-sky-50 border-sky-300 text-sky-900',
  'bg-emerald-50 border-emerald-300 text-emerald-900',
  'bg-violet-50 border-violet-300 text-violet-900',
  'bg-amber-50 border-amber-300 text-amber-900',
  'bg-rose-50 border-rose-300 text-rose-900',
  'bg-teal-50 border-teal-300 text-teal-900',
]

function colorFor(eventTypeId) {
  const s = String(eventTypeId || '')
  let h = 0
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0
  return CLASS_COLORS[h % CLASS_COLORS.length]
}

const HOURS = Array.from({ length: DAY_END_HOUR - DAY_START_HOUR }, (_, i) => DAY_START_HOUR + i)

export default function WeekGrid({ weekStart, classes, onClassClick }) {
  const todayISO = toISODate(new Date())

  // Bucket classes by local date, then assign lanes so overlapping classes at
  // the same club sit side by side instead of stacking on top of each other.
  const byDate = useMemo(() => {
    const map = new Map()
    for (const c of classes || []) {
      const parsed = parseLocalTimestamp(c.event_timestamp_local)
      if (!parsed) continue
      const startMin = parsed.hour * 60 + parsed.min
      const item = {
        ...c,
        _parsed: parsed,
        _startMin: startMin,
        _endMin: startMin + (c.duration_minutes || 60),
      }
      if (!map.has(parsed.date)) map.set(parsed.date, [])
      map.get(parsed.date).push(item)
    }
    for (const [, list] of map) layoutLanes(list)
    return map
  }, [classes])

  const days = Array.from({ length: 7 }, (_, i) => addDays(weekStart, i))

  return (
    <div className="bg-surface rounded-xl border border-border overflow-hidden">
      {/* Day headers */}
      <div className="grid grid-cols-[56px_repeat(7,1fr)] border-b border-border">
        <div />
        {days.map((d, i) => {
          const iso = toISODate(d)
          const isToday = iso === todayISO
          return (
            <div
              key={iso}
              className={`px-2 py-2 text-center border-l border-border ${isToday ? 'bg-wcs-red/10' : ''}`}
            >
              <div className={`text-xs uppercase tracking-wide ${isToday ? 'text-wcs-red font-semibold' : 'text-text-muted'}`}>
                {WEEKDAY_LABELS[i]}
              </div>
              <div className={`text-sm ${isToday ? 'text-wcs-red font-bold' : 'text-text-primary'}`}>
                {d.getDate()}
              </div>
            </div>
          )
        })}
      </div>

      {/* Scrollable grid body */}
      <div className="overflow-x-auto">
        <div className="grid grid-cols-[56px_repeat(7,1fr)] min-w-[720px]">
          {/* Hour gutter */}
          <div className="relative" style={{ height: GRID_HEIGHT_PX }}>
            {HOURS.map(h => (
              <div
                key={h}
                className="absolute right-1 text-[10px] text-text-muted -translate-y-1/2"
                style={{ top: (h - DAY_START_HOUR) * 60 * PX_PER_MINUTE }}
              >
                {fmtHour(h)}
              </div>
            ))}
          </div>

          {days.map(d => {
            const iso = toISODate(d)
            const isToday = iso === todayISO
            const dayClasses = byDate.get(iso) || []
            return (
              <div
                key={iso}
                className={`relative border-l border-border ${isToday ? 'bg-wcs-red/5' : ''}`}
                style={{ height: GRID_HEIGHT_PX }}
              >
                {/* Hour lines */}
                {HOURS.map(h => (
                  <div
                    key={h}
                    className="absolute left-0 right-0 border-t border-border/40"
                    style={{ top: (h - DAY_START_HOUR) * 60 * PX_PER_MINUTE }}
                  />
                ))}

                {dayClasses.map(c => {
                  const top = (c._startMin - DAY_START_HOUR * 60) * PX_PER_MINUTE
                  const height = Math.max(22, (c._endMin - c._startMin) * PX_PER_MINUTE - 2)
                  const widthPct = 100 / (c._laneCount || 1)
                  return (
                    <button
                      key={c.event_id}
                      type="button"
                      onClick={() => onClassClick && onClassClick(c)}
                      title={`${c.class_name} · ${fmtTime12(c._parsed.hour, c._parsed.min)}${c.instructor_name ? ' · ' + c.instructor_name : ''}`}
                      className={`absolute rounded-md border px-1.5 py-1 text-left overflow-hidden hover:brightness-95 transition ${colorFor(c.event_type_id)}`}
                      style={{
                        top,
                        height,
                        left: `calc(${(c._laneIndex || 0) * widthPct}% + 2px)`,
                        width: `calc(${widthPct}% - 4px)`,
                      }}
                    >
                      <div className="text-[10px] leading-tight opacity-80">
                        {fmtTime12(c._parsed.hour, c._parsed.min)}
                      </div>
                      <div className="text-[11px] font-semibold leading-tight truncate">
                        {c.class_name}
                      </div>
                      <div className="text-[10px] leading-tight truncate opacity-80">
                        {c.instructor_name || 'Unassigned'}
                      </div>
                    </button>
                  )
                })}
              </div>
            )
          })}
        </div>
      </div>
    </div>
  )
}
