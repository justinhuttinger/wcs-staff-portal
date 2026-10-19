const test = require('node:test')
const assert = require('node:assert')
const { selectAllPages, selectInPaged } = require('./pagedSelect')

// A tiny stand-in for supabase-js: records filters, ordering and range, and
// answers with the matching slice of `rows`, capped like PostgREST at `cap`.
function fakeClient(rows, { cap = 1000, failOn } = {}) {
  const calls = []
  return {
    calls,
    from(table) {
      const q = { table, inCol: null, inVals: null, orders: [], eqs: [], range: null }
      calls.push(q)
      const api = {
        select() { return api },
        in(col, vals) { q.inCol = col; q.inVals = vals; return api },
        eq(col, val) { q.eqs.push([col, val]); return api },
        order(col, opts) { q.orders.push([col, opts?.ascending !== false]); return api },
        range(from, to) { q.range = [from, to]; return api },
        then(resolve) {
          if (failOn && failOn(q)) return resolve({ data: null, error: { message: 'boom' } })
          let list = rows.filter(r => !q.inCol || q.inVals.includes(r[q.inCol]))
          for (const [c, v] of q.eqs) list = list.filter(r => r[c] === v)
          const [from, to] = q.range || [0, Infinity]
          resolve({ data: list.slice(from, Math.min(to + 1, from + cap)), error: null })
        },
      }
      return api
    },
  }
}

const many = (n, extra = {}) => Array.from({ length: n }, (_, i) => ({ id: i + 1, member_id: String((i % 7) + 1), ...extra }))

test('selectAllPages reads past the 1,000-row cap until a short page', async () => {
  const client = fakeClient(many(2345))
  const rows = await selectAllPages(() => client.from('t').select('*'), { order: ['id'] })
  assert.strictEqual(rows.length, 2345)
  assert.deepStrictEqual(client.calls.map(c => c.range), [[0, 999], [1000, 1999], [2000, 2999]])
  // Every page is ordered, so pages never overlap or skip.
  assert.ok(client.calls.every(c => c.orders.length === 1 && c.orders[0][0] === 'id'))
})

test('selectAllPages stops on an exactly full last page with one empty read', async () => {
  const client = fakeClient(many(2000))
  const rows = await selectAllPages(() => client.from('t').select('*'), { order: ['id'] })
  assert.strictEqual(rows.length, 2000)
  assert.strictEqual(client.calls.length, 3)
})

test('selectAllPages honors maxRows', async () => {
  const client = fakeClient(many(5000))
  const rows = await selectAllPages(() => client.from('t').select('*'), { order: ['id'], maxRows: 1500 })
  assert.strictEqual(rows.length, 1500)
  assert.strictEqual(client.calls.length, 2)
})

test('selectAllPages throws instead of returning a partial set', async () => {
  const client = fakeClient(many(1500), { failOn: (q) => q.range && q.range[0] === 1000 })
  await assert.rejects(() => selectAllPages(() => client.from('t').select('*'), { order: ['id'] }), /boom/)
})

test('selectInPaged chunks the .in() list, pages each chunk and de-dupes values', async () => {
  const client = fakeClient(many(3000))
  const values = ['1', '2', '2', '3', '', null, '4', '5', '6', '7']
  const rows = await selectInPaged(client, 't', '*', 'member_id', values, { chunk: 3, order: ['id'] })
  assert.strictEqual(rows.length, 3000)
  const inLists = [...new Set(client.calls.map(c => JSON.stringify(c.inVals)))]
  assert.deepStrictEqual(inLists, ['["1","2","3"]', '["4","5","6"]', '["7"]'])
})

test('selectInPaged applies extend to every page', async () => {
  const client = fakeClient(many(2500, { kind: 'client' }))
  const rows = await selectInPaged(client, 't', '*', 'member_id', ['1', '2', '3', '4', '5', '6', '7'],
    { extend: (q) => q.eq('kind', 'client'), order: ['id'] })
  assert.strictEqual(rows.length, 2500)
  assert.ok(client.calls.every(c => c.eqs.length === 1))
})

test('selectInPaged with no values makes no request', async () => {
  const client = fakeClient(many(10))
  assert.deepStrictEqual(await selectInPaged(client, 't', '*', 'member_id', [null, '']), [])
  assert.strictEqual(client.calls.length, 0)
})
