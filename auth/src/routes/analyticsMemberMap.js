const { Router } = require('express')
const authenticate = require('../middleware/auth')
const { requireRole } = require('../middleware/role')
const { narrowClubsToScope } = require('../services/locationScope')
const { supabaseAdmin } = require('../services/supabase')
const { fetchAll } = require('../lib/supabaseFetchAll')
const { wrapSWR } = require('../services/memoryCache')
const { getSkipList } = require('../utils/membershipSkipList')
const { buildMemberMap, selectPopulation, POPULATIONS, HORIZON_DAYS } = require('../lib/memberMap')
const { CLUBS, CLUB_BY_SLUG } = require('../lib/salespersonPerformance')

// ---------------------------------------------------------------------------
// Member Map — Analytics (manager+, club-scoped)
//
// Members' home addresses as pins against the club pins, with distance-to-club
// stats. Managers only ever receive members of the clubs they are assigned to
// (narrowClubsToScope); corporate+ see every club. Every club's PIN is sent
// regardless, since "nearest club" is judged against all of them and club
// addresses are public.
//
// ?population= picks who is plotted: active (default), new, cancelled,
// pending or pt. Each uses the rule of the report that owns that number; see
// selectPopulation in lib/memberMap. new and cancelled read ?start/?end and
// reach back HORIZON_DAYS (what the geocoder covers, migration 237).
// Addresses come from the ABC sync (migration 236); geocodes from ghl-sync's
// Census job (address_geocodes).
// ---------------------------------------------------------------------------

const router = Router()

router.use(authenticate)
router.use(requireRole('manager'))

const FRESH_MS = 10 * 60 * 1000
const STALE_MS = 60 * 60 * 1000
const PIF_LOOKBACK_MONTHS = 12

function isoDaysAgo(days) {
  return new Date(Date.now() - days * 86400000).toISOString().slice(0, 10)
}

async function load(clubNumbers) {
  const horizon = isoDaysAgo(HORIZON_DAYS)
  const today = new Date().toLocaleDateString('en-CA', { timeZone: 'America/Los_Angeles' })
  const pifSince = (() => {
    const d = new Date(`${today}T00:00:00Z`)
    d.setUTCMonth(d.getUTCMonth() - PIF_LOOKBACK_MONTHS)
    return d.toISOString().slice(0, 10)
  })()

  const [counted, rows, geocodes, pins, skip, ptRecurring, ptPif] = await Promise.all([
    fetchAll(supabaseAdmin
      .from('abc_members_counted')
      .select('id')
      .in('club_number', clubNumbers)
      .eq('is_active', true)
      .eq('counts_as_member', true)
      .order('id', { ascending: true })),
    // Everyone any population could need: active today, or joined / changed
    // status inside the horizon.
    fetchAll(supabaseAdmin
      .from('abc_members')
      .select('id, member_id, club_number, first_name, last_name, address_line1, city, state, postal_code, address_key, ' +
        'is_active, member_status, member_status_date, since_date, membership_type')
      .in('club_number', clubNumbers)
      .or(`is_active.eq.true,since_date.gte.${horizon},member_status_date.gte.${horizon}`)
      .order('id', { ascending: true })),
    fetchAll(supabaseAdmin
      .from('address_geocodes')
      .select('address_key, lat, lng')
      .eq('status', 'match')
      .order('address_key', { ascending: true })),
    supabaseAdmin
      .from('club_geo')
      .select('club_number, address, lat, lng, clubs!inner(slug, name, sort_order, active)')
      .eq('clubs.active', true),
    getSkipList(),
    // PT Roster's "today": recurring services sold and not yet ended...
    fetchAll(supabaseAdmin
      .from('abc_pt_services')
      .select('club_number, member_id, inactive_date')
      .in('club_number', clubNumbers)
      .not('recurring_type_desc', 'ilike', '%paid in full%')
      .lte('sale_date', today)
      .order('recurring_service_id', { ascending: true })),
    // ...plus paid-in-full packages bought in the last 12 months (no end date).
    fetchAll(supabaseAdmin
      .from('abc_pt_services')
      .select('club_number, member_id')
      .in('club_number', clubNumbers)
      .ilike('recurring_type_desc', '%paid in full%')
      .lte('sale_date', today)
      .gte('sale_date', pifSince)
      .order('recurring_service_id', { ascending: true })),
  ])
  if (pins.error) throw new Error(pins.error.message)

  const ptKeys = new Set([
    ...ptRecurring.filter(s => !s.inactive_date || String(s.inactive_date).slice(0, 10) > today),
    ...ptPif,
  ].map(s => `${s.club_number}|${s.member_id}`))
  const geo = new Map(geocodes.map(g => [g.address_key, { lat: g.lat, lng: g.lng }]))
  const clubs = (pins.data || [])
    .map(p => ({ club_number: p.club_number, slug: p.clubs.slug, name: p.clubs.name, sort_order: p.clubs.sort_order, address: p.address, lat: p.lat, lng: p.lng }))
    .sort((a, b) => a.sort_order - b.sort_order)
  return { rows, countedIds: new Set(counted.map(c => c.id)), skip, ptKeys, geo, clubs, horizon }
}

router.get('/', async (req, res) => {
  try {
    const clubsParam = String(req.query.clubs || 'all')
    const asked = clubsParam === 'all'
      ? CLUBS.map(c => c.slug)
      : clubsParam.split(',').map(s => s.trim().toLowerCase()).filter(s => CLUB_BY_SLUG[s])
    if (asked.length === 0) return res.status(400).json({ error: 'no valid clubs requested' })
    // Managers are narrowed to the clubs they are assigned; corporate+ keep what they asked for.
    const slugs = await narrowClubsToScope(req, asked)
    if (slugs.length === 0) return res.status(403).json({ error: 'no access to the requested clubs' })
    const selected = new Set(slugs.map(s => CLUB_BY_SLUG[s].clubNumber))
    const population = POPULATIONS.includes(String(req.query.population)) ? String(req.query.population) : 'active'
    const isDate = v => /^\d{4}-\d{2}-\d{2}$/.test(String(v || ''))
    const today = new Date().toLocaleDateString('en-CA', { timeZone: 'America/Los_Angeles' })
    const end = isDate(req.query.end) ? String(req.query.end) : today
    const start = isDate(req.query.start) ? String(req.query.start) : `${end.slice(0, 7)}-01`
    if (start > end) return res.status(400).json({ error: 'start must not be after end' })

    // One cache entry for all clubs: the pull is the same either way (nearest
    // club is judged against every pin), only the selection differs.
    const allNumbers = CLUBS.map(c => c.clubNumber)
    const data = await wrapSWR('analytics:member-map', FRESH_MS, STALE_MS, () => load(allNumbers))

    const members = selectPopulation(data.rows, {
      population, start, end, countedIds: data.countedIds, skip: data.skip, ptKeys: data.ptKeys,
    })
    const payload = buildMemberMap({ members, geocodes: data.geo, clubs: data.clubs, selected })
    res.set('Cache-Control', 'private, no-store')
    res.json({
      ...payload,
      population,
      range: population === 'new' || population === 'cancelled' ? { start, end } : null,
      // Before this date New Members / Cancelled have no geocodes to plot.
      horizon: data.horizon,
      generated_at: new Date().toISOString(),
    })
  } catch (err) {
    console.error('[MemberMap] failed:', err.message)
    res.status(500).json({ error: err.message })
  }
})

module.exports = router
