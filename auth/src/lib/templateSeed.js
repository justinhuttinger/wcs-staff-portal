// auth/src/lib/templateSeed.js
// Pure helpers for scripts/seed-program-templates.js: place each template
// exercise name on a library row (memberapp_exercises), and turn a seed
// template into the builder's tree shape. No I/O.

const { MUSCLES, nameKey } = require('./exerciseLibrary')

/**
 * Resolve template exercise names to library ids.
 *
 *   1. nameKey(alias || name) equals a library row's name_key -> that row
 *      (an alias is how a free-exercise-db spelling is pointed at).
 *   2. no alias and nameKey(name) matches nothing -> a custom exercise from
 *      `customs` (primary muscle required, from the library vocabulary).
 *   3. anything else is listed in `missing` so the script can stop.
 *
 * A custom created on an earlier run already has a row with its name_key, so
 * step 1 finds it and re-running creates nothing twice.
 *
 * @returns {{ byName: Map<string,string>, create: object[], missing: string[] }}
 */
function resolveExercises(names, library, { aliases = {}, customs = {} } = {}) {
  const byKey = new Map()
  // Prefer a vendor row over a custom one when both share a key.
  const rank = { ymove: 0, free: 1, custom: 2 }
  for (const row of library || []) {
    const held = byKey.get(row.name_key)
    if (!held || (rank[row.source] ?? 3) < (rank[held.source] ?? 3)) byKey.set(row.name_key, row)
  }

  const byName = new Map()
  const create = []
  const missing = []
  for (const name of [...new Set(names)]) {
    const alias = aliases[name]
    const hit = byKey.get(nameKey(alias || name))
    if (hit) { byName.set(name, hit.id); continue }
    if (alias) { missing.push(`${name}: alias "${alias}" is not in the library (seed the exercise library first)`); continue }
    const custom = customs[name]
    if (!custom || !MUSCLES.includes(custom.primary)) {
      missing.push(`${name}: no library match and no custom entry with a known primary muscle`)
      continue
    }
    create.push({
      source: 'custom',
      name,
      name_key: nameKey(name),
      primary_muscle: custom.primary,
      secondary_muscles: (custom.secondary || []).filter(m => MUSCLES.includes(m)),
      equipment: custom.equipment || null,
      created_by: 'seed',
    })
  }
  return { byName, create, missing }
}

/** A seed template -> the body POST /coaching/programs (normaliseTree) takes. */
function templateTree(t, idByName) {
  return {
    name: t.name,
    overview: t.description || null,
    tags: t.tags || [],
    goal: t.goal || null,
    level: t.level || null,
    days_per_week: t.days_per_week || null,
    equipment: t.equipment || null,
    days: t.days.map(d => ({
      name: d.name,
      instructions: d.instructions || null,
      // Warm-ups first, cool-downs last, whatever order the file lists them.
      items: ['warmup', 'workout', 'cooldown'].flatMap(section => d.ex
        .filter(ex => (ex.section || 'workout') === section)
        .map(ex => ({
          section,
          exercise_id: idByName.get(ex.name),
          sets: ex.sets === '' || ex.sets == null ? null : Number(ex.sets),
          reps: ex.reps || null,
          weight: ex.weight || null,
          rest_seconds: ex.rest_seconds ?? null,
          notes: ex.notes || null,
        }))),
    })),
  }
}

module.exports = { resolveExercises, templateTree }
