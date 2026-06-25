const test = require('node:test')
const assert = require('node:assert')
const { isPT, normSvc, CLUBS } = require('./abcRecurring')

test('isPT matches training service names, excludes consults', () => {
  assert.equal(isPT('PT 60MIN'), true)
  assert.equal(isPT('SMALL GROUP TRAINING'), true)
  assert.equal(isPT('ONLINE COACHING'), true)
  assert.equal(isPT('PT CONSULT'), false)
  assert.equal(isPT('DUES'), false)
  assert.equal(isPT(''), false)
})

test('normSvc collapses PT60 aliases', () => {
  assert.equal(normSvc('PT 60MIN'), 'PT60')
  assert.equal(normSvc('Group Training'), 'Group Training')
})

test('CLUBS has all seven clubs', () => {
  assert.equal(CLUBS.length, 7)
  assert.ok(CLUBS.find(c => c.slug === 'medford' && c.clubNumber === '32073'))
})
