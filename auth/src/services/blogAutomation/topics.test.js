const test = require('node:test')
const assert = require('node:assert')
const { pickCategory, pickTopic, resolveTopicText } = require('./topics')

test('pickCategory returns a not-recently-used category', () => {
  const c = pickCategory(['fitness-tips', 'nutrition'])
  assert.ok(!['fitness-tips', 'nutrition'].includes(c))
})

test('pickCategory with empty history returns the first category', () => {
  assert.equal(pickCategory([]), 'fitness-tips')
})

test('resolveTopicText substitutes [Location]', () => {
  assert.equal(resolveTopicText('Best spots near [Location]', 'Salem'), 'Best spots near Salem')
})

test('pickTopic avoids recently used topics', () => {
  const used = ['Best compound exercises for building strength']
  const t = pickTopic('fitness-tips', used, 'Salem')
  assert.ok(!used.includes(t))
  assert.ok(t.length > 0)
})

test('pickTopic falls back when all topics used', () => {
  const { CATEGORIES } = require('./config')
  const all = CATEGORIES.find(c => c.key === 'gym-life').topics
  const t = pickTopic('gym-life', all, 'Eugene')
  assert.ok(typeof t === 'string' && t.length > 0)
})
