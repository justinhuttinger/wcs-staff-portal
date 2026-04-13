const { Router } = require('express')
const { supabaseAdmin } = require('../services/supabase')
const authenticate = require('../middleware/auth')
const { requireRole, ROLE_HIERARCHY } = require('../middleware/role')

const router = Router()
router.use(authenticate)
router.use(requireRole('team_member'))

// ---------------------------------------------------------------------------
// Point values
// ---------------------------------------------------------------------------
const POINTS = {
  DAY_ONE_BOOKED: 10,
  MEMBERSHIP: 5,
  SAME_DAY_SALE: 5,
  VIP: 2,
}

// ---------------------------------------------------------------------------
// 5-minute in-memory cache (same pattern as meta-ads)
// ---------------------------------------------------------------------------
const cache = {}
const CACHE_TTL = 5 * 60 * 1000

function getCached(key) {
  const entry = cache[key]
  if (entry && (Date.now() - entry.ts) < CACHE_TTL) return entry.data
  return null
}

function setCache(key, data) {
  cache[key] = { data, ts: Date.now() }
  const now = Date.now()
  for (const k of Object.keys(cache)) {
    if ((now - cache[k].ts) > CACHE_TTL * 2) delete cache[k]
  }
}

// ---------------------------------------------------------------------------
// Pacific timezone offset for custom field date alignment
// ---------------------------------------------------------------------------
// Dynamic Pacific timezone offset (handles PDT/PST automatically)
function getPacificOffsetMs(date) {
  const formatter = new Intl.DateTimeFormat('en-US', { timeZone: 'America/Los_Angeles', hour: 'numeric', hour12: false })
  const utcHour = date.getUTCHours()
  const pacificHour = parseInt(formatter.format(date), 10)
  const diff = (utcHour - pacificHour + 24) % 24
  return diff * 3600000
}

function monthBounds(monthStr) {
  // monthStr = "YYYY-MM"
  const [year, mon] = monthStr.split('-').map(Number)
  const start = new Date(Date.UTC(year, mon - 1, 1))
  const end = new Date(Date.UTC(year, mon, 0, 23, 59, 59, 999)) // last day of month
  return {
    startMs: (start.getTime() + getPacificOffsetMs(start)).toString(),
    endMs: (end.getTime() + getPacificOffsetMs(end)).toString(),
    startISO: start.toISOString(),
    endISO: end.toISOString(),
  }
}

// ---------------------------------------------------------------------------
// Helper: aggregate leaderboard data for a single location_slug
// ---------------------------------------------------------------------------
async function aggregateLocation(locationSlug, bounds) {
  const { startMs, endMs, startISO, endISO } = bounds

  // 1. Memberships: ghl_contacts_report where member_sign_date in range
  let memberQ = supabaseAdmin
    .from('ghl_contacts_report')
    .select('sale_team_member, same_day_sale')
    .not('member_sign_date', 'is', null)
    .gte('member_sign_date', startMs)
    .lte('member_sign_date', endMs)
  if (locationSlug) memberQ = memberQ.eq('location_slug', locationSlug)

  const { data: memberData } = await memberQ
  const members = memberData || []

  // 2. Day Ones Booked: ghl_contacts_report where day_one_booked='Yes' and day_one_booking_date in range
  let dayOneQ = supabaseAdmin
    .from('ghl_contacts_report')
    .select('day_one_booking_team_member')
    .eq('day_one_booked', 'Yes')
    .not('day_one_booking_date', 'is', null)
    .gte('day_one_booking_date', startMs)
    .lte('day_one_booking_date', endMs)
  if (locationSlug) dayOneQ = dayOneQ.eq('location_slug', locationSlug)

  const { data: dayOneData } = await dayOneQ
  const dayOnes = dayOneData || []

  // 3. VIPs: ghl_contacts_v2 with "vip" tag, created_at_ghl in range, then join for sale_team_member
  let vipQuery = supabaseAdmin
    .from('ghl_contacts_v2')
    .select('id, tags')
    .contains('tags', ['vip'])
    .gte('created_at_ghl', startISO)
    .lte('created_at_ghl', endISO)
  if (locationSlug) {
    const { data: loc } = await supabaseAdmin
      .from('ghl_locations')
      .select('id')
      .ilike('name', '%' + locationSlug + '%')
      .limit(1)
      .maybeSingle()
    if (loc) vipQuery = vipQuery.eq('location_id', loc.id)
  }
  const { data: vipContacts } = await vipQuery
  const vipIds = (vipContacts || []).map(v => v.id)

  // Normalize name: collapse spaces, title case, trim
  function normalizeName(raw) {
    if (!raw) return ''
    return raw.replace(/\s+/g, ' ').trim()
      .toLowerCase()
      .replace(/\b\w/g, c => c.toUpperCase())
  }

  // Look up sale_team_member for VIP contacts from the report view
  let vipSalesMap = {}
  if (vipIds.length > 0) {
    // Batch in chunks of 100 to avoid URL length issues
    for (let i = 0; i < vipIds.length; i += 100) {
      const chunk = vipIds.slice(i, i + 100)
      const { data: vipReport } = await supabaseAdmin
        .from('ghl_contacts_report')
        .select('id, sale_team_member')
        .in('id', chunk)
      for (const vr of (vipReport || [])) {
        const name = normalizeName(vr.sale_team_member)
        if (name && name !== 'Unassigned') {
          vipSalesMap[name] = (vipSalesMap[name] || 0) + 1
        }
      }
    }
  }

  // Aggregate by person (normalized key)
  const personStats = {}

  function ensurePerson(key) {
    if (!personStats[key]) {
      personStats[key] = { memberships: 0, day_ones: 0, same_day: 0, vips: 0 }
    }
  }

  // Memberships + same day sales
  for (const m of members) {
    const name = normalizeName(m.sale_team_member)
    if (!name || name === 'Unassigned') continue
    ensurePerson(name)
    personStats[name].memberships++
    if (m.same_day_sale === 'Sale') personStats[name].same_day++
  }

  // Day ones booked
  for (const d of dayOnes) {
    const name = normalizeName(d.day_one_booking_team_member)
    if (!name || name === 'Unassigned') continue
    ensurePerson(name)
    personStats[name].day_ones++
  }

  // VIPs
  for (const [rawName, count] of Object.entries(vipSalesMap)) {
    const name = normalizeName(rawName)
    if (!name || name === 'Unassigned') continue
    ensurePerson(name)
    personStats[name].vips += count
  }

  // Build rankings
  const rankings = Object.entries(personStats).map(([name, stats]) => {
    const points =
      stats.day_ones * POINTS.DAY_ONE_BOOKED +
      stats.memberships * POINTS.MEMBERSHIP +
      stats.same_day * POINTS.SAME_DAY_SALE +
      stats.vips * POINTS.VIP
    return { name, points, ...stats }
  })

  rankings.sort((a, b) => b.points - a.points)
  rankings.forEach((r, i) => { r.rank = i + 1 })

  return rankings
}

