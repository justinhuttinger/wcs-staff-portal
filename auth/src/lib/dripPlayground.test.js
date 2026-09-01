// auth/src/lib/dripPlayground.test.js
const { test } = require('node:test')
const assert = require('node:assert')
const {
  PLAYGROUND_SLUG, PLAYGROUND_MESSAGES, isPlayground, playgroundStorageKey,
  messageById, messageByKey, buildMessages, customValuesMap,
} = require('./dripPlayground')
const { mediaKeyFor } = require('./dripMedia')

test('isPlayground matches the slug, case and space insensitively', () => {
  assert.equal(isPlayground('playground'), true)
  assert.equal(isPlayground(' Playground '), true)
  assert.equal(isPlayground('salem'), false)
  assert.equal(isPlayground(''), false)
  assert.equal(isPlayground(undefined), false)
})

test('there are five messages with distinct ids and keys', () => {
  assert.equal(PLAYGROUND_MESSAGES.length, 5)
  assert.equal(new Set(PLAYGROUND_MESSAGES.map(m => m.id)).size, 5)
  assert.equal(new Set(PLAYGROUND_MESSAGES.map(m => m.fieldKey)).size, 5)
})

test('a fresh playground falls back to the starting text', () => {
  const msgs = buildMessages({})
  assert.deepEqual(msgs.map(m => m.value), ['Test SMS 1', 'Test SMS 2', 'Test SMS 3', 'Test SMS 4', 'Test SMS 5'])
})

test('a saved edit wins over the starting text', () => {
  const msgs = buildMessages({ 'drip_playground.custom_values.test_sms_2': 'edited' })
  assert.equal(msgs[1].value, 'edited')
  assert.equal(msgs[0].value, 'Test SMS 1')
})

test('clearing a message to empty is kept, not reset to the default', () => {
  // An empty saved string is a deliberate edit; only an absent key falls back.
  const msgs = buildMessages({ 'drip_playground.custom_values.test_sms_3': '' })
  assert.equal(msgs[2].value, '')
})

test('storage key is derived from the field key and tolerates braces', () => {
  assert.equal(playgroundStorageKey('custom_values.test_sms_1'), 'drip_playground.custom_values.test_sms_1')
  assert.equal(playgroundStorageKey('{{ custom_values.test_sms_1 }}'), 'drip_playground.custom_values.test_sms_1')
})

test('lookup by synthetic id and by field key', () => {
  assert.equal(messageById('playground-test-sms-4').name, 'Test SMS 4')
  assert.equal(messageById('nope'), null)
  assert.equal(messageByKey('custom_values.test_sms_4').name, 'Test SMS 4')
  assert.equal(messageByKey('{{ custom_values.test_sms_4 }}').name, 'Test SMS 4')
  assert.equal(messageByKey('custom_values.vip_sms_1'), null)
})

test('custom value map lets playground copy reference another playground message', () => {
  const map = customValuesMap(buildMessages({}))
  assert.equal(map['custom_values.test_sms_1'], 'Test SMS 1')
  assert.equal(Object.keys(map).length, 5)
})

test('playground messages produce the same media companion keys as real ones', () => {
  // Media has to work identically here or the playground is not a fair test.
  assert.equal(mediaKeyFor('custom_values.test_sms_1'), 'custom_values.test_sms_1_media')
})

test('no playground key can collide with a real drip key', () => {
  const real = [
    'custom_values.new_lead_sms_1', 'custom_values.vip_sms_1', 'custom_values.trial_begin_sms',
    'custom_values.missed_tour_sms', 'custom_values.new_member_sms_1',
  ]
  for (const m of PLAYGROUND_MESSAGES) assert.ok(!real.includes(m.fieldKey), m.fieldKey)
})

test('the slug is not one of the clubs', () => {
  const clubs = ['salem', 'keizer', 'eugene', 'springfield', 'clackamas', 'milwaukie', 'medford']
  assert.ok(!clubs.includes(PLAYGROUND_SLUG))
})
