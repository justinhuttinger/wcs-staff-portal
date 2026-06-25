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

test('putStockLevel: HTTP error with non-JSON body → failed (not synced)', async () => {
  const r = await putStockLevel('1234', 'SALE1', { action: 'add', quantity: 5 }, {
    fetchImpl: async () => ({ ok: false, status: 502, json: async () => { throw new Error('not json') }, text: async () => 'Bad Gateway' }),
  })
  assert.strictEqual(r.status, 'failed')
  assert.ok(/502/.test(r.error || ''), `expected HTTP 502 in error, got ${r.error}`)
})

test('buildStockBody: skips non-integer override quantity', () => {
  assert.strictEqual(buildStockBody({ action: 'override', quantity: 5.5 }).ok, false)
  assert.strictEqual(buildStockBody({ action: 'override', quantity: 3 }).ok, true)
})

test('putStockLevel: uses the plural clubs/items path (singular 400s at ABC gateway)', async () => {
  let calledUrl = ''
  await putStockLevel('31598', 'SALE1', { action: 'add', quantity: 1 }, {
    fetchImpl: async (url) => { calledUrl = url; return { ok: true, status: 200, text: async () => JSON.stringify({ status: { messageCode: 'API-CLU-ITM-0000' } }) } },
  })
  assert.ok(/\/31598\/clubs\/items\/SALE1$/.test(calledUrl), `expected plural clubs/items path, got ${calledUrl}`)
})

test('putStockLevel: gateway 400 with top-level message surfaces it in error', async () => {
  const r = await putStockLevel('31598', 'SALE1', { action: 'add', quantity: 1 }, {
    fetchImpl: async () => ({ ok: false, status: 400, text: async () => JSON.stringify({ message: 'No routing rule is matching path', http_status_code: 400 }) }),
  })
  assert.strictEqual(r.status, 'failed')
  assert.ok(/No routing rule/.test(r.error || ''), `expected gateway message in error, got ${r.error}`)
})
