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
// A STOCK, NOT A FLOW — but a stock that can be rewound. Unlike abc_members,
// which is current-state and loses a membership the moment somebody re-joins,
// abc_pt_services keeps every service as a TERM: its own row, its own sale_date
// and inactive_date, never overwritten. ABC returned the full history in one
// pull back to June 2022.
//
// So the roster reconstructs for any past date: sold by then, not ended by
// then. The window's END is the as-of date, which is why this report takes the
// shared range at all — it has no use for the start.
//
// THE ONE THING THAT CANNOT BE REWOUND is paid in full. ABC puts no end date on
// a PIF package, so there is no way to know when it was spent; those are
// counted by a lookback from the as-of date instead, and the report says so.
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
    const isDate = v => /^\d{4}-\d{2}-\d{2}$/.test(String(v || ''))
    // As of the end of the chosen window, or today. A roster is always "as at"
    // a moment, never "between two dates".
    const today = new Date().toLocaleDateString('en-CA', { timeZone: 'America/Los_Angeles' })
    const asOf = isDate(req.query.asOf) ? String(req.query.asOf)
      : isDate(req.query.end) ? String(req.query.end)
      : today

    const clubsParam = String(req.query.clubs || 'all')
    const slugs = clubsParam === 'all'
      ? CLUBS.map(c => c.slug)
      : clubsParam.split(',').map(s => s.trim().toLowerCase()).filter(s => CLUB_BY_SLUG[s])
    if (slugs.length === 0) return res.status(400).json({ error: 'no valid clubs requested' })

    const allClubs = slugs.length === CLUBS.length
    const clubNumbers = allClubs ? null : slugs.map(s => CLUB_BY_SLUG[s].clubNumber)

    // Counted back from the AS-OF date, not from today: a roster for last March
    // must not include a package bought in July.
    const since = new Date(`${asOf}T00:00:00Z`)
    since.setUTCMonth(since.getUTCMonth() - PIF_LOOKBACK_MONTHS)
    const pifSince = since.toISOString().slice(0, 10)

    const cacheKey = ['analytics:pt-roster', asOf, slugs.slice().sort().join('+')].join('|')

    const payload = await wrapSWR(cacheKey, FRESH_MS, STALE_MS, async () => {
      const scoped = q => (clubNumbers ? q.in('club_number', clubNumbers) : q)

      const [recurringRaw, pif] = await Promise.all([
        // Sold by the as-of date and not ended by it. Selected on DATES rather
        // than on status, so the same query answers "today" and "last March" —
        // status only ever describes now.
        fetchAll(scoped(supabaseAdmin.from('abc_pt_services')
          .select(FIELDS)
          .not('recurring_type_desc', 'ilike', '%paid in full%')
          .lte('sale_date', asOf))),
        // Paid in full carries no end date and lands as inactive the moment it
        // is sold, so it cannot be selected on status or dated out — only on
        // when it was bought.
        fetchAll(scoped(supabaseAdmin.from('abc_pt_services')
          .select(FIELDS)
          .ilike('recurring_type_desc', '%paid in full%')
          .lte('sale_date', asOf)
          .gte('sale_date', pifSince))),
      ])

      // Still running on the as-of date: no end date yet, or one that had not
      // arrived. A service that ends ON the day is counted as gone that day,
      // matching how every loss figure in Analytics dates a deactivation.
      const recurring = recurringRaw.filter(
        s => !s.inactive_date || String(s.inactive_date).slice(0, 10) > asOf
      )

      return { recurring, pif }
    })

    const built = buildPtRoster(payload.recurring, payload.pif, {
      pifLookbackMonths: PIF_LOOKBACK_MONTHS,
    })

    res.json({
      ...built,
      clients: built.clients.map(c => ({ ...c, club: clubName(c.clubNumber) })),
      trainers: built.trainers.map(t => ({
        ...t,
        clients: t.clients.map(c => ({ ...c, club: clubName(c.clubNumber) })),
      })),
      meta: {
        clubs: slugs,
        pifSince,
        pifLookbackMonths: PIF_LOOKBACK_MONTHS,
        asOf,
        isHistorical: asOf < today,
      },
    })
  } catch (err) {
    console.error('[analytics/pt-roster] error:', err.message)
    res.status(500).json({ error: 'Failed to build PT roster' })
  }
})

module.exports = router
