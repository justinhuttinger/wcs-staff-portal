// Verifies that a request to the Projects Chat app really came from Google
// Chat. Chat (as a Google Workspace add-on) sends a Google-signed OIDC ID
// token as `Authorization: Bearer <token>`. We check, with no extra
// dependency:
//   - RS256 signature against Google's published keys (JWKS, cached)
//   - iss is Google, aud is exactly our endpoint URL, not expired
//   - email is the Chat app's add-on service account and is verified
// Anything else is rejected.

const crypto = require('crypto')

const JWKS_URL = 'https://www.googleapis.com/oauth2/v3/certs'
const ISSUERS = new Set(['accounts.google.com', 'https://accounts.google.com'])
const SKEW_S = 60

let cache = { keys: null, until: 0 }

async function fetchKeys(fetchImpl = fetch) {
  if (cache.keys && Date.now() < cache.until) return cache.keys
  const res = await fetchImpl(JWKS_URL)
  if (!res.ok) throw new Error(`Google keys ${res.status}`)
  const body = await res.json()
  const maxAge = Number((/max-age=(\d+)/.exec(res.headers?.get?.('cache-control') || '') || [])[1]) || 3600
  cache = { keys: body.keys || [], until: Date.now() + maxAge * 1000 }
  return cache.keys
}

function b64urlJson(part) {
  return JSON.parse(Buffer.from(part, 'base64url').toString('utf8'))
}

// Returns { ok: true, payload } or { ok: false, reason }.
async function verifyChatToken(token, { audience, serviceAccountEmail, getKeys = fetchKeys, now = Date.now() } = {}) {
  try {
    if (!token) return { ok: false, reason: 'no token' }
    if (!audience || !serviceAccountEmail) return { ok: false, reason: 'not configured' }
    const parts = String(token).split('.')
    if (parts.length !== 3) return { ok: false, reason: 'malformed token' }
    const header = b64urlJson(parts[0])
    const payload = b64urlJson(parts[1])
    if (header.alg !== 'RS256') return { ok: false, reason: 'unexpected alg' }

    const keys = await getKeys()
    const jwk = keys.find(k => k.kid === header.kid)
    if (!jwk) return { ok: false, reason: 'unknown key' }
    const key = crypto.createPublicKey({ key: jwk, format: 'jwk' })
    const signed = Buffer.from(`${parts[0]}.${parts[1]}`)
    const valid = crypto.verify('RSA-SHA256', signed, key, Buffer.from(parts[2], 'base64url'))
    if (!valid) return { ok: false, reason: 'bad signature' }

    const nowS = Math.floor(now / 1000)
    if (!ISSUERS.has(payload.iss)) return { ok: false, reason: 'bad issuer' }
    const aud = Array.isArray(payload.aud) ? payload.aud : [payload.aud]
    if (!aud.includes(audience)) return { ok: false, reason: 'bad audience' }
    if (!(payload.exp > nowS - SKEW_S)) return { ok: false, reason: 'expired' }
    if (payload.iat && payload.iat > nowS + SKEW_S) return { ok: false, reason: 'issued in the future' }
    if (String(payload.email || '').toLowerCase() !== String(serviceAccountEmail).toLowerCase()) return { ok: false, reason: 'wrong service account' }
    if (payload.email_verified !== true && payload.email_verified !== 'true') return { ok: false, reason: 'email not verified' }
    return { ok: true, payload }
  } catch (e) {
    return { ok: false, reason: e.message }
  }
}

function bearer(req) {
  const h = String(req.headers?.authorization || '')
  return h.startsWith('Bearer ') ? h.slice(7).trim() : null
}

module.exports = { verifyChatToken, bearer, _resetKeyCache: () => { cache = { keys: null, until: 0 } } }
