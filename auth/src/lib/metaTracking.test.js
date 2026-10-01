const test = require('node:test')
const assert = require('node:assert/strict')
const { withOfflineTracking, hasOfflineTracking } = require('./metaTracking')

const DS = '820682157231470'
const DEFAULTS = [
  { 'action.type': ['onsite_conversion'], conversion_id: ['1'] },
  { 'action.type': ['link_click'], post: ['2'], 'post.wall': ['3'] },
]

test('appends the dataset offline spec, keeping existing specs', () => {
  const out = withOfflineTracking(DEFAULTS, DS)
  assert.equal(out.length, 3)
  assert.deepEqual(out.slice(0, 2), DEFAULTS)
  assert.deepEqual(out[2], { 'action.type': ['offline_conversion'], dataset: [DS] })
})

test('no change when the ad already tracks it, or there is no dataset', () => {
  const tracked = withOfflineTracking(DEFAULTS, DS)
  assert.equal(hasOfflineTracking(tracked, DS), true)
  assert.equal(withOfflineTracking(tracked, DS), null)
  assert.equal(withOfflineTracking(DEFAULTS, ''), null)
  assert.equal(withOfflineTracking([{ 'action.type': ['offline_conversion'], offline_conversion_data_set: ['9'] }], DS), null)
})

test('handles an ad with no specs yet', () => {
  assert.deepEqual(withOfflineTracking(undefined, DS), [{ 'action.type': ['offline_conversion'], dataset: [DS] }])
})
