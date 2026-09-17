const test = require('node:test')
const assert = require('node:assert')
const { shapePos, buildClubSnapshot } = require('./clubSnapshot')

const ROWS = [
  { profit_center: 'WCS Drinks', revenue: '27357.53' },
  { profit_center: 'WCS Snacks', revenue: '4739.46' },
  { profit_center: 'WCS Merchandise', revenue: '15309.50' },
  { profit_center: 'WCS Supplements', revenue: '18034.69' },
  { profit_center: 'TRAINING', revenue: '177269.43' },
  { profit_center: 'Guest Fees', revenue: '15492.13' },
  { profit_center: 'REFUNDS', revenue: '-9224.19' },
]

test('POS income is the four retail centres only', () => {
  const p = shapePos(ROWS)
  assert.equal(p.posDrinks, 27357.53)
  assert.equal(p.posSnacks, 4739.46)
  assert.equal(p.posMerch, 15309.5)
  assert.equal(p.posSupps, 18034.69)
  assert.equal(p.posTotal, 65441.18)
})

test('missing centres are zero; unloaded rows are no data', () => {
  assert.equal(shapePos([{ profit_center: 'wcs drinks', revenue: 10 }]).posTotal, 10)
  assert.equal(shapePos([]).posSnacks, 0)
  assert.equal(shapePos(null), null)
})

test('snapshot carries POS stats with prior comparison', () => {
  const win = { window: {}, summary: {}, pt: {} }
  const built = buildClubSnapshot(win, win, [], { pos: ROWS, priorPos: [{ profit_center: 'WCS Drinks', revenue: 100 }] })
  const total = built.stats.find(s => s.key === 'posTotal')
  assert.equal(total.group, 'pos')
  assert.equal(total.value, 65441.18)
  assert.equal(total.prior, 100)
  assert.ok(built.statGroups.some(g => g.key === 'pos'))
  const none = buildClubSnapshot(win, win, [], {})
  assert.equal(none.stats.find(s => s.key === 'posDrinks').value, null)
})
