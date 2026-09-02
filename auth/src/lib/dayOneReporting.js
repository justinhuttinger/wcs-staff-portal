// Day One numbers for the older reports, read from day_one_appointments.
//
// WHAT THIS REPLACES
// Leaderboard, PT Health and the PT/sales reports all counted Day Ones out of
// ghl_contacts_report's day_one_* columns. Those columns are a snapshot of GHL
// CONTACT CUSTOM FIELDS, written by the booking widget and by workflows, so a
// Day One only ever appeared in a report if a custom field had been set on the
// contact. Anything the widget did not book, or any workflow that did not fire,
// was invisible — and a contact only has ONE set of those fields, so a member
// with two Day Ones only ever counted once.
//
// day_one_appointments is reconciled from the calendars every 15 minutes, so it
// is the same set of appointments staff can actually see in GHL.
//
// MEASURED, August 2026, all clubs:
//   rows            321 here vs 262 in the legacy columns  (+59, +23%)
//   with a booker   254 here vs 219                        (+35)
//   credit LOST by switching: 0
// Nobody loses a booking they were credited for; 32 bookings gain attribution
// that the custom fields never had.
//
// FIELD MAPPING, legacy -> here
//   day_one_booked='Yes'          a row exists
//   day_one_booking_date          booked_at      (when it was BOOKED)
//   day_one_date                  scheduled_date (when it HAPPENS)
//   day_one_booking_team_member   booked_by_name
//   day_one_trainer               trainer_name
//   day_one_status='Completed'    status='completed'
//   day_one_sale='Sale'           outcome='Sale'
//
// The two date fields are not interchangeable and never were: the leaderboard
// scores the month a booking was MADE, the PT funnel measures the month the
// appointment HAPPENS. Keeping both distinct is why they are separate arguments
// here rather than one "date range".

const { supabaseAdmin } = require('../services/supabase')
const { fetchAll } = require('./supabaseFetchAll')

/** Collapse spacing and title-case, so "chris  MARTINEZ" keys with "Chris Martinez". */
function normalizeName(raw) {
  if (!raw) return ''
  return String(raw).replace(/\s+/g, ' ').trim()
    .toLowerCase()
    .replace(/\b\w/g, c => c.toUpperCase())
}

// Accepts a single slug or a list, because the reports differ: the leaderboard
// scopes to one club, /reports/* can be scoped to several by role.
function applySlug(q, locationSlug, locationSlugs) {
  if (Array.isArray(locationSlugs)) return q.in('location_slug', locationSlugs)
  if (locationSlug && locationSlug !== 'all') return q.eq('location_slug', locationSlug)
  return q
}

/**
 * Legacy field names for one appointment, so reports and the calendar views
 * that still speak day_one_* keep working while the data underneath comes from
 * day_one_appointments. `contact` is the matching ghl_contacts_report row, if
 * there is one, and supplies only what the appointment does not carry:
 * pt_value, pt_sign_date and tags live on the contact.
 */
function toLegacyShape(row, contact) {
  const status = statusLabel(row.status)
  return {
    id: contact?.id || row.ghl_contact_id,
    appointment_id: row.id,
    first_name: contact?.first_name || null,
    last_name: contact?.last_name || null,
    full_name: contact?.full_name || row.contact_name || null,
    email: contact?.email || row.contact_email || null,
    phone: contact?.phone || row.contact_phone || null,
    tags: contact?.tags || null,
    day_one_booked: 'Yes',
    day_one_date: row.scheduled_date,
    day_one_booking_date: row.booked_at,
    day_one_booking_team_member: row.booked_by_name || null,
    day_one_status: status,
    day_one_sale: row.outcome || null,
    day_one_trainer: row.trainer_name || null,
    show_or_no_show: status === 'Completed' ? 'Show' : (status === 'No Show' ? 'No Show' : null),
    pt_sale_type: row.pt_sale_type || null,
    why_no_sale: row.why_no_sale || null,
    pt_value: contact?.pt_value ?? null,
    pt_sign_date: contact?.pt_sign_date ?? null,
    location_name: contact?.location_name || null,
    location_slug: row.location_slug,
  }
}

/** ghl_contacts_report rows for these contact ids, keyed by id. */
async function contactsById(contactIds, columns) {
  const ids = [...new Set((contactIds || []).filter(Boolean))]
  const byId = {}
  for (let i = 0; i < ids.length; i += 200) {
    const rows = await fetchAll(
      supabaseAdmin.from('ghl_contacts_report').select(columns).in('id', ids.slice(i, i + 200)))
    for (const r of rows) byId[r.id] = r
  }
  return byId
}

