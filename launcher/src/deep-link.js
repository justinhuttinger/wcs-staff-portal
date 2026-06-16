// wcsportal:// one-time deep links.
//
// An admin mints a link (wcsportal://set-location?token=...) and sends it to a
// team member. Clicking it on the machine launches/focuses Portal and routes
// the URL here; we redeem the token with the auth API (single-use, expiring)
// and apply the returned location/abc_url via applyConfig.

const { API_URL } = require('./config')
const { getInstallId, getHostname } = require('./install-id')

const SCHEME = 'wcsportal'

let log = () => {}
function setLogger(fn) { log = fn || (() => {}) }

// Pull the wcsportal:// argument out of a process argv array (Windows passes
// the deep link as a launch arg).
function findDeepLink(argv) {
  if (!Array.isArray(argv)) return null
  return argv.find(a => typeof a === 'string' && a.startsWith(SCHEME + '://')) || null
}

function extractToken(url) {
  try {
    // new URL() on a custom scheme keeps the query intact.
    const u = new URL(url)
    return u.searchParams.get('token')
  } catch {
    const m = /[?&]token=([^&]+)/.exec(url || '')
    return m ? decodeURIComponent(m[1]) : null
  }
}

// Redeem a deep link and apply it. Resolves to true if applied.
async function redeemAndApply(url, applyConfig) {
  const token = extractToken(url)
  if (!token) { log('[deep-link] no token in ' + url); return false }
  try {
    const res = await fetch(API_URL + '/launcher/redeem', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({ token, install_id: getInstallId(), hostname: getHostname() }),
    })
    const data = await res.json().catch(() => ({}))
    if (!res.ok) { log('[deep-link] redeem rejected: ' + (data.error || res.status)); return false }
    if (!data.location) { log('[deep-link] redeem returned no location'); return false }
    log('[deep-link] applying location=' + data.location)
    if (applyConfig) applyConfig({ location: data.location, abc_url: data.abc_url })
    return true
  } catch (err) {
    log('[deep-link] redeem failed: ' + (err?.message || err))
    return false
  }
}

module.exports = { SCHEME, findDeepLink, extractToken, redeemAndApply, setLogger }
