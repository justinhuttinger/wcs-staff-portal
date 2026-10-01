const test = require('node:test')
const assert = require('node:assert/strict')
const { scriptKeys, findScript } = require('./callScript')

test('scriptKeys: this call first, then the script shared by the whole flow', () => {
  assert.deepEqual(scriptKeys('F. Abandoned Cart Call 2'), ['abandonedcartcall2script', 'abandonedcartcallscript'])
  assert.deepEqual(scriptKeys('A. New Lead-Call 1'), ['newleadcall1script', 'newleadcallscript'])
  assert.deepEqual(scriptKeys('I. Check In Worry - Call 1'), ['checkinworrycall1script', 'checkinworrycallscript'])
  // no call number: one key
  assert.deepEqual(scriptKeys('B. Trial-Ending Call'), ['trialendingcallscript'])
  // not a lettered Manual Actions workflow
  assert.deepEqual(scriptKeys('Nightly cleanup'), [])
})

const values = [
  { name: 'Abandoned Cart Call Script', value: 'Shared script' },
  { name: 'Abandoned Cart Call 2 Script', value: ' Second call script ' },
  { name: 'Abandoned Cart Call 1 SMS', value: 'not a script' },
  { name: 'Past Due Call 1 Script', value: '   ' },
]

test('findScript: the call-specific script wins over the shared one', () => {
  assert.deepEqual(findScript('F. Abandoned Cart Call 2', values), { title: 'Abandoned Cart Call 2 Script', script: 'Second call script' })
  assert.deepEqual(findScript('F. Abandoned Cart Call 1', values), { title: 'Abandoned Cart Call Script', script: 'Shared script' })
})

test('findScript: empty or missing custom values mean no script', () => {
  assert.equal(findScript('H. Past Due Call 1', values), null)
  assert.equal(findScript('D. VIP-Call 1', values), null)
})
