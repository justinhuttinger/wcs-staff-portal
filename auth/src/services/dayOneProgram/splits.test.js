const test = require('node:test')
const assert = require('node:assert')
const { resolveDayFocuses } = require('./splits')

test('3 days defaults to push/pull/legs', () => {
  const r = resolveDayFocuses({ daysPerWeek: '3' })
  assert.deepEqual(r.map(d => d.day), [1, 2, 3])
  assert.deepEqual(r.map(d => d.focus), ['Push', 'Pull', 'Legs'])
})

test('4 days defaults to upper/lower split', () => {
  const r = resolveDayFocuses({ daysPerWeek: '4' })
  assert.deepEqual(r.map(d => d.focus), ['Upper Body', 'Lower Body', 'Upper Body', 'Lower Body'])
})

test('trainer day focus overrides the default for that day', () => {
  const r = resolveDayFocuses({ daysPerWeek: '3', day2Focus: 'Conditioning' })
  assert.deepEqual(r.map(d => d.focus), ['Push', 'Conditioning', 'Legs'])
})

test('clamps to 1..7 and falls back for unknown counts', () => {
  assert.equal(resolveDayFocuses({ daysPerWeek: '0' }).length, 1)
  assert.equal(resolveDayFocuses({ daysPerWeek: '9' }).length, 7)
  assert.equal(resolveDayFocuses({ daysPerWeek: 'abc' }).length, 4) // default 4
})
