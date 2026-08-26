// Reading and writing the VIP referral fields on a GHL contact.
//
// Three fields, all TEXT, present at every club:
//   contact.referred_by_full_name   who sent them
//   contact.referred_by_abc_id      that person's ABC member id
//   contact.vip_team_member         the staffer who handed out the card
//
// Always resolved by fieldKey, never a hardcoded id: the ids differ per club
// (Salem gpdxWI9... vs Medford EXEpbfI...), so an id baked in here would write
// to the wrong field at six of the seven gyms. getFieldId caches the mapping.

const { ghlFetch } = require('../services/ghlClient')
const { getFieldId } = require('../services/ghlCustomFields')

const KEYS = {
  fullName: 'contact.referred_by_full_name',
  abcId: 'contact.referred_by_abc_id',
  teamMember: 'contact.vip_team_member',
}

function valueOf(field) {
  if (!field) return ''
  const v = field.value != null ? field.value : field.fieldValue
  return v == null ? '' : String(v).trim()
}

/**
 * What the contact already holds.
 *
 * GHL returns customFields keyed by id, and inconsistently includes fieldKey,
 * so we map ids back through the cache rather than trusting the shape.
 *
 * @returns {Promise<{fullName, abcId, teamMember, contactId}|null>} null when
 *          there is no contact to read.
 */
async function readReferral({ locationId, apiKey, contactId }) {
  if (!locationId || !apiKey || !contactId) return null

  const data = await ghlFetch('/contacts/' + contactId, apiKey)
  const contact = (data && (data.contact || data)) || {}
  const fields = contact.customFields || []

  const ids = {}
  for (const [name, key] of Object.entries(KEYS)) {
    ids[name] = await getFieldId(locationId, apiKey, key)
  }

  const byId = {}
  for (const f of fields) if (f.id) byId[f.id] = f

  return {
    contactId,
    fullName: valueOf(byId[ids.fullName]),
    abcId: valueOf(byId[ids.abcId]),
    teamMember: valueOf(byId[ids.teamMember]),
  }
}

/**
 * Write whichever values were supplied.
 *
 * Only non-empty values are sent. A blank here means "staff did not answer",
 * not "clear what is on the record" -- both questions are optional, and an
 * empty write would wipe a referral somebody else had already captured.
 *
 * @returns {Promise<{ok, written: string[]}>}
 */
async function writeReferral({ locationId, apiKey, contactId }, values) {
  if (!locationId || !apiKey || !contactId) return { ok: false, written: [], error: 'no contact' }

  const customFields = []
  const written = []

  for (const [name, key] of Object.entries(KEYS)) {
    const value = String((values && values[name]) || '').trim()
    if (!value) continue
    const id = await getFieldId(locationId, apiKey, key)
    if (!id) continue
    customFields.push({ id, field_value: value })
    written.push(name)
  }

  if (!customFields.length) return { ok: true, written: [] }

  try {
    await ghlFetch('/contacts/' + contactId, apiKey, { method: 'PUT', body: { customFields } })
    return { ok: true, written }
  } catch (err) {
    return { ok: false, written: [], error: err.message }
  }
}

module.exports = { readReferral, writeReferral, KEYS }
