// Shrink oversized photos in the browser before they are uploaded.
//
// A phone camera JPEG runs 5-12 MB, which is 10x more than a ticket
// attachment needs — nobody zooms into a receipt or a broken-treadmill photo
// past ~1600px. Resizing client-side keeps the storage bucket (and the
// uploader's data plan) an order of magnitude smaller with no visible loss.
//
// Everything here is best-effort: any failure returns the original File so an
// upload never breaks because a browser couldn't decode an image.

const MAX_DIMENSION = 1600   // longest edge, px
const JPEG_QUALITY = 0.82
const SKIP_UNDER_BYTES = 400 * 1024  // already small enough to not be worth it

// Formats we deliberately leave alone: GIF (would lose animation) and SVG
// (vector — resizing is meaningless and it's tiny anyway).
const SKIP_TYPES = ['image/gif', 'image/svg+xml']

export function isDownscalable(file) {
  return !!file &&
    typeof file.type === 'string' &&
    file.type.startsWith('image/') &&
    !SKIP_TYPES.includes(file.type) &&
    file.size > SKIP_UNDER_BYTES
}

function jpegName(name) {
  return String(name || 'image').replace(/\.[^.]+$/, '') + '.jpg'
}

/**
 * Resize an image File so its longest edge is at most MAX_DIMENSION and
 * re-encode it as JPEG. Returns the original File when it isn't an image,
 * is already small, can't be decoded, or when the re-encode came out larger.
 */
export async function downscaleImage(file) {
  if (!isDownscalable(file)) return file
  if (typeof createImageBitmap !== 'function' || typeof document === 'undefined') return file

  let bitmap
  try {
    // from-image applies the EXIF orientation, so portrait phone shots don't
    // come out sideways once the EXIF block is dropped by the re-encode.
    bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' })
  } catch {
    return file  // HEIC and anything else this browser can't decode
  }

  try {
    const { width, height } = bitmap
    if (!width || !height) return file

    const scale = Math.min(1, MAX_DIMENSION / Math.max(width, height))
    // Already within bounds and only mildly heavy: re-encoding buys little.
    const targetW = Math.round(width * scale)
    const targetH = Math.round(height * scale)

    const canvas = document.createElement('canvas')
    canvas.width = targetW
    canvas.height = targetH
    const ctx = canvas.getContext('2d')
    if (!ctx) return file
    // JPEG has no alpha: paint white first so transparent PNGs don't land on
    // a black background.
    ctx.fillStyle = '#ffffff'
    ctx.fillRect(0, 0, targetW, targetH)
    ctx.drawImage(bitmap, 0, 0, targetW, targetH)

    const blob = await new Promise(resolve => canvas.toBlob(resolve, 'image/jpeg', JPEG_QUALITY))
    if (!blob || blob.size >= file.size) return file

    return new File([blob], jpegName(file.name), {
      type: 'image/jpeg',
      lastModified: file.lastModified || undefined,
    })
  } catch {
    return file
  } finally {
    bitmap.close?.()
  }
}
