const { Router } = require('express')
const authenticate = require('../middleware/auth')
const { requireRole } = require('../middleware/role')
const { supabaseAdmin } = require('../services/supabase')
const { fetchAll } = require('../lib/supabaseFetchAll')
const { wrapSWR } = require('../services/memoryCache')
const { CLUBS, CLUB_BY_SLUG, clubName } = require('../lib/salespersonPerformance')
const { buildPtRoster } = require('../lib/ptRosterAnalytics')

// ---------------------------------------------------------------------------
// PT Roster — Analytics (corporate+)
//
// Who is on personal training right now. The old Reporting view's roster, read
// from the synced abc_pt_services rather than the live ABC API — see
// lib/ptRosterAnalytics for what that trades away and why it is worth it.
//
// A STOCK, NOT A FLOW: this is the book as it stands, so the shared date range
// does not apply. The one date that matters is how far back a paid-in-full
// package still counts as current, which is a setting rather than a filter.
// ---------------------------------------------------------------------------

const router = Router()
router.use(authenticate)
router.use(requireRole('corporate'))

const FRESH_MS = 10 * 60 * 1000
const STALE_MS = 60 * 60 * 1000

// How long a paid-in-full package counts as a live client. ABC puts no end date
// on one, so there is no honest way to know when it is spent; a year is the
// window the old report's users were reading it over.
const PIF_LOOKBACK_MONTHS = 12

const FIELDS =
  'member_id, member_name, club_number, trainer_name, service_item, recurring_type_desc, ' +
  'status, sub_status, frequency, invoice_total, sale_date'

router.get('/', async (req, res) => {
  try {
    const clubsParam = String(req.query.clubs || 'all')
    const slugs = clubsParam === 'all'
      ? CLUBS.map(c => c.slug)
      : clubsParam.split(',').map(s => s.trim().toLowerCase()).filter(s => CLUB_BY_SLUG[s])
    if (slugs.length === 0) return res.status(400).json({ error: 'no valid clubs requested' })

    const allClubs = slugs.length === CLUBS.length
    const clubNumbers = allClubs ? null : slugs.map(s => CLUB_BY_SLUG[s].clubNumber)

    const since = new Date()
    since.setUTCMonth(since.getUTCMonth() - PIF_LOOKBACK_MONTHS)
    const pifSince = since.toISOString().slice(0, 10)

    const cacheKey = ['analytics:pt-roster', slugs.slice().sort().join('+')].join('|')

    const payload = await wrapSWR(cacheKey, FRESH_MS, STALE_MS, async () => {
      const scoped = q => (clubNumbers ? q.in('club_number', clubNumbers) : q)

      const [recurring, pif] = await Promise.all([
        // Active and not paid in full: an ongoing commitment on the books.
        // 'Frozen' counts as active on purpose — a frozen client is still a
        // client, and the roster flags them rather than dropping them.
        fetchAll(scoped(supabaseAdmin.from('abc_pt_services')
          .select(FIELDS)
          .eq('status', 'active')
          .not('recurring_type_desc', 'ilike', '%paid in full%'))),
        // Paid in full carries no end date and lands as inactive the moment it
        // is sold, so it cannot be selected on status at all — only on when it
        // was bought.
        fetchAll(scoped(supabaseAdmin.from('abc_pt_services')
          .select(FIELDS)
          .ilike('recurring_type_desc', '%paid in full%')
          .gte('sale_date', pifSince))),
      ])

      return { recurring, pif }
    })

    const built = buildPtRoster(payload.recurring, payload.pif, {
      pifLookbackMonths: PIF_LOOKBACK_MONTHS,
    })

    res.json({
      ...built,
      clients: built.clients.map(c => ({ ...c, club: clubName(c.clubNumber) })),
      meta: {
        clubs: slugs,
        pifSince,
        pifLookbackMonths: PIF_LOOKBACK_MONTHS,
        asOf: new Date().toISOString().slice(0, 10),
      },
    })
  } catch (err) {
    console.error('[analytics/pt-roster] error:', err.message)
    res.status(500).json({ error: 'Failed to build PT roster' })
  }
})

module.exports = router
