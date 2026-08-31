import { test } from 'node:test'
import assert from 'node:assert/strict'
import { initials } from './initials.js'

test('initials takes first and last', () => {
  assert.equal(initials('Jane Doe'), 'JD')
  assert.equal(initials('Mary Anne Smith'), 'MS')
})

test('initials handles one name, blanks and junk', () => {
  assert.equal(initials('Cher'), 'C')
  assert.equal(initials('  spaced   out  '), 'SO')
  assert.equal(initials(''), '?')
  assert.equal(initials(null), '?')
  assert.equal(initials(undefined), '?')
})

test('initials falls back to the first character of an email', () => {
  assert.equal(initials('justin@wcstrength.com'), 'J')
})
