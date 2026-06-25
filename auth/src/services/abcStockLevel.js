// ABC Financial "PUT Stock Level" client for the Inventory tool. Mirrors portal
// restocks (action=add) and physical counts (action=override) to ABC so its
// inStock reflects the floor. unitCost is omitted by default (ABC requires it to
// match a previously-available value or it rejects the whole PUT); set
// ABC_STOCK_PUSH_SEND_COST=1 to include it.

const ABC_BASE_URL = process.env.ABC_BASE_URL || 'https://api.abcfinancial.com/rest'
const ABC_APP_ID = process.env.ABC_APP_ID
const ABC_APP_KEY = process.env.ABC_APP_KEY

// ABC bans these characters in notes (API-CLU-ITM-0009).
const BANNED_NOTES_CHARS = /[#$&*()`={}:<>?\[\];'',/\\]/g

function sanitizeNotes(s) {
  if (!s) return ''
  return String(s).replace(BANNED_NOTES_CHARS, '').replace(/\s+/g, ' ').trim().slice(0, 500)
}

// Build the PUT body, applying ABC's validation rules. Returns { ok:false,
// skipReason } when the value cannot legally be sent (so the caller marks the
// movement 'skipped' rather than attempting a doomed request).
function buildStockBody({ action, quantity, unitCost, vendor, reason, notes }) {
  if (action !== 'add' && action !== 'override') return { ok: false, skipReason: `bad action ${action}` }
  const q = Number(quantity)
  if (!Number.isFinite(q)) return { ok: false, skipReason: 'non-numeric quantity' }
  if (action === 'add') {
    if (!Number.isInteger(q) || q <= 0) return { ok: false, skipReason: 'add quantity must be a positive integer' }
    if (q > 9999) return { ok: false, skipReason: 'add quantity exceeds 4 digits' }
  } else { // override
    if (q < 0) return { ok: false, skipReason: 'override quantity must be >= 0' }
  }
  const body = { action, quantity: String(Math.trunc(q)) }
  if (Number.isFinite(Number(unitCost))) body.unitCost = Number(unitCost).toFixed(2)
  if (vendor) body.vendor = String(vendor).slice(0, 100)
  if (action === 'add') body.reason = reason || 'Received' // override: no reason
  const n = sanitizeNotes(notes)
  if (n) body.notes = n
  return { ok: true, body }
}

// Parse an ABC response envelope. benign=true means "ABC declined but it's a
// no-op we can treat as already-synced" (override equals current stock).
function classifyAbcResult(json) {
  const code = json?.status?.messageCode || null
  if (code && code !== 'API-CLU-ITM-0010' && /-0000$/.test(code)) {
    return { ok: true, code, message: json?.status?.message || null, benign: false }
  }
  const errs = Array.isArray(json?.errorMessages) ? json.errorMessages : []
  if (errs.length === 0 && (!code || /-0000$/.test(code))) {
    return { ok: true, code, message: json?.status?.message || null, benign: false }
  }
  const first = errs[0] || {}
  const errCode = first.messageCode || code
  return {
    ok: false,
    code: errCode || null,
    message: first.message || json?.status?.message || null,
    benign: errCode === 'API-CLU-ITM-0007',
  }
}

module.exports = { buildStockBody, sanitizeNotes, classifyAbcResult, ABC_BASE_URL, ABC_APP_ID, ABC_APP_KEY }
