// Meta Conversions API "Purchase" for every new membership.
//
// Runs inside the ABC sync, per club, right after reconcile. A new join is an
// active primary member whose since_date falls inside the look-back window
// (default 7 days). Each one is sent to Meta once, as a server-side Purchase
// matched on the ABC member's email / phone / name / DOB plus whatever the
// GHL contact carries from the website (fbp, fbc, fbclid, external_id).
//
// Every send is logged in meta_capi_events (migration 220), keyed on
// event_id = purchase_{member_id}_{agreement_number}, so a member is never
// sent twice and a failed send is retried on the next cycle. Meta also
// dedupes on event_id, so a retry after a lost response is harmless.
//
// Off unless META_CAPI_PURCHASE_ENABLED=true. Dry run (META_PURCHASE_DRY_RUN,
// else the sync-wide DRY_RUN) logs what would be sent and writes nothing.
// Needs META_PIXEL_ID + META_ACCESS_TOKEN (same values as wcs-auth-api);
// META_PURCHASE_VALUE (default 990, the FB ROAS report's LTV) and
// META_PURCHASE_WINDOW_DAYS (default 7) are optional.
//
// Dependency-injectable (db, send, now) so tests run offline.
const crypto = require('crypto')

let _defaultDb = null
function getDefaultDb() {
  if (!_defaultDb) _defaultDb = require('../db/supabase')
  return _defaultDb
}

const GRAPH_VERSION = process.env.META_GRAPH_VERSION || 'v23.0'
const PAGE = 1000
// A send Meta keeps rejecting is bad data, not a blip. Stop after this many.
const MAX_ATTEMPTS = 5

// Never a sale, whatever else is configured: staff, non-members, childcare
// add-ons and agreements ABC is in the middle of deleting.
const NON_SALE_TYPES = new Set([
  'non-member', 'employee', 'employee fao', 'staff', 'childcare',
])
const DELETING_TYPE = /^z\./i

// Match keys in a fixed order, same log format as the portal's /meta/lead
// (auth/src/lib/metaMatch.js) so the two can be grepped the same way.
const MATCH_KEYS = [
  ['em', 'em'], ['ph', 'ph'], ['fn', 'fn'], ['ln', 'ln'], ['db', 'db'],
  ['fbp', 'fbp'], ['fbc', 'fbc'], ['xid', 'external_id'],
]
function matchCoverage(userData) {
  return MATCH_KEYS.map(([label, key]) => `${label}=${userData[key] ? 'y' : 'n'}`).join(' ')
}

function sha256(value) {
  return crypto.createHash('sha256').update(String(value)).digest('hex')
}

// Normalization matches the portal's /meta/lead exactly. Two hashing rules
// that drift apart silently destroy match quality.
function normalizeEmail(value) {
  const email = String(value || '').trim().toLowerCase()
  return email.includes('@') ? email : null
}

function normalizePhone(value) {
  let digits = String(value || '').replace(/\D/g, '')
  if (!digits) return null
  if (digits.length === 10) digits = '1' + digits
  return digits
}

function normalizeName(value) {
  const name = String(value || '').trim().toLowerCase().replace(/[^a-zÀ-ɏ ]/g, '').trim()
  return name || null
}

// Meta wants date of birth as YYYYMMDD.
function normalizeDob(value) {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(value || ''))
  return m ? `${m[1]}${m[2]}${m[3]}` : null
}

function normalizeExternalId(value) {
  if (value === null || value === undefined || typeof value === 'object') return ''
  return String(value).trim().toLowerCase()
}

// fbclid only reaches GHL as a raw query value; Meta wants it wrapped as an
// fbc cookie. The click time isn't kept, so use the contact's creation time,
// which is the form submit that captured it.
function fbcFromFbclid(fbclid, createdAt) {
  const id = String(fbclid || '').trim()
  if (!id) return null
  const ms = Date.parse(createdAt || '') || Date.now()
  return `fb.1.${ms}.${id}`
}

function isNewJoin(member, { windowStart, skipTypes = new Set() }) {
  if (!member || !member.is_active || member.is_non_member) return false
  // A family agreement is one sale; secondaries ride on the primary.
  if (member.is_primary_member === false) return false
  if (!member.since_date || String(member.since_date).slice(0, 10) < windowStart) return false
  const type = String(member.membership_type || '').trim()
  if (DELETING_TYPE.test(type)) return false
  if (NON_SALE_TYPES.has(type.toLowerCase()) || skipTypes.has(type.toLowerCase())) return false
  return true
}

function eventIdFor(member) {
  return `purchase_${member.member_id}_${member.agreement_number || 'na'}`
}

