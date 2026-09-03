// Shape and rules for member-app daily habits. Pure on purpose so the route
// stays about Supabase and this stays testable.
//
// The member app has its own copy of the presets in worker/habits.js; they are
// two deployments talking to one table, so the tests below pin the shape that
// both sides rely on.

const HABIT_PRESETS = [
  { kind: 'water', label: 'Water', unit: 'oz', levels: [64, 80, 100, 128], target: 100 },
  { kind: 'sleep', label: 'Sleep', unit: 'hours', levels: [6, 7, 8, 9], target: 8 },
  { kind: 'steps', label: 'Steps', unit: 'steps', levels: [5000, 7500, 10000, 12500], target: 10000 },
]

// Enough to build a routine, few enough that the member's home screen stays a
// home screen.
const MAX_HABITS = 8
const ADHERENCE_DAYS = 30

const pacificDay = (d = new Date()) => d.toLocaleDateString('en-CA', { timeZone: 'America/Los_Angeles' })

function shiftDay(dayKey, days) {
  const d = new Date(`${dayKey}T12:00:00Z`)
  d.setUTCDate(d.getUTCDate() + days)
  return d.toISOString().slice(0, 10)
}

const clean = (v, max) => (v == null ? null : String(v).trim().slice(0, max) || null)

// A preset owns its label and unit so every member's tiles read the same; only
// the level is chosen. A custom habit is whatever was typed.
function normaliseHabit(input, existing) {
  const kind = String(input.kind || existing?.kind || 'custom')
  const preset = HABIT_PRESETS.find(p => p.kind === kind)

  if (preset) {
    const target = Number(input.target ?? existing?.target ?? preset.target)
    if (!Number.isFinite(target) || target <= 0) return { error: 'Pick a level for this habit' }
    return { value: { kind, label: preset.label, unit: preset.unit, target } }
  }
  if (kind !== 'custom') return { error: 'Unknown habit kind' }

  const label = clean(input.label ?? existing?.label, 40)
  if (!label) return { error: 'Give the habit a name' }

  // A custom habit is often a plain yes/no ("no soda"), so a target is optional.
  const raw = input.target ?? existing?.target
  const target = raw === '' || raw == null ? null : Number(raw)
  if (target !== null && (!Number.isFinite(target) || target <= 0)) {
    return { error: 'That target is not a number' }
  }
  return { value: { kind: 'custom', label, unit: clean(input.unit ?? existing?.unit, 12), target } }
}

module.exports = { HABIT_PRESETS, MAX_HABITS, ADHERENCE_DAYS, pacificDay, shiftDay, normaliseHabit }
