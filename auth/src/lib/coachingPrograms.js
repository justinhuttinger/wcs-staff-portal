// auth/src/lib/coachingPrograms.js
// Pure logic for Coaching programs and templates (one tree for both): clean a
// builder payload, work out the smallest set of row changes that turns what is
// stored into what was sent, label exercises the Kahunas way (A, B, A1/A2) and
// count volume per muscle. No I/O here; routes/coaching.js does the writing.
//
// Saving is a DIFF on purpose. Workout logs point at program items
// (memberapp_set_logs.program_item_id), so re-inserting the tree on every save
// would orphan a client's history each time their coach fixed a typo.

const SECTIONS = ['warmup', 'workout', 'cooldown']

const MAX_DAYS = 14
const MAX_ITEMS = 40
const MAX_TAGS = 12

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/

const text = (v, max) => (v == null ? null : String(v).trim().slice(0, max) || null)

function intIn(v, min, max, clamp) {
  if (v === '' || v === null || v === undefined) return null
  const n = Number(v)
  if (!Number.isFinite(n)) return null
  const i = Math.trunc(n)
  if (i < min) return clamp ? min : null
  if (i > max) return clamp ? max : null
  return i
}

function isoDate(v) {
  if (typeof v !== 'string' || !DATE_RE.test(v)) return null
  const d = new Date(`${v}T12:00:00Z`)
  return Number.isNaN(d.getTime()) || d.toISOString().slice(0, 10) !== v ? null : v
}

const keepId = (v) => (v == null || v === '' ? undefined : String(v))

function normaliseItem(raw, position) {
  const exerciseId = raw?.exercise_id == null ? '' : String(raw.exercise_id)
  if (!UUID_RE.test(exerciseId)) return null
  const item = {
    section: SECTIONS.includes(raw.section) ? raw.section : 'workout',
    position,
    superset_group: text(raw.superset_group, 4),
    exercise_id: exerciseId,
    sets: intIn(raw.sets, 0, 20, true),
    reps: text(raw.reps, 40),
    weight: text(raw.weight, 40),
    rir: text(raw.rir, 40),
    rest_seconds: intIn(raw.rest_seconds, 0, 3600, true),
    notes: text(raw.notes, 400),
  }
  const id = keepId(raw.id)
  return id ? { id, ...item } : item
}

/**
 * Clean a builder payload into { program, days[] }. Positions come from array
 * order, so the order the coach dragged things into is the order saved.
 * Items without a library exercise are dropped (a half-added row).
 */
function normaliseTree(body) {
  const b = body || {}
  const name = text(b.name, 120)
  if (!name) return { error: 'Give the program a name' }

  const startsOn = isoDate(b.starts_on)
  const endsOn = isoDate(b.ends_on)
  if (startsOn && endsOn && endsOn < startsOn) return { error: 'The end date is before the start date' }

  const tags = (Array.isArray(b.tags) ? b.tags : [])
    .map(t => text(t, 40))
    .filter(Boolean)
    .slice(0, MAX_TAGS)

  const program = {
    name,
    overview: text(b.overview, 2000),
    tags,
    goal: text(b.goal, 60),
    level: text(b.level, 60),
    equipment: text(b.equipment, 60),
    days_per_week: intIn(b.days_per_week, 1, 7, false),
    starts_on: startsOn,
    ends_on: endsOn,
  }

  const days = (Array.isArray(b.days) ? b.days : []).slice(0, MAX_DAYS).map((d, i) => {
    const items = []
    for (const raw of Array.isArray(d?.items) ? d.items : []) {
      if (items.length >= MAX_ITEMS) break
      const it = normaliseItem(raw, items.length)
      if (it) items.push(it)
    }
    const day = {
      position: i,
      // A blank day name is a coach mid-edit, not a reason to lose the save.
      name: text(d?.name, 80) || `Day ${i + 1}`,
      instructions: text(d?.instructions, 2000),
      items,
    }
    const id = keepId(d?.id)
    return id ? { id, ...day } : day
  })

  return { tree: { program, days } }
}

const dayRow = (d) => ({ position: d.position, name: d.name, instructions: d.instructions })

function itemRow(it) {
  const { id, ...row } = it
  return row
}

