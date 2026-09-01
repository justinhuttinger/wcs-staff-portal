// auth/src/lib/dripMedia.js
//
// The media half of a drip message.
//
// GHL attaches media to an SMS by putting a URL in a custom value and pasting
// that custom value into the workflow action's attachment field. The workflow
// is edited by hand once; after that the attachment is whatever the custom
// value holds, so turning media on and off is just writing or clearing that
// value. Nothing about the workflow changes.
//
// Each message therefore gets a companion value: "VIP SMS 1" is paired with
// "VIP SMS 1 Media", which GHL keys as custom_values.vip_sms_1_media.

// Carriers, not GHL, enforce the ceiling, and they enforce it silently - an
// oversized MMS is simply never delivered to those subscribers. The worst of
// the common caps is AT&T / toll-free at 0.6 MB, so the usable budget is well
// under that once encoding overhead is counted.
const MAX_MEDIA_BYTES = 450 * 1024

// MMS carries these three and nothing else.
const ALLOWED_MIME = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/gif': 'gif',
}

const MEDIA_SUFFIX = '_media'
const MEDIA_LABEL_SUFFIX = ' Media'

function normalizeKey(key) {
  return String(key || '').replace(/[{}\s]/g, '')
}

/**
 * The companion media key for a message key.
 * "custom_values.vip_sms_1" -> "custom_values.vip_sms_1_media"
 */
function mediaKeyFor(messageKey) {
  const key = normalizeKey(messageKey)
  if (!key) return null
  if (key.endsWith(MEDIA_SUFFIX)) return key
  return key + MEDIA_SUFFIX
}

/**
 * The name to create the companion value under. GHL derives the fieldKey from
 * the name, so "VIP SMS 1" + " Media" is what produces vip_sms_1_media - the
 * name and the key have to stay in step or the token in the workflow breaks.
 */
function mediaNameFor(messageName) {
  const name = String(messageName || '').trim()
  if (!name) return null
  if (name.toLowerCase().endsWith(MEDIA_LABEL_SUFFIX.toLowerCase())) return name
  return name + MEDIA_LABEL_SUFFIX
}

/** Is this custom value a media companion rather than a message? */
function isMediaKey(key) {
  return normalizeKey(key).endsWith(MEDIA_SUFFIX)
}

/**
 * Validate an uploaded file before it reaches storage.
 * @returns {{ok: true, ext: string} | {ok: false, error: string}}
 */
function validateMedia({ mimetype, size } = {}) {
  const mime = String(mimetype || '').toLowerCase().split(';')[0].trim()
  const ext = ALLOWED_MIME[mime]
  if (!ext) {
    return { ok: false, error: 'MMS supports JPEG, PNG and GIF only. That file is ' + (mime || 'an unknown type') + '.' }
  }
  if (!Number.isFinite(size) || size <= 0) {
    return { ok: false, error: 'The file is empty.' }
  }
  if (size > MAX_MEDIA_BYTES) {
    return {
      ok: false,
      error: `That image is ${formatBytes(size)}. Carriers drop MMS over about 0.6 MB, so keep it under ${formatBytes(MAX_MEDIA_BYTES)}.`,
    }
  }
  return { ok: true, ext }
}

function formatBytes(n) {
  const bytes = Number(n) || 0
  if (bytes < 1024) return bytes + ' B'
  if (bytes < 1024 * 1024) return Math.round(bytes / 1024) + ' KB'
  return (bytes / (1024 * 1024)).toFixed(1) + ' MB'
}

/**
 * Storage path for a club's media. Scoped per club so one club's image can be
 * replaced without touching another's, and suffixed with a random token so a
 * replacement gets a new URL rather than being served from a CDN cache of the
 * old bytes.
 */
function mediaStoragePath({ clubSlug, mediaKey, ext }) {
  const club = String(clubSlug || 'unknown').replace(/[^a-z0-9-]/gi, '').toLowerCase()
  const key = normalizeKey(mediaKey).replace(/^custom_values\./, '').replace(/[^a-z0-9_]/gi, '')
  const token = Math.random().toString(36).slice(2, 10)
  return `${club}/${key}-${Date.now()}-${token}.${ext}`
}

module.exports = {
  MAX_MEDIA_BYTES,
  ALLOWED_MIME,
  mediaKeyFor,
  mediaNameFor,
  isMediaKey,
  validateMedia,
  formatBytes,
  mediaStoragePath,
  normalizeKey,
}
