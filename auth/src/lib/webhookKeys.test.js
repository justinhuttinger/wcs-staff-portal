const { test } = require('node:test')
const assert = require('node:assert/strict')
const { keysIn, pickClubKey, maskKey } = require('./webhookKeys')

test('keysIn finds keychain keys anywhere in a payload', () => {
  const p = { a: [{ authorization: { data: { token: 'WFKC_kc_abc123' } } }], b: 'x WFKC_kc_def456 y' }
  assert.deepEqual([...keysIn(p)].sort(), ['WFKC_kc_abc123', 'WFKC_kc_def456'])
})

test('pickClubKey picks the club key, never the source key', () => {
  const history = [
    { t: 'WFKC_kc_salem' },              // pushed copy (source key)
    { t: 'WFKC_kc_spring' }, { t: 'WFKC_kc_spring' },
  ]
  assert.equal(pickClubKey(history, new Set(['WFKC_kc_salem'])).key, 'WFKC_kc_spring')
  assert.equal(pickClubKey([{ t: 'WFKC_kc_salem' }], new Set(['WFKC_kc_salem'])).key, null)
  assert.equal(maskKey('WFKC_kc_1234567890'), 'WFKC_kc_1234…')
})
