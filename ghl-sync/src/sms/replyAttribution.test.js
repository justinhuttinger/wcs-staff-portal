const test = require('node:test')
const assert = require('node:assert')
const { attributeReplies, isOptOut, DEFAULT_WINDOW_HOURS } = require('./replyAttribution')

const at = (h) => new Date(Date.UTC(2026, 7, 19, h, 0, 0)).toISOString()
const out = (id, h) => ({ id, direction: 'outbound', body: 'Hi there!', date_added: at(h) })
const inb = (id, h, body = 'yes please') => ({ id, direction: 'inbound', body, date_added: at(h) })

test('an inbound message is credited to the outbound send before it', () => {
  const r = attributeReplies([out('s1', 1), inb('i1', 3)], {})
  assert.deepStrictEqual(r, [{ inbound_id: 'i1', send_id: 's1', reply_minutes: 120, is_opt_out: false }])
})

test('an inbound outside the window is not attributed', () => {
  const r = attributeReplies([out('s1', 0), inb('i1', 80)], { windowHours: 72 })
  assert.deepStrictEqual(r, [])
})

test('the NEAREST preceding send wins, not the first', () => {
  const r = attributeReplies([out('s1', 1), out('s2', 4), inb('i1', 5)], {})
  assert.strictEqual(r[0].send_id, 's2')
  assert.strictEqual(r[0].reply_minutes, 60)
})

test('two inbounds after one send both attribute to it', () => {
  const r = attributeReplies([out('s1', 1), inb('i1', 2), inb('i2', 3)], {})
  assert.strictEqual(r.length, 2)
  assert.ok(r.every(x => x.send_id === 's1'))
})

test('an inbound with no preceding outbound is ignored', () => {
  assert.deepStrictEqual(attributeReplies([inb('i1', 2), out('s1', 5)], {}), [])
})

test('input order does not matter', () => {
  const a = attributeReplies([inb('i1', 5), out('s2', 4), out('s1', 1)], {})
  const b = attributeReplies([out('s1', 1), out('s2', 4), inb('i1', 5)], {})
  assert.deepStrictEqual(a, b)
})

test('opt-out replies are attributed and flagged', () => {
  const r = attributeReplies([out('s1', 1), inb('i1', 2, 'STOP')], {})
  assert.strictEqual(r[0].is_opt_out, true)
})

test('messages with unusable timestamps are skipped', () => {
  const r = attributeReplies([out('s1', 1), { id: 'i1', direction: 'inbound', body: 'hi', date_added: 'nonsense' }], {})
  assert.deepStrictEqual(r, [])
})

test('isOptOut matches the standard carrier keywords, case-insensitively', () => {
  for (const w of ['STOP', 'stop', ' Stop ', 'STOPALL', 'unsubscribe', 'Cancel', 'end', 'QUIT']) {
    assert.strictEqual(isOptOut(w), true, w)
  }
})

test('isOptOut does not fire on the keyword inside a sentence', () => {
  assert.strictEqual(isOptOut('I cannot stop thinking about leg day'), false)
  assert.strictEqual(isOptOut(''), false)
  assert.strictEqual(isOptOut(null), false)
})

test('the default window is 72 hours', () => {
  assert.strictEqual(DEFAULT_WINDOW_HOURS, 72)
})
