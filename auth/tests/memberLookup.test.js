// The referrer picker's search.
//
// Two rules matter for correctness, and both are invisible in the UI if they
// break: results must be scoped to THIS club, and to ACTIVE members only.
// Offering a cancelled member invites crediting somebody for a reward they can
// no longer receive.

const test = require('node:test')
const assert = require('node:assert/strict')
const path = require('node:path')

let lastQuery = null
let rows = []

function prime(rel, exports) {
  const resolved = require.resolve(path.join(__dirname, '..', 'src', rel))
  require.cache[resolved] = { id: resolved, filename: resolved, loaded: true, exports }
}

// A chainable stub that records what the query asked for.
function builder() {
  const q = { filters: {}, or: null, limit: null }
  lastQuery = q
  const chain = {
    select: () => chain,
    eq: (col, val) => { q.filters[col] = val; return chain },
    ilike: (col, val) => { q.filters[col + '~'] = val; return chain },
    or: v => { q.or = v; return chain },
    limit: n => { q.limit = n; return Promise.resolve({ data: rows, error: null }) },
  }
  return chain
}

prime('services/supabase', { supabaseAdmin: { from: () => builder() } })

const { searchMembersByName } = require('../src/lib/memberLookup')

test.beforeEach(() => { lastQuery = null; rows = [] })

test('scopes to the club it was given', async () => {
  await searchMembersByName('32073', 'Smith')
  assert.equal(lastQuery.filters.club_number, '32073')
})

test('returns active members only', async () => {
  await searchMembersByName('30935', 'Smith')
  // Salem holds 3,680 cancelled members; without this the picker offers them.
  assert.equal(lastQuery.filters['member_status~'], 'active')
})

test('a two-word query searches first and last name', async () => {
  // A hit, so the precise query stands. With no rows it deliberately falls back
  // to the looser either-name search, covered below.
  rows = [{ member_id: 'M1', first_name: 'Henry', last_name: 'Magnuson', member_status: 'Active' }]

  await searchMembersByName('30935', 'Henry Magnuson')

  assert.equal(lastQuery.filters['first_name~'], 'Henry%')
  assert.equal(lastQuery.filters['last_name~'], 'Magnuson%')
})

test('a two-word query with no exact hit widens to either name', async () => {
  // "Henry Magnusen" misspelt, or a member stored first-name-last. Better to
  // show near matches than an empty list staff cannot act on.
  rows = []

  await searchMembersByName('30935', 'Henry Magnuson')

  assert.ok(lastQuery.or, 'fell back to the looser search')
  assert.match(lastQuery.or, /first_name\.ilike\.Henry Magnuson%/)
})

test('a single word searches either name', async () => {
  await searchMembersByName('30935', 'Magnuson')
  assert.match(lastQuery.or, /first_name\.ilike\.Magnuson%/)
  assert.match(lastQuery.or, /last_name\.ilike\.Magnuson%/)
})

test('a phone query searches both phone columns', async () => {
  await searchMembersByName('30935', '(503) 580-4556')
  // Loose pattern, because PostgREST cannot strip punctuation and ABC stores
  // "(503) 580-4556". The exact re-check happens in JS.
  assert.match(lastQuery.or, /primary_phone\.ilike\.%503%580%4556%/)
  assert.match(lastQuery.or, /mobile_phone\.ilike\.%503%580%4556%/)
})

test('an email query searches email', async () => {
  await searchMembersByName('30935', 'dana@example.com')
  assert.equal(lastQuery.filters['email~'], '%dana@example.com%')
})

test('too short a query does not hit the database at all', async () => {
  const out = await searchMembersByName('30935', 'a')
  assert.deepEqual(out, [])
  assert.equal(lastQuery, null)
})

test('results carry the contact details staff need to tell people apart', async () => {
  rows = [{
    member_id: 'M1', first_name: 'Dana', last_name: 'Reyes',
    email: 'dana@example.com', primary_phone: '(503) 555-1212',
    mobile_phone: '', member_status: 'Active',
  }]

  const [hit] = await searchMembersByName('30935', 'Dana Reyes')
  assert.equal(hit.memberId, 'M1')
  assert.equal(hit.phone, '(503) 555-1212')
  assert.equal(hit.email, 'dana@example.com')
})

test('falls back to the mobile number when there is no primary', async () => {
  rows = [{
    member_id: 'M2', first_name: 'Pat', last_name: 'Kim',
    email: '', primary_phone: '', mobile_phone: '(503) 555-9999', member_status: 'Active',
  }]

  const [hit] = await searchMembersByName('30935', 'Pat Kim')
  assert.equal(hit.phone, '(503) 555-9999')
})
