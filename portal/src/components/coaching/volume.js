// Client-side twins of auth/src/lib/coachingPrograms.js, so the builder can
// relabel rows and recount volume on every keystroke without a round trip.
// Keep the rules identical to the server's.

// The server refuses a save past these (auth/src/lib/coachingPrograms.js).
export const MAX_DAYS = 14
export const MAX_ITEMS = 40

export const SECTIONS = [
  { key: 'warmup', label: 'Warm up' },
  { key: 'workout', label: 'Workout' },
  { key: 'cooldown', label: 'Cool down' },
]

const LETTERS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'
const letter = (n) => (n < 26 ? LETTERS[n] : `${LETTERS[Math.floor(n / 26) - 1]}${LETTERS[n % 26]}`)

/**
 * Kahunas row labels aligned to `items`: A, B, C… per section in order; a run
 * of neighbours in one section sharing a superset_group shares a letter and
 * is numbered (A1, A2).
 */
export function itemLabels(items) {
  const list = items || []
  const labels = new Array(list.length)
  const counters = {}
  let i = 0
  while (i < list.length) {
    const section = list[i].section || 'workout'
    const group = list[i].superset_group || null
    let j = i + 1
    if (group) {
      while (j < list.length && (list[j].section || 'workout') === section && list[j].superset_group === group) j++
    }
    const n = counters[section] || 0
    counters[section] = n + 1
    const base = letter(n)
    if (j - i === 1) labels[i] = base
    else for (let k = i; k < j; k++) labels[k] = `${base}${k - i + 1}`
    i = j
  }
  return labels
}

/**
 * Kahunas "Total Volume Sets": each Workout-section set counts 1 to the
 * exercise's primary muscle and 0.5 to each secondary. Items carry their
 * exercise summary as `item.exercise`.
 */
export function volumeByMuscle(items) {
  const out = {}
  const add = (m, n) => { if (m && n) out[m] = (out[m] || 0) + n }
  for (const it of items || []) {
    if (it.section !== 'workout' || !it.exercise) continue
    const sets = Number(it.sets) || 0
    add(it.exercise.primary_muscle, sets)
    for (const m of it.exercise.secondary_muscles || []) add(m, sets * 0.5)
  }
  return out
}

export function mergeVolume(list) {
  const out = {}
  for (const v of list || []) {
    for (const [m, n] of Object.entries(v || {})) out[m] = (out[m] || 0) + n
  }
  return out
}

/** [{ muscle, sets }] biggest first, for the chip strip. */
export function volumeChips(volume) {
  return Object.entries(volume || {})
    .map(([muscle, sets]) => ({ muscle, sets }))
    .sort((a, b) => b.sets - a.sets || a.muscle.localeCompare(b.muscle))
}

export const titleCase = (s) => String(s || '').replace(/\b\w/g, c => c.toUpperCase())

export const formatSets = (n) => (Number.isInteger(n) ? String(n) : n.toFixed(1))

/** 90 -> "1:30", 45 -> "0:45", null -> "". */
export function formatRest(seconds) {
  if (seconds === null || seconds === undefined || seconds === '') return ''
  const s = Math.max(0, Math.trunc(Number(seconds)))
  if (!Number.isFinite(s)) return ''
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`
}

/** "1:30" -> 90, "90" -> 90, "2m" -> 120, "" -> null. Clamped to an hour. */
export function parseRest(text) {
  const t = String(text ?? '').trim().toLowerCase()
  if (!t) return null
  let seconds
  const clock = t.match(/^(\d+):(\d{1,2})$/)
  if (clock) seconds = Number(clock[1]) * 60 + Number(clock[2])
  else if (/^\d+(\.\d+)?\s*m(in)?$/.test(t)) seconds = Math.round(parseFloat(t) * 60)
  else if (/^\d+\s*s?(ec)?$/.test(t)) seconds = parseInt(t, 10)
  else return null
  return Math.min(3600, Math.max(0, seconds))
}

const pacificToday = () => new Intl.DateTimeFormat('en-CA', {
  timeZone: 'America/Los_Angeles', year: 'numeric', month: '2-digit', day: '2-digit',
}).format(new Date())

export { pacificToday }

/**
 * Where a client program sits: 'scheduled' (future start), 'current',
 * 'ended' (past end) or 'archived'. A future start is never current.
 */
export function programStatus(p, today = pacificToday()) {
  if (!p.is_active) return 'archived'
  if (p.ends_on && p.ends_on < today) return 'ended'
  if (p.starts_on && p.starts_on > today) return 'scheduled'
  return 'current'
}
