const test = require('node:test')
const assert = require('node:assert')
const { shapeContact } = require('./contact')

// Only the GHL webhook path shapes a contact this way. The intake site passes
// the client straight through, because the form already collected it.

test('a full GHL contact keeps its name', () => {
  const c = shapeContact({ id: 'x', name: 'Sarah Mitchell', firstName: 'Sarah', lastName: 'Mitchell', email: 's@x.com' })
  assert.equal(c.name, 'Sarah Mitchell')
  assert.equal(c.email, 's@x.com')
})

// The bug: GHL returns no `name` for a contact created by upsert, so every one
// of those runs recorded the client as "Client" despite having both names.
test('a missing name is composed from first and last, not replaced by Client', () => {
  assert.equal(shapeContact({ firstName: 'Justin', lastName: 'Huttinger' }).name, 'Justin Huttinger')
  assert.equal(shapeContact({ firstName: 'Justin' }).name, 'Justin')
})

test('Client remains the fallback when there is genuinely no name', () => {
  assert.equal(shapeContact({ email: 'a@b.com' }).name, 'Client')
  assert.equal(shapeContact({ firstName: '  ', lastName: ' ' }).name, 'Client')
  assert.equal(shapeContact({}).name, 'Client')
  assert.equal(shapeContact().name, 'Client')
})
