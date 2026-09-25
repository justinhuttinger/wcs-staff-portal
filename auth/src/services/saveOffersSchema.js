/**
 * Pure validation for WCS Save admin (routes/saveAdmin.js).
 *
 * The member-facing wcs-save Worker reads these rows straight from Supabase and
 * trusts them, so everything that reaches save_settings / save_reasons /
 * save_offers goes through here first. Shapes follow migration 211; the config
 * per offer_type is the contract the Worker applies to ABC.
 *
 * No I/O in this file so it can be unit tested (saveOffersSchema.test.js).
 */

const { NAME_TO_CLUB } = require('../config/clubMap')

const CLUB_NUMBERS = Object.values(NAME_TO_CLUB)
const OFFER_TYPES = ['dues_discount', 'freeze', 'perk']
// 'charge' exists in the table's check constraint but is reserved for the
// Stripe provider. Until that ships, the admin cannot pick it.
const OWED_BALANCE_MODES = ['staff', 'block']
const OUTCOMES = ['in_progress', 'saved', 'cancelled', 'needs_staff', 'abandoned', 'failed']

const SETTINGS_TEXT_FIELDS = [
  'intro_heading', 'intro_body',
  'saved_heading', 'saved_body',
  'cancelled_heading', 'cancelled_body',
  'staff_heading', 'staff_body',
]
const SETTINGS_BOOL_FIELDS = ['enabled', 'require_email_code']
const SETTINGS_EDITABLE = [
  ...SETTINGS_BOOL_FIELDS,
  'max_offers_shown',
  'owed_balance_mode',
  ...SETTINGS_TEXT_FIELDS,
  'staff_notify_emails',
]

const HEADLINE_MAX = 120
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/

function isUuid(v) {
  return typeof v === 'string' && UUID_RE.test(v)
}

function isValidEmail(v) {
  return typeof v === 'string' && v.length <= 254 && EMAIL_RE.test(v)
}

function toNumber(v) {
  if (v === null || v === undefined || v === '') return NaN
  const n = typeof v === 'number' ? v : Number(String(v).trim())
  return Number.isFinite(n) ? n : NaN
}

function isIntIn(n, min, max) {
  return Number.isInteger(n) && n >= min && n <= max
}

// A real calendar date in YYYY-MM-DD, or null for blank.
function normalizeDate(v) {
  if (v === null || v === undefined || v === '') return { ok: true, value: null }
  const s = String(v).trim()
  if (!DATE_RE.test(s)) return { ok: false }
  const d = new Date(s + 'T00:00:00Z')
  if (Number.isNaN(d.getTime()) || d.toISOString().slice(0, 10) !== s) return { ok: false }
  return { ok: true, value: s }
}

function trimOrNull(v) {
  if (v === null || v === undefined) return null
  const s = String(v).trim()
  return s || null
}

function fail(fields) {
  const first = Object.values(fields)[0]
  return { ok: false, error: Object.keys(fields).length === 1 ? first : 'Check the highlighted fields', fields }
}

// ---------------------------------------------------------------- settings

/**
 * Only whitelisted columns survive; anything absent from body is left alone.
 * Returns { ok, patch } or { ok: false, error, fields }.
 */
function validateSettings(body) {
  const b = body && typeof body === 'object' ? body : {}
  const patch = {}
  const fields = {}

  for (const f of SETTINGS_BOOL_FIELDS) {
    if (!(f in b)) continue
    if (typeof b[f] !== 'boolean') fields[f] = `${f} must be true or false`
    else patch[f] = b[f]
  }

  if ('max_offers_shown' in b) {
    const n = toNumber(b.max_offers_shown)
    if (!isIntIn(n, 0, 5)) fields.max_offers_shown = 'Max offers shown must be a whole number from 0 to 5'
    else patch.max_offers_shown = n
  }

  if ('owed_balance_mode' in b) {
    const m = String(b.owed_balance_mode || '').trim()
    if (m === 'charge') fields.owed_balance_mode = 'Card payments are not set up yet'
    else if (!OWED_BALANCE_MODES.includes(m)) fields.owed_balance_mode = 'Owed balance mode must be staff or block'
    else patch.owed_balance_mode = m
  }

  for (const f of SETTINGS_TEXT_FIELDS) {
    if (!(f in b)) continue
    const s = String(b[f] ?? '').trim()
    if (!s) fields[f] = 'This text cannot be blank'
    else if (s.length > 2000) fields[f] = 'Keep this under 2000 characters'
    else patch[f] = s
  }

  if ('staff_notify_emails' in b) {
    const raw = b.staff_notify_emails
    if (!Array.isArray(raw)) {
      fields.staff_notify_emails = 'Staff notify emails must be a list'
    } else {
      const cleaned = [...new Set(raw.map(e => String(e ?? '').trim().toLowerCase()).filter(Boolean))]
      const bad = cleaned.filter(e => !isValidEmail(e))
      if (bad.length) fields.staff_notify_emails = `Not a valid email: ${bad.join(', ')}`
      else if (cleaned.length > 20) fields.staff_notify_emails = 'At most 20 emails'
      else patch.staff_notify_emails = cleaned
    }
  }

  if (Object.keys(fields).length) return fail(fields)
  return { ok: true, patch }
}

