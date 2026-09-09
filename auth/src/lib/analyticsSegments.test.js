const { test } = require('node:test')
const assert = require('node:assert/strict')
const { segmentValueLabel, UNASSIGNED_LABEL } = require('./analyticsSegments')

test('a blank salesperson is Not Assigned, not Unknown', () => {
  // The SQL view coalesces a missing salesperson to the string 'Unknown'.
  assert.equal(segmentValueLabel('salesperson', 'Unknown'), 'Not Assigned')
  assert.equal(segmentValueLabel('salesperson', null), UNASSIGNED_LABEL)
  assert.equal(segmentValueLabel('salesperson', '   '), UNASSIGNED_LABEL)
})

test('a real salesperson is passed through untouched', () => {
  assert.equal(segmentValueLabel('salesperson', 'Katie Castlio'), 'Katie Castlio')
})

test('Unknown stays Unknown for attributes, which is what it means there', () => {
  // An unrecorded gender or membership type IS an uncertainty. Only people get
  // relabelled, or the fix would make three other dimensions read wrong.
  for (const seg of ['gender', 'membership_type', 'age_group', 'payment_method', 'join_source']) {
    assert.equal(segmentValueLabel(seg, 'Unknown'), 'Unknown')
  }
})

test('a non-person segment is never rewritten, blank or not', () => {
  assert.equal(segmentValueLabel('gender', null), null)
  assert.equal(segmentValueLabel('club', '31601'), '31601')
})
