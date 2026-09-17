const test = require('node:test')
const assert = require('node:assert')
const { normalizeTime, parseWindow } = require('./stlBusinessHours')

test('normalizeTime', () => {
  assert.equal(normalizeTime('11:00'), '11:00')
  assert.equal(normalizeTime('19:30:00'), '19:30')
  assert.equal(normalizeTime('7:30'), null)
  assert.equal(normalizeTime('24:00'), null)
  assert.equal(normalizeTime(''), null)
})

test('parseWindow accepts a valid window and tidies days', () => {
  const r = parseWindow({ window_start: '09:00', window_end: '18:00:00', active_days: [6, '1', 1, 0] })
  assert.deepEqual(r.value, { window_start: '09:00', window_end: '18:00', active_days: [0, 1, 6] })
})

test('parseWindow rejects bad input', () => {
  assert.ok(parseWindow({ window_start: '19:00', window_end: '11:00', active_days: [0] }).error)
  assert.ok(parseWindow({ window_start: '11:00', window_end: '11:00', active_days: [0] }).error)
  assert.ok(parseWindow({ window_start: 'x', window_end: '11:00', active_days: [0] }).error)
  assert.ok(parseWindow({ window_start: '09:00', window_end: '17:00', active_days: [] }).error)
  assert.ok(parseWindow({ window_start: '09:00', window_end: '17:00', active_days: [7] }).error)
  assert.ok(parseWindow({ window_start: '09:00', window_end: '17:00' }).error)
})
