// The three fetches behind Salesperson Performance, shared with the Membership
// Snapshot that drills into it.
//
// Extracted rather than copied: the snapshot has to load EXACTLY what the table
// loads, or the same person shows different numbers in two places. The
// since_date selection in particular is load-bearing and easy to get wrong.

const { supabaseAdmin } = require('../services/supabase')
const { fetchAll } = require('./supabaseFetchAll')

const MEMBER_FIELDS = [
  'id', 'club_number', 'sales_person_name', 'sign_date', 'membership_type',
  'membership_type_abc_code', 'agreement_number', 'since_date',
  'agreement_entry_source', 'gender', 'birth_date', 'payment_frequency',
  'agreement_payment_method', 'agreement_term', 'is_primary_member',
  'next_due_amount', 'down_payment', 'email', 'primary_phone', 'mobile_phone',
  'first_name', 'last_name',
].join(', ')

async function loadMembers(clubNumbers, start, end) {
  return fetchAll(
    supabaseAdmin
      .from('abc_members')
      .select(MEMBER_FIELDS)
      .in('club_number', clubNumbers)
      // Selected on since_date, the day the MEMBERSHIP started, not sign_date,
      // the day the current agreement was signed. sign_date moves onto the
      // latest agreement, so selecting on it both double-counts re-signs and
      // loses the original sale. See isNewSale in salespersonPerformance.
      .gte('since_date', start)
      .lte('since_date', end)
      .order('id', { ascending: true })
  )
}

async function loadDayOnes(clubSlugs, start, end) {
  return fetchAll(
    supabaseAdmin
      .from('day_one_appointments')
      .select('id, location_slug, ghl_contact_id, booked_by_name, booked_at, contact_email, contact_name')
      .in('location_slug', clubSlugs)
      .gte('booked_at', start + 'T00:00:00Z')
      .lte('booked_at', end + 'T23:59:59.999Z')
      .order('id', { ascending: true })
  )
}

// Pull the GHL contacts behind a set of Day Ones so they can be matched to ABC
// members. Chunked because PostgREST caps how long an `in` list can be.
async function loadGhlContacts(contactIds) {
  const ids = [...new Set((contactIds || []).filter(Boolean))]
  const out = []
  const CHUNK = 200
  for (let i = 0; i < ids.length; i += CHUNK) {
    const batch = ids.slice(i, i + CHUNK)
    const { data, error } = await supabaseAdmin
      .from('ghl_contacts_v2')
      .select('id, email, phone, first_name, last_name')
      .in('id', batch)
    if (error) throw new Error(error.message)
    out.push(...(data || []))
  }
  return out
}

/** Everything buildReport needs for one window, in one call. */
async function loadSalespersonWindow(clubNumbers, clubSlugs, start, end) {
  const [members, dayOnes] = await Promise.all([
    loadMembers(clubNumbers, start, end),
    loadDayOnes(clubSlugs, start, end),
  ])
  const contacts = await loadGhlContacts(dayOnes.map(d => d.ghl_contact_id))
  return { members, dayOnes, contactsById: new Map(contacts.map(c => [c.id, c])) }
}

module.exports = { loadMembers, loadDayOnes, loadGhlContacts, loadSalespersonWindow, MEMBER_FIELDS }
