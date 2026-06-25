const test = require('node:test')
const assert = require('node:assert')
const { buildStockBody, sanitizeNotes, classifyAbcResult } = require('./abcStockLevel')

test('buildStockBody: add maps reason Received, integer string quantity, no cost by default', () => {
  const r = buildStockBody({ action: 'add', quantity: 10, vendor: 'Bear Vending', notes: 'restock' })
  assert.strictEqual(r.ok, true)
  assert.deepStrictEqual(r.body, { action: 'add', quantity: '10', vendor: 'Bear Vending', reason: 'Received', notes: 'restock' })
})

test('buildStockBody: override omits reason and accepts zero', () => {
  const r = buildStockBody({ action: 'override', quantity: 0 })
  assert.strictEqual(r.ok, true)
  assert.strictEqual(r.body.action, 'override')
  assert.strictEqual(r.body.quantity, '0')
  assert.ok(!('reason' in r.body))
})

test('buildStockBody: includes unitCost only when a finite number is passed', () => {
  const r = buildStockBody({ action: 'add', quantity: 3, unitCost: 9 })
  assert.strictEqual(r.body.unitCost, '9.00')
  const r2 = buildStockBody({ action: 'add', quantity: 3 })
  assert.ok(!('unitCost' in r2.body))
})

test('buildStockBody: skips non-integer / zero / negative add quantity', () => {
  assert.strictEqual(buildStockBody({ action: 'add', quantity: 1.5 }).ok, false)
  assert.strictEqual(buildStockBody({ action: 'add', quantity: 0 }).ok, false)
  assert.strictEqual(buildStockBody({ action: 'add', quantity: -2 }).ok, false)
})

test('sanitizeNotes: strips banned chars and caps length', () => {
  assert.strictEqual(sanitizeNotes('count by Jane (D) #1'), 'count by Jane D 1')
  assert.strictEqual(sanitizeNotes('x'.repeat(600)).length, 500)
})

test('classifyAbcResult: success', () => {
  const r = classifyAbcResult({ status: { message: 'Sale Item updated successfully.', messageCode: 'API-CLU-ITM-0000' } })
  assert.strictEqual(r.ok, true)
  assert.strictEqual(r.benign, false)
})

test('classifyAbcResult: override-equals-current is benign', () => {
  const r = classifyAbcResult({ status: { messageCode: 'API-CLU-ITM-0010' }, errorMessages: [{ message: 'New quantity cannot be the same as In Stock for Overrides', messageCode: 'API-CLU-ITM-0007' }] })
  assert.strictEqual(r.ok, false)
  assert.strictEqual(r.benign, true)
  assert.strictEqual(r.code, 'API-CLU-ITM-0007')
})

test('classifyAbcResult: real error is not benign', () => {
  const r = classifyAbcResult({ status: { messageCode: 'API-CLU-ITM-0010' }, errorMessages: [{ message: 'The unit cost is incorrect.', messageCode: 'API-CLU-ITM-0005' }] })
  assert.strictEqual(r.benign, false)
  assert.strictEqual(r.code, 'API-CLU-ITM-0005')
})

const { putStockLevel } = require('./abcStockLevel')

function fakeFetch(responseJson, ok = true) {
  return async () => ({ ok, status: ok ? 200 : 400, json: async () => responseJson, text: async () => JSON.stringify(responseJson) })
}

test('putStockLevel: success → synced', async () => {
  const r = await putStockLevel('1234', 'SALE1', { action: 'add', quantity: 5 }, {
    fetchImpl: fakeFetch({ status: { message: 'Sale Item updated successfully.', messageCode: 'API-CLU-ITM-0000' } }),
  })
  assert.strictEqual(r.status, 'synced')
})

test('putStockLevel: benign override → synced', async () => {
  const r = await putStockLevel('1234', 'SALE1', { action: 'override', quantity: 2 }, {
    fetchImpl: fakeFetch({ status: { messageCode: 'API-CLU-ITM-0010' }, errorMessages: [{ messageCode: 'API-CLU-ITM-0007', message: 'same as in stock' }] }, false),
  })
  assert.strictEqual(r.status, 'synced')
})

test('putStockLevel: real error → failed with code', async () => {
  const r = await putStockLevel('1234', 'SALE1', { action: 'add', quantity: 5 }, {
    fetchImpl: fakeFetch({ status: { messageCode: 'API-CLU-ITM-0010' }, errorMessages: [{ messageCode: 'API-CLU-ITM-0005', message: 'The unit cost is incorrect.' }] }, false),
  })
  assert.strictEqual(r.status, 'failed')
  assert.strictEqual(r.code, 'API-CLU-ITM-0005')
})

test('putStockLevel: unsendable value → skipped (no fetch call)', async () => {
  let called = false
  const r = await putStockLevel('1234', 'SALE1', { action: 'add', quantity: 0 }, {
    fetchImpl: async () => { called = true; return { ok: true, json: async () => ({}) } },
  })
  assert.strictEqual(r.status, 'skipped')
  assert.strictEqual(called, false)
})
