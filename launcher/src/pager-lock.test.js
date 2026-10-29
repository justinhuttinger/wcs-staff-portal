const test = require('node:test')
const assert = require('node:assert/strict')
const { verify } = require('./pager-lock')

// Made by scripts/action1/set-pager-pc.ps1's code in Windows PowerShell 5.1
// for the password "Front Desk 42!".
const FROM_POWERSHELL = {
  salt: 'vNPlh+rwjduAQX4RZRCaLQ==',
  iterations: 100000,
  hash: 'TO4QUPvq6UGg6GofAzy3+nS4NKnObqmJi57mvxgFr98=',
}

test('accepts the password the Action1 script hashed', () => {
  assert.equal(verify(FROM_POWERSHELL, 'Front Desk 42!'), true)
})

test('rejects a wrong or empty password', () => {
  assert.equal(verify(FROM_POWERSHELL, 'front desk 42!'), false)
  assert.equal(verify(FROM_POWERSHELL, ''), false)
  assert.equal(verify(FROM_POWERSHELL, undefined), false)
})

test('no password set means unlocked', () => {
  assert.equal(verify(undefined, 'anything'), true)
  assert.equal(verify({}, ''), true)
})
