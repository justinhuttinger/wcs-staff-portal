// WCS University — enrollment orchestration.
//
// One admin click → (1) grant the GHL user access to the University sub-account
// with restricted (assigned-data-only) permissions, and (2) create their own
// copy of the practice contacts, assigned to them. The university_enrollments
// row (UNIQUE on ghl_user_id) is the idempotency guard: a retry/double-click
// reuses the row and only does the work not already recorded, so it can never
// double-create contacts or re-grant needlessly.

const { supabaseAdmin } = require('../supabase')
const { getUniversityLocation } = require('../../config/ghlLocations')
const { createSeedContacts } = require('./seedContacts')

// Find-or-create the enrollment row for a user (idempotency anchor).
async function getOrCreateEnrollment({ userId, email, name, locationId, enrolledBy }) {
  const { data: existing } = await supabaseAdmin
    .from('university_enrollments')
    .select('*')
    .eq('ghl_user_id', userId)
    .maybeSingle()
  if (existing) return existing

  const { data, error } = await supabaseAdmin
    .from('university_enrollments')
    .insert({
      ghl_user_id: userId,
      user_email: email || null,
      user_name: name || null,
      location_id: locationId,
      status: 'pending',
      enrolled_by: enrolledBy || null,
    })
    .select()
    .single()
  // A racing insert can lose the UNIQUE; re-read the winner.
  if (error) {
    const { data: row } = await supabaseAdmin
      .from('university_enrollments').select('*').eq('ghl_user_id', userId).maybeSingle()
    if (row) return row
    throw new Error(`enrollment insert failed: ${error.message}`)
  }
  return data
}

// Enroll a user = create their practice contacts, assigned to them (access +
// permissions are granted by hand in GHL). Resumable: re-running only creates
// the contacts not already recorded for this user.
async function enrollUser({ userId, email, name, enrolledBy }) {
  const uni = getUniversityLocation()
  if (!uni) throw new Error('University location not configured (set GHL_UNIVERSITY_LOCATION_ID + GHL_UNIVERSITY_API_KEY)')
  if (!userId) throw new Error('userId is required')

  const row = await getOrCreateEnrollment({ userId, email, name, locationId: uni.id, enrolledBy })
  if (row.status === 'complete') return { enrollment: row, notes: [] }

  // Create the seed contacts not yet created for this enrollment.
  const { created, errors } = await createSeedContacts(userId, row.created_contacts || [])
  const allContacts = [...(row.created_contacts || []), ...created]

  // Complete when every active seed produced a contact.
  const { data: activeSeeds } = await supabaseAdmin
    .from('university_seed_contacts').select('id').eq('active', true)
  const expected = (activeSeeds || []).length
  const fullySeeded = allContacts.length >= expected && allContacts.every(c => c.ghl_contact_id)

  const patch = {
    created_contacts: allContacts,
    status: (fullySeeded && errors.length === 0) ? 'complete' : (allContacts.length > 0 ? 'partial' : 'failed'),
    error: errors.length ? errors.join(' | ') : null,
  }

  const { data: updated, error: upErr } = await supabaseAdmin
    .from('university_enrollments').update(patch).eq('id', row.id).select().single()
  if (upErr) throw new Error(`enrollment update failed: ${upErr.message}`)
  return { enrollment: updated, notes: [] }
}

module.exports = { enrollUser, getOrCreateEnrollment }
