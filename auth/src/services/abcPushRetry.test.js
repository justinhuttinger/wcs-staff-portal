const test = require('node:test')
const assert = require('node:assert')
const { runAbcPushRetry } = require('./abcPushRetry')

// Minimal fake supabase query chain returning the given rows from .limit().
function fakeDb(rows) {
  return {
    from() { return this },
    select() { return this },
    in() { return this },
    lt() { return this },
    order() { return this },
    limit() { return Promise.resolve({ data: rows, error: null }) },
  }
}

test('runAbcPushRetry: re-pushes each selected movement', async () => {
  const seen = []
  const res = await runAbcPushRetry({
    db: fakeDb([{ id: 'a' }, { id: 'b' }]),
    push: async (id) => { seen.push(id); return { status: id === 'a' ? 'synced' : 'failed' } },
  })
  assert.deepStrictEqual(seen, ['a', 'b'])
  assert.strictEqual(res.attempted, 2)
  assert.strictEqual(res.synced, 1)
  assert.strictEqual(res.failed, 1)
})

test('runAbcPushRetry: disabled via env returns zero', async () => {
  process.env.INVENTORY_ABC_PUSH_DISABLED = '1'
  const res = await runAbcPushRetry({ db: fakeDb([{ id: 'a' }]), push: async () => ({ status: 'synced' }) })
  delete process.env.INVENTORY_ABC_PUSH_DISABLED
  assert.strictEqual(res.attempted, 0)
})