// ---------------------------------------------------------------- reasons

/**
 * partial = true for PUT: only validate what was sent.
 */
function validateReason(body, { partial = false } = {}) {
  const b = body && typeof body === 'object' ? body : {}
  const row = {}
  const fields = {}

  if (!partial || 'label' in b) {
    const label = String(b.label ?? '').trim()
    if (!label) fields.label = 'Reason label is required'
    else if (label.length > 120) fields.label = 'Keep the label under 120 characters'
    else row.label = label
  }

  if (!partial || 'abc_cancel_code' in b) {
    const code = String(b.abc_cancel_code ?? '').trim().toUpperCase()
    if (!/^[A-Z0-9]{3}$/.test(code)) fields.abc_cancel_code = 'ABC cancel code must be 3 letters or digits, e.g. CMO'
    else row.abc_cancel_code = code
  }

  if ('sort_order' in b) {
    const n = toNumber(b.sort_order)
    if (!Number.isInteger(n) || Math.abs(n) > 1e6) fields.sort_order = 'Sort order must be a whole number'
    else row.sort_order = n
  }

  if ('active' in b) {
    if (typeof b.active !== 'boolean') fields.active = 'active must be true or false'
    else row.active = b.active
  }

  if (Object.keys(fields).length) return fail(fields)
  return { ok: true, row }
}

// ---------------------------------------------------------------- offers

/**
 * Validate one offer's config for its type and strip unknown keys.
 * Returns { ok, config } or { ok: false, error }.
 */
function normalizeOfferConfig(offerType, config) {
  const c = config && typeof config === 'object' && !Array.isArray(config) ? config : {}

  if (offerType === 'dues_discount') {
    const hasPct = c.percent_off !== undefined && c.percent_off !== null && c.percent_off !== ''
    const hasAmt = c.amount_off !== undefined && c.amount_off !== null && c.amount_off !== ''
    if (hasPct === hasAmt) return { ok: false, error: 'A dues discount needs exactly one of percent off or dollar amount off' }
    const invoices = toNumber(c.invoices)
    if (!isIntIn(invoices, 1, 12)) return { ok: false, error: 'Number of months must be a whole number from 1 to 12' }
    if (hasPct) {
      const pct = toNumber(c.percent_off)
      if (!isIntIn(pct, 1, 100)) return { ok: false, error: 'Percent off must be a whole number from 1 to 100' }
      return { ok: true, config: { percent_off: pct, invoices } }
    }
    const amt = toNumber(c.amount_off)
    if (!(amt > 0)) return { ok: false, error: 'Dollar amount off must be more than 0' }
    return { ok: true, config: { amount_off: Math.round(amt * 100) / 100, invoices } }
  }

  if (offerType === 'freeze') {
    const months = toNumber(c.months)
    if (!isIntIn(months, 1, 12)) return { ok: false, error: 'Freeze months must be a whole number from 1 to 12' }
    const fee = toNumber(c.fee)
    if (!(fee >= 0)) return { ok: false, error: 'Monthly freeze fee must be 0 or more' }
    return { ok: true, config: { months, fee: Math.round(fee * 100) / 100 } }
  }

  if (offerType === 'perk') {
    const instructions = String(c.staff_instructions ?? '').trim()
    if (!instructions) return { ok: false, error: 'Staff instructions are required for a perk' }
    return { ok: true, config: { staff_instructions: instructions } }
  }

  return { ok: false, error: `Offer type must be one of ${OFFER_TYPES.join(', ')}` }
}

/**
 * Validate a full offer (for PUT the route merges the stored row with the
 * body first, so this always sees a complete object).
 *
 * knownReasonIds: Set of save_reasons ids that exist.
 * Returns { ok, row } or { ok: false, error, fields }.
 */
