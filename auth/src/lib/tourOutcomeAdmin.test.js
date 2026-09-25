const test = require('node:test')
const assert = require('node:assert')
const { validateOutcome, passModeOf } = require('./tourOutcomeAdmin')

const CLUBS = ['clackamas', 'milwaukie', 'salem']

test('the three pass modes map onto the two columns the kiosk reads', () => {
  const none = validateOutcome({ outcome: 'Guest', pass_mode: 'none', location_slugs: null }, CLUBS, true)
  assert.deepStrictEqual(none.errors, [])
  assert.strictEqual(none.row.grants_pass, false)
  assert.strictEqual(none.row.default_pass_days, null)

  const fixed = validateOutcome({ outcome: 'Punch', pass_mode: 'fixed', pass_days: '30', location_slugs: null }, CLUBS, true)
  assert.deepStrictEqual(fixed.errors, [])
  assert.strictEqual(fixed.row.grants_pass, true)
  assert.strictEqual(fixed.row.default_pass_days, 30)

  const choose = validateOutcome({ outcome: 'Custom', pass_mode: 'choose', location_slugs: null }, CLUBS, true)
  assert.strictEqual(choose.row.grants_pass, true)
  assert.strictEqual(choose.row.default_pass_days, null)

  for (const r of [none.row, fixed.row, choose.row]) {
    const again = validateOutcome({ pass_mode: passModeOf(r), pass_days: r.default_pass_days, location_slugs: null }, CLUBS, false)
    assert.strictEqual(again.row.grants_pass, r.grants_pass)
    assert.strictEqual(again.row.default_pass_days, r.default_pass_days)
  }
})

test('a fixed pass must be 1 to 90 whole days', () => {
  for (const d of [0, 91, 2.5, '', 'abc']) {
    const { errors } = validateOutcome({ outcome: 'X', pass_mode: 'fixed', pass_days: d, location_slugs: null }, CLUBS, true)
    assert.strictEqual(errors.length, 1, String(d))
  }
})

test('clubs: null is every club, an empty list is refused, unknown clubs are refused', () => {
  assert.strictEqual(validateOutcome({ outcome: 'X', pass_mode: 'none', location_slugs: null }, CLUBS, true).row.location_slugs, null)
  assert.strictEqual(validateOutcome({ outcome: 'X', pass_mode: 'none', location_slugs: [] }, CLUBS, true).errors.length, 1)
  assert.strictEqual(validateOutcome({ outcome: 'X', pass_mode: 'none', location_slugs: ['Nowhere'] }, CLUBS, true).errors.length, 1)
  assert.deepStrictEqual(
    validateOutcome({ outcome: 'X', pass_mode: 'none', location_slugs: [' Salem', 'clackamas', 'salem'] }, CLUBS, true).row.location_slugs,
    ['clackamas', 'salem'],
  )
})

test('a new outcome needs a name; an edit never touches it', () => {
  assert.ok(validateOutcome({ outcome: '  ', pass_mode: 'none', location_slugs: null }, CLUBS, true).errors.length)
  assert.strictEqual(validateOutcome({ outcome: '  Guest   Pass ', pass_mode: 'none', location_slugs: null }, CLUBS, true).row.outcome, 'Guest Pass')
  assert.ok(!('outcome' in validateOutcome({ outcome: 'Renamed', pass_mode: 'none', location_slugs: null }, CLUBS, false).row))
})

test('counts as a tour by default, and never touches is_sale', () => {
  const { row } = validateOutcome({ outcome: 'X', pass_mode: 'none', location_slugs: null, is_sale: true }, CLUBS, true)
  assert.strictEqual(row.counts_as_tour, true)
  assert.ok(!('is_sale' in row))
})
