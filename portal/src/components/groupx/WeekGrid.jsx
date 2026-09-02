import { useMemo } from 'react'
import {
  PX_PER_MINUTE, WEEKDAY_LABELS,
  addDays, toISODate, fmtHour, fmtTime12, parseLocalTimestamp, layoutLanes,
  displayClassName, durationLabel, dayWindow,
} from '../../lib/weekGrid'
// The palette moved to its own module so the printed sheet can render the same
// colours from the same hash. See lib/classColors.js.
import { colorFor } from '../../lib/classColors'

// Clicking empty grid space creates a class at that slot. Times snap to the
// nearest half hour so a click never produces something like 9:47am.
const SNAP_MINUTES = 30

// Takes the window because it is no longer a constant: on a week with a 5am
// class the grid starts at 5, and a click 30px down means 5:30, not 6:30.
function slotTimeFromOffset(offsetY, startHour, endHour) {
  const raw = startHour * 60 + offsetY / PX_PER_MINUTE
  const snapped = Math.round(raw / SNAP_MINUTES) * SNAP_MINUTES
  const clamped = Math.min(Math.max(snapped, startHour * 60), endHour * 60 - SNAP_MINUTES)
  const h = Math.floor(clamped / 60)
  const m = clamped % 60
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`
}

// Arrow glyphs as inline SVG rather than a font or an entity, so they keep
// their weight next to the label at every zoom level.
function Chevron({ dir }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"
      strokeLinecap="round" strokeLinejoin="round" className="w-4 h-4" aria-hidden="true">
      <path d={dir === 'left' ? 'M15 19l-7-7 7-7' : 'M9 5l7 7-7 7'} />
    </svg>
  )
}

export default function WeekGrid({
  weekStart, classes, onClassClick, onSlotClick,
  weekLabel, onPrevWeek, onNextWeek, onThisWeek, loading,
}) {
  const todayISO = toISODate(new Date())
  // The nav belongs to the calendar, so it renders only when the caller
  // actually wired it up. Other users of WeekGrid keep a bare grid.
  const hasNav = !!(onPrevWeek || onNextWeek)

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

  // Grown to contain whatever is actually scheduled, so an early class is
  // never clipped out of existence. See dayWindow().
  const { startHour, endHour } = useMemo(() => dayWindow(classes), [classes])
  const hours = useMemo(
    () => Array.from({ length: endHour - startHour }, (_, i) => startHour + i),
    [startHour, endHour],
  )
  const gridHeight = (endHour - startHour) * 60 * PX_PER_MINUTE

  const days = Array.from({ length: 7 }, (_, i) => addDays(weekStart, i))

  return (
    <div className="bg-surface rounded-xl border border-border overflow-hidden">
      {/* Week nav, on the calendar it actually drives. Prev sits hard left and
          Next hard right, so the arrows bracket the week they move, and the
          label they change reads between them. */}
      {hasNav && (
        <div className="flex items-center gap-2 px-3 py-2.5 border-b border-border">
          <button
            type="button"
            onClick={onPrevWeek}
            aria-label="Previous week"
            className="shrink-0 p-2 rounded-lg border border-border text-text-primary hover:bg-bg transition"
          >
            <Chevron dir="left" />
          </button>

          <div className="flex-1 min-w-0 flex items-center justify-center gap-2">
            <span className="text-base font-bold text-text-primary truncate">{weekLabel}</span>
            {onThisWeek && (
              <button
                type="button"
                onClick={onThisWeek}
                className="shrink-0 px-2.5 py-1 text-xs rounded-lg border border-border text-text-primary hover:bg-bg transition"
              >
                Today
              </button>
            )}
            {loading && <span className="shrink-0 text-xs font-medium text-text-primary">Loading…</span>}
          </div>

          <button
            type="button"
            onClick={onNextWeek}
            aria-label="Next week"
            className="shrink-0 p-2 rounded-lg border border-border text-text-primary hover:bg-bg transition"
          >
            <Chevron dir="right" />
          </button>
        </div>
      )}

      {/* Day headers */}
      <div className="grid grid-cols-[56px_repeat(7,1fr)] border-b border-border">
        <div />
        {days.map(d => {
          const iso = toISODate(d)
          const isToday = iso === todayISO
          return (
            <div
              key={iso}
              className={`px-2 py-2 text-center border-l border-border ${isToday ? 'bg-wcs-red/10' : ''}`}
            >
              <div className={`text-xs uppercase tracking-wide font-semibold ${isToday ? 'text-wcs-red' : 'text-text-primary'}`}>
                {/* Read from the column's own date, not its index -- indexing by
                    position hard-wires the grid to a Sunday start, which lies
                    once the caller anchors the week on Monday instead. */}
                {WEEKDAY_LABELS[d.getDay()]}
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
          <div className="relative" style={{ height: gridHeight }}>
            {hours.map(h => (
              <div
                key={h}
                className="absolute right-1 text-[10px] font-semibold text-text-primary -translate-y-1/2"
                style={{ top: (h - startHour) * 60 * PX_PER_MINUTE }}
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
                style={{ height: gridHeight }}
                onClick={e => {
                  // Only fire for the column itself. Clicks on a class block
                  // stop propagation, so this never double-triggers.
                  if (!onSlotClick || e.target !== e.currentTarget) return
                  const y = e.clientY - e.currentTarget.getBoundingClientRect().top
                  onSlotClick({ date: iso, time: slotTimeFromOffset(y, startHour, endHour) })
                }}
                title={onSlotClick ? 'Click to add a class' : undefined}
              >
                {/* Hour lines */}
                {hours.map(h => (
                  <div
                    key={h}
                    className="absolute left-0 right-0 border-t border-border/40 pointer-events-none"
                    style={{ top: (h - startHour) * 60 * PX_PER_MINUTE }}
                  />
                ))}

                {dayClasses.map(c => {
                  const top = (c._startMin - startHour * 60) * PX_PER_MINUTE
                  const height = Math.max(22, (c._endMin - c._startMin) * PX_PER_MINUTE - 2)
                  const widthPct = 100 / (c._laneCount || 1)
                  // The "- 30"/"- 60" suffix on split-length classes is dropped
                  // here and shown as a pill instead. Colour keys off the same
                  // trimmed name so both lengths of one class share a colour.
                  const label = displayClassName(c.class_name, c.duration_minutes)
                  const lenLabel = durationLabel(c.duration_minutes)
                  return (
                    <button
                      key={c.event_id}
                      type="button"
                      onClick={e => { e.stopPropagation(); if (onClassClick) onClassClick(c) }}
                      title={`${label}${lenLabel ? ` (${lenLabel})` : ''} · ${fmtTime12(c._parsed.hour, c._parsed.min)}${c.instructor_name ? ' · ' + c.instructor_name : ''}`}
                      className={`absolute rounded-md border px-1.5 py-1 text-left overflow-hidden hover:brightness-110 transition ${colorFor(label)}`}
                      style={{
                        top,
                        height,
                        left: `calc(${(c._laneIndex || 0) * widthPct}% + 2px)`,
                        width: `calc(${widthPct}% - 4px)`,
                      }}
                    >
                      <div className="text-[10px] font-bold leading-tight tabular-nums">
                        {fmtTime12(c._parsed.hour, c._parsed.min)}
                      </div>
                      <div className="text-[11px] font-semibold leading-tight truncate">
                        {label}
                        {lenLabel && (
                          <span className="ml-1 align-middle px-1 py-px rounded bg-black/25 text-[8px] font-bold tabular-nums leading-none whitespace-nowrap">
                            {lenLabel}
                          </span>
                        )}
                      </div>
                      <div className="text-[10px] font-medium leading-tight truncate">
                        {c.instructor_name || 'Unassigned'}
                      </div>
                      {/* State reads at a glance: a logged class shows its
                          number, a past unlogged one shows an amber dot. */}
                      {c.headcount != null && (
                        <span className="absolute top-0.5 right-1 text-[10px] font-bold tabular-nums bg-black/25 rounded px-1">
                          {c.headcount}
                        </span>
                      )}
                      {c.is_new && (
                        <span className="inline-block mt-0.5 px-1 py-px rounded bg-wcs-red text-white text-[8px] font-bold uppercase tracking-wide leading-none">
                          New
                        </span>
                      )}
                      {c.needs_attendance && (
                        <span
                          className="absolute top-1 right-1 w-2 h-2 rounded-full bg-amber-300 ring-1 ring-black/30"
                          title="Needs an attendance count"
                        />
                      )}
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
