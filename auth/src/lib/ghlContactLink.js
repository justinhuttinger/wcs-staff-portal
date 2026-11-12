// Personal booking links: /<type>/<slug>?c={{contact.id}} from a GHL text.
//
// The person is already a GHL contact, so the page books that contact directly
// (no upsert, so no chance of a duplicate). The id is unsigned, so a page only
// ever shows a first name + last initial; the contact must belong to this
// club's GHL location or it counts as not found and the page shows the normal
// form. Shared by the Day One and Gym Tour pages.
const { ghlFetch } = require('../services/ghlClient')

async function linkedContact(loc, rawId) {
  const id = String(rawId || '').trim()
  if (!/^[A-Za-z0-9]{6,64}$/.test(id)) return null
  let contact
  try {
    contact = (await ghlFetch(`/contacts/${id}`, loc.apiKey))?.contact
  } catch (e) {
    // 403 = another club's contact (this key can't see it); same as not found.
    if (/GHL API error (400|403|404)/.test(e.message)) return null
    throw e
  }
  if (!contact?.id || contact.locationId !== loc.id) return null
  if (!String(contact.firstName || '').trim()) return null
  return contact
}

// What a page may show about a linked contact.
function publicName(contact) {
  return {
    firstName: String(contact.firstName).trim(),
    lastInitial: String(contact.lastName || '').trim().charAt(0).toUpperCase(),
  }
}

module.exports = { linkedContact, publicName }
