const test = require('node:test')
const assert = require('node:assert/strict')
const { cleanTaskInput, rowSignal } = require('../src/services/hub/taskModel')

test('cleanTaskInput rejects missing title and bad priority', () => {
  assert.equal(cleanTaskInput({}).error, 'Title is required')
  assert.equal(cleanTaskInput({ title: 'x', priority: 'urgent' }).error, 'Bad priority')
})

test('cleanTaskInput dedupes clubs and drops junk', () => {
  assert.deepEqual(cleanTaskInput({ title: 'x', clubs: ['salem', 'salem', 'Bad Slug!'] }).fields.clubs, ['salem'])
})

test('cleanTaskInput: bad date and non-uuid category become null; defaults on create', () => {
  const { fields } = cleanTaskInput({ title: '  Fix sign  ', due_date: '11/20/2026', category_id: 'nope' })
  assert.equal(fields.title, 'Fix sign')
  assert.equal(fields.due_date, null)
  assert.equal(fields.category_id, null)
  assert.equal(fields.priority, 'medium')
  assert.deepEqual(fields.clubs, [])
})

test('cleanTaskInput partial: only the keys sent, and empty title still refused', () => {
  assert.deepEqual(cleanTaskInput({ priority: 'high' }, { partial: true }).fields, { priority: 'high' })
  assert.equal(cleanTaskInput({ title: '  ' }, { partial: true }).error, 'Title is required')
})

test('rowSignal: unseen reply needs review; waitingDays from oldest send', () => {
  const now = Date.now(), d = n => new Date(now - n * 864e5).toISOString()
  const s = rowSignal({}, [
    { state: 'waiting', last_sent_at: d(3) }, { state: 'waiting', last_sent_at: d(1) },
    { state: 'replied', reply_seen: false },
  ])
  assert.equal(s.needsReview, true)
  assert.equal(s.waitingDays, 3)
  assert.equal(s.allIn, false)
})

test('rowSignal: no people, or seen replies only, needs no review', () => {
  assert.deepEqual(rowSignal({}, []), { needsReview: false, waitingDays: null, allIn: false })
  assert.equal(rowSignal({}, [{ state: 'replied', reply_seen: true }]).needsReview, false)
})

test('cleanTaskInput: Time needed is 30/60/90/120/180 minutes or empty (Claude estimates)', () => {
  assert.equal(cleanTaskInput({ title: 'x', minutes_override: 90 }).fields.minutes_override, 90)
  assert.equal(cleanTaskInput({ title: 'x', minutes_override: '' }).fields.minutes_override, null)
  assert.equal(cleanTaskInput({ title: 'x' }).fields.minutes_override, null)
  assert.equal(cleanTaskInput({ title: 'x', minutes_override: 45 }).error, 'Bad time needed')
  assert.deepEqual(cleanTaskInput({ minutes_override: 120 }, { partial: true }).fields, { minutes_override: 120 })
})
