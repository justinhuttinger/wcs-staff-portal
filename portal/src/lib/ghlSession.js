// The signed-in GHL user's session token, handed over by the Agency Custom JS
// "Send to portal" button as #open/workflowTransfer?ghl=<jwt>. Workflow
// Transfer needs it because GHL only reads and writes full workflows through
// its internal API, which runs as a logged-in user.
//
// Read once at module load (and on hashchange, for a portal tab that is
// already open), then wiped from the address bar: it is a live credential.
// Kept in sessionStorage only, so it dies with the tab, and sent per request
// to our API, which never stores it.

const KEY = 'wcs.ghlSession'
const HASH_RE = /^#open\/workflowTransfer[?&]ghl=([\w.-]+)/
export const GHL_SESSION_EVENT = 'wcs:ghl-session'

function decodeExp(token) {
  try {
    let part = token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/')
    part += '='.repeat((4 - (part.length % 4)) % 4)
    const exp = JSON.parse(atob(part)).exp
    return typeof exp === 'number' ? exp * 1000 : null
  } catch {
    return null
  }
}

export function setGhlSession(raw) {
  const token = String(raw || '').replace(/^Bearer\s+/i, '').trim()
  if (!/^[\w-]+\.[\w-]+\.[\w-]+$/.test(token)) return false
  try { sessionStorage.setItem(KEY, token) } catch { /* private mode: memory only */ }
  memory = token
  window.dispatchEvent(new Event(GHL_SESSION_EVENT))
  return true
}

let memory = null

export function getGhlSession() {
  let token = memory
  try { token = sessionStorage.getItem(KEY) || token } catch { /* ignore */ }
  if (!token) return null
  const expiresAt = decodeExp(token)
  if (expiresAt && expiresAt < Date.now()) return null
  return { token, expiresAt }
}

export function clearGhlSession() {
  memory = null
  try { sessionStorage.removeItem(KEY) } catch { /* ignore */ }
  window.dispatchEvent(new Event(GHL_SESSION_EVENT))
}

function captureFromHash() {
  const m = window.location.hash.match(HASH_RE)
  if (!m) return false
  history.replaceState(null, '', window.location.pathname + window.location.search + '#open/workflowTransfer')
  return setGhlSession(decodeURIComponent(m[1]))
}

captureFromHash()
window.addEventListener('hashchange', () => {
  if (captureFromHash()) window.dispatchEvent(new Event('wcs:open-workflow-transfer'))
})
