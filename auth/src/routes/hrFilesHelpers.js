// Pure, dependency-free helpers for HR file uploads (routes/hrDocuments.js).
// Kept separate so they can be unit-tested without loading express/supabase.

const MAX_UPLOAD_BYTES = 15 * 1024 * 1024

// Extension -> the content type we store and serve. The extension is the
// source of truth: the browser's claimed mimetype is unreliable (a phone often
// sends HEIC as application/octet-stream), and everything is served back as a
// download, never rendered inline.
const ALLOWED_TYPES = {
  pdf: 'application/pdf',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  png: 'image/png',
  webp: 'image/webp',
  heic: 'image/heic',
  heif: 'image/heif',
  doc: 'application/msword',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  xls: 'application/vnd.ms-excel',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  txt: 'text/plain',
}

function extOf(fileName) {
  const m = /\.([a-z0-9]+)$/i.exec(String(fileName || '').trim())
  return m ? m[1].toLowerCase() : ''
}

function isAllowedFile(fileName) {
  return Object.prototype.hasOwnProperty.call(ALLOWED_TYPES, extOf(fileName))
}

function contentTypeFor(fileName) {
  return ALLOWED_TYPES[extOf(fileName)] || 'application/octet-stream'
}

// The name shown in the portal and used for the download. Strips any path a
// browser may have sent and anything that would break a header or a filesystem.
function cleanFileName(fileName) {
  const base = String(fileName || '').split(/[\\/]/).pop()
  const cleaned = base.replace(/[\x00-\x1f"<>:|?*]+/g, '').replace(/\s+/g, ' ').trim()
  return (cleaned || 'file').slice(-150)
}

// Storage keys never contain the original name: {club}/{worker}/{uuid}.{ext}.
function storagePath({ locationSlug, workerId, id, fileName }) {
  const seg = s => String(s || 'unknown').replace(/[^a-zA-Z0-9_-]+/g, '_')
  return `${seg(locationSlug)}/${seg(workerId)}/${id}.${extOf(fileName)}`
}

function contentDisposition(fileName) {
  const ascii = cleanFileName(fileName).replace(/[^\x20-\x7e]+/g, '_')
  return `attachment; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(cleanFileName(fileName))}`
}

module.exports = {
  MAX_UPLOAD_BYTES, ALLOWED_TYPES,
  extOf, isAllowedFile, contentTypeFor, cleanFileName, storagePath, contentDisposition,
}
