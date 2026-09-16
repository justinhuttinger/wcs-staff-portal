const test = require('node:test')
const assert = require('node:assert')
const { scopeSlugs, NO_ACCESS_SLUG } = require('./locationScope')
const { parseLocationSlugParam } = require('../utils/locationSlug')

const P = (s) => parseLocationSlugParam(s)

test('all-location roles keep full access', () => {
  // admin / corporate / marketing requesting "all" => no filter
  assert.deepEqual(scopeSlugs(P('all'), 'admin', []), { all: true })
  assert.deepEqual(scopeSlugs(P(null), 'corporate', []), { all: true })
  // director resolves to corporate
  assert.deepEqual(scopeSlugs(P(undefined), 'director', []), { all: true })
  // a specific club passes through unchanged for all-location roles
  assert.deepEqual(scopeSlugs(P('salem'), 'admin', []), { slugs: ['salem'] })
})

test('manager requesting all is narrowed to their assigned clubs', () => {
  const r = scopeSlugs(P('all'), 'manager', ['salem', 'keizer'])
  assert.deepEqual(r, { slugs: ['salem', 'keizer'] })
  assert.ok(!r.all) // never "all" for a restricted role
})

test('manager requesting an allowed club gets just that club', () => {
  assert.deepEqual(scopeSlugs(P('salem'), 'manager', ['salem', 'keizer']), { slugs: ['salem'] })
})

test('manager requesting a club they are NOT assigned to gets no rows', () => {
  // silent-narrow drops the disallowed club; empty => sentinel (no rows), NOT all
  assert.deepEqual(scopeSlugs(P('clackamas'), 'manager', ['salem']), { slugs: [NO_ACCESS_SLUG] })
})

test('restricted user with no assigned clubs gets no rows', () => {
  assert.deepEqual(scopeSlugs(P('all'), 'lead', []), { slugs: [NO_ACCESS_SLUG] })
})

test('multi-club request is intersected to the allowed subset', () => {
  assert.deepEqual(scopeSlugs(P('salem,clackamas'), 'manager', ['salem', 'keizer']), { slugs: ['salem'] })
})

// --- narrowClubsToScope (Analytics `clubs` param) ---------------------------

test('narrowClubsToScope: corporate+ keep exactly the clubs they asked for', async () => {
  const { narrowClubsToScope } = require('./locationScope')
  const asked = ['salem', 'clackamas', 'medford']
  for (const role of ['admin', 'corporate', 'director', 'marketing']) {
    assert.deepEqual(await narrowClubsToScope({ staff: { role } }, asked), asked)
  }
})

test('narrowClubsToScope: manager with no assigned clubs gets nothing, never all', async () => {
  const { narrowClubsToScope } = require('./locationScope')
  assert.deepEqual(await narrowClubsToScope({ staff: { role: 'manager', location_ids: [] } }, ['salem']), [])
})

test('narrowClubsToScope: manager is intersected with assigned clubs', async () => {
  const supabasePath = require.resolve('./supabase')
  const prior = require.cache[supabasePath]
  require.cache[supabasePath] = {
    id: supabasePath, filename: supabasePath, loaded: true,
    exports: { supabaseAdmin: { from: () => ({ select: () => ({ in: async () => ({ data: [{ name: 'Salem' }, { name: 'Keizer' }] }) }) }) } },
  }
  try {
    const { narrowClubsToScope } = require('./locationScope')
    const req = { staff: { role: 'manager', location_ids: ['l1', 'l2'] } }
    assert.deepEqual(await narrowClubsToScope(req, ['salem', 'keizer', 'eugene', 'medford']), ['salem', 'keizer'])
    assert.deepEqual(await narrowClubsToScope(req, ['medford']), [])
  } finally {
    if (prior) require.cache[supabasePath] = prior
    else delete require.cache[supabasePath]
  }
})
