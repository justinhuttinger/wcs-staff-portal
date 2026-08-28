const { Router } = require('express')
const authenticate = require('../middleware/auth')
const { requireRole } = require('../middleware/role')
const { supabaseAdmin } = require('../services/supabase')
const { fetchAll } = require('../lib/supabaseFetchAll')
const { wrapSWR } = require('../services/memoryCache')
const { getSkipList } = require('../utils/membershipSkipList')
// This route keeps its own member/Day One loaders below, but VIPs and tours are
// taken from the shared module so the table and the snapshots that drill into
// it cannot disagree about which clubs record them.
const { loadVipCredits, loadTourCompletions } = require('../lib/salespersonData')

// ---------------------------------------------------------------------------
// Salesperson Performance — Analytics (admin only)
//
// Rebuild of the external tool's "Salesperson Performance: New Member Units"
// board, with one deliberate substitution: where the source tool counts ABC
// "PT Intro" bookings, we count **Day One bookings**, which is the equivalent
// step in our model.
//
// Two independent aggregations, unioned on (club, salesperson):
//   1. New member units  — abc_members.since_date in range, grouped by
//                          club_number + sales_person_name.
//   2. Day One bookings  — day_one_appointments.booked_at in range, grouped by
//                          location_slug + booked_by_name (credit follows the
//                          person who BOOKED the Day One, not the person who
//                          sold the membership).
//
// Because the two halves are credited independently, a salesperson can book
// more Day Ones than they sold memberships — Day One Book % can exceed 100%.
// That is real, not a bug: the front desk books for whoever is on the floor.
//
// "Book on Join Date" needs both halves at once, so it bridges the Day One to
// an ABC member: day_one_appointments.ghl_contact_id -> ghl_contacts_v2 ->
// abc_members matched on email OR phone OR full name. That path resolves ~97%
// of bookings; the Day One table's own contact_phone column is unusable (3 of
// 1,696 rows are populated), which is why the GHL contact is the bridge.
// The arithmetic lives in lib/salespersonPerformance.js so it can be tested
// without a database; this file only fetches and caches.
// ---------------------------------------------------------------------------

const {
  CLUBS, CLUB_BY_SLUG, buildReport, buildFilterOptions, VIEW_BY,
} = require('../lib/salespersonPerformance')

async function loadMembers(clubNumbers, start, end) {
  return fetchAll(
    supabaseAdmin
      .from('abc_members')
      .select('id, club_number, sales_person_name, sign_date, membership_type, membership_type_abc_code, agreement_number, since_date, agreement_entry_source, gender, birth_date, payment_frequency, agreement_payment_method, agreement_term, is_primary_member, next_due_amount, down_payment, email, primary_phone, mobile_phone, first_name, last_name')
      .in('club_number', clubNumbers)
      // Selected on since_date, the day the MEMBERSHIP started, not sign_date,
      // the day the current agreement was signed. sign_date moves onto the
      // latest agreement, so selecting on it both double-counts re-signs and
      // loses the original sale. See isNewSale in the lib.
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

// Pull the GHL contacts behind a set of Day Ones so we can match them to ABC
// members. Chunked because PostgREST caps how long an `in` list can be.
async function loadGhlContacts(contactIds) {
  const ids = [...new Set(contactIds.filter(Boolean))]
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

// ---------------------------------------------------------------------------

const router = Router()
router.use(authenticate)
router.use(requireRole('admin'))

const FRESH_MS = 5 * 60 * 1000
const STALE_MS = 30 * 60 * 1000

router.get('/', async (req, res) => {
  try {
    const start = String(req.query.start || '').slice(0, 10)
    const end = String(req.query.end || '').slice(0, 10)
    if (!/^\d{4}-\d{2}-\d{2}$/.test(start) || !/^\d{4}-\d{2}-\d{2}$/.test(end)) {
      return res.status(400).json({ error: 'start and end must be YYYY-MM-DD' })
    }
    if (start > end) return res.status(400).json({ error: 'start must not be after end' })

    const clubsParam = String(req.query.clubs || 'all')
    const slugs = clubsParam === 'all'
      ? CLUBS.map(c => c.slug)
      : clubsParam.split(',').map(s => s.trim().toLowerCase()).filter(s => CLUB_BY_SLUG[s])
    if (slugs.length === 0) return res.status(400).json({ error: 'no valid clubs requested' })

    const filters = {
      // Excluding the shared skip-list types is the default, matching the
      // other membership reports; include is the opt-in.
      exclusion: req.query.exclusion === 'include' ? 'include' : 'exclude',
      joinSource: req.query.joinSource || null,
      membershipType: req.query.membershipType || null,
      gender: req.query.gender || null,
      paymentTerm: req.query.paymentTerm || null,
      paymentMethod: req.query.paymentMethod || null,
      memberRelationship: ['primary', 'secondary'].includes(req.query.memberRelationship)
        ? req.query.memberRelationship
        : null,
      ageGroup: req.query.ageGroup || null,
      viewBy: VIEW_BY.includes(req.query.viewBy) ? req.query.viewBy : 'club_salesperson',
    }

    // Cache key is bounded: the filter values all come from a closed set of
    // in-range values, so this cannot grow without limit.
    const cacheKey = [
      'analytics:salesperson', start, end, slugs.slice().sort().join('+'),
      filters.exclusion, filters.joinSource, filters.membershipType,
      filters.gender, filters.paymentTerm, filters.paymentMethod,
      filters.memberRelationship, filters.ageGroup, filters.viewBy,
    ].join('|')

    const payload = await wrapSWR(cacheKey, FRESH_MS, STALE_MS, async () => {
      const clubNumbers = slugs.map(s => CLUB_BY_SLUG[s].clubNumber)
      const [members, dayOnes, vips, tours] = await Promise.all([
        loadMembers(clubNumbers, start, end),
        loadDayOnes(slugs, start, end),
        loadVipCredits(clubNumbers, start, end),
        loadTourCompletions(clubNumbers, start, end),
      ])
      const contacts = await loadGhlContacts(dayOnes.map(d => d.ghl_contact_id))
      const contactsById = new Map(contacts.map(c => [c.id, c]))
      const skipList = await getSkipList()
      const report = buildReport(members, dayOnes, contactsById, filters, skipList, { vips, tours })
      return {
        ...report,
        filterOptions: buildFilterOptions(members),
        meta: {
          start,
          end,
          clubs: slugs,
          memberRows: members.length,
          excludedTypes: filters.exclusion === 'include' ? [] : [...skipList].sort(),
          dayOneRows: dayOnes.length,
          // How much of the window has a payment method on file. Until the
          // migration-123 backfill has run this is 0, and % on ACH shows N/A
          // rather than a fake 0%.
          paymentMethodCoverage: members.length
            ? Math.round((members.filter(m => m.agreement_payment_method).length / members.length) * 100)
            : null,
          // Surfaced so the UI can be honest about what is not yet wired up.
          unavailable: {
            tours: 'tour events are live-fetched from GHL and never persisted',
          },
        },
      }
    })

    res.json(payload)
  } catch (err) {
    console.error('[analytics/salesperson] error:', err.message)
    res.status(500).json({ error: 'Failed to build salesperson performance report' })
  }
})

module.exports = router
