const { Router } = require('express')
const authenticate = require('../middleware/auth')
const { requireRole } = require('../middleware/role')
const { supabaseAdmin } = require('../services/supabase')
const { fetchAll } = require('../lib/supabaseFetchAll')
const { wrapSWR } = require('../services/memoryCache')
const { getSkipList } = require('../utils/membershipSkipList')
const { buildMemberMap } = require('../lib/memberMap')
const { CLUBS, CLUB_BY_SLUG } = require('../lib/salespersonPerformance')

// ---------------------------------------------------------------------------
// Member Map — Analytics (OWNER ONLY)
//
// Every active member's home address as a pin, against the club pins, with
// distance-to-club stats. Home addresses are the most sensitive thing the
// portal shows, so this is gated to MEMBER_MAP_EMAILS (default: the owner)
// on top of admin, not to a role.
//
// "Active" is Membership Mix's rule: abc_members_counted, is_active +
// counts_as_member, minus the excluded statuses and the skip list, so the two
// reports agree on the count. Addresses come from the ABC sync (migration 236);
// geocodes from ghl-sync's Census job (address_geocodes).
// ---------------------------------------------------------------------------

const router = Router()

const OWNER_EMAILS = (process.env.MEMBER_MAP_EMAILS || 'justin@wcstrength.com')
  .split(',').map(s => s.trim().toLowerCase()).filter(Boolean)

function requireOwner(req, res, next) {
  if (!OWNER_EMAILS.includes(String(req.staff?.email || '').toLowerCase())) {
    return res.status(403).json({ error: 'Not available' })
  }
  next()
}

router.use(authenticate)
router.use(requireRole('admin'))
router.use(requireOwner)

const FRESH_MS = 10 * 60 * 1000
const STALE_MS = 60 * 60 * 1000
const EXCLUDED_STATUSES = ['Return For Collection', 'Cancelled', 'Expired']

async function load(clubNumbers) {
  const [counted, addresses, geocodes, pins, skipList] = await Promise.all([
    fetchAll(supabaseAdmin
      .from('abc_members_counted')
      .select('id, membership_type')
      .in('club_number', clubNumbers)
      .eq('is_active', true)
      .eq('counts_as_member', true)
      .not('member_status', 'in', `(${EXCLUDED_STATUSES.map(s => `"${s}"`).join(',')})`)
      .order('id', { ascending: true })),
    fetchAll(supabaseAdmin
      .from('abc_members')
      .select('id, member_id, club_number, first_name, last_name, address_line1, city, state, postal_code, address_key')
      .in('club_number', clubNumbers)
      .eq('is_active', true)
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
  ])
  if (pins.error) throw new Error(pins.error.message)

  const keep = new Set(counted
    .filter(m => !skipList.has((m.membership_type || '').toLowerCase()))
    .map(m => m.id))
  const members = addresses.filter(m => keep.has(m.id))
  const geo = new Map(geocodes.map(g => [g.address_key, { lat: g.lat, lng: g.lng }]))
  const clubs = (pins.data || [])
    .map(p => ({ club_number: p.club_number, slug: p.clubs.slug, name: p.clubs.name, sort_order: p.clubs.sort_order, address: p.address, lat: p.lat, lng: p.lng }))
    .sort((a, b) => a.sort_order - b.sort_order)
  return { members, geo, clubs }
}

router.get('/', async (req, res) => {
  try {
    const clubsParam = String(req.query.clubs || 'all')
    const slugs = clubsParam === 'all'
      ? CLUBS.map(c => c.slug)
      : clubsParam.split(',').map(s => s.trim().toLowerCase()).filter(s => CLUB_BY_SLUG[s])
    if (slugs.length === 0) return res.status(400).json({ error: 'no valid clubs requested' })
    const selected = new Set(slugs.map(s => CLUB_BY_SLUG[s].clubNumber))

    // One cache entry for all clubs: the pull is the same either way (nearest
    // club is judged against every pin), only the selection differs.
    const allNumbers = CLUBS.map(c => c.clubNumber)
    const data = await wrapSWR('analytics:member-map', FRESH_MS, STALE_MS, () => load(allNumbers))

    const payload = buildMemberMap({ members: data.members, geocodes: data.geo, clubs: data.clubs, selected })
    res.set('Cache-Control', 'private, no-store')
    res.json({ ...payload, generated_at: new Date().toISOString() })
  } catch (err) {
    console.error('[MemberMap] failed:', err.message)
    res.status(500).json({ error: err.message })
  }
})

module.exports = router
