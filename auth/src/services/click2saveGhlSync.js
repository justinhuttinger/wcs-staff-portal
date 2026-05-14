const { getLocationByClubCode } = require('../config/ghlLocations')
const { getFieldId } = require('./ghlCustomFields')
const { ghlFetch } = require('./ghlClient')

const CANCEL_REASON_FIELD_KEY = process.env.GHL_CANCEL_REASON_FIELD_KEY || 'contact.cancel_reason'

// Fire-and-forget: upsert the Click2Save member's GHL contact with the
// cancel reason from a CANCEL event. Only acts on requestType === 'CANCEL'.
// Errors are logged and swallowed — this is a downstream side effect of
// click2save_events persistence and must never block the 200 response.
function syncCancelReasonToGhl(event) {
  runSync(event).catch(err => {
    const requestId = event?.requestId || 'unknown'
    console.warn(`[c2s-ghl ${requestId}] sync failed:`, err.message)
  })
}

async function runSync(event) {
  if (!event || event.requestType !== 'CANCEL') return

  const requestId = event.requestId || 'unknown'
  const clubCode = event.data?.clubCode
  const email = event.data?.member?.email
  const cancelReason = event.data?.result?.cancelReason

  if (!email) {
    console.warn(`[c2s-ghl ${requestId}] skipped: no member email`)
    return
  }
  if (!cancelReason) {
    console.warn(`[c2s-ghl ${requestId}] skipped: no cancelReason on event.data.result`)
    return
  }

  const loc = getLocationByClubCode(clubCode)
  if (!loc) {
    console.warn(`[c2s-ghl ${requestId}] skipped: no GHL location for clubCode=${clubCode}`)
    return
  }

  const fieldId = await getFieldId(loc.id, loc.apiKey, CANCEL_REASON_FIELD_KEY)
  if (!fieldId) {
    console.warn(`[c2s-ghl ${requestId}] skipped: fieldKey ${CANCEL_REASON_FIELD_KEY} not found in location ${loc.name} (${loc.id})`)
    return
  }

  const body = {
    locationId: loc.id,
    email,
    customFields: [{ id: fieldId, field_value: cancelReason }],
  }

  const resp = await ghlFetch('/contacts/upsert', loc.apiKey, { method: 'POST', body })
  const contactId = resp?.contact?.id || resp?.id || null
  console.log(`[c2s-ghl ${requestId}] upserted ${loc.name} contact=${contactId} cancelReason="${cancelReason}"`)
}

module.exports = { syncCancelReasonToGhl }
