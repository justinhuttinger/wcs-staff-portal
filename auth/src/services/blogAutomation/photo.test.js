const test = require('node:test')
const assert = require('node:assert')
const photo = require('./photo')

test('pickPhoto returns the top image match for the location', async () => {
  const fakeEmbed = async () => [0.1, 0.2]
  const fakeRpc = async (fn, args) => {
    assert.equal(fn, 'match_media_embeddings')
    assert.equal(args.filter_location, 'Salem')
    assert.equal(args.filter_kind, 'image')
    return { data: [
      { asset_id: 'a1', drive_file_id: 'd1', similarity: 0.8 },
      { asset_id: 'a2', drive_file_id: 'd2', similarity: 0.6 },
    ], error: null }
  }
  const r = await photo.pickPhoto({ location: 'Salem', queryText: 'squat rack' },
    { embedQuery: fakeEmbed, rpc: fakeRpc })
  assert.deepEqual(r, { assetId: 'a1', driveFileId: 'd1', similarity: 0.8 })
})

test('pickPhoto returns null when no matches', async () => {
  const r = await photo.pickPhoto({ location: 'Medford', queryText: 'x' },
    { embedQuery: async () => [0], rpc: async () => ({ data: [], error: null }) })
  assert.equal(r, null)
})

test('pickPhoto returns null and does not throw on embed error', async () => {
  const r = await photo.pickPhoto({ location: 'Salem', queryText: 'x' },
    { embedQuery: async () => { throw new Error('voyage down') }, rpc: async () => ({ data: [], error: null }) })
  assert.equal(r, null)
})
