const { Router } = require('express')
const authenticate = require('../middleware/auth')
const { requireRole } = require('../middleware/role')
const { supabaseAdmin } = require('../services/supabase')
const { fetchAll } = require('../lib/supabaseFetchAll')
const { wrapSWR } = require('../services/memoryCache')
const { buildMemberJourney } = require('../lib/memberJourney')
const { CLUBS, CLUB_BY_SLUG } = require('../lib/salespersonPerformance')

// ---------------------------------------------------------------------------
// Member Journey — Analytics (admin only)
//
// What a member is worth, and how often they come, by MONTH OF MEMBERSHIP
// rather than by calendar month. Everybody's first month is 0, so a member who
// joined last week and one who joined two years ago are compared at the same
// point in their own membership.
//
// Migration 154 carries the definitions. The one worth knowing here: the
// denominator is member-MONTHS generated from the join date, not the rows in
// the check-in table. That table holds no zeroes, so averaging it directly
// answers "among members who came, how often" and draws a flat line.
// ---------------------------------------------------------------------------

const router = Router()
router.use(authenticate)
router.use(requireRole('admin'))

const FRESH_MS = 15 * 60 * 1000
const STALE_MS = 60 * 60 * 1000
const DEFAULT_MAX_MONTHS = 24
const MAX_MAX_MONTHS = 48

// The check-in feed starts here. A member who joined before it cannot have
// early tenure months measured, so the default cohort starts where the evidence
// does — otherwise months 0-11 of a 2023 joiner would be counted as zero visits
// and drag the whole early curve down.
const CHECKIN_DATA_FROM = '2024-08-01'

const STATUSES = new Set(['all', 'active', 'left'])
const PT_CHOICES = new Set(['all', 'yes', 'no'])

router.get('/', async (req, res) => {
  try {
    const isDate = v => /^\d{4}-\d{2}-\d{2}$/.test(String(v || ''))
    const joinFrom = isDate(req.query.joinFrom) ? String(req.query.joinFrom) : CHECKIN_DATA_FROM
    const joinTo = isDate(req.query.joinTo) ? String(req.query.joinTo) : new Date().toISOString().slice(0, 10)
    if (joinFrom > joinTo) return res.status(400).json({ error: 'joinFrom must not be after joinTo' })

    const maxRaw = Number(req.query.maxMonths)
    const maxMonths = Number.isFinite(maxRaw)
      ? Math.min(MAX_MAX_MONTHS, Math.max(1, Math.round(maxRaw)))
      : DEFAULT_MAX_MONTHS

    const clubsParam = String(req.query.clubs || 'all')
    const slugs = clubsParam === 'all'
      ? CLUBS.map(c => c.slug)
      : clubsParam.split(',').map(s => s.trim().toLowerCase()).filter(s => CLUB_BY_SLUG[s])
    if (slugs.length === 0) return res.status(400).json({ error: 'no valid clubs requested' })

    const allClubs = slugs.length === CLUBS.length
    const clubNumbers = allClubs ? null : slugs.map(s => CLUB_BY_SLUG[s].clubNumber)

    const status = STATUSES.has(String(req.query.status)) ? String(req.query.status) : 'all'
    const pt = PT_CHOICES.has(String(req.query.pt)) ? String(req.query.pt) : 'all'
    const pick = v => {
      const s = String(v ?? '').trim()
      return s === '' || s === 'all' ? null : s
    }

    const args = {
      p_join_from: joinFrom,
      p_join_to: joinTo,
      p_clubs: clubNumbers,
      p_max_months: maxMonths,
      p_status: status,
      p_gender: pick(req.query.gender),
      p_age_group: pick(req.query.ageGroup),
      p_join_source: pick(req.query.joinSource),
      p_membership_type: pick(req.query.membershipType),
      p_pt: pt,
      p_exclude: String(req.query.exclude ?? 'true') !== 'false',
    }

    const cacheKey = ['analytics:member-journey', ...Object.values(args).map(v =>
      Array.isArray(v) ? v.slice().sort().join('+') : String(v))].join('|')

    const rows = await wrapSWR(cacheKey, FRESH_MS, STALE_MS, async () =>
      // fetchAll: 48 tenure months across a dozen spend groups runs past the
      // 1000-row cap PostgREST applies silently, in ORDER BY order.
      fetchAll(supabaseAdmin.rpc('analytics_member_journey', args))
    )

    const built = buildMemberJourney(rows)

    res.json({
      ...built,
      meta: {
        joinFrom, joinTo, maxMonths, status, pt,
        clubs: slugs,
        checkinDataFrom: CHECKIN_DATA_FROM,
        exclude: args.p_exclude,
      },
    })
  } catch (err) {
    console.error('[analytics/member-journey] error:', err.message)
    res.status(500).json({ error: 'Failed to build member journey' })
  }
})

module.exports = router
