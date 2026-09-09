const { Router } = require('express')
const authenticate = require('../middleware/auth')
const { requireRole } = require('../middleware/role')
const { supabaseAdmin } = require('../services/supabase')
const { fetchAll } = require('../lib/supabaseFetchAll')
const { wrapSWR } = require('../services/memoryCache')
const { monthToDate, windowLabel } = require('../lib/snapshotWindow')
const { CLUBS, CLUB_BY_SLUG } = require('../lib/salespersonPerformance')
const { buildVipAnalysis, VIEW_BY } = require('../lib/vipAnalysis')

// ---------------------------------------------------------------------------
// VIP Analysis — Analytics (corporate+)
//
// Of the VIP referrals collected in the window, how many came in and how many
// joined. See lib/vipAnalysis for what each step means and why two of the three
// can come back null rather than zero.
// ---------------------------------------------------------------------------

const router = Router()
router.use(authenticate)
router.use(requireRole('corporate'))

const FRESH_MS = 5 * 60 * 1000
const STALE_MS = 30 * 60 * 1000

// How long after the referral a tour or a signup still counts as belonging to
// it. Kept equal to salespersonPerformance's TOUR_ATTRIBUTION_DAYS: a referral
// on the last day of the month routinely converts in the next one, and cutting
// at the window edge would score every late referral a failure by an accident
// of where the report boundary fell.
const ATTRIBUTION_DAYS = 30

// PostgREST caps how long an `in` list may be, and a busy month is well past a
// few hundred contacts.
const CHUNK = 200

function addDays(iso, days) {
  return new Date(Date.parse(`${iso}T00:00:00Z`) + days * 86400000).toISOString().slice(0, 10)
}

/** Rows for a set of contact ids, in chunks the URL length can carry. */
async function inChunks(ids, run) {
  const out = []
  for (let i = 0; i < ids.length; i += CHUNK) {
    out.push(...(await run(ids.slice(i, i + CHUNK))))
  }
  return out
}

router.get('/', async (req, res) => {
  try {
    const mtd = monthToDate()
    const isDate = v => /^\d{4}-\d{2}-\d{2}$/.test(String(v || ''))
    const start = isDate(req.query.start) ? String(req.query.start) : mtd.start
    const end = isDate(req.query.end) ? String(req.query.end) : mtd.end
    if (start > end) return res.status(400).json({ error: 'start must not be after end' })

    const clubsParam = String(req.query.clubs || 'all')
    const slugs = clubsParam === 'all'
      ? CLUBS.map(c => c.slug)
      : clubsParam.split(',').map(s => s.trim().toLowerCase()).filter(s => CLUB_BY_SLUG[s])
    if (slugs.length === 0) return res.status(400).json({ error: 'no valid clubs requested' })

    const viewBy = VIEW_BY.includes(String(req.query.viewBy)) ? String(req.query.viewBy) : 'club'
    const clubNumbers = slugs.map(s => CLUB_BY_SLUG[s].clubNumber)
    const tail = addDays(end, ATTRIBUTION_DAYS)

    // viewBy is not in the key: it regroups the same rows and the payload is
    // rebuilt from cache in microseconds, so caching it twice would only halve
    // the hit rate.
    const cacheKey = ['analytics:vip-analysis', start, end, slugs.slice().sort().join('+')].join('|')

    const payload = await wrapSWR(cacheKey, FRESH_MS, STALE_MS, async () => {
      // Lifetime club sets, judged over the whole table rather than the window
      // — see lib/vipAnalysis on why not-configured must not read as zero.
      const [credits, vipEver, tourEver] = await Promise.all([
        fetchAll(supabaseAdmin.from('vip_credits')
          .select('ghl_contact_id, club_number, employee_name, credited_at')
          .in('club_number', clubNumbers)
          .gte('credited_at', `${start}T00:00:00Z`)
          .lte('credited_at', `${end}T23:59:59.999Z`)
          .order('id', { ascending: true })),
        fetchAll(supabaseAdmin.from('vip_credits').select('club_number')),
        fetchAll(supabaseAdmin.from('tour_intakes').select('club_number').eq('status', 'completed')),
      ])

      const contactIds = [...new Set(credits.map(c => c.ghl_contact_id).filter(Boolean))]

      const [contacts, tours, members] = await Promise.all([
        // Email, phone and name are what the member match runs on. Without the
        // contact there is nothing to match, so an unresolvable id simply never
        // converts rather than throwing.
        inChunks(contactIds, ids => fetchAll(supabaseAdmin.from('ghl_contacts_v2')
          .select('id, email, phone, first_name, last_name')
          .in('id', ids))),
        // Every completed tour for these people from the window opening to the
        // attribution tail. Not bounded by club: a referral collected at one
        // club and toured at another still walked through a door.
        inChunks(contactIds, ids => fetchAll(supabaseAdmin.from('tour_intakes')
          .select('ghl_contact_id, completed_at')
          .eq('status', 'completed')
          .in('ghl_contact_id', ids)
          .gte('completed_at', `${start}T00:00:00Z`)
          .lte('completed_at', `${tail}T23:59:59.999Z`))),
        // Joiners over the same span. The match is on the person, not the club,
        // for the same reason.
        fetchAll(supabaseAdmin.from('abc_members')
          .select('id, club_number, since_date, sign_date, email, primary_phone, mobile_phone, first_name, last_name')
          .gte('since_date', start)
          .lte('since_date', tail)
          .order('id', { ascending: true })),
      ])

      return {
        credits,
        contacts,
        tours,
        members,
        vipClubs: [...new Set(vipEver.map(r => r.club_number))],
        tourClubs: [...new Set(tourEver.map(r => r.club_number))],
      }
    })

    const built = buildVipAnalysis(payload.credits, {
      contactsById: new Map(payload.contacts.map(c => [c.id, c])),
      tours: payload.tours,
      members: payload.members,
      vipClubs: new Set(payload.vipClubs),
      tourClubs: new Set(payload.tourClubs),
      viewBy,
    })

    res.json({
      ...built,
      meta: {
        start, end,
        windowLabel: windowLabel(start, end),
        clubs: slugs,
        attributionDays: ATTRIBUTION_DAYS,
        // Named so the report can say WHY a column is blank rather than just
        // leaving a dash for the reader to interpret.
        unconfiguredVip: slugs.filter(s => !payload.vipClubs.includes(CLUB_BY_SLUG[s].clubNumber)),
        noTourHistory: slugs.filter(s => !payload.tourClubs.includes(CLUB_BY_SLUG[s].clubNumber)),
      },
    })
  } catch (err) {
    console.error('[analytics/vip-analysis] failed:', err.message)
    res.status(500).json({ error: 'vip analysis failed' })
  }
})

module.exports = router
