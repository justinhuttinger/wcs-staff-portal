// portal/src/lib/imageShrink.js
//
// Carriers cap MMS around 0.6 MB and drop anything larger without telling you,
// so a phone photo straight off a camera roll is unusable. Rather than making
// staff resize images themselves, shrink in the browser before upload.
//
// GIFs are passed through untouched: a canvas re-encode would keep the first
// frame and silently kill the animation, which is worse than refusing.

export const MAX_MEDIA_BYTES = 450 * 1024

// Widest sensible edge for a phone screen. Beyond this is bytes nobody sees.
const MAX_EDGE = 1200

function loadImage(file) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file)
    const img = new Image()
    img.onload = () => { URL.revokeObjectURL(url); resolve(img) }
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('That file could not be read as an image.')) }
    img.src = url
  })
}

function canvasToBlob(canvas, type, quality) {
  return new Promise(resolve => canvas.toBlob(resolve, type, quality))
}

/**
 * Return a file small enough to send, or throw with a message worth showing.
 *
 * @returns {Promise<{file: File, originalBytes: number, bytes: number, resized: boolean}>}
 */
export async function shrinkImage(file) {
  const originalBytes = file.size

  if (file.type === 'image/gif') {
    if (originalBytes > MAX_MEDIA_BYTES) {
      throw new Error(
        `That GIF is ${Math.round(originalBytes / 1024)} KB. Animated GIFs cannot be resized here without losing the ` +
        `animation, so it needs to be under ${Math.round(MAX_MEDIA_BYTES / 1024)} KB before uploading.`
      )
    }
    return { file, originalBytes, bytes: originalBytes, resized: false }
  }

  if (file.type !== 'image/jpeg' && file.type !== 'image/png') {
    throw new Error('MMS supports JPEG, PNG and GIF only.')
  }

  if (originalBytes <= MAX_MEDIA_BYTES) {
    return { file, originalBytes, bytes: originalBytes, resized: false }
  }

  const img = await loadImage(file)
  const scale = Math.min(1, MAX_EDGE / Math.max(img.width, img.height))
  const canvas = document.createElement('canvas')
  canvas.width = Math.max(1, Math.round(img.width * scale))
  canvas.height = Math.max(1, Math.round(img.height * scale))
  const ctx = canvas.getContext('2d')

  // PNG screenshots with transparency go to white rather than black once
  // flattened into JPEG.
  ctx.fillStyle = '#ffffff'
  ctx.fillRect(0, 0, canvas.width, canvas.height)
  ctx.drawImage(img, 0, 0, canvas.width, canvas.height)

  // Step the quality down until it fits. JPEG regardless of input, because a
  // PNG photo will not get under the cap at any useful resolution.
  for (const quality of [0.82, 0.7, 0.6, 0.5, 0.4]) {
    const blob = await canvasToBlob(canvas, 'image/jpeg', quality)
    if (blob && blob.size <= MAX_MEDIA_BYTES) {
      const name = file.name.replace(/\.[^.]+$/, '') + '.jpg'
      return {
        file: new File([blob], name, { type: 'image/jpeg' }),
        originalBytes,
        bytes: blob.size,
        resized: true,
      }
    }
  }

  throw new Error(
    'That image could not be compressed under the carrier limit. Try a smaller or simpler image.'
  )
}

export function formatBytes(n) {
  const bytes = Number(n) || 0
  if (bytes < 1024) return bytes + ' B'
  if (bytes < 1024 * 1024) return Math.round(bytes / 1024) + ' KB'
  return (bytes / (1024 * 1024)).toFixed(1) + ' MB'
}
