const test = require('node:test')
const assert = require('node:assert')
const { buildCategoryRows, CATEGORY_ORDER } = require('./membershipByCategory')

const row = (category, over = {}) => ({
  category, members: 100, joined: 10, left_count: 4, net: 6, ...over,
})

test('rows come back in a fixed order, not in whatever order SQL returned', () => {
  const rows = buildCategoryRows(
    [row('Temp'), row('Dues'), row('Insurance')],
    [],
  )
  assert.deepStrictEqual(rows.map(r => r.category), ['Insurance', 'Dues', 'Temp'])
})

// Order is fixed on purpose: sorting by size would reshuffle the rows whenever
// a club's mix changed, and a reader comparing two clubs side by side would be
// comparing different rows in the same position.
test('a category with no members still gets its row', () => {
  const rows = buildCategoryRows([row('Dues')], [])
  assert.deepStrictEqual(rows.map(r => r.category), ['Insurance', 'Dues', 'Temp'])
  const insurance = rows.find(r => r.category === 'Insurance')
  assert.strictEqual(insurance.members, 0)
  assert.strictEqual(insurance.joined, 0)
})

test('prior-period figures are paired onto the row', () => {
  const rows = buildCategoryRows(
    [row('Dues', { members: 120, joined: 20, left_count: 5 })],
    [row('Dues', { members: 100, joined: 15, left_count: 8 })],
  )
  const dues = rows.find(r => r.category === 'Dues')
  assert.strictEqual(dues.members, 120)
  assert.strictEqual(dues.priorMembers, 100)
  assert.strictEqual(dues.priorJoined, 15)
  assert.strictEqual(dues.priorLeft, 8)
})

test('net is joined minus left, and keeps its sign', () => {
  const rows = buildCategoryRows([row('Temp', { joined: 38, left_count: 86 })], [])
  assert.strictEqual(rows.find(r => r.category === 'Temp').net, -48)
})

// Unmapped is the reconciliation remainder, not a category. It appears only
// when it would otherwise make the rows fail to add up, and vanishes for good
// once the types behind it are mapped in Admin.
test('Unmapped is hidden when it is empty', () => {
  const rows = buildCategoryRows([row('Dues'), row('Unmapped', { members: 0, joined: 0, left_count: 0, net: 0 })], [])
  assert.ok(!rows.some(r => r.category === 'Unmapped'))
})

test('Unmapped shows when it holds anybody', () => {
  const rows = buildCategoryRows([row('Dues'), row('Unmapped', { members: 4, joined: 0, left_count: 2, net: -2 })], [])
  const last = rows[rows.length - 1]
  assert.strictEqual(last.category, 'Unmapped')
  assert.strictEqual(last.members, 4)
})

test('Unmapped shows when it had movement but no members left in it', () => {
  const rows = buildCategoryRows([row('Unmapped', { members: 0, joined: 0, left_count: 3, net: -3 })], [])
  assert.ok(rows.some(r => r.category === 'Unmapped'))
})

test('empty input yields the three categories at zero, and no Unmapped', () => {
  const rows = buildCategoryRows([], [])
  assert.deepStrictEqual(rows.map(r => r.category), CATEGORY_ORDER)
  assert.ok(rows.every(r => r.members === 0 && r.joined === 0 && r.left === 0))
})

test('null input does not throw', () => {
  assert.strictEqual(buildCategoryRows(null, null).length, 3)
})

// The whole promise of the breakdown: it adds up to the block it sits under.
test('the rows sum to the club totals they are broken out of', () => {
  const rows = buildCategoryRows([
    row('Dues', { members: 12887, joined: 514, left_count: 481 }),
    row('Insurance', { members: 3249, joined: 45, left_count: 54 }),
    row('Temp', { members: 278, joined: 38, left_count: 86 }),
    row('Unmapped', { members: 4, joined: 0, left_count: 2 }),
  ], [])
  const sum = (k) => rows.reduce((t, r) => t + r[k], 0)
  assert.strictEqual(sum('members'), 16418)
  assert.strictEqual(sum('joined'), 597)
  assert.strictEqual(sum('left'), 623)
})
