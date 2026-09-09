const { Router } = require('express')
const authenticate = require('../middleware/auth')
const { requireRole } = require('../middleware/role')
const { supabaseAdmin } = require('../services/supabase')
const { fetchAll } = require('../lib/supabaseFetchAll')
const { wrapSWR } = require('../services/memoryCache')
const { monthToDate, windowLabel } = require('../lib/snapshotWindow')
const { CLUBS, CLUB_BY_SLUG } = require('../lib/salespersonPerformance')
const { getLocationBySlug } = require('../config/ghlLocations')
const { buildVipAnalysis, VIEW_BY } = require('../lib/vipAnalysis')

// ---------------------------------------------------------------------------
// VIP Analysis — Analytics (corporate+)
//
// Of the VIP referrals collected in the window, how many came in and how many
// joined. See lib/vipAnalysis for what each step means and why a figure can
// come back null rather than zero.
//
// "Came in" is a GHL pipeline stage, not a tour: VIPs are worked in GHL rather
// than walked through the tour check-in, and measuring it from tours found one
// of 176 in September.
// ---------------------------------------------------------------------------

const router = Router()
router.use(authenticate)
router.use(requireRole('corporate'))

const FRESH_MS = 5 * 60 * 1000
const STALE_MS = 30 * 60 * 1000

// How long after the window closes a signup still counts as belonging to a
// referral in it. Kept equal to salespersonPerformance's TOUR_ATTRIBUTION_DAYS: a referral
// on the last day of the month routinely converts in the next one, and cutting
// at the window edge would score every late referral a failure by an accident
// of where the report boundary fell.
const ATTRIBUTION_DAYS = 30

// PostgREST caps how long an `in` list may be, and a busy month is well past a
// few hundred contacts.
const CHUNK = 200

// Matched on stage NAME alone. 'Trial Started' lives in Membership Pipeline at
// five clubs and Standard Member Pipeline at one, and nowhere else; 'Pass
// Redeemed' lives only in the VIP Pipeline. The names are already unambiguous,
// and pinning the pipeline as well would report zero at the club on the other
// membership pipeline.
const TRIAL_STAGE = 'Trial Started'
const PASS_STAGE = 'Pass Redeemed'

// stage_name and pipeline_name are columns on ghl_opportunities_v2 and are
// EMPTY — 0 of 20,011 rows carry either — so the stage has to be joined rather
// than read off the row. Reading the column would have quietly matched nothing.
const OPP_SELECT = 'contact_id, status, last_stage_change_at, ghl_pipeline_stages(name)'

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
      // Which clubs CAN produce each number, read from what their GHL account
      // actually has rather than from whether the window was busy. A location
      // with no Trial Started stage anywhere in its pipelines cannot report a
      // came-in figure, and zero there would be a claim about the staff.
      const [credits, vipEver, stageRows] = await Promise.all([
        fetchAll(supabaseAdmin.from('vip_credits')
          .select('ghl_contact_id, club_number, employee_name, credited_at')
          .in('club_number', clubNumbers)
          .gte('credited_at', `${start}T00:00:00Z`)
          .lte('credited_at', `${end}T23:59:59.999Z`)
          .order('id', { ascending: true })),
        fetchAll(supabaseAdmin.from('vip_credits').select('club_number')),
        fetchAll(supabaseAdmin.from('ghl_pipeline_stages')
          .select('name, ghl_pipelines(location_id)')
          .in('name', [TRIAL_STAGE, PASS_STAGE])),
      ])

      const contactIds = [...new Set(credits.map(c => c.ghl_contact_id).filter(Boolean))]

      const [contacts, opps, members] = await Promise.all([
        // Email, phone and name are what the member match runs on. Without the
        // contact there is nothing to match, so an unresolvable id simply never
        // converts rather than throwing.
        inChunks(contactIds, ids => fetchAll(supabaseAdmin.from('ghl_contacts_v2')
          .select('id, email, phone, first_name, last_name')
          .in('id', ids))),
        // Every opportunity these people hold. NOT filtered by date here: an
        // opportunity carries only its current stage, and the date that matters
        // is when it reached that stage, which is compared against the credit in
        // the builder. Filtering on creation would drop somebody referred after
        // their opportunity was raised.
        inChunks(contactIds, ids => fetchAll(supabaseAdmin.from('ghl_opportunities_v2')
          .select(OPP_SELECT)
          .in('contact_id', ids))),
        // Joiners over the same span. The match is on the person, not the club,
        // for the same reason.
        fetchAll(supabaseAdmin.from('abc_members')
          .select('id, club_number, since_date, sign_date, email, primary_phone, mobile_phone, first_name, last_name')
          .gte('since_date', start)
          .lte('since_date', tail)
          .order('id', { ascending: true })),
      ])

      // location id -> club number, so a stage seen at a location can be said
      // to belong to a club.
      const clubByLocation = new Map()
      for (const slug of slugs) {
        const loc = getLocationBySlug(slug)
        if (loc?.id) clubByLocation.set(loc.id, CLUB_BY_SLUG[slug].clubNumber)
      }
      const clubsWithStage = (stageName) => [...new Set(
        stageRows
          .filter(r => r.name === stageName)
          .map(r => clubByLocation.get(r.ghl_pipelines?.location_id))
          .filter(Boolean)
      )]

      return {
        credits,
        contacts,
        opps,
        members,
        vipClubs: [...new Set(vipEver.map(r => r.club_number))],
        trialClubs: clubsWithStage(TRIAL_STAGE),
        passClubs: clubsWithStage(PASS_STAGE),
      }
    })

    // contact id -> the EARLIEST date each stage was reached. Earliest, because
    // a person can hold more than one opportunity and the first time they got
    // there is the answer to "when did they come in".
    const reached = new Map()
    for (const o of payload.opps) {
      const stage = o.ghl_pipeline_stages?.name
      const key = stage === TRIAL_STAGE ? 'trial' : stage === PASS_STAGE ? 'pass' : null
      if (!key || !o.contact_id || !o.last_stage_change_at) continue
      const day = String(o.last_stage_change_at).slice(0, 10)
      const cur = reached.get(o.contact_id) || { trial: null, pass: null }
      if (!cur[key] || day < cur[key]) cur[key] = day
      reached.set(o.contact_id, cur)
    }

    const built = buildVipAnalysis(payload.credits, {
      contactsById: new Map(payload.contacts.map(c => [c.id, c])),
      reached,
      members: payload.members,
      vipClubs: new Set(payload.vipClubs),
      trialClubs: new Set(payload.trialClubs),
      passClubs: new Set(payload.passClubs),
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
        noTrialStage: slugs.filter(s => !payload.trialClubs.includes(CLUB_BY_SLUG[s].clubNumber)),
        noPassStage: slugs.filter(s => !payload.passClubs.includes(CLUB_BY_SLUG[s].clubNumber)),
      },
    })
  } catch (err) {
    console.error('[analytics/vip-analysis] failed:', err.message)
    res.status(500).json({ error: 'vip analysis failed' })
  }
})

module.exports = router
