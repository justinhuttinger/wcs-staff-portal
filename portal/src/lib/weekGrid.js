// Week-grid and date helpers shared by the PT Scheduler and the Group X
// scheduler. Moved out of PtSchedulerView.jsx unchanged — PT Scheduler is in
// production and must behave identically.
//
// Note: startOfWeek is SUNDAY-anchored, matching the staff calendars. The
// public class board is Monday-anchored and deliberately does not use this.

// Calendar grid config
export const DAY_START_HOUR = 6           // 6 AM
export const DAY_END_HOUR = 22            // 10 PM
export const PX_PER_MINUTE = 1            // 1px = 1 minute → 30min slot = 30px
export const GRID_HEIGHT_PX = (DAY_END_HOUR - DAY_START_HOUR) * 60 * PX_PER_MINUTE
export const WEEKDAY_LABELS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
export const MONTH_LABELS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

// Sunday of the week containing `d` (local time)
export function startOfWeek(d) {
  const out = new Date(d)
  out.setHours(0, 0, 0, 0)
  out.setDate(out.getDate() - out.getDay())
  return out
}

export function addDays(d, n) {
  const out = new Date(d)
  out.setDate(out.getDate() + n)
  return out
}

export function toISODate(d) {
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const dd = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${dd}`
}

export function fmtHour(h) {
  const ampm = h >= 12 ? 'PM' : 'AM'
  const hh = h % 12 || 12
  return `${hh} ${ampm}`
}

export function fmtTime12(hour, min) {
  const ampm = hour >= 12 ? 'PM' : 'AM'
  const hh = hour % 12 || 12
  const mm = String(min).padStart(2, '0')
  return `${hh}:${mm} ${ampm}`
}

// "YYYY-MM-DD[T or space]HH:mm:ss" → { date: 'YYYY-MM-DD', hour, min }
// Cached rows from ghl-sync use 'T'; live ABC rows (via /abc-scheduler/events
// merge introduced in PR #130) come through with a space separator —
// accept either. Before this fix, every live event silently failed the
// parse and was dropped from the day buckets.
export function parseLocalTimestamp(ts) {
  if (!ts) return null
  const m = String(ts).match(/^(\d{4}-\d{2}-\d{2})[T ](\d{2}):(\d{2})/)
  if (!m) return null
  return { date: m[1], hour: parseInt(m[2], 10), min: parseInt(m[3], 10) }
}

// Assigns each event a horizontal lane so overlapping events sit side by side.
// Mutates the events: reads `_startMin`/`_endMin`, sets `_laneIndex`/`_laneCount`.
export function layoutLanes(events) {
  const sorted = events.slice().sort((a, b) => a._startMin - b._startMin)
  const lanes = [] // each lane is a list of events; lanes[i] holds the latest endMin

  for (const e of sorted) {
    let placed = false
    for (let i = 0; i < lanes.length; i++) {
      const last = lanes[i][lanes[i].length - 1]
      if (last._endMin <= e._startMin) {
        e._laneIndex = i
        lanes[i].push(e)
        placed = true
        break
      }
    }
    if (!placed) {
      e._laneIndex = lanes.length
      lanes.push([e])
    }
  }
  // Now compute laneCount per event — for overlap-group correctness, set
  // laneCount = max lanes occupied by any event in its overlap cluster.
  // Simple version: every event uses total lanes (slight horizontal waste
  // but no overlap mistakes).
  const totalLanes = Math.max(1, lanes.length)
  for (const e of sorted) e._laneCount = totalLanes
  return sorted
}

// ABC has no way to set a class length per class: duration is a property of the
// event type, so offering one class at two lengths means two event types. WCS
// names those "Butts and Guts - 30" / "Butts and Guts - 60".
//
// Staff picking a class to schedule need to see that suffix, so the create
// dropdown keeps the raw ABC name. Everywhere the class is merely displayed it
// is noise: the length is already shown as a pill next to it, and "Butts and
// Guts - 30  [30 min]" says the same thing twice.
//
// Deliberately narrow: only a trailing " - <number>" goes, and only when the
// number matches the class's own duration, so a real class called "Studio 60"
// or "Zone 2" is never truncated.
export function displayClassName(name, durationMinutes) {
  const raw = String(name || '')
  const m = raw.match(/^(.*\S)\s*-\s*(\d{1,3})$/)
  if (!m) return raw
  if (durationMinutes != null && Number(m[2]) !== Number(durationMinutes)) return raw
  return m[1]
}

// A pill is worth the space only when the length is not the usual 60 minutes.
// Returns null when there is nothing worth saying, so callers can render
// `{label && <span>{label}</span>}` without a length check of their own.
export function durationLabel(durationMinutes) {
  const mins = Number(durationMinutes)
  if (!Number.isFinite(mins) || mins <= 0 || mins === 60) return null
  return `${mins} min`
}
