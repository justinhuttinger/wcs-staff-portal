const { getPaginated } = require('./client');

const PAGE_SIZE = parseInt(process.env.CONTACTS_PAGE_SIZE) || 100;

async function fetchAllContacts(locationId, apiKey) {
  return getPaginated(
    '/contacts/',
    { locationId, limit: PAGE_SIZE },
    'contacts',
    { paginationType: 'cursor', cursorParam: 'startAfter' },
    apiKey
  );
}

async function fetchContactsDelta(locationId, sinceDate, apiKey) {
  // startAfterDate returns contacts updated after this ISO date
  // Overlap by 5 minutes to avoid missing records
  const overlap = new Date(new Date(sinceDate).getTime() - 5 * 60 * 1000);
  return getPaginated(
    '/contacts/',
    { locationId, limit: PAGE_SIZE, startAfterDate: overlap.toISOString() },
    'contacts',
    { paginationType: 'cursor', cursorParam: 'startAfter' },
    apiKey
  );
}

function transformContact(raw, locationId) {
  // Transform customFields array [{id, value}] → JSONB object {id: value}
  const customFields = {};
  for (const field of (raw.customFields || [])) {
    if (field.id && field.value !== undefined && field.value !== null) {
      customFields[field.id] = field.value;
    }
  }

  return {
    id: raw.id,
    location_id: locationId,
    first_name: raw.firstName || null,
    last_name: raw.lastName || null,
    full_name: raw.name || [raw.firstName, raw.lastName].filter(Boolean).join(' ') || null,
    email: raw.email || null,
    phone: normalizePhone(raw.phone),
    date_of_birth: raw.dateOfBirth || null,
    address: raw.address ? {
      line1: raw.address.line1 || raw.address.address1 || null,
      city: raw.address.city || null,
      state: raw.address.state || null,
      zip: raw.address.postalCode || raw.address.zip || null,
    } : null,
    tags: raw.tags || [],
    source: raw.source || null,
    assigned_user_id: raw.assignedTo || null,
    assigned_user_name: null,
    dnd: raw.dnd || false,
    type: raw.type || null,
    custom_fields: Object.keys(customFields).length > 0 ? customFields : null,
    created_at_ghl: raw.dateAdded || raw.createdAt || null,
    updated_at_ghl: raw.dateUpdated || raw.updatedAt || null,
    synced_at: new Date().toISOString(),
  };
}

function normalizePhone(phone) {
  if (!phone) return null;
  return phone.replace(/[^\d+]/g, '') || null;
}

module.exports = { fetchAllContacts, fetchContactsDelta, transformContact };