// ABC gives since_date as a bare date. Noon Pacific (19:00Z) on that day,
// or now if that is still in the future, since Meta rejects future times.
function eventTimeFor(member, nowMs) {
  const day = String(member.since_date).slice(0, 10)
  const noon = Date.parse(`${day}T19:00:00Z`)
  return Math.floor(Math.min(Number.isFinite(noon) ? noon : nowMs, nowMs) / 1000)
}

/**
 * Build the Meta event for one new join.
 * @param {object} member abc_members row
 * @param {object|null} contact ghl_contacts_v2 row, when one matched
 * @param {object} fieldIds { fbp, fbc, fbclid, external_id } custom field ids for this location
 */
function buildPurchaseEvent({ member, contact, fieldIds = {}, value, currency = 'USD', locationName, nowMs }) {
  const userData = {}
  const email = normalizeEmail(member.email) || normalizeEmail(contact && contact.email)
  const phone = normalizePhone(member.mobile_phone || member.primary_phone) || normalizePhone(contact && contact.phone)
  const first = normalizeName(member.first_name)
  const last = normalizeName(member.last_name)
  const dob = normalizeDob(member.birth_date)
  if (email) userData.em = [sha256(email)]
  if (phone) userData.ph = [sha256(phone)]
  if (first) userData.fn = [sha256(first)]
  if (last) userData.ln = [sha256(last)]
  if (dob) userData.db = [sha256(dob)]

  const cf = (contact && contact.custom_fields) || {}
  const fbp = fieldIds.fbp && cf[fieldIds.fbp]
  const fbc = (fieldIds.fbc && cf[fieldIds.fbc]) ||
    (fieldIds.fbclid && fbcFromFbclid(cf[fieldIds.fbclid], contact && contact.created_at_ghl))
  const xid = normalizeExternalId(fieldIds.external_id && cf[fieldIds.external_id])
  if (fbp) userData.fbp = String(fbp)
  if (fbc) userData.fbc = String(fbc)
  if (xid) userData.external_id = [sha256(xid)]

  // Online joins happen on the website but we have none of the browser data
  // Meta requires for action_source=website, so they go as system_generated.
  const isWeb = String(member.agreement_entry_source || '').trim().toLowerCase() === 'web'

  const customData = {
    currency,
    value,
    content_name: String(member.membership_type || 'Membership'),
    content_category: locationName || undefined,
    order_id: member.agreement_number || undefined,
  }

  return {
    event_name: 'Purchase',
    event_id: eventIdFor(member),
    event_time: eventTimeFor(member, nowMs),
    action_source: isWeb ? 'system_generated' : 'physical_store',
    user_data: userData,
    custom_data: JSON.parse(JSON.stringify(customData)),
  }
}

async function sendToMeta(eventData) {
  const pixelId = process.env.META_PIXEL_ID
  const token = process.env.META_ACCESS_TOKEN
  if (!pixelId || !token) return { ok: false, error: 'META_PIXEL_ID / META_ACCESS_TOKEN not set' }
  const payload = { data: [eventData], access_token: token }
  // Test stream only. Must be deleted in production or events never land.
  if (process.env.META_TEST_EVENT_CODE) payload.test_event_code = process.env.META_TEST_EVENT_CODE
  try {
    const res = await fetch(`https://graph.facebook.com/${GRAPH_VERSION}/${pixelId}/events`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    })
    const data = await res.json().catch(() => ({}))
    if (!res.ok || data.error) return { ok: false, data, error: (data.error && data.error.message) || `HTTP ${res.status}` }
    return { ok: true, data }
  } catch (err) {
    return { ok: false, error: err.message }
  }
}

async function pageAll(makeQuery, label) {
  const rows = []
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await makeQuery().range(from, from + PAGE - 1)
    if (error) throw new Error(`[MetaPurchase] ${label}: ${error.message}`)
    if (!data || !data.length) break
    rows.push(...data)
    if (data.length < PAGE) break
  }
  return rows
}

async function loadFieldIds(db, locationId) {
  const { data, error } = await db.from('ghl_custom_field_defs')
    .select('id, field_key').eq('location_id', locationId)
    .in('field_key', ['contact.abc_member_id', 'contact.fbp', 'contact.fbc', 'contact.fbclid', 'contact.external_id'])
  if (error) throw new Error(`[MetaPurchase] field defs: ${error.message}`)
  const ids = {}
  for (const d of data || []) ids[d.field_key.replace('contact.', '')] = d.id
  return ids
}

