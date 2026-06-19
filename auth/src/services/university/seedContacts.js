// WCS University — clone the practice (persona) contacts for a trainee.
//
// On enroll, each trainee gets their OWN copy of the active seed contacts
// (university_seed_contacts), created in the University sub-account and assigned
// to them, so "only assigned data" scopes each trainee to their own personas.
// The University location has allowDuplicateContact=true, so per-trainee copies
// of the same persona phone are allowed.
//
// Persona behavior at call time is driven by the dialed Retell number
// (UNIVERSITY_NUMBER_MAP), so the contact only needs name + phone + assignment +
// tag here — no persona custom fields (which don't exist in this sub-account).

const { ghlFetch } = require('../ghlClient')
const { supabaseAdmin } = require('../supabase')
const { getUniversityLocation } = require('../../config/ghlLocations')

async function loadActiveSeeds() {
  const { data, error } = await supabaseAdmin
    .from('university_seed_contacts')
    .select('*')
    .eq('active', true)
    .order('sort_order')
  if (error) throw new Error(`seed load failed: ${error.message}`)
  return data || []
}

// Create the seed contacts for a user that aren't already recorded as created
// for this enrollment. `alreadyCreated` is the enrollment's created_contacts
// array ([{ seed_id, scenario, ghl_contact_id }]). Returns { created, errors }.
async function createSeedContacts(userId, alreadyCreated = []) {
  const uni = getUniversityLocation()
  if (!uni) return { created: [], errors: ['University location not configured (GHL_UNIVERSITY_*)'] }

  const doneSeedIds = new Set((alreadyCreated || []).map(c => c.seed_id))
  const seeds = (await loadActiveSeeds()).filter(s => !doneSeedIds.has(s.id))

  const created = []
  const errors = []
  for (const seed of seeds) {
    const body = {
      locationId: uni.id,
      firstName: seed.first_name,
      lastName: seed.last_name || undefined,
      name: `${seed.first_name}${seed.last_name ? ' ' + seed.last_name : ''}`,
      phone: seed.phone || undefined,
      assignedTo: userId,
      tags: seed.tag ? [seed.tag] : undefined,
      source: 'WCS University enrollment',
    }
    try {
      const res = await ghlFetch('/contacts/', uni.apiKey, { method: 'POST', body })
      const contactId = res.contact?.id || res.id || null
      created.push({ seed_id: seed.id, scenario: seed.scenario, ghl_contact_id: contactId })
    } catch (err) {
      errors.push(`${seed.first_name} ${seed.last_name || ''}: ${err.message}`.trim())
    }
  }
  return { created, errors }
}

module.exports = { loadActiveSeeds, createSeedContacts }
