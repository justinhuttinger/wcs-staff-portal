// auth/src/lib/exerciseLibrary.js
// Pure mapping for the Coaching exercise library (memberapp_exercises): turn a
// vendor's exercise into a library row, and work out which incoming rows
// update, link onto, or add to what is already stored. No I/O here; the sync
// service and the seed script do the reading and writing.

// free-exercise-db's muscle vocabulary. It is the canonical list until YMove's
// values are mapped onto it; volume-per-muscle counts on these names.
const MUSCLES = [
  'abdominals', 'abductors', 'adductors', 'biceps', 'calves', 'chest', 'forearms',
  'glutes', 'hamstrings', 'lats', 'lower back', 'middle back', 'neck', 'quadriceps',
  'shoulders', 'traps', 'triceps',
]

const FREE_DB_REPO = 'yuhonas/free-exercise-db'

const ABBREVIATIONS = { db: 'dumbbell', bb: 'barbell', kb: 'kettlebell' }

/**
 * Normalise an exercise name so the same movement from two vendors compares
 * equal: "DB Bench Press" and "Dumbbell bench press", "E-Z Curl Bar Curls" and
 * "ez bar curl". Deliberately conservative; a near-miss just stays two rows.
 */
function nameKey(name) {
  let s = String(name || '').toLowerCase().replace(/&/g, ' and ')
  s = s.replace(/[^a-z0-9]+/g, ' ').trim()
  const words = s.split(' ').filter(Boolean).map(w => ABBREVIATIONS[w] || w)
  s = words.join(' ')
    .replace(/\be z\b/g, 'ez')
    .replace(/\bez curl bar\b/g, 'ez bar')
  const parts = s.split(' ')
  const last = parts[parts.length - 1]
  if (last && last.length > 3 && last.endsWith('s') && !last.endsWith('ss')) {
    parts[parts.length - 1] = last.slice(0, -1)
  }
  return parts.join(' ')
}

const lower = (v) => (v == null ? null : String(v).trim().toLowerCase() || null)
const lowerList = (list) => (Array.isArray(list) ? list.map(lower).filter(Boolean) : [])
const textList = (list) => (Array.isArray(list) ? list.map(String).filter(Boolean) : [])

/** A free-exercise-db row (dist/exercises.json) as a library row. */
function fromFreeDb(row, sha) {
  const primaries = lowerList(row.primaryMuscles)
  const image = Array.isArray(row.images) && row.images[0]
  return {
    source: 'free',
    source_id: row.id,
    slug: row.id,
    name: row.name,
    name_key: nameKey(row.name),
    primary_muscle: primaries[0] || null,
    secondary_muscles: [...primaries.slice(1), ...lowerList(row.secondaryMuscles)],
    equipment: lower(row.equipment),
    category: lower(row.category),
    difficulty: lower(row.level),
    instructions: textList(row.instructions),
    cues: [],
    thumbnail_url: image ? `https://cdn.jsdelivr.net/gh/${FREE_DB_REPO}@${sha}/exercises/${image}` : null,
    has_video: false,
  }
}

/** A YMove /exercises item (fetched with excludeVideos=1) as a library row. */
function fromYmove(ex) {
  return {
    source: 'ymove',
    source_id: ex.id,
    slug: ex.slug || null,
    name: ex.title,
    name_key: nameKey(ex.title),
    primary_muscle: lower(ex.muscleGroup),
    secondary_muscles: lowerList(ex.secondaryMuscles),
    equipment: lower(ex.equipment),
    category: lower(ex.category),
    difficulty: lower(ex.difficulty),
    instructions: textList(ex.instructions),
    cues: textList(ex.importantPoints),
    thumbnail_url: ex.thumbnailUrl || null,
    has_video: !!ex.hasVideo,
  }
}

// A vendor that sends no thumbnail must not wipe the image a row already has.
const keepImage = (row, stored) =>
  (row.thumbnail_url || !stored.thumbnail_url ? row : { ...row, thumbnail_url: stored.thumbnail_url })

/**
 * Decide what each incoming row does against what is stored.
 *
 *   - Same (source, source_id) already stored -> update that row.
 *   - A YMove row whose name_key matches an unlinked 'free' row -> link onto
 *     it (update keeps the id, so programs and logs that use it are untouched).
 *     One-to-one: a free row is linked at most once per run.
 *   - A free row whose name_key already belongs to a YMove row -> skip. That
 *     row was a free row YMove linked onto; re-seeding must not bring it back.
 *   - Otherwise insert. Custom rows are never matched or touched.
 *
 * @param {{id, source, source_id, name_key}[]} existing
 * @param {object[]} incoming library rows from fromFreeDb / fromYmove
 * @returns {{ updates: {id, row}[], inserts: object[], skipped: number }}
 */
function planUpsert(existing, rawIncoming) {
  // One plan per (source, source_id): paging can repeat an item, and two
  // writes of one key would trip the unique index. The last copy wins.
  const latest = new Map()
  for (const row of rawIncoming) latest.set(`${row.source}:${row.source_id}`, row)
  const incoming = [...latest.values()]

  const bySource = new Map()
  const freeByKey = new Map()
  const ymoveKeys = new Set()
  for (const r of existing) {
    if (r.source_id != null) bySource.set(`${r.source}:${r.source_id}`, r)
    if (r.source === 'free' && !freeByKey.has(r.name_key)) freeByKey.set(r.name_key, r)
    if (r.source === 'ymove') ymoveKeys.add(r.name_key)
  }

  const updates = []
  const inserts = []
  let skipped = 0
  const linked = new Set()

  for (const row of incoming) {
    const same = bySource.get(`${row.source}:${row.source_id}`)
    if (same) {
      updates.push({ id: same.id, row: keepImage(row, same) })
      continue
    }
    if (row.source === 'ymove') {
      const free = freeByKey.get(row.name_key)
      if (free && !linked.has(free.id)) {
        linked.add(free.id)
        updates.push({ id: free.id, row: keepImage(row, free) })
        continue
      }
    }
    if (row.source === 'free' && ymoveKeys.has(row.name_key)) {
      skipped += 1
      continue
    }
    inserts.push(row)
  }

  return { updates, inserts, skipped }
}

module.exports = { MUSCLES, FREE_DB_REPO, nameKey, fromFreeDb, fromYmove, planUpsert }