// The GHL contact for a member: by the abc_member_id custom field first (what
// reconcile writes), then by email. Only the handful of new joins are looked
// up, so this stays cheap without loading the whole location.
async function findContact(db, locationId, member, fieldIds) {
  const cols = 'id, email, phone, custom_fields, created_at_ghl'
  if (fieldIds.abc_member_id && member.member_id) {
    const { data } = await db.from('ghl_contacts_v2').select(cols)
      .eq('location_id', locationId)
      .eq(`custom_fields->>${fieldIds.abc_member_id}`, member.member_id)
      .limit(1)
    if (data && data[0]) return data[0]
  }
  const email = normalizeEmail(member.email)
  if (email) {
    const { data } = await db.from('ghl_contacts_v2').select(cols)
      .eq('location_id', locationId).ilike('email', email).limit(1)
    if (data && data[0]) return data[0]
  }
  return null
}

async function runMetaPurchaseForLocation(location, options = {}) {
  const {
    dryRun = true,
    db = getDefaultDb(),
    send = sendToMeta,
    nowMs = Date.now(),
    windowDays = parseInt(process.env.META_PURCHASE_WINDOW_DAYS || '7', 10),
    value = parseFloat(process.env.META_PURCHASE_VALUE || '990'),
    skipTypes = new Set(),
  } = options
  const { id: locationId, name: locationName, clubNumber } = location
  const summary = { club: clubNumber, candidates: 0, alreadySent: 0, gaveUp: 0, sent: 0, failed: 0, planned: [] }

  const windowStart = new Date(nowMs - windowDays * 86400000).toISOString().slice(0, 10)
  const members = await pageAll(() => db.from('abc_members')
    .select('member_id, agreement_number, first_name, last_name, email, primary_phone, mobile_phone, birth_date, membership_type, since_date, is_active, is_primary_member, is_non_member, agreement_entry_source')
    .eq('club_number', clubNumber).eq('is_active', true).gte('since_date', windowStart)
    .order('member_id'), `${clubNumber} members`)
  const candidates = members.filter(m => isNewJoin(m, { windowStart, skipTypes }))
  summary.candidates = candidates.length
  if (!candidates.length) return summary

  const logged = new Map()
  const eventIds = candidates.map(eventIdFor)
  for (let i = 0; i < eventIds.length; i += 200) {
    const { data, error } = await db.from('meta_capi_events')
      .select('event_id, status, attempts').in('event_id', eventIds.slice(i, i + 200))
    if (error) throw new Error(`[MetaPurchase] ${clubNumber}: sent lookup: ${error.message}`)
    for (const r of data || []) logged.set(r.event_id, r)
  }

  const fieldIds = await loadFieldIds(db, locationId)

  for (const member of candidates) {
    const eventId = eventIdFor(member)
    const prior = logged.get(eventId)
    if (prior && prior.status === 'sent') { summary.alreadySent++; continue }
    if (prior && (prior.attempts || 0) >= MAX_ATTEMPTS) { summary.gaveUp++; continue }

    const contact = await findContact(db, locationId, member, fieldIds)
    const event = buildPurchaseEvent({ member, contact, fieldIds, value, locationName, nowMs })
    const match = matchCoverage(event.user_data)
    const name = `${member.first_name || ''} ${member.last_name || ''}`.trim()
    summary.planned.push({ member_id: member.member_id, name, since: member.since_date, match })
    if (dryRun) continue

    const result = await send(event)
    const row = {
      event_id: eventId,
      event_name: 'Purchase',
      club_number: clubNumber,
      abc_member_id: member.member_id,
      ghl_contact_id: contact ? contact.id : null,
      value,
      action_source: event.action_source,
      event_time: new Date(event.event_time * 1000).toISOString(),
      match,
      attempts: ((prior && prior.attempts) || 0) + 1,
      status: result.ok ? 'sent' : 'failed',
      error: result.ok ? null : String(result.error || 'unknown'),
      meta_response: result.data || null,
      attempted_at: new Date(nowMs).toISOString(),
    }
    const { error } = await db.from('meta_capi_events').upsert(row, { onConflict: 'event_id' })
    if (error) console.error(`[MetaPurchase] ${clubNumber}: log write failed for ${eventId}: ${error.message}`)
    if (result.ok) summary.sent++
    else {
      summary.failed++
      console.error(`[MetaPurchase] ${clubNumber}: Meta rejected ${eventId}: ${row.error}`)
    }
  }
  return summary
}

module.exports = {
  runMetaPurchaseForLocation,
  buildPurchaseEvent,
  isNewJoin,
  eventIdFor,
  eventTimeFor,
  normalizePhone,
  normalizeDob,
  fbcFromFbclid,
  matchCoverage,
}
