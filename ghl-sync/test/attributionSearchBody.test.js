const test = require('node:test')
const assert = require('node:assert/strict')
const { buildSearchBody } = require('../src/sync/attributionSearchBody')

test('base body has location, page limit, and dateAdded sort', () => {
  const body = buildSearchBody({ locationId: 'loc1' })
  assert.equal(body.locationId, 'loc1')
  assert.ok(body.pageLimit > 0)
  assert.deepEqual(body.sort, [{ field: 'dateAdded', direction: 'desc' }])
  assert.equal(body.filters, undefined)
  assert.equal(body.searchAfter, undefined)
})

test('searchAfter cursor is passed through', () => {
  const cursor = [1234567890, 'abc']
  const body = buildSearchBody({ locationId: 'loc1', searchAfter: cursor })
  assert.deepEqual(body.searchAfter, cursor)
})

test('sinceIso adds a dateAdded range filter', () => {
  const body = buildSearchBody({ locationId: 'loc1', sinceIso: '2026-06-01T00:00:00.000Z' })
  assert.deepEqual(body.filters, [
    { field: 'dateAdded', operator: 'range', value: { gte: '2026-06-01T00:00:00.000Z' } },
  ])
})

test('no filters key when sinceIso is absent (full pass stays a full pass)', () => {
  const body = buildSearchBody({ locationId: 'loc1', searchAfter: [1, 'x'] })
  assert.equal('filters' in body, false)
})
