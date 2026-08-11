// auth/src/lib/tillCountParse.test.js
const { test } = require('node:test')
const assert = require('node:assert')
const fs = require('node:fs')
const path = require('node:path')
const { classifyTillCount, denominationValue } = require('./tillCountParse')

const openHtml = fs.readFileSync(path.join(__dirname, '__fixtures__/till-open-count.html'), 'utf8')
const closeHtml = fs.readFileSync(path.join(__dirname, '__fixtures__/till-close-count.html'), 'utf8')

// --- denominationValue ---------------------------------------------------
test('denominationValue maps bill rows by $amount', () => {
  assert.equal(denominationValue('# of $100s'), 100)
  assert.equal(denominationValue('# of $20s'), 20)
  assert.equal(denominationValue('# of $1s'), 1)
  assert.equal(denominationValue('Number of $20 Bills'), 20)
})
test('denominationValue maps coin rows by (Nc)', () => {
  assert.equal(denominationValue('# of Quarters (25c)'), 0.25)
  assert.equal(denominationValue('# of Dimes (10c)'), 0.10)
  assert.equal(denominationValue('# of Nickles (5c)'), 0.05)
  assert.equal(denominationValue('# of Pennies (1c)'), 0.01)
})
test('denominationValue falls back to coin words', () => {
  assert.equal(denominationValue('Quarters'), 0.25)
  assert.equal(denominationValue('Nickels'), 0.05)
  assert.equal(denominationValue('Pennies'), 0.01)
})
test('denominationValue returns null for non-denomination rows', () => {
  assert.equal(denominationValue('Did you sweep the floor?'), null)
  assert.equal(denominationValue(''), null)
  assert.equal(denominationValue(null), null)
})

// --- classifyTillCount ---------------------------------------------------
test('parses an open drawer count as a denomination-weighted total', () => {
  const out = classifyTillCount({
    subject: 'Drawer Open Count (Jun 29) submitted at Salem',
    html: openHtml, receivedAt: '2026-06-29T23:30:00Z',
  })
  assert.equal(out.location_slug, 'salem')
  assert.equal(out.count_type, 'open')
  // 100*1 + 50*2 + 20*5 + 10*2 + 5*3 + 1*10 + .25*8 + .10*5 + .05*4 + .01*7
  assert.equal(out.counted_amount, 347.77)
  assert.equal(out.business_date, '2026-06-29')
  assert.equal(out.employee_name, 'Justin Huttinger')
  assert.equal(out.denominations['100'], 1)
  assert.equal(out.denominations['0.25'], 8)
})
test('parses a close drawer count', () => {
  const out = classifyTillCount({
    subject: 'Drawer Close Count (Jun 29) submitted at Salem',
    html: closeHtml, receivedAt: '2026-06-29T23:30:00Z',
  })
  assert.equal(out.count_type, 'close')
  // 100*1 + 50*1 + 20*3 + 10*4 + 5*5 + 1*20 + .25*10 + .10*10 + .05*10 + .01*10
  assert.equal(out.counted_amount, 299.10)
})
test('parses "Opening"/"Closing Drawer Count" naming (word order variant)', () => {
  const open = classifyTillCount({
    subject: 'Opening Drawer Count (Jun 29) submitted at Salem',
    html: openHtml, receivedAt: '2026-06-29T23:30:00Z',
  })
  assert.equal(open.count_type, 'open')
  const close = classifyTillCount({
    subject: 'Closing Drawer Count (Jun 29) submitted at Salem',
    html: closeHtml, receivedAt: '2026-06-29T23:30:00Z',
  })
  assert.equal(close.count_type, 'close')
})
test('non-drawer submission is ignored', () => {
  assert.equal(classifyTillCount({ subject: 'Front Desk Open submitted at Salem', html: openHtml }), null)
})
test('a drawer count with no parsable denomination rows is ignored', () => {
  assert.equal(classifyTillCount({
    subject: 'Drawer Open Count (Jun 29) submitted at Salem',
    html: '<div></div>',
  }), null)
})
test('unknown subject returns null', () => {
  assert.equal(classifyTillCount({ subject: 'garbage', html: openHtml }), null)
})
