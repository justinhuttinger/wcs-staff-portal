// Pure helpers behind public ticket-file share links.
//
// A share token is the ENTIRE credential for a file that anyone on the
// internet can fetch, so the rules that decide what a token looks like, how
// the bytes are served, and what the link says are worth testing on their own,
// away from Express and Supabase.

// 32 random bytes, hex. Anything else reaching /public/ticket-file is a
// scanner, and rejecting it on shape saves a database round trip.
const SHARE_TOKEN_BYTES = 32
const SHARE_TOKEN_RE = /^[a-f0-9]{64}$/

function isShareToken(token) {
  return typeof token === 'string' && SHARE_TOKEN_RE.test(token)
}

// Content types a browser may render in a tab. Everything else is forced to
// download, so a shared .html or .svg can never run script on the API's own
// origin and reach for a session cookie.
const INLINE_TYPES = new Set([
  'application/pdf',
  'image/png', 'image/jpeg', 'image/gif', 'image/webp', 'image/avif',
  'text/plain',
])

function dispositionMode(contentType) {
  const base = String(contentType || '').split(';')[0].trim().toLowerCase()
  return INLINE_TYPES.has(base) ? 'inline' : 'attachment'
}

// RFC 6266: a quoted ASCII filename every client understands, plus filename*
// so clients that support it get the real unicode name back.
function contentDisposition(mode, name) {
  const safe = String(name || 'file').replace(/[\r\n"]/g, '_')
  const ascii = safe.replace(/[^\x20-\x7e]/g, '_')
  return `${mode}; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(safe)}`
}

// PUBLIC_API_BASE_URL wins when set (custom domains); otherwise the host the
// request actually arrived on, which `trust proxy` makes honest on Render.
function apiOrigin({ configured, protocol, host }) {
  const fixed = String(configured || '').trim().replace(/\/+$/, '')
  if (fixed) return fixed
  return `${protocol}://${host}`
}

function buildShareUrl(origin, token) {
  return token ? `${origin}/public/ticket-file/${token}` : null
}

module.exports = {
  SHARE_TOKEN_BYTES, isShareToken, dispositionMode, contentDisposition, apiOrigin, buildShareUrl,
}
