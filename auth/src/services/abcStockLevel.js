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
    if (!Number.isInteger(q) || q < 0) return { ok: false, skipReason: 'override quantity must be a non-negative integer' }
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
  if (code && /-0000$/.test(code)) {
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

function abcHeaders() {
  return { app_id: ABC_APP_ID || '', app_key: ABC_APP_KEY || '', Accept: 'application/json', 'Content-Type': 'application/json' }
}

async function putStockLevel(clubNumber, saleItemId, opts, deps = {}) {
  const fetchImpl = deps.fetchImpl || fetch
  const built = buildStockBody(opts)
  if (!built.ok) return { status: 'skipped', code: null, error: built.skipReason }
  if (!clubNumber || !saleItemId) return { status: 'skipped', code: null, error: 'missing club or saleItemId' }
  const url = `${ABC_BASE_URL}/${clubNumber}/club/items/${saleItemId}`
  try {
    const res = await fetchImpl(url, {
      method: 'PUT', headers: abcHeaders(), body: JSON.stringify(built.body),
      signal: AbortSignal.timeout(30000),
    })
    let json = {}
    try { json = await res.json() } catch { json = {} }
    const c = classifyAbcResult(json)
    // benign (override == current) wins even on a 400 envelope. Otherwise a
    // success classification is only trusted on a 2xx — an HTTP error with a
    // non-JSON/empty body must NOT be read as success (it would be marked synced
    // and never retried, losing the stock change).
    if (c.benign) return { status: 'synced', code: c.code, error: null }
    if (c.ok && res.ok) return { status: 'synced', code: c.code, error: null }
    return { status: 'failed', code: c.code, error: (c.message || `HTTP ${res.status}`).slice(0, 500) }
  } catch (e) {
    return { status: 'failed', code: null, error: String(e.message || e).slice(0, 500) }
  }
}

// Map a movement kind to an ABC action. count = absolute set = override;
// adjustment/received = add. Anything else is not pushed.
function actionForKind(kind) {
  if (kind === 'count') return 'override'
  if (kind === 'adjustment' || kind === 'received') return 'add'
  return null
}

async function pushMovement(movementId, deps = {}) {
  const { supabaseAdmin } = require('./supabase')
  const db = deps.db || supabaseAdmin
  const sendCost = process.env.ABC_STOCK_PUSH_SEND_COST === '1'
  const { data: mv } = await db.from('inventory_movements').select('*').eq('id', movementId).maybeSingle()
  if (!mv) return { status: 'skipped', code: null, error: 'movement not found' }
  const action = actionForKind(mv.kind)
  if (!action) return { status: 'skipped', code: null, error: `kind ${mv.kind} not pushable` }

  const { data: item } = await db.from('inventory_items').select('sale_item_id, avg_unit_cost, last_unit_cost').eq('id', mv.item_id).maybeSingle()
  const saleItemId = item?.sale_item_id || null

  const quantity = action === 'override' ? mv.qty_after : mv.qty_delta
  const unitCost = sendCost ? (item?.avg_unit_cost ?? item?.last_unit_cost) : undefined
  let result
  if (!saleItemId) {
    result = { status: 'skipped', code: null, error: 'item has no ABC sale_item_id' }
  } else {
    result = await putStockLevel(mv.club_number, saleItemId, {
      action, quantity, unitCost, notes: mv.note || null,
    }, deps)
  }

  await db.from('inventory_movements').update({
    abc_push_status: result.status,
    abc_action: action,
    abc_push_error: result.error || null,
    abc_push_attempts: (mv.abc_push_attempts || 0) + 1,
    abc_pushed_at: new Date().toISOString(),
  }).eq('id', movementId)
  return result
}

module.exports = { buildStockBody, sanitizeNotes, classifyAbcResult, putStockLevel, pushMovement, actionForKind, ABC_BASE_URL, ABC_APP_ID, ABC_APP_KEY }