/**
 * Day Ones BOOKED per person, keyed by normalised name.
 *
 * Windowed on booked_at — the month the booking was made, which is what the
 * leaderboard scores. A cancelled Day One still counts: the booking is the
 * work being credited, and whether the member later cancelled is not the
 * booker's doing. That matches the legacy behaviour, which never filtered on
 * status either.
 */
async function bookedByPerson({ startISO, endISO, locationSlug }) {
  let q = supabaseAdmin
    .from('day_one_appointments')
    .select('booked_by_name')
    .not('booked_by_name', 'is', null)
    .gte('booked_at', startISO)
    .lte('booked_at', endISO)
  q = applySlug(q, locationSlug)

  const rows = await fetchAll(q)
  const byPerson = {}
  for (const r of rows) {
    const name = normalizeName(r.booked_by_name)
    if (!name || name === 'Unassigned') continue
    byPerson[name] = (byPerson[name] || 0) + 1
  }
  return byPerson
}

/**
 * The Set / Show / Close funnel, windowed on scheduled_date.
 *
 *   set    every Day One scheduled in the window, cancellations included
 *   show   the member turned up            (status = 'completed')
 *   close  they turned up and bought       (outcome = 'Sale')
 *
 * Dates are plain ISO days here rather than the epoch-millisecond strings the
 * GHL date-picker columns needed, because scheduled_date is a real date column.
 * That also disposes of the timezone bug those millisecond bounds kept
 * re-introducing, where a Pacific offset pushed bookings dated the 1st into the
 * previous month.
 */
async function funnel({ locationSlug, locationSlugs, startDate, endDate }) {
  let q = supabaseAdmin
    .from('day_one_appointments')
    .select('status, outcome')
  if (startDate) q = q.gte('scheduled_date', startDate)
  if (endDate) q = q.lte('scheduled_date', endDate)
  q = applySlug(q, locationSlug, locationSlugs)

  const rows = await fetchAll(q)
  let show = 0
  let close = 0
  for (const r of rows) {
    if (r.status !== 'completed') continue
    show++
    if (r.outcome === 'Sale') close++
  }
  return { set: rows.length, show, close }
}

/**
 * Day Ones scheduled in the window, as rows, for the reports that break them
 * down by status/trainer/sale rather than just counting them.
 */
async function scheduledInRange({ locationSlug, locationSlugs, startDate, endDate }) {
  let q = supabaseAdmin
    .from('day_one_appointments')
    .select('id, ghl_contact_id, contact_name, contact_email, contact_phone, ' +
            'location_slug, scheduled_date, booked_at, status, outcome, ' +
            'pt_sale_type, why_no_sale, trainer_name, booked_by_name')
  if (startDate) q = q.gte('scheduled_date', startDate)
  if (endDate) q = q.lte('scheduled_date', endDate)
  q = applySlug(q, locationSlug, locationSlugs)
  return fetchAll(q.order('scheduled_date', { ascending: false }))
}

/**
 * Day Ones BOOKED in the window, as rows, for reports that also chart them by
 * booking date. Same window as bookedByPerson, which counts these.
 */
async function bookedInRange({ startISO, endISO, locationSlug, locationSlugs }) {
  let q = supabaseAdmin
    .from('day_one_appointments')
    .select('id, ghl_contact_id, location_slug, booked_at, booked_by_name, scheduled_date')
    .gte('booked_at', startISO)
    .lte('booked_at', endISO)
  q = applySlug(q, locationSlug, locationSlugs)
  return fetchAll(q)
}

/**
 * Which of these GHL contacts have ever had a Day One, as a Set of contact id.
 *
 * Matched on ghl_contact_id, not email: contact id is set on every row here,
 * email on only 70% of them, so an email match silently drops a third of the
 * Day Ones it is asked about.
 */
async function contactIdsWithDayOne(contactIds) {
  const ids = [...new Set((contactIds || []).filter(Boolean))]
  const found = new Set()
  for (let i = 0; i < ids.length; i += 200) {
    const chunk = ids.slice(i, i + 200)
    const rows = await fetchAll(
      supabaseAdmin.from('day_one_appointments').select('ghl_contact_id').in('ghl_contact_id', chunk))
    for (const r of rows) found.add(r.ghl_contact_id)
  }
  return found
}

/** Legacy status/sale strings, for report shapes still keyed on them. */
const STATUS_LABEL = {
  completed: 'Completed',
  no_show: 'No Show',
  cancelled: 'Cancelled',
  scheduled: 'Scheduled',
}

function statusLabel(status) {
  return STATUS_LABEL[status] || 'Unknown'
}

module.exports = {
  bookedByPerson, bookedInRange, contactIdsWithDayOne, funnel, scheduledInRange,
  contactsById, toLegacyShape, statusLabel, normalizeName, STATUS_LABEL,
}
