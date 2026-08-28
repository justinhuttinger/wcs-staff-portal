/**
 * Finding the GHL contact for a tour card that never carried one.
 *
 * A card raised by a GHL survey arrives with the contact id in the payload. A
 * card raised by the kiosk does not: the kiosk announces the arrival from its
 * own webhook, before anything has told it which GHL contact the person maps
 * to, so tour_intakes.ghl_contact_id is null for every kiosk check-in.
 *
 * That was invisible until VIP referrals, which are the first thing that writes
 * BACK to the contact. Staff filled the referral in, the save succeeded, and the
 * answers went nowhere, because the write is gated on an id the row never had.
 *
 * We know the person's email and phone, and by the time staff complete the tour
 * the contact certainly exists -- the kiosk upserts it on the way through. So
 * look it up. Email first: it is what the duplicate check is most reliable on,
 * and two people share a phone far more often than an inbox.
 */

const { ghlFetch } = require('../services/ghlClient')

// GHL's own duplicate check. It answers "which contact at this location already
// has this email/phone", which is exactly the question, and it is a single
// indexed call rather than a search page.
async function findBy(locationId, apiKey, field, value) {
  if (!value) return null
  try {
    const data = await ghlFetch('/contacts/search/duplicate', apiKey, {
      params: { locationId, [field]: value },
    })
    const c = data && data.contact
    return (c && c.id) || null
  } catch (err) {
    // A lookup failure must not stop a tour being completed.
    console.error(`[resolve-ghl-contact] ${field} lookup failed:`, err.message)
    return null
  }
}

/**
 * @returns {Promise<string|null>} the contact id, or null when nothing matches.
 */
async function resolveGhlContactId({ locationId, apiKey, email, phone }) {
  if (!locationId || !apiKey) return null
  return (await findBy(locationId, apiKey, 'email', (email || '').trim())) ||
         (await findBy(locationId, apiKey, 'number', (phone || '').trim()))
}

module.exports = { resolveGhlContactId }
