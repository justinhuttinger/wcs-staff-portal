const sharp = require('sharp')

// Bound libvips memory on the small shared instance: disable the operation cache
// and cap worker threads so concurrent decodes don't balloon resident memory.
sharp.cache(false)
sharp.concurrency(2)

const MAX_PIXELS = 2_000_000 // Voyage caps charge at 2MP; no value embedding larger.

// Re-encode any image buffer to a JPEG data URL sized for Voyage.
async function toEmbedInput(buffer) {
  const img = sharp(buffer, { failOn: 'none' }).rotate() // honor EXIF orientation
  const meta = await img.metadata()
  const px = (meta.width || 0) * (meta.height || 0)
  let pipeline = img
  if (px > MAX_PIXELS) {
    const scale = Math.sqrt(MAX_PIXELS / px)
    pipeline = img.resize(Math.round((meta.width || 0) * scale))
  }
  const out = await pipeline.jpeg({ quality: 80 }).toBuffer()
  return { imageDataUrl: 'data:image/jpeg;base64,' + out.toString('base64') }
}

module.exports = { toEmbedInput, MAX_PIXELS }
