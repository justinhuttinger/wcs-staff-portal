const test = require('node:test')
const assert = require('node:assert/strict')
const { queueCompletionError } = require('./queueCompletion')

const ALLOWED = ['Membership Sale', 'Started Trial', 'Started VIP Pass', 'Day Pass', 'Only Tour', 'Custom Pass']

test('a complete answer saves', () => {
  assert.equal(
    queueCompletionError({ outcome: 'Started Trial', tourMember: 'Allie Collins' }, ALLOWED),
    null,
  )
})

test('an outcome with nobody credited is refused', () => {
  // The live bug: Eugene intake f61ff486 saved a completed 7-day trial with
  // tour_member null, so the tour reached the webhook and the reports with no
  // one attached to it.
  for (const missing of [undefined, null, '', '   ']) {
    assert.deepEqual(
      queueCompletionError({ outcome: 'Started Trial', tourMember: missing }, ALLOWED),
      { error: 'tour member is required' },
      `expected ${JSON.stringify(missing)} to be refused`,
    )
  }
})

test('the outcome is still checked, and checked first', () => {
  assert.deepEqual(
    queueCompletionError({ outcome: 'Sold Them A Boat', tourMember: 'Allie Collins' }, ALLOWED),
    { error: 'invalid outcome' },
  )
  // Both missing reads as an outcome problem: it is the first thing staff pick.
  assert.deepEqual(queueCompletionError({}, ALLOWED), { error: 'invalid outcome' })
})

test('Day Pass is accepted, so the new outcome is not blocked by this guard', () => {
  assert.equal(
    queueCompletionError({ outcome: 'Day Pass', tourMember: 'Allie Collins' }, ALLOWED),
    null,
  )
})

test('a cancelled card needs neither: they left before being seen', () => {
  assert.equal(queueCompletionError({ cancelled: true }, ALLOWED), null)
  assert.equal(
    queueCompletionError({ cancelled: true, outcome: undefined, tourMember: '' }, ALLOWED),
    null,
  )
})
