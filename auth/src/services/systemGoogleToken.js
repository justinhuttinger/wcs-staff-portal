/**
 * Google OAuth tokens for portal-owned sender accounts.
 *
 * Assignment and @mention DMs are sent as the actor with their own token
 * (services/googleUserToken.js). A ticket CREATION notice has no natural human
 * sender — it comes from the portal — so it goes out from a dedicated account,
 * noreply@wcstrength.com, connected once by an admin and stored in
 * system_google_tokens keyed by purpose.
 *
 * Mirrors getStaffGoogleAccessToken: return the stored access token, or
 * refresh it and persist the new one. Throws with `notConnected: true` when
 * no account has been linked for that purpose yet.
 */

const { supabaseAdmin } = require('./supabase')

const GOOGLE_CLIENT_ID = process.env.GOOGLE_BUSINESS_CLIENT_ID
const GOOGLE_CLIENT_SECRET = process.env.GOOGLE_BUSINESS_CLIENT_SECRET
const REFRESH_BUFFER_MS = 5 * 60 * 1000

// The sender for ticket creation notices. Configurable so a different mailbox
// can take over without a migration.
const TICKET_NOTIFIER = 'ticket_notifier'
const TICKET_NOTIFIER_EMAIL = process.env.TICKET_NOTIFIER_EMAIL || 'noreply@wcstrength.com'

async function refreshAccessToken(refreshToken) {
  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: GOOGLE_CLIENT_ID,
      client_secret: GOOGLE_CLIENT_SECRET,
      refresh_token: refreshToken,
      grant_type: 'refresh_token',
    }),
  })
  const data = await res.json().catch(() => ({}))
  if (!res.ok || data.error) {
    const err = new Error(data.error_description || data.error || 'Token refresh failed')
    if (data.error === 'invalid_grant') err.notConnected = true
    throw err
  }
  return data.access_token
}

async function getSystemToken(purpose = TICKET_NOTIFIER) {
  const { data, error } = await supabaseAdmin
    .from('system_google_tokens')
    .select('email, access_token, refresh_token, expires_at, scope')
    .eq('purpose', purpose)
    .maybeSingle()
  if (error) throw error
  if (!data) {
    const err = new Error(`No system Google account connected for "${purpose}"`)
    err.notConnected = true
    throw err
  }

  const expiresAtMs = data.expires_at ? new Date(data.expires_at).getTime() : 0
  if (data.access_token && expiresAtMs - Date.now() > REFRESH_BUFFER_MS) {
    return { accessToken: data.access_token, email: data.email }
  }

  const accessToken = await refreshAccessToken(data.refresh_token)
  await supabaseAdmin
    .from('system_google_tokens')
    .update({ access_token: accessToken, expires_at: new Date(Date.now() + 3600 * 1000).toISOString(), updated_at: new Date().toISOString() })
    .eq('purpose', purpose)
  return { accessToken, email: data.email }
}

// Status for the admin panel: is a sender linked, which mailbox, does it carry
// the Chat scopes?
async function getSystemTokenStatus(purpose = TICKET_NOTIFIER) {
  const { data } = await supabaseAdmin
    .from('system_google_tokens')
    .select('email, scope, connected_at, updated_at')
    .eq('purpose', purpose)
    .maybeSingle()
  if (!data) return { connected: false, expected_email: TICKET_NOTIFIER_EMAIL }
  const scope = data.scope || ''
  return {
    connected: true,
    email: data.email,
    expected_email: TICKET_NOTIFIER_EMAIL,
    // A mailbox other than the configured one still works, but say so plainly.
    matches_expected: String(data.email).toLowerCase() === TICKET_NOTIFIER_EMAIL.toLowerCase(),
    has_chat: /auth\/chat\.messages/.test(scope) && /auth\/chat\.spaces/.test(scope),
    connected_at: data.connected_at,
  }
}

module.exports = {
  TICKET_NOTIFIER,
  TICKET_NOTIFIER_EMAIL,
  getSystemToken,
  getSystemTokenStatus,
}
