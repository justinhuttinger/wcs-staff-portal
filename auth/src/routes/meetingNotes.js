// auth/src/routes/meetingNotes.js
// Admin routes for the meeting-notes job:
//   - a dedicated Google connect flow that requests the SUPERSET of scopes
//     (Sheets/Drive + Documents + Calendar events) so the owner's token can
//     create Docs and attach them to calendar events. Kept separate from the
//     Sheets-export flow so ordinary staff aren't asked for Calendar/Docs.
//   - status + manual run for the poller.
const { Router } = require('express')
const crypto = require('crypto')
const authenticate = require('../middleware/auth')
const { requireRole } = require('../middleware/role')
const { supabaseAdmin } = require('../services/supabase')
const { runOnce } = require('../services/meetingNotes')
const { enabledMeetings, ENABLED_ENV, GOOGLE_OWNER_EMAIL } = require('../services/meetingNotes/config')

const router = Router()

const GOOGLE_CLIENT_ID = process.env.GOOGLE_BUSINESS_CLIENT_ID
const GOOGLE_CLIENT_SECRET = process.env.GOOGLE_BUSINESS_CLIENT_SECRET
const AUTH_API_URL = process.env.AUTH_API_URL || 'https://api.wcstrength.com'
const REDIRECT_URI = `${AUTH_API_URL}/meeting-notes/callback`

// Superset: existing Sheets/Drive scopes PLUS Documents + Calendar events.
// drive.file already covers Docs we create; documents lets us write their body;
// calendar.events lets us attach Docs to and annotate meeting events.
const SCOPES = [
  'https://www.googleapis.com/auth/spreadsheets',
  'https://www.googleapis.com/auth/drive.file',
  'https://www.googleapis.com/auth/documents',
  'https://www.googleapis.com/auth/calendar.events',
  'openid',
  'email',
].join(' ')

const STATE_TTL_MS = 10 * 60 * 1000
const stateMap = new Map()
function setState(staffId) {
  const state = crypto.randomBytes(24).toString('base64url')
  stateMap.set(state, { staffId, expires: Date.now() + STATE_TTL_MS })
  for (const [k, v] of stateMap) if (v.expires < Date.now()) stateMap.delete(k)
  return state
}
function consumeState(state) {
  const e = stateMap.get(state)
  if (!e) return null
  stateMap.delete(state)
  return e.expires < Date.now() ? null : e
}

async function fetchGoogleEmail(accessToken) {
  const res = await fetch('https://openidconnect.googleapis.com/v1/userinfo', {
    headers: { Authorization: 'Bearer ' + accessToken },
  })
  if (!res.ok) return ''
  const info = await res.json().catch(() => ({}))
  return info.email || ''
}

// NOTE: auth is applied per-route, NOT globally, because /callback is hit by
// Google's redirect with no Authorization header. A global router.use(auth)
// would 401 that callback ("Missing or invalid authorization header").
const admin = [authenticate, requireRole('admin')]

// Status: connection state of the owner account + job config.
router.get('/status', admin, async (req, res) => {
  try {
    const { data } = await supabaseAdmin
      .from('staff').select('id').eq('email', GOOGLE_OWNER_EMAIL).maybeSingle()
    let google = { connected: false }
    if (data) {
      const { data: tok } = await supabaseAdmin
        .from('staff_google_tokens').select('email, scope, expires_at').eq('staff_id', data.id).maybeSingle()
      if (tok) {
        const hasDocs = (tok.scope || '').includes('documents')
        const hasCal = (tok.scope || '').includes('calendar')
        google = { connected: true, email: tok.email, hasDocs, hasCalendar: hasCal,
          ready: hasDocs && hasCal }
      }
    }
    res.json({
      enabled: process.env[ENABLED_ENV] === 'true',
      ownerEmail: GOOGLE_OWNER_EMAIL,
      google,
      meetings: enabledMeetings().map((m) => m.key),
    })
  } catch (e) { res.status(500).json({ error: e.message }) }
})

// Issue a consent URL bound to the requesting admin (who should be the owner).
router.post('/authorize-url', admin, (req, res) => {
  if (!GOOGLE_CLIENT_ID) return res.status(500).json({ error: 'Google OAuth not configured' })
  const state = setState(req.staff.id)
  const url = 'https://accounts.google.com/o/oauth2/v2/auth?' + new URLSearchParams({
    client_id: GOOGLE_CLIENT_ID, redirect_uri: REDIRECT_URI, response_type: 'code',
    scope: SCOPES, access_type: 'offline', prompt: 'consent', include_granted_scopes: 'true', state,
  })
  res.json({ url })
})

// OAuth callback (public — comes from Google; bound to staff via state).
router.get('/callback', async (req, res) => {
  const closeHtml = (msg, ok = true) => `<!DOCTYPE html><html><head><meta charset="utf-8">`
    + `<title>Meeting Notes ${ok ? 'Connected' : 'Error'}</title></head><body style="font:14px system-ui;padding:32px;text-align:center">`
    + `<h1 style="color:${ok ? '#2e7d32' : '#c62828'}">${ok ? 'Connected ✓' : 'Connection failed'}</h1><p>${msg}</p>`
    + `<script>try{window.opener&&window.opener.postMessage({type:'meeting-notes-auth',ok:${ok}},'*')}catch(e){}setTimeout(()=>window.close(),${ok ? 1500 : 4000})</script></body></html>`
  const { code, error, state } = req.query
  if (error) return res.status(400).send(closeHtml('Authorization denied: ' + error, false))
  if (!code || !state) return res.status(400).send(closeHtml('Missing code or state', false))
  const entry = consumeState(state)
  if (!entry) return res.status(400).send(closeHtml('Invalid or expired state — retry from the portal', false))
  try {
    const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ code, client_id: GOOGLE_CLIENT_ID, client_secret: GOOGLE_CLIENT_SECRET,
        redirect_uri: REDIRECT_URI, grant_type: 'authorization_code' }),
    })
    const tokens = await tokenRes.json()
    if (tokens.error || !tokens.refresh_token) {
      throw new Error(tokens.error_description || tokens.error || 'No refresh_token — Disconnect then Connect again.')
    }
    const email = await fetchGoogleEmail(tokens.access_token)
    const expiresAt = new Date(Date.now() + (tokens.expires_in || 3600) * 1000).toISOString()
    const { error: upErr } = await supabaseAdmin.from('staff_google_tokens').upsert({
      staff_id: entry.staffId, email, access_token: tokens.access_token,
      refresh_token: tokens.refresh_token, expires_at: expiresAt, scope: tokens.scope || SCOPES,
    }, { onConflict: 'staff_id' })
    if (upErr) throw upErr
    res.send(closeHtml(`Signed in as ${email || 'your Google account'} with Docs + Calendar access.`, true))
  } catch (e) { res.status(500).send(closeHtml(e.message || 'Token exchange failed', false)) }
})

// Manual poll (fire-and-forget; it processes any unhandled meeting docs).
router.post('/run', admin, (req, res) => {
  runOnce().catch((e) => console.error('[MeetingNotes] manual run failed:', e.message))
  res.json({ started: true })
})

module.exports = router
