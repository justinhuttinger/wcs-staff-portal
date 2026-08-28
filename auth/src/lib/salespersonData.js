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

/**
 * VIP credits in a window, plus WHICH CLUBS COLLECT THEM AT ALL.
 *
 * The second half matters more than the first. Milwaukie has never recorded a
 * single VIP credit — not a quiet month, zero since the table began — because
 * its GHL location has no VIP fields configured. Reporting that as "0 VIPs
 * collected" makes a claim about the staff when the truth is a claim about
 * setup, so a club that has never credited one is reported as not configured
 * and its VIP cells stay blank.
 *
 * Judged on the LIFETIME of the table rather than the window, or a club that
 * simply had a slow month would be branded unconfigured.
 */
async function loadVipCredits(clubNumbers, start, end) {
  const [credits, everRows] = await Promise.all([
    fetchAll(
      supabaseAdmin
        .from('vip_credits')
        .select('id, club_number, employee_name, credited_at')
        .in('club_number', clubNumbers)
        .gte('credited_at', start + 'T00:00:00Z')
        .lte('credited_at', end + 'T23:59:59.999Z')
        .order('id', { ascending: true })
    ),
    fetchAll(supabaseAdmin.from('vip_credits').select('club_number')),
  ])
  return { credits, configuredClubs: new Set(everRows.map(r => r.club_number)) }
}

/**
 * Completed tours in a window, and which clubs have ever recorded one.
 *
 * Same reasoning as VIPs: tours only started being kept on 2026-08-28 (before
 * that the check-in deleted the row on completion), so every earlier window is
 * genuinely empty rather than a month nobody gave a tour. A club with no tour
 * on record is reported as pending, not as zero.
 *
 * Only `completed` counts. A row still at `ready` is a check-in nobody closed
 * out, not a tour that happened.
 */
async function loadTourCompletions(clubNumbers, start, end) {
  const [tours, everRows, outcomes] = await Promise.all([
    fetchAll(
      supabaseAdmin
        .from('tour_intakes')
        .select('id, club_number, given_by_name, outcome, completed_at')
        .eq('status', 'completed')
        .in('club_number', clubNumbers)
        .gte('completed_at', start + 'T00:00:00Z')
        .lte('completed_at', end + 'T23:59:59.999Z')
        .order('id', { ascending: true })
    ),
    fetchAll(supabaseAdmin.from('tour_intakes').select('club_number').eq('status', 'completed')),
    // Which outcomes count as converted is read from the table, never
    // hardcoded: migration 147 put no foreign key on outcome, and the whole
    // vocabulary was already replaced once by #713.
    fetchAll(supabaseAdmin.from('tour_outcomes').select('outcome, is_sale')),
  ])
  return {
    tours,
    configuredClubs: new Set(everRows.map(r => r.club_number)),
    saleOutcomes: new Set(outcomes.filter(o => o.is_sale).map(o => o.outcome)),
  }
}

/** Everything buildReport needs for one window, in one call. */
async function loadSalespersonWindow(clubNumbers, clubSlugs, start, end) {
  const [members, dayOnes, vips, tours] = await Promise.all([
    loadMembers(clubNumbers, start, end),
    loadDayOnes(clubSlugs, start, end),
    loadVipCredits(clubNumbers, start, end),
    loadTourCompletions(clubNumbers, start, end),
  ])
  const contacts = await loadGhlContacts(dayOnes.map(d => d.ghl_contact_id))
  return {
    members,
    dayOnes,
    contactsById: new Map(contacts.map(c => [c.id, c])),
    vips,
    tours,
  }
}

module.exports = {
  loadMembers, loadDayOnes, loadGhlContacts, loadVipCredits, loadTourCompletions,
  loadSalespersonWindow, MEMBER_FIELDS,
}
