const test = require('node:test')
const assert = require('node:assert/strict')

const supaPath = require.resolve('../src/services/supabase')

// Only the member half is exercised: the prospect lookup goes to ABC over HTTP.
function withMembers(rows, run) {
  const calls = []
  const q = {
    select() { return this },
    eq() { return this },
    or(expr) { calls.push(expr); return this },
    ilike(col, val) { calls.push(`${col}=${val}`); return this },
    async limit() { return { data: rows, error: null } },
  }
  require.cache[supaPath] = {
    id: supaPath, filename: supaPath, loaded: true,
    exports: { supabaseAdmin: { from: () => q } },
  }
  delete require.cache[require.resolve('../src/lib/resolveAbcId')]
  const { findMember } = require('../src/lib/resolveAbcId')
  return run(findMember, calls)
}

const CLUB = '30935'

test('a member match carries their status back', async () => {
  await withMembers(
    [{ member_id: 'm1', primary_phone: '(425) 954-9854', member_status: 'Active' }],
    async findMember => {
      const r = await findMember(CLUB, { phone: '4259549854' })
      assert.deepEqual(r, { id: 'm1', type: 'member', status: 'Active' })
    }
  )
})

test('an ACTIVE member is still matched, never skipped', async () => {
  // Filtering the matcher would lose the join entirely rather than flag the
  // tour: we would fail to identify them, not decline to count them.
  await withMembers(
    [{ member_id: 'm1', email: 'a@b.com', member_status: 'Active' }],
    async findMember => {
      const r = await findMember(CLUB, { email: 'a@b.com' })
      assert.equal(r.id, 'm1')
    }
  )
})

test('a cancelled member matches too, and says so', async () => {
  // Their tour is a win-back and should count; the caller needs the status to
  // tell that apart from an active member.
  await withMembers(
    [{ member_id: 'm2', email: 'x@y.com', member_status: 'Cancelled' }],
    async findMember => {
      const r = await findMember(CLUB, { email: 'x@y.com' })
      assert.equal(r.status, 'Cancelled')
    }
  )
})

test('the query never constrains on status', async () => {
  await withMembers(
    [{ member_id: 'm1', email: 'a@b.com', member_status: 'Active' }],
    async (findMember, calls) => {
      await findMember(CLUB, { phone: '4259549854', email: 'a@b.com' })
      assert.ok(
        !calls.some(c => /member_status/i.test(c)),
        `status must not be filtered on: ${calls.join(' | ')}`
      )
    }
  )
})

test('a member row with no status recorded is null, not a guess', async () => {
  await withMembers(
    [{ member_id: 'm3', email: 'n@o.com' }],
    async findMember => {
      assert.equal((await findMember(CLUB, { email: 'n@o.com' })).status, null)
    }
  )
})
