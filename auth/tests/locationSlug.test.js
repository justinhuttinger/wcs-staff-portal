const test = require('node:test')
const assert = require('node:assert/strict')

const {
  ALL_SLUGS,
  parseLocationSlugParam,
  locationCacheKey,
  intersectWithAllowed,
} = require('../src/utils/locationSlug')

test('parse: missing / null / empty → all', () => {
  for (const v of [undefined, null, '', '   ']) {
    const r = parseLocationSlugParam(v)
    assert.equal(r.all, true)
    assert.deepEqual(r.slugs, ALL_SLUGS)
    assert.equal(r.invalid, undefined)
  }
})

test('parse: literal "all" (any case) → all', () => {
  for (const v of ['all', 'ALL', '  All  ']) {
    const r = parseLocationSlugParam(v)
    assert.equal(r.all, true)
    assert.deepEqual(r.slugs, ALL_SLUGS)
  }
})

test('parse: single slug → not all, slugs=[that one]', () => {
  const r = parseLocationSlugParam('salem')
  assert.equal(r.all, false)
  assert.deepEqual(r.slugs, ['salem'])
})

test('parse: comma-separated → multi-slug', () => {
  const r = parseLocationSlugParam('salem,eugene,medford')
  assert.equal(r.all, false)
  // Output is in canonical ALL_SLUGS order, not input order
  assert.deepEqual(r.slugs, ['salem', 'eugene', 'medford'])
})

test('parse: input order does not matter — output is canonical', () => {
  const a = parseLocationSlugParam('medford,salem,eugene')
  const b = parseLocationSlugParam('eugene,salem,medford')
  assert.deepEqual(a.slugs, b.slugs, 'same set → same output')
})

test('parse: dedup repeated slugs', () => {
  const r = parseLocationSlugParam('salem,salem,eugene')
  assert.deepEqual(r.slugs, ['salem', 'eugene'])
})

test('parse: all 7 slugs collapse to {all: true}', () => {
  const allRaw = ALL_SLUGS.join(',')
  const r = parseLocationSlugParam(allRaw)
  assert.equal(r.all, true)
  assert.deepEqual(r.slugs, ALL_SLUGS)
})

test('parse: unknown slug → invalid', () => {
  const r = parseLocationSlugParam('salem,atlantis')
  assert.equal(r.invalid, 'atlantis')
})

test('parse: extra whitespace + mixed case → normalized', () => {
  const r = parseLocationSlugParam(' Salem , EUGENE ,medford ')
  assert.equal(r.all, false)
  assert.deepEqual(r.slugs, ['salem', 'eugene', 'medford'])
})

test('cacheKey: all → "all"', () => {
  assert.equal(locationCacheKey({ all: true, slugs: ALL_SLUGS }), 'all')
})

test('cacheKey: single → that slug (matches pre-multi-slug behavior)', () => {
  assert.equal(locationCacheKey({ all: false, slugs: ['salem'] }), 'salem')
})

test('cacheKey: multi → canonical-ordered, plus-joined', () => {
  const a = locationCacheKey({ all: false, slugs: ['salem', 'eugene'] })
  // Canonical order from the parser preserves ALL_SLUGS positions: salem before eugene
  assert.equal(a, 'salem+eugene')
})

test('cacheKey: same set in any input order → identical key', () => {
  const a = locationCacheKey(parseLocationSlugParam('eugene,salem,medford'))
  const b = locationCacheKey(parseLocationSlugParam('medford,salem,eugene'))
  assert.equal(a, b)
})

test('intersectWithAllowed: null allowed → no narrowing', () => {
  const r = intersectWithAllowed({ all: false, slugs: ['salem'] }, null)
  assert.deepEqual(r.slugs, ['salem'])
})

test('intersectWithAllowed: all=true gets narrowed to allowed set', () => {
  const r = intersectWithAllowed({ all: true, slugs: ALL_SLUGS }, ['salem', 'eugene'])
  assert.equal(r.all, false)
  assert.deepEqual(r.slugs, ['salem', 'eugene'])
})

test('intersectWithAllowed: overreach without silentNarrow → invalid', () => {
  const r = intersectWithAllowed({ all: false, slugs: ['salem', 'medford'] }, ['salem'])
  assert.equal(r.invalid, 'medford')
  assert.equal(r.denied, true)
})

test('intersectWithAllowed: overreach with silentNarrow → drops disallowed', () => {
  const r = intersectWithAllowed({ all: false, slugs: ['salem', 'medford'] }, ['salem'], { silentNarrow: true })
  assert.equal(r.invalid, undefined)
  assert.deepEqual(r.slugs, ['salem'])
})

test('intersectWithAllowed: fully allowed → unchanged', () => {
  const input = { all: false, slugs: ['salem', 'eugene'] }
  const r = intersectWithAllowed(input, ['salem', 'eugene', 'medford'])
  assert.deepEqual(r.slugs, input.slugs)
  assert.equal(r.invalid, undefined)
})
