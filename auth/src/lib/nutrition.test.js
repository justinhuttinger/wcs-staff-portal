const test = require('node:test')
const assert = require('node:assert/strict')

const {
  caloriesFrom, normaliseMeal, normaliseTarget, targetOn,
  totalsFor, remainingFor, recentMeals, MIN_CALORIES,
} = require('./nutrition')

test('calories are derived from macros when they are left out', () => {
  const { value } = normaliseMeal({ protein_g: 40, carbs_g: 50, fat_g: 10 })
  assert.equal(value.calories, 40 * 4 + 50 * 4 + 10 * 9)
})

test('typed calories win over the macro arithmetic', () => {
  // The member read a label. Arguing with it would be the app pretending to
  // know their lunch better than the packet does.
  const { value } = normaliseMeal({ calories: 500, protein_g: 40, carbs_g: 50, fat_g: 10 })
  assert.equal(value.calories, 500)
})

test('a meal with nothing in it is refused', () => {
  assert.ok(normaliseMeal({}).error)
})

test('a meal can be calories alone', () => {
  const { value } = normaliseMeal({ calories: 620 })
  assert.equal(value.calories, 620)
  assert.equal(value.protein_g, null)
})

test('negative and nonsense numbers are refused', () => {
  assert.ok(normaliseMeal({ calories: -10 }).error)
  assert.ok(normaliseMeal({ calories: 'lots' }).error)
})

test('an absurd single meal is refused', () => {
  assert.ok(normaliseMeal({ calories: 90000 }).error)
})

test('an unknown slot is refused but no slot is fine', () => {
  assert.ok(normaliseMeal({ calories: 400, slot: 'brunch' }).error)
  assert.equal(normaliseMeal({ calories: 400, slot: '' }).value.slot, null)
})

test('a target can be protein alone', () => {
  const { value } = normaliseTarget({ protein_g: 160 })
  assert.equal(value.protein_g, 160)
  assert.equal(value.calories, null)
})

test('an empty target is refused', () => {
  assert.ok(normaliseTarget({}).error)
})

test('a starvation calorie goal is refused, coach or not', () => {
  // A floor nobody can set past, including a trainer, and the place a dropped
  // digit gets caught.
  assert.ok(normaliseTarget({ calories: MIN_CALORIES - 1 }).error)
  assert.ok(normaliseTarget({ calories: 240 }).error)
  assert.ok(!normaliseTarget({ calories: MIN_CALORIES }).error)
})

test('a day is measured against the target in force that day', () => {
  const targets = [
    { effective_from: '2026-09-01', calories: 2400 },
    { effective_from: '2026-10-01', calories: 2100 },
  ]
  // Not the newest row: the newest row that had started.
  assert.equal(targetOn(targets, '2026-09-15').calories, 2400)
  assert.equal(targetOn(targets, '2026-10-05').calories, 2100)
  assert.equal(targetOn(targets, '2026-10-01').calories, 2100)
})

test('a day before any target existed has none', () => {
  assert.equal(targetOn([{ effective_from: '2026-09-01' }], '2026-08-30'), null)
  assert.equal(targetOn([], '2026-09-01'), null)
})

test('totals add the meals up and ignore blanks', () => {
  const totals = totalsFor([
    { calories: 500, protein_g: 40, carbs_g: null, fat_g: 12 },
    { calories: 320, protein_g: 12, carbs_g: 40, fat_g: null },
  ])
  assert.deepEqual(totals, { calories: 820, protein_g: 52, carbs_g: 40, fat_g: 12 })
})

test('remaining goes negative when they go over', () => {
  const remaining = remainingFor(
    { calories: 2610, protein_g: 180, carbs_g: 200, fat_g: 70 },
    { calories: 2400, protein_g: 160, carbs_g: null, fat_g: 80 },
  )
  assert.equal(remaining.calories, -210)
  assert.equal(remaining.protein_g, -20)
  // No goal set for carbs means no number to be over or under.
  assert.equal(remaining.carbs_g, null)
  assert.equal(remaining.fat_g, 10)
})

test('there is nothing remaining when nothing was set', () => {
  assert.equal(remainingFor({ calories: 500 }, null), null)
})

test('recents are deduped on name, newest first', () => {
  const out = recentMeals([
    { name: 'Chicken bowl', calories: 700 },
    { name: 'chicken bowl', calories: 690 },
    { name: 'Oats', calories: 400 },
    { name: '  ', calories: 100 },
    { name: null, calories: 100 },
  ])
  assert.deepEqual(out.map(m => m.name), ['Chicken bowl', 'Oats'])
  assert.equal(out[0].calories, 700)
})

test('recents stop at the limit', () => {
  const many = Array.from({ length: 30 }, (_, i) => ({ name: `Meal ${i}`, calories: 100 }))
  assert.equal(recentMeals(many).length, 12)
  assert.equal(recentMeals(many, 3).length, 3)
})

test('caloriesFrom is null when there is nothing to work from', () => {
  assert.equal(caloriesFrom({ protein_g: null, carbs_g: null, fat_g: null }), null)
})
