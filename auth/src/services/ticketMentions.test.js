const test = require('node:test')
const assert = require('node:assert')
const {
  parseMentionIds,
  notifiableMentionIds,
  newMentionIds,
  toPlainText,
} = require('./ticketMentions')

const A = '0b3f1e2a-1111-4aaa-8bbb-1234567890ab'
const B = 'aa11bb22-2222-4ccc-9ddd-abcdef012345'
const ACTOR = 'ffffffff-9999-4eee-8fff-000000000000'

test('parseMentionIds pulls uuids from tokens', () => {
  const body = `Hey @[Jane Doe](user:${A}) can you look? cc @[Bob](user:${B})`
  assert.deepStrictEqual(parseMentionIds(body), [A, B])
})

test('duplicate mentions of the same person collapse to one', () => {
  const body = `@[Jane](user:${A}) and again @[Jane Doe changed name](user:${A})`
  assert.deepStrictEqual(parseMentionIds(body), [A])
})

test('parseMentionIds ignores non-mention text and bare @', () => {
  assert.deepStrictEqual(parseMentionIds('email me @ jane, no tokens here'), [])
  assert.deepStrictEqual(parseMentionIds(''), [])
  assert.deepStrictEqual(parseMentionIds(null), [])
})

test('identity comes from the uuid, not the label', () => {
  // Same uuid, different display text -> one person.
  const body = `@[Old Name](user:${A}) @[New Name](user:${A})`
  assert.deepStrictEqual(parseMentionIds(body), [A])
})

test('a self-mention never notifies', () => {
  const body = `note to self @[Me](user:${ACTOR}) and @[Jane](user:${A})`
  assert.deepStrictEqual(notifiableMentionIds(body, ACTOR), [A])
})

test('newMentionIds only returns people not already notified (edit-safe)', () => {
  const body = `@[Jane](user:${A}) @[Bob](user:${B})`
  // Jane was already pinged on a prior save; only Bob is new.
  assert.deepStrictEqual(newMentionIds(body, ACTOR, [A]), [B])
  // Nothing new when everyone was already notified.
  assert.deepStrictEqual(newMentionIds(body, ACTOR, [A, B]), [])
})

test('newMentionIds still excludes the actor', () => {
  const body = `@[Me](user:${ACTOR}) @[Jane](user:${A})`
  assert.deepStrictEqual(newMentionIds(body, ACTOR, []), [A])
})

test('uuid matching is case-insensitive', () => {
  const upper = A.toUpperCase()
  const body = `@[Jane](user:${upper})`
  assert.deepStrictEqual(parseMentionIds(body), [A])
  assert.deepStrictEqual(newMentionIds(body, ACTOR, [A]), [])
})

test('toPlainText renders tokens as @Name for DM excerpts', () => {
  const body = `Please review @[Jane Doe](user:${A}) — thanks`
  assert.strictEqual(toPlainText(body), 'Please review @Jane Doe — thanks')
})
