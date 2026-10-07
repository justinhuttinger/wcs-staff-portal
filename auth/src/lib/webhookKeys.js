// Custom Webhook steps carry a GHL keychain key (authorization token
// "WFKC_kc_...") that belongs to ONE sub-account. It has no name to match by,
// so the normal remap leaves it alone, and a copied workflow would keep calling
// GHL with the source club's key (found 2026-10-07: the voicemail chain's
// internal-note webhooks in 4 clubs ended up on Salem's key).
//
// Each club's own key is learned from what that club's workflows used before:
// the backups in ghl_workflow_snapshots. The most common key there that is not
// one of the source's keys is the club's key.
const KEY_RE = /WFKC_kc_[A-Za-z0-9]+/g

function keysIn(value) {
  const text = typeof value === 'string' ? value : JSON.stringify(value ?? '')
  return new Set(text.match(KEY_RE) || [])
}

// history: array of payloads (or strings) seen in the target club.
// Returns { key, candidates } where key is null when none is known.
function pickClubKey(history, exclude) {
  const counts = new Map()
  for (const h of history || []) {
    for (const k of keysIn(h)) if (!exclude.has(k)) counts.set(k, (counts.get(k) || 0) + 1)
  }
  const ranked = [...counts.entries()].sort((a, b) => b[1] - a[1]).map(([k]) => k)
  return { key: ranked[0] || null, candidates: ranked }
}

// Masked for display: never show a whole key in the UI or logs.
const maskKey = k => (k ? `${k.slice(0, 12)}…` : '')

module.exports = { KEY_RE, keysIn, pickClubKey, maskKey }
