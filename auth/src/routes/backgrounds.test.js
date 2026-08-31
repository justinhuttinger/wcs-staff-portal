const { test } = require('node:test')
const assert = require('node:assert/strict')
const { isAllowedMime, extForMime, toPrune, MAX_PER_USER } = require('./backgroundsHelpers')

test('only the three image types are accepted', () => {
  assert.equal(isAllowedMime('image/jpeg'), true)
  assert.equal(isAllowedMime('image/png'), true)
  assert.equal(isAllowedMime('image/webp'), true)
  assert.equal(isAllowedMime('image/gif'), false)
  assert.equal(isAllowedMime('image/svg+xml'), false)   // SVG can carry script
  assert.equal(isAllowedMime('application/pdf'), false)
  assert.equal(isAllowedMime(''), false)
  assert.equal(isAllowedMime(null), false)
  assert.equal(isAllowedMime(undefined), false)
})

test('a mime with parameters still resolves', () => {
  assert.equal(isAllowedMime('image/jpeg; charset=binary'), true)
})

test('extension follows the mime, never the filename', () => {
  assert.equal(extForMime('image/jpeg'), 'jpg')
  assert.equal(extForMime('image/png'), 'png')
  assert.equal(extForMime('image/webp'), 'webp')
})

test('nothing is pruned below the cap', () => {
  const files = [
    { name: 'a', created_at: '2026-01-01T00:00:00Z' },
    { name: 'b', created_at: '2026-01-02T00:00:00Z' },
  ]
  assert.deepEqual(toPrune(files, 3), [])
})

test('at the cap, the oldest is pruned to make room for one more', () => {
  const files = [
    { name: 'b', created_at: '2026-01-02T00:00:00Z' },
    { name: 'a', created_at: '2026-01-01T00:00:00Z' },
    { name: 'c', created_at: '2026-01-03T00:00:00Z' },
  ]
  assert.deepEqual(toPrune(files, 3), ['a'])
})

test('over the cap, everything above it is pruned oldest-first', () => {
  const files = [
    { name: 'a', created_at: '2026-01-01T00:00:00Z' },
    { name: 'b', created_at: '2026-01-02T00:00:00Z' },
    { name: 'c', created_at: '2026-01-03T00:00:00Z' },
    { name: 'd', created_at: '2026-01-04T00:00:00Z' },
    { name: 'e', created_at: '2026-01-05T00:00:00Z' },
  ]
  assert.deepEqual(toPrune(files, 3), ['a', 'b', 'c'])
})

test('a file with no timestamp sorts oldest rather than throwing', () => {
  const files = [
    { name: 'x' },
    { name: 'y', created_at: '2026-01-02T00:00:00Z' },
    { name: 'z', created_at: '2026-01-03T00:00:00Z' },
  ]
  assert.deepEqual(toPrune(files, 3), ['x'])
})

test('the per-user cap is 3', () => {
  assert.equal(MAX_PER_USER, 3)
})
