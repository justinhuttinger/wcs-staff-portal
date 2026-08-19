const test = require('node:test')
const assert = require('node:assert')
const { templateKey, normalizeBody } = require('./templateKey')

// GHL gives no workflow id on a message, so the message body IS the only
// identity an automated text has. These cases pin the normalization that makes
// two sends of the same template collide and two different templates not.

test('same template with different merged first names collides', () => {
  const a = 'Hi Shaun!\n\nWelcome to your free week at West Coast Strength.'
  const b = 'Hi Marcia!\n\nWelcome to your free week at West Coast Strength.'
  assert.strictEqual(templateKey(a), templateKey(b))
})

test('different templates do not collide', () => {
  const a = 'Hi Shaun! Welcome to your free week at West Coast Strength.'
  const b = 'Hi Shaun! Your trial expires tomorrow, want to lock in a rate?'
  assert.notStrictEqual(templateKey(a), templateKey(b))
})

test('differing short links in the same template collide', () => {
  const a = 'Book your tour here: https://link.wcs.com/a1b2c3'
  const b = 'Book your tour here: https://link.wcs.com/z9y8x7'
  assert.strictEqual(templateKey(a), templateKey(b))
})

test('differing phone numbers and digits in the same template collide', () => {
  const a = 'Call us at 503-555-0142 to confirm your 9:00 session'
  const b = 'Call us at 541-555-9987 to confirm your 6:30 session'
  assert.strictEqual(templateKey(a), templateKey(b))
})

test('greeting variants are not force-merged into one template', () => {
  const a = 'Hey Shaun! Your trial expires tomorrow.'
  const b = 'Hi Shaun! Your trial expires tomorrow.'
  assert.notStrictEqual(templateKey(a), templateKey(b))
})

test('punctuation and whitespace noise collapses', () => {
  assert.strictEqual(templateKey('Hi  Shaun!!   See   you soon.'), templateKey('Hi Shaun! See you soon.'))
})

test('empty or missing body yields null', () => {
  assert.strictEqual(templateKey(''), null)
  assert.strictEqual(templateKey(null), null)
  assert.strictEqual(templateKey('   '), null)
})

test('key is 16 hex characters and stable across calls', () => {
  const k = templateKey('Hi Shaun! Welcome aboard.')
  assert.match(k, /^[0-9a-f]{16}$/)
  assert.strictEqual(k, templateKey('Hi Shaun! Welcome aboard.'))
})

test('normalizeBody strips the merged name but keeps the greeting word', () => {
  assert.strictEqual(normalizeBody('Hi Shaun! Welcome aboard.'), 'hi welcome aboard')
})

test('bodies differing only past 160 normalized characters collide', () => {
  const base = 'x'.repeat(200)
  assert.strictEqual(templateKey(base + 'aaa'), templateKey(base + 'bbb'))
})
