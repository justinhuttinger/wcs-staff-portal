const test = require('node:test')
const assert = require('node:assert')
const { cleanPageEvent } = require('./pageEvents')

const NOW = Date.parse('2026-10-02T17:05:00Z')
const good = {
  club: '030935', ts: '2026-10-02T17:04:11.000Z', source: 'button', action: 'single',
  targets: [1, 2],
  results: [{ handset: 1, ok: true, latencyMs: 380 }, { handset: 2, ok: false, latencyMs: 5000, error: 'Phone base unreachable' }],
  result: 'partial',
  button: { ieee: '0x00158d0001234567', name: 'Front desk', battery: 92, linkquality: 118 },
}

test('a button page becomes an insertable row', () => {
  const { row, error } = cleanPageEvent(good, NOW)
  assert.strictEqual(error, undefined)
  assert.strictEqual(row.club_number, '30935')
  assert.deepStrictEqual(row.targets, [1, 2])
  assert.deepStrictEqual(row.results[1], { handset: 2, ok: false, latencyMs: 5000, error: 'Phone base unreachable' })
  assert.strictEqual(row.button_name, 'Front desk')
  assert.strictEqual(row.battery, 92)
})

test('a suppressed press with no button details is accepted', () => {
  const { row } = cleanPageEvent({ club: '30935', ts: good.ts, source: 'button', result: 'suppressed', targets: [1] }, NOW)
  assert.strictEqual(row.result, 'suppressed')
  assert.deepStrictEqual(row.results, [])
  assert.strictEqual(row.battery, null)
  assert.strictEqual(row.action, 'single')
})

test('bad input is rejected', () => {
  assert.strictEqual(cleanPageEvent({ ...good, club: '' }, NOW).error, 'club required')
  assert.strictEqual(cleanPageEvent({ ...good, source: 'web' }, NOW).error, 'bad source')
  assert.strictEqual(cleanPageEvent({ ...good, result: 'great' }, NOW).error, 'bad result')
  assert.strictEqual(cleanPageEvent({ ...good, ts: 'yesterday' }, NOW).error, 'bad ts')
  assert.strictEqual(cleanPageEvent({ ...good, ts: '2027-01-01T00:00:00Z' }, NOW).error, 'bad ts')
})

test('out-of-range handsets and junk values are dropped', () => {
  const { row } = cleanPageEvent({ ...good, targets: [1, 9, 'x'], results: [{ handset: 7, ok: true }], button: { battery: 500 } }, NOW)
  assert.deepStrictEqual(row.targets, [1])
  assert.deepStrictEqual(row.results, [])
  assert.strictEqual(row.battery, null)
})
