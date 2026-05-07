/**
 * Per-user Google OAuth flow for Sheets/Drive export.
 *
 * Each staff member connects their own Google account; tokens are stored
 * in `staff_google_tokens` keyed by staff.id. Sheets created via the
 * export endpoints land in *that user's* Drive — not a shared admin
 * account.
 *
 * Endpoints:
 *   GET  /google-sheets/status         -> { connected, email?, expires_at? }
 *   GET  /google-sheets/authorize      -> redirects to Google consent
 *   GET  /google-sheets/callback       -> Google -> exchange -> close window
 *   POST /google-sheets/disconnect     -> deletes the user's token
 */

const { Router } = require('express')
const crypto = require('crypto')
const authenticate = require('../middleware/auth')
const { supabaseAdmin } = require('../services/supabase')

const router = Router()

// Same OAuth client as Google Business — requires the new redirect_uri to
// be added to the OAuth consent screen's "Authorized redirect URIs" list.
const GOOGLE_CLIENT_ID = process.env.GOOGLE_BUSINESS_CLIENT_ID
const GOOGLE_CLIENT_SECRET = process.env.GOOGLE_BUSINESS_CLIENT_SECRET
const AUTH_API_URL = process.env.AUTH_API_URL || 'https://api.wcstrength.com'
const PORTAL_URL = process.env.PORTAL_URL || 'https://portal.wcstrength.com'
const REDIRECT_URI = `${AUTH_API_URL}/google-sheets/callback`

// Minimum scopes needed to create + write a Sheet in the user's own Drive.
// `userinfo.email` lets us record which Google account they connected
// (useful for the UI status display).
const SCOPES = [
  'https://www.googleapis.com/auth/spreadsheets',
  'https://www.googleapis.com/auth/drive.file',
  'openid',
  'email',
].join(' ')

// In-memory state map: random state -> { staffId, expires }. Used to bind
// the OAuth callback back to the staff member who started the flow. Self-
// expires after 10 min.
const STATE_TTL_MS = 10 * 60 * 1000
const stateMap = new Map()

function setState(staffId) {
  const state = crypto.randomBytes(24).toString('base64url')
  stateMap.set(state, { staffId, expires: Date.now() + STATE_TTL_MS })
  // Best-effort cleanup so the map doesn't grow unbounded
  for (const [k, v] of stateMap) {
    if (v.expires < Date.now()) stateMap.delete(k)
  }
  return state
}

function consumeState(state) {
  const entry = stateMap.get(state)
  if (!entry) return null
  stateMap.delete(state)
  if (entry.expires < Date.now()) return null
  return entry
}

async function fetchGoogleUserInfo(accessToken) {
  const res = await fetch('https://openidconnect.googleapis.com/v1/userinfo', {
    headers: { Authorization: 'Bearer ' + accessToken },
  })
  if (!res.ok) return {}
  return res.json().catch(() => ({}))
}

// GET /google-sheets/status — does the requesting user have a token?
router.get('/status', authenticate, async (req, res) => {
  try {
    const { data, error } = await supabaseAdmin
      .from('staff_google_tokens')
      .select('email, scope, expires_at, connected_at')
      .eq('staff_id', req.staff.id)
      .maybeSingle()
    if (error) throw error
    if (!data) return res.json({ connected: false })
    res.json({
      connected: true,
      email: data.email,
      scope: data.scope,
      expires_at: data.expires_at,
      connected_at: data.connected_at,
    })
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

// POST /google-sheets/authorize-url — issues a Google OAuth consent URL
// pre-bound to this staff member via a server-side state token. The
// frontend opens the returned URL in a popup. We use POST + auth header
// (rather than a top-level redirect) so the user's bearer token doesn't
// have to ride along on a redirect.
router.post('/authorize-url', authenticate, (req, res) => {
  if (!GOOGLE_CLIENT_ID) return res.status(500).json({ error: 'Google OAuth not configured' })
  const state = setState(req.staff.id)
  const url = 'https://accounts.google.com/o/oauth2/v2/auth?' + new URLSearchParams({
    client_id: GOOGLE_CLIENT_ID,
    redirect_uri: REDIRECT_URI,
    response_type: 'code',
    scope: SCOPES,
    access_type: 'offline',
    prompt: 'consent',
    include_granted_scopes: 'true',
    state,
  })
  res.json({ url })
})

// GET /google-sheets/callback — Google redirects here. Public (no auth
// middleware) because the request comes from Google, not the user's
// session — but we look up the staff by the state we issued.
router.get('/callback', async (req, res) => {
  const { code, error, state } = req.query
  const closeHtml = (msg, ok = true) => `
<!DOCTYPE html>
<html><head><title>Google Sheets — ${ok ? 'Connected' : 'Error'}</title>
<style>body{font:14px/1.5 system-ui,sans-serif;padding:32px;text-align:center;color:#333}
.ok{color:#2e7d32}.err{color:#c62828}
button{margin-top:16px;padding:8px 16px;font-size:14px;cursor:pointer}</style></head>
<body>
<h1 class="${ok ? 'ok' : 'err'}">${ok ? 'Connected to Google ✓' : 'Connection failed'}</h1>
<p>${msg}</p>
<p>You can close this window.</p>
<script>
  try { window.opener && window.opener.postMessage({ type: 'google-sheets-auth', ok: ${ok} }, '*') } catch(e){}
  setTimeout(() => window.close(), ${ok ? 1500 : 4000});
</script>
</body></html>`
  if (error) return res.status(400).send(closeHtml('Authorization denied: ' + error, false))
  if (!code || !state) return res.status(400).send(closeHtml('Missing code or state', false))

  const stateEntry = consumeState(state)
  if (!stateEntry) return res.status(400).send(closeHtml('Invalid or expired state — please retry from the portal', false))

  try {
    const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        code,
        client_id: GOOGLE_CLIENT_ID,
        client_secret: GOOGLE_CLIENT_SECRET,
        redirect_uri: REDIRECT_URI,
        grant_type: 'authorization_code',
      }),
    })
    const tokens = await tokenRes.json()
    if (tokens.error || !tokens.refresh_token) {
      // Without refresh_token we can't keep working past 1 hour. Force
      // re-consent (this happens if the user already granted before).
      throw new Error(
        tokens.error_description ||
        tokens.error ||
        'No refresh_token returned — try Disconnect, then Connect again.'
      )
    }

    const userinfo = await fetchGoogleUserInfo(tokens.access_token)
    const email = userinfo.email || ''

    const expiresAt = new Date(Date.now() + (tokens.expires_in || 3600) * 1000).toISOString()

    const { error: upErr } = await supabaseAdmin
      .from('staff_google_tokens')
      .upsert(
        {
          staff_id: stateEntry.staffId,
          email,
          access_token: tokens.access_token,
          refresh_token: tokens.refresh_token,
          expires_at: expiresAt,
          scope: tokens.scope || SCOPES,
        },
        { onConflict: 'staff_id' }
      )
    if (upErr) throw upErr

    res.send(closeHtml(`Signed in as ${email || 'your Google account'}.`, true))
  } catch (err) {
    res.status(500).send(closeHtml(err.message || 'Token exchange failed', false))
  }
})

// POST /google-sheets/disconnect — drop the user's token
router.post('/disconnect', authenticate, async (req, res) => {
  try {
    const { error } = await supabaseAdmin
      .from('staff_google_tokens')
      .delete()
      .eq('staff_id', req.staff.id)
    if (error) throw error
    res.json({ ok: true })
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

module.exports = router
module.exports.PORTAL_URL = PORTAL_URL
