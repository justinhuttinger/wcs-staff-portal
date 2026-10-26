const { test } = require('node:test')
const assert = require('node:assert')
const { parsePhone, parseAge, parseCheckin, parseCheckout } = require('./childcareCheckin')

const base = {
  parent_first_name: '  Sam ',
  parent_last_name: 'Rivera',
  parent_phone: '503.555.1234',
  membership_kind: 'drop_in',
  children: [{ first_name: 'Ava', last_name: 'Rivera', age: '4', age_unit: 'years' }],
}

test('parsePhone formats 10 digits and strips a leading 1', () => {
  assert.deepStrictEqual(parsePhone('5035551234'), { phone: '(503) 555-1234' })
  assert.deepStrictEqual(parsePhone('+1 (503) 555-1234'), { phone: '(503) 555-1234' })
  for (const v of ['', null, '555-1234', '25035551234']) assert.ok(parsePhone(v).error)
})

test('parseAge converts years to months and keeps months', () => {
  assert.deepStrictEqual(parseAge('3', 'years'), { months: 36 })
  assert.deepStrictEqual(parseAge(8, 'months'), { months: 8 })
  assert.deepStrictEqual(parseAge('0', 'months'), { months: 0 })
  assert.ok(parseAge('19', 'years').error)
  assert.ok(parseAge('2.5', 'years').error)
  assert.ok(parseAge('3', 'weeks').error)
})

test('parseCheckin builds one row per child with typed parent details', () => {
  const r = parseCheckin({
    ...base,
    children: [
      { first_name: 'Ava', last_name: 'Rivera', age: '4', age_unit: 'years' },
      { first_name: 'Leo', last_name: 'Rivera', age: '10', age_unit: 'months' },
    ],
  }, 30935)
  assert.strictEqual(r.rows.length, 2)
  assert.deepStrictEqual(r.rows[0], {
    club_number: '30935',
    child_first_name: 'Ava',
    child_last_name: 'Rivera',
    child_age_months: 48,
    parent_first_name: 'Sam',
    parent_last_name: 'Rivera',
    parent_phone: '(503) 555-1234',
    membership_kind: 'drop_in',
    alt_pickup_name: null,
  })
  assert.strictEqual(r.rows[1].child_age_months, 10)
})

test('parseCheckin requires a name when someone else may pick up', () => {
  assert.match(parseCheckin({ ...base, alt_pickup: true }, 1).error, /picking up/)
  const r = parseCheckin({ ...base, alt_pickup: true, alt_pickup_name: 'Grandma Jo' }, 1)
  assert.strictEqual(r.rows[0].alt_pickup_name, 'Grandma Jo')
  // An unticked box ignores a leftover name.
  assert.strictEqual(parseCheckin({ ...base, alt_pickup: false, alt_pickup_name: 'X' }, 1).rows[0].alt_pickup_name, null)
})

test('parseCheckin rejects missing pieces', () => {
  assert.ok(parseCheckin({ ...base, parent_first_name: ' ' }, 1).error)
  assert.match(parseCheckin({ ...base, parent_last_name: '' }, 1).error, /last name/)
  assert.match(parseCheckin({ ...base, children: [{ first_name: 'Ava', age: 2, age_unit: 'years' }] }, 1).error, /last name/)
  assert.ok(parseCheckin({ ...base, membership_kind: 'pif' }, 1).error)
  assert.ok(parseCheckin({ ...base, children: [] }, 1).error)
  assert.match(parseCheckin({ ...base, children: [base.children[0], { first_name: '', last_name: 'X', age: 2, age_unit: 'years' }] }, 1).error, /Child 2/)
})

test('parseCheckout fills the name from the visit for parent and approved pickup', () => {
  const visit = { parent_first_name: 'Sam', parent_last_name: 'Rivera', alt_pickup_name: 'Grandma Jo' }
  assert.deepStrictEqual(parseCheckout({ picked_up_by: 'same_parent' }, visit).update,
    { checked_out_by: 'same_parent', checked_out_by_name: 'Sam Rivera' })
  assert.deepStrictEqual(parseCheckout({ picked_up_by: 'approved_alternate', name: 'ignored' }, visit).update,
    { checked_out_by: 'approved_alternate', checked_out_by_name: 'Grandma Jo' })
  assert.deepStrictEqual(parseCheckout({ picked_up_by: 'other', name: ' Uncle  Ray ' }, visit).update,
    { checked_out_by: 'other', checked_out_by_name: 'Uncle Ray' })
})

test('parseCheckout refuses an approved pickup nobody approved, and a nameless other', () => {
  assert.ok(parseCheckout({ picked_up_by: 'approved_alternate' }, { parent_first_name: 'A', parent_last_name: 'B', alt_pickup_name: null }).error)
  assert.ok(parseCheckout({ picked_up_by: 'other', name: '' }, { parent_first_name: 'A', parent_last_name: 'B' }).error)
  assert.ok(parseCheckout({}, { parent_first_name: 'A', parent_last_name: 'B' }).error)
})
