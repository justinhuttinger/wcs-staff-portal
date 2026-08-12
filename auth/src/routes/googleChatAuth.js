/**
 * Per-user Google OAuth flow for the ticket -> Chat bridge.
 *
 * When a staff member assigns a ticket or @mentions someone, the target gets a
 * Google Chat DM sent AS the actor (see services/googleChat.js). That requires
 * the actor's stored Google token to carry the Chat scopes. This flow grants
 * them, reusing the same staff_google_tokens store and OAuth client as the
 * Sheets/Docs connect flows, with include_granted_scopes so it stacks on top of
 * (never replaces) any scopes they already granted.
 *
 * Endpoints:
 *   GET  /google-chat/status         -> { connected, has_chat, email? }
 *   POST /google-chat/authorize-url  -> { url } (open in a popup)
 *   GET  /google-chat/callback       -> Google -> exchange -> close window
 *   POST /google-chat/disconnect     -> revoke just the token row
 *
 * One-time Google Cloud setup: enable the Google Chat API on the OAuth project,
 * add the two chat scopes to the consent screen, and register
 * `${AUTH_API_URL}/google-chat/callback` as an authorized redirect URI.
 */

const { Router } = require('express')
const crypto = require('crypto')
const authenticate = require('../middleware/auth')
const { supabaseAdmin } = require('../services/supabase')
const { CHAT_SCOPES } = require('../services/googleChat')

const router = Router()

const GOOGLE_CLIENT_ID = process.env.GOOGLE_BUSINESS_CLIENT_ID
const GOOGLE_CLIENT_SECRET = process.env.GOOGLE_BUSINESS_CLIENT_SECRET
const AUTH_API_URL = process.env.AUTH_API_URL || 'https://api.wcstrength.com'
const REDIRECT_URI = `${AUTH_API_URL}/google-chat/callback`

// Chat scopes to send a DM as the actor, plus identity so we record which
// account they linked. include_granted_scopes merges these with prior grants.
const SCOPES = [...CHAT_SCOPES, 'openid', 'email'].join(' ')

function hasChatScope(scope) {
  return /auth\/chat\.messages/.test(scope || '') && /auth\/chat\.spaces/.test(scope || '')
}

// state -> { staffId, expires }, self-expiring (10 min). Binds the callback to
// the staff member who started the flow.
const STATE_TTL_MS = 10 * 60 * 1000
const stateMap = new Map()
function setState(staffId) {
  const state = crypto.randomBytes(24).toString('base64url')
  stateMap.set(state, { staffId, expires: Date.now() + STATE_TTL_MS })
  for (const [k, v] of stateMap) if (v.expires < Date.now()) stateMap.delete(k)
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

// GET /google-chat/status — is the caller connected, and does their token carry
// the Chat scopes (i.e. can they actually send DMs)?
router.get('/status', authenticate, async (req, res) => {
  try {
    const { data, error } = await supabaseAdmin
      .from('staff_google_tokens')
      .select('email, scope, expires_at, connected_at')
      .eq('staff_id', req.staff.id)
      .maybeSingle()
    if (error) throw error
    if (!data) return res.json({ connected: false, has_chat: false })
    res.json({
      connected: true,
      has_chat: hasChatScope(data.scope),
      email: data.email,
      expires_at: data.expires_at,
      connected_at: data.connected_at,
    })
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

// POST /google-chat/authorize-url — consent URL bound to this staff member.
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

// GET /google-chat/callback — Google redirects here (public; bound via state).
router.get('/callback', async (req, res) => {
  const { code, error, state } = req.query
  const closeHtml = (msg, ok = true) => `
<!DOCTYPE html>
<html><head><title>Google Chat — ${ok ? 'Connected' : 'Error'}</title>
<style>body{font:14px/1.5 system-ui,sans-serif;padding:32px;text-align:center;color:#333}
.ok{color:#2e7d32}.err{color:#c62828}</style></head>
<body>
<h1 class="${ok ? 'ok' : 'err'}">${ok ? 'Google Chat connected ✓' : 'Connection failed'}</h1>
<p>${msg}</p>
<p>You can close this window.</p>
<script>
  try { window.opener && window.opener.postMessage({ type: 'google-chat-auth', ok: ${ok} }, '*') } catch(e){}
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
      throw new Error(
        tokens.error_description || tokens.error ||
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

    if (!hasChatScope(tokens.scope)) {
      return res.send(closeHtml('Connected, but Chat permission was not granted. Reconnect and allow Google Chat access.', false))
    }
    res.send(closeHtml(`Signed in as ${email || 'your Google account'}.`, true))
  } catch (err) {
    res.status(500).send(closeHtml(err.message || 'Token exchange failed', false))
  }
})

// POST /google-chat/disconnect — drop the caller's token row.
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
