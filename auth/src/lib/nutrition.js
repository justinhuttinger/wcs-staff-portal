// Shape and rules for member-app diet tracking. Pure on purpose so the route
// stays about Supabase and this stays testable.
//
// The member app carries its own copy in worker/nutrition.js; they are two
// deployments writing one set of tables, so the tests pin what both rely on.

const SLOTS = ['breakfast', 'lunch', 'dinner', 'snack']
const MACROS = ['calories', 'protein_g', 'carbs_g', 'fat_g']

// Atwater factors: what a gram of each macro is worth in calories.
const KCAL_PER_G = { protein_g: 4, carbs_g: 4, fat_g: 9 }

// A floor under what anyone can set, coach included. Nobody needs to be told by
// an app to eat 600 calories, and a typo that drops a digit should bounce.
const MIN_CALORIES = 1000
const MAX_CALORIES = 8000
const MAX_GRAMS = 1500

const num = (v) => {
  if (v === '' || v == null) return null
  const n = Number(v)
  return Number.isFinite(n) ? n : NaN
}

// Calories can be left out and derived from the macros. When both are given and
// they disagree, what was typed wins: the member read a label, and arguing with
// it would be the app pretending to know better.
function caloriesFrom(macros) {
  const parts = Object.entries(KCAL_PER_G)
    .map(([key, per]) => (macros[key] == null ? null : macros[key] * per))
  if (parts.every(p => p === null)) return null
  return Math.round(parts.reduce((sum, p) => sum + (p ?? 0), 0))
}

function normaliseMeal(input) {
  const out = {}
  for (const key of MACROS) {
    const n = num(input[key])
    if (Number.isNaN(n)) return { error: 'Those numbers do not look right' }
    if (n !== null && n < 0) return { error: 'Numbers cannot be negative' }
    out[key] = n
  }

  if (out.calories === null) out.calories = caloriesFrom(out)
  if (out.calories === null) return { error: 'Enter calories, or the macros to work them out from' }
  if (out.calories > MAX_CALORIES) return { error: 'That is more than a day in one meal. Check the numbers' }
  for (const key of ['protein_g', 'carbs_g', 'fat_g']) {
    if (out[key] !== null && out[key] > MAX_GRAMS) return { error: 'Check the numbers on that one' }
  }

  const slot = input.slot == null || input.slot === '' ? null : String(input.slot)
  if (slot !== null && !SLOTS.includes(slot)) return { error: 'Unknown meal' }

  const name = input.name == null ? null : String(input.name).trim().slice(0, 80) || null
  return { value: { ...out, slot, name } }
}

// Targets are all optional: someone can track protein alone, or log meals for a
// week with no goals at all before anyone puts a number on them.
function normaliseTarget(input) {
  const out = {}
  for (const key of MACROS) {
    const n = num(input[key])
    if (Number.isNaN(n)) return { error: 'Those numbers do not look right' }
    if (n !== null && n <= 0) return { error: 'A goal has to be more than zero' }
    out[key] = n
  }
  if (out.calories !== null && out.calories < MIN_CALORIES) {
    return { error: `${MIN_CALORIES} calories is the lowest goal this app will set` }
  }
  if (out.calories !== null && out.calories > MAX_CALORIES) {
    return { error: 'That calorie goal is not realistic' }
  }
  if (MACROS.every(k => out[k] === null)) return { error: 'Set at least one goal' }
  return { value: out }
}

// The newest target whose effective_from has arrived. Rows are append-only, so
// a day in the past is measured against whatever was in force at the time.
function targetOn(targets, dayKey) {
  return (targets || [])
    .filter(t => t.effective_from <= dayKey)
    .sort((a, b) => String(b.effective_from).localeCompare(String(a.effective_from)))[0] ?? null
}

function totalsFor(meals) {
  const out = { calories: 0, protein_g: 0, carbs_g: 0, fat_g: 0 }
  for (const meal of meals || []) {
    for (const key of MACROS) out[key] += Number(meal[key] ?? 0)
  }
  for (const key of MACROS) out[key] = Math.round(out[key])
  return out
}

// Remaining goes negative rather than clamping: going over is allowed, and the
// member is owed a straight answer about by how much.
function remainingFor(totals, target) {
  if (!target) return null
  const out = {}
  for (const key of MACROS) {
    out[key] = target[key] == null ? null : Math.round(Number(target[key]) - totals[key])
  }
  return out
}

// Meals worth offering again: most people eat the same eight things, and
// re-adding one should be a tap. Deduped on name, newest first.
function recentMeals(meals, limit = 12) {
  const seen = new Set()
  const out = []
  for (const meal of meals || []) {
    const key = (meal.name || '').trim().toLowerCase()
    if (!key || seen.has(key)) continue
    seen.add(key)
    out.push({
      name: meal.name,
      slot: meal.slot,
      calories: meal.calories,
      protein_g: meal.protein_g,
      carbs_g: meal.carbs_g,
      fat_g: meal.fat_g,
    })
    if (out.length >= limit) break
  }
  return out
}

module.exports = {
  SLOTS, MACROS, KCAL_PER_G, MIN_CALORIES, MAX_CALORIES,
  caloriesFrom, normaliseMeal, normaliseTarget, targetOn, totalsFor, remainingFor, recentMeals,
}