// ---------------------------------------------------------------------------
// Helper: find current user in rankings
// ---------------------------------------------------------------------------
function findUserRank(rankings, staff) {
  const displayName = (staff.display_name || '').toLowerCase()
  const fullName = ((staff.first_name || '') + ' ' + (staff.last_name || '')).trim().toLowerCase()

  for (const r of rankings) {
    const rName = r.name.toLowerCase()
    if (rName === displayName || rName === fullName) {
      return { user_rank: r.rank, user_points: r.points }
    }
  }
  return { user_rank: null, user_points: 0 }
}

// ---------------------------------------------------------------------------
// GET /reports/leaderboard
// Query params: month (YYYY-MM), location_slug
// ---------------------------------------------------------------------------
router.get('/', async (req, res) => {
  try {
    const month = req.query.month || new Date().toISOString().slice(0, 7)
    const locationSlug = req.query.location_slug
    const userRole = req.staff.role
    const roleLevel = ROLE_HIERARCHY.indexOf(userRole)
    const managerLevel = ROLE_HIERARCHY.indexOf('manager')
    const isManager = roleLevel >= managerLevel

    // Validate month format
    if (!/^\d{4}-\d{2}$/.test(month)) {
      return res.status(400).json({ error: 'Invalid month format. Use YYYY-MM.' })
    }

    const bounds = monthBounds(month)

    // Cross-location view: manager+ with no location_slug or location_slug="all"
    if (isManager && (!locationSlug || locationSlug === 'all')) {
      const cacheKey = `leaderboard:cross:${month}`
      const cached = getCached(cacheKey)
      if (cached) return res.json(cached)

      // Fetch all locations
      const { data: allLocations } = await supabaseAdmin
        .from('ghl_locations')
        .select('id, name')
      const locations = allLocations || []

      // Derive slugs from location names
      // Parallelize per-location aggregation (was sequential N+1)
      const locationResults = await Promise.all(locations.map(async (loc) => {
        const slug = loc.name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '')
        const rankings = await aggregateLocation(slug, bounds)

        const totalPoints = rankings.reduce((sum, r) => sum + r.points, 0)
        const topPerformer = rankings.length > 0 ? rankings[0] : null

        return {
          location: loc.name,
          location_slug: slug,
          total_points: totalPoints,
          top_performer: topPerformer ? topPerformer.name : null,
          top_performer_points: topPerformer ? topPerformer.points : 0,
          staff_count: rankings.length,
        }
      }))

      locationResults.sort((a, b) => b.total_points - a.total_points)
      locationResults.forEach((r, i) => { r.rank = i + 1 })

      const result = { month, locations: locationResults }
      setCache(cacheKey, result)
      return res.json(result)
    }

    // Single location view
    if (!locationSlug) {
      return res.status(400).json({ error: 'location_slug is required for non-manager roles' })
    }

    const cacheKey = `leaderboard:${locationSlug}:${month}`
    const cached = getCached(cacheKey)
    if (cached) {
      const userInfo = findUserRank(cached.rankings, req.staff)
      return res.json({ ...cached, ...userInfo })
    }

    const rankings = await aggregateLocation(locationSlug, bounds)
    const userInfo = findUserRank(rankings, req.staff)

    // Count total staff at this location for "last place" display
    let totalStaff = rankings.length
    try {
      const { data: loc } = await supabaseAdmin
        .from('ghl_locations').select('id')
        .ilike('name', '%' + locationSlug + '%').limit(1).maybeSingle()
      if (loc) {
        const { count } = await supabaseAdmin
          .from('staff_locations').select('*', { count: 'exact', head: true })
          .eq('location_id', loc.id)
        if (count && count > totalStaff) totalStaff = count
      }
    } catch (e) { /* fallback to rankings length */ }

    const result = { month, location: locationSlug, rankings, total_staff: totalStaff, ...userInfo }
    setCache(cacheKey, { month, location: locationSlug, rankings, total_staff: totalStaff })
    return res.json(result)
  } catch (err) {
    console.error('[Leaderboard] Error:', err.message)
    res.status(500).json({ error: err.message })
  }
})

module.exports = router