function validateOffer(body, { knownReasonIds = new Set() } = {}) {
  const b = body && typeof body === 'object' ? body : {}
  const row = {}
  const fields = {}

  const offerType = String(b.offer_type ?? '').trim()
  if (!OFFER_TYPES.includes(offerType)) {
    fields.offer_type = `Offer type must be one of ${OFFER_TYPES.join(', ')}`
  } else {
    row.offer_type = offerType
    const cfg = normalizeOfferConfig(offerType, b.config)
    if (!cfg.ok) fields.config = cfg.error
    else row.config = cfg.config
  }

  const headline = String(b.headline ?? '').trim()
  if (!headline) fields.headline = 'Headline is required'
  else if (headline.length > HEADLINE_MAX) fields.headline = `Keep the headline to ${HEADLINE_MAX} characters or fewer`
  else row.headline = headline

  // name is internal. Default it to the headline so it is never blank.
  const name = String(b.name ?? '').trim() || headline
  if (name.length > 200) fields.name = 'Keep the name under 200 characters'
  else row.name = name

  const description = trimOrNull(b.description)
  if (description && description.length > 2000) fields.description = 'Keep the description under 2000 characters'
  else row.description = description

  const finePrint = trimOrNull(b.fine_print)
  if (finePrint && finePrint.length > 2000) fields.fine_print = 'Keep the fine print under 2000 characters'
  else row.fine_print = finePrint

  const reasonIds = b.reason_ids ?? []
  if (!Array.isArray(reasonIds)) {
    fields.reason_ids = 'Reasons must be a list'
  } else {
    const ids = [...new Set(reasonIds.map(String))]
    const unknown = ids.filter(id => !isUuid(id) || !knownReasonIds.has(id))
    if (unknown.length) fields.reason_ids = 'One or more selected reasons no longer exist'
    else row.reason_ids = ids
  }

  const clubNumbers = b.club_numbers ?? []
  if (!Array.isArray(clubNumbers)) {
    fields.club_numbers = 'Clubs must be a list'
  } else {
    const nums = [...new Set(clubNumbers.map(c => String(c).trim()))]
    const unknown = nums.filter(c => !CLUB_NUMBERS.includes(c))
    if (unknown.length) fields.club_numbers = `Unknown club number: ${unknown.join(', ')}`
    else row.club_numbers = nums
  }

  if (b.priority === undefined || b.priority === null || b.priority === '') {
    row.priority = 100
  } else {
    const p = toNumber(b.priority)
    if (!isIntIn(p, 0, 100000)) fields.priority = 'Priority must be a whole number (lower shows first)'
    else row.priority = p
  }

  if (b.active === undefined) row.active = false
  else if (typeof b.active !== 'boolean') fields.active = 'active must be true or false'
  else row.active = b.active

  const starts = normalizeDate(b.starts_on)
  const ends = normalizeDate(b.ends_on)
  if (!starts.ok) fields.starts_on = 'Start date must be a valid date'
  else row.starts_on = starts.value
  if (!ends.ok) fields.ends_on = 'End date must be a valid date'
  else row.ends_on = ends.value
  if (starts.ok && ends.ok && starts.value && ends.value && ends.value < starts.value) {
    fields.ends_on = 'End date cannot be before the start date'
  }

  if (Object.keys(fields).length) return fail(fields)
  return { ok: true, row }
}

// ---------------------------------------------------------------- requests / stats

function parseLimit(v, { def = 100, max = 500 } = {}) {
  const n = toNumber(v)
  if (!Number.isInteger(n) || n < 1) return def
  return Math.min(n, max)
}

function parseDays(v, { def = 30, max = 365 } = {}) {
  const n = toNumber(v)
  if (!Number.isInteger(n) || n < 1) return def
  return Math.min(n, max)
}

/**
 * A request staff still has to act on. Not just outcome = needs_staff: a perk
 * is recorded by the Worker as outcome = saved WITH staff_reason set (e.g.
 * "Give perk: free smoothie"), and staff still has to hand it out.
 */
function needsAction(r) {
  return !!r && !r.resolved_at && (r.outcome === 'needs_staff' || !!r.staff_reason)
}

/**
 * rows: save_requests rows (outcome, offer_id, offer_snapshot, reason_label,
 * staff_reason, resolved_at). Returns totals by outcome, save rate, breakdowns.
 */
function computeStats(rows) {
  const byOutcome = Object.fromEntries(OUTCOMES.map(o => [o, 0]))
  const offers = new Map()
  const reasons = new Map()
  let needsActionOpen = 0

  for (const r of rows || []) {
    if (r.outcome in byOutcome) byOutcome[r.outcome] += 1
    if (needsAction(r)) needsActionOpen += 1

    if (r.offer_id || r.offer_snapshot) {
      const key = r.offer_id || (r.offer_snapshot && r.offer_snapshot.id) || 'unknown'
      const headline = (r.offer_snapshot && r.offer_snapshot.headline) || 'Unknown offer'
      const cur = offers.get(key) || { offer_id: r.offer_id || null, headline, count: 0 }
      cur.count += 1
      offers.set(key, cur)
    }

    const label = r.reason_label || null
    if (label) reasons.set(label, (reasons.get(label) || 0) + 1)
  }

  const decided = byOutcome.saved + byOutcome.cancelled
  return {
    total: (rows || []).length,
    by_outcome: byOutcome,
    save_rate: decided ? byOutcome.saved / decided : null,
    needs_action_open: needsActionOpen,
    by_offer: [...offers.values()].sort((a, b) => b.count - a.count),
    by_reason: [...reasons.entries()].map(([reason_label, count]) => ({ reason_label, count }))
      .sort((a, b) => b.count - a.count),
  }
}

module.exports = {
  CLUB_NUMBERS,
  OFFER_TYPES,
  OWED_BALANCE_MODES,
  OUTCOMES,
  SETTINGS_EDITABLE,
  HEADLINE_MAX,
  isUuid,
  isValidEmail,
  needsAction,
  validateSettings,
  validateReason,
  normalizeOfferConfig,
  validateOffer,
  parseLimit,
  parseDays,
  computeStats,
}
