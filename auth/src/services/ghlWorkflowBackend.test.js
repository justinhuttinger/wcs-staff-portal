const { test } = require('node:test')
const assert = require('node:assert/strict')
const { triggerSignature } = require('./ghlWorkflowBackend')

test('triggerSignature matches same type + conditions regardless of ids, dates and order', () => {
  const a = { id: 'x', date_added: '1', type: 'contact_tag', conditions: [{ id: 'tag-added', operator: 'index-of-true', field: 'tagsAdded', value: 'checked in-90days', title: 'Tag added' }] }
  const b = { id: 'y', date_added: '2', type: 'contact_tag', conditions: [{ id: 'tag-added', operator: 'index-of-true', field: 'tagsAdded', value: 'checked in-90days' }] }
  const c = { ...b, conditions: [{ ...b.conditions[0], value: 'other' }] }
  assert.equal(triggerSignature(a), triggerSignature(b))
  assert.notEqual(triggerSignature(a), triggerSignature(c))
  const d1 = { type: 'custom_date_reminder', conditions: [{ id: 'x', value: 1 }, { id: 'y', value: 'sale' }] }
  const d2 = { type: 'custom_date_reminder', conditions: [{ id: 'y', value: 'sale' }, { id: 'x', value: 1 }] }
  assert.equal(triggerSignature(d1), triggerSignature(d2))
})
