/**
 * Per-staff Google OAuth token retrieval. Looks up the row in
 * staff_google_tokens, refreshes the access_token if it's near expiry,
 * persists the new token, and returns it.
 *
 * Throws an error tagged `notConnected: true` when the user hasn't
 * connected yet — callers should surface that distinctly so the UI can
 * prompt them to click "Connect Google".
 */

const { supabaseAdmin } = require('./supabase')

const GOOGLE_CLIENT_ID = process.env.GOOGLE_BUSINESS_CLIENT_ID
const GOOGLE_CLIENT_SECRET = process.env.GOOGLE_BUSINESS_CLIENT_SECRET
const REFRESH_BUFFER_MS = 5 * 60 * 1000 // refresh if expiring within 5 min

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
    // If Google rejected the refresh_token (revoked, expired, scope
    // change), the user has to reconnect.
    if (data.error === 'invalid_grant') err.notConnected = true
    throw err
  }
  return data.access_token
}

async function getStaffGoogleAccessToken(staffId) {
  if (!staffId) {
    const err = new Error('staffId required')
    err.status = 400
    throw err
  }
  const { data, error } = await supabaseAdmin
    .from('staff_google_tokens')
    .select('access_token, refresh_token, expires_at, email')
    .eq('staff_id', staffId)
    .maybeSingle()
  if (error) throw error
  if (!data) {
    const err = new Error('Google not connected for this user')
    err.notConnected = true
    err.status = 412 // Precondition Required-ish
    throw err
  }
  const expiresAtMs = data.expires_at ? new Date(data.expires_at).getTime() : 0
  if (data.access_token && expiresAtMs - Date.now() > REFRESH_BUFFER_MS) {
    return { accessToken: data.access_token, email: data.email }
  }
  // Refresh.
  const newAccess = await refreshAccessToken(data.refresh_token)
  const newExpires = new Date(Date.now() + 3600 * 1000).toISOString()
  await supabaseAdmin
    .from('staff_google_tokens')
    .update({ access_token: newAccess, expires_at: newExpires })
    .eq('staff_id', staffId)
  return { accessToken: newAccess, email: data.email }
}

module.exports = { getStaffGoogleAccessToken }
