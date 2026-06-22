const test = require('node:test')
const assert = require('node:assert/strict')
const sharp = require('sharp')
const { toEmbedInput } = require('../src/media/imagePrep')

test('toEmbedInput downscales a large image to <= 2MP jpeg data url', async () => {
  const big = await sharp({ create: { width: 3000, height: 3000, channels: 3, background: '#888' } })
    .jpeg().toBuffer()
  const { imageDataUrl } = await toEmbedInput(big)
  assert.match(imageDataUrl, /^data:image\/jpeg;base64,/)
  const out = Buffer.from(imageDataUrl.split(',')[1], 'base64')
  const meta = await sharp(out).metadata()
  assert.ok(meta.width * meta.height <= 2_000_000, `pixels ${meta.width * meta.height} should be <= 2MP`)
})
