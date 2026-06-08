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
