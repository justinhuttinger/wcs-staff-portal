const test = require('node:test')
const assert = require('node:assert')
const { isFrontDeskVisible } = require('./helpCenterPublic')

test('front desk sees articles with no role floor or a Team Member+ floor', () => {
  assert.equal(isFrontDeskVisible(null), true)
  assert.equal(isFrontDeskVisible(''), true)
  assert.equal(isFrontDeskVisible('team_member'), true)
})

test('Lead+ and higher, and unknown floors, stay behind the login', () => {
  for (const r of ['lead', 'manager', 'corporate', 'admin', 'something_new']) {
    assert.equal(isFrontDeskVisible(r), false, r)
  }
})