/**
 * The row changes that turn `stored` into `tree`.
 *
 * A day or item keeps its row only when its id is one of THIS program's stored
 * ids, and only once per save. Anything else (no id, an unknown id, another
 * program's id) is inserted fresh, so a payload can never reach into another
 * program's rows. Items under a newly inserted day carry `day_index` (the
 * day's position in `tree.days`) instead of `day_id`; the caller resolves it
 * after inserting the days.
 *
 * Apply in this order: insert days, update days, insert + update items,
 * delete items, delete days (so an item moving off a deleted day is moved
 * before its old day cascades).
 *
 * @param {{ days: { id: string, items: { id: string }[] }[] }} stored
 * @param {{ days: object[] }} tree  output of normaliseTree
 */
function planTreeDiff(stored, tree) {
  const storedDays = new Set()
  const storedItems = new Set()
  for (const d of stored?.days || []) {
    storedDays.add(String(d.id))
    for (const it of d.items || []) storedItems.add(String(it.id))
  }

  const plan = {
    days: { insert: [], update: [], delete: [] },
    items: { insert: [], update: [], delete: [] },
  }
  const keptDays = new Set()
  const keptItems = new Set()

  tree.days.forEach((day, dayIndex) => {
    const keep = day.id && storedDays.has(day.id) && !keptDays.has(day.id)
    let target
    if (keep) {
      keptDays.add(day.id)
      plan.days.update.push({ id: day.id, row: dayRow(day) })
      target = { day_id: day.id }
    } else {
      plan.days.insert.push({ day_index: dayIndex, row: dayRow(day) })
      target = { day_index: dayIndex }
    }

    for (const it of day.items) {
      const row = itemRow(it)
      if (it.id && storedItems.has(it.id) && !keptItems.has(it.id)) {
        keptItems.add(it.id)
        if (target.day_id) plan.items.update.push({ id: it.id, row: { ...row, day_id: target.day_id } })
        else plan.items.update.push({ id: it.id, day_index: dayIndex, row })
      } else if (target.day_id) {
        plan.items.insert.push({ day_id: target.day_id, row })
      } else {
        plan.items.insert.push({ day_index: dayIndex, row })
      }
    }
  })

  plan.days.delete = [...storedDays].filter(id => !keptDays.has(id))
  plan.items.delete = [...storedItems].filter(id => !keptItems.has(id))
  return plan
}

const LETTERS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'
const letter = (n) => (n < 26 ? LETTERS[n] : `${LETTERS[Math.floor(n / 26) - 1]}${LETTERS[n % 26]}`)

/**
 * Kahunas row labels, aligned to `items`: A, B, C… counted per section in
 * order; a run of neighbours in one section sharing a superset_group shares a
 * letter and is numbered (A1, A2). A "superset" of one is just a letter.
 */
function itemLabels(items) {
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

const lookup = (lib, id) => (lib instanceof Map ? lib.get(id) : lib?.[id])

/**
 * Kahunas "Total Volume Sets": each Workout-section set counts 1 to the
 * exercise's primary muscle and 0.5 to each secondary. Warm up and cool down
 * are not training volume.
 */
function volumeByMuscle(items, exercisesById) {
  const out = {}
  const add = (m, n) => { if (m && n) out[m] = (out[m] || 0) + n }
  for (const it of items || []) {
    if (it.section !== 'workout') continue
    const ex = lookup(exercisesById, it.exercise_id)
    if (!ex) continue
    const sets = Number(it.sets) || 0
    add(ex.primary_muscle, sets)
    for (const m of ex.secondary_muscles || []) add(m, sets * 0.5)
  }
  return out
}

/** Sum several days' volume into one program total. */
function mergeVolume(list) {
  const out = {}
  for (const v of list || []) {
    for (const [m, n] of Object.entries(v || {})) out[m] = (out[m] || 0) + n
  }
  return out
}

/** A deep copy with every id removed: duplicate, assign, save as template. */
function copyTree(tree) {
  return {
    program: { ...tree.program, tags: [...(tree.program?.tags || [])] },
    days: (tree.days || []).map(({ id, items, ...day }) => ({
      ...day,
      items: (items || []).map(({ id: _id, ...it }) => ({ ...it })),
    })),
  }
}

module.exports = {
  SECTIONS, MAX_DAYS, MAX_ITEMS, UUID_RE,
  normaliseTree, planTreeDiff, itemLabels, volumeByMuscle, mergeVolume, copyTree,
}
