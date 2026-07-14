const { Router } = require('express')
const { supabaseAdmin } = require('../services/supabase')
const authenticate = require('../middleware/auth')
const { requireRole } = require('../middleware/role')
const { LOCATIONS } = require('../config/ghlLocations')
const { SEED_EXCLUDED_TYPES } = require('../config/lapsedSeed')
const {
  daysSinceForMember,
  bucketTier,
  tierDayRange,
  inTierRange,
  normalizeExcludedInput,
  findUnknownTypes,
} = require('./lapsedCheckinsHelpers')

const router = Router()
router.use(authenticate)
// Admin-only, same gate as the Forms admin module (requireRole('admin')).
router.use(requireRole('admin'))

const CONFIG_KEY = 'lapsed_checkin_excluded_types'

// Paginate past Supabase's 1000-row default — mirrors ghl-sync's
// lapsedTaggingJob.js .range() loop so large clubs (~3k active members each,
// 7 clubs) aren't silently truncated. `buildQuery` returns a *fresh*
// Supabase query builder (already configured with .select()/.eq() etc) on
// each call, matching the pattern of building a new query per page.
const PAGE_SIZE = 1000
async function fetchAllRows(buildQuery) {
  const rows = []
  let from = 0
  while (true) {
    const { data, error } = await buildQuery().range(from, from + PAGE_SIZE - 1)
    if (error) throw error
    if (!data || data.length === 0) break
    rows.push(...data)
    if (data.length < PAGE_SIZE) break
    from += PAGE_SIZE
  }
  return rows
}

// club_number (abc_members) -> display name, built from the same location
// config the rest of the API uses (auth/src/config/ghlLocations.js).
const CLUB_NAME_MAP = Object.fromEntries(LOCATIONS.map(l => [l.clubCode, l.name]))

// Read the current excluded-types list from app_config, falling back to the
// seed when the row hasn't been saved yet. Returns { list, updated_at }.
async function loadExcludedTypes() {
  const { data, error } = await supabaseAdmin
    .from('app_config')
    .select('value, updated_at')
    .eq('key', CONFIG_KEY)
    .maybeSingle()
  if (error) throw error
  if (!data) return { list: SEED_EXCLUDED_TYPES, updated_at: null }
  const { list } = normalizeExcludedInput(Array.isArray(data.value) ? data.value : [])
  return { list: list.length ? list : SEED_EXCLUDED_TYPES, updated_at: data.updated_at || null }
}

function memberName(m) {
  return [m.first_name, m.last_name].filter(Boolean).join(' ').trim() || m.member_id
}

// GET /admin/lapsed-checkins/types
// { types: [{ membership_type, active_members, excluded }], updated_at }
router.get('/types', async (req, res) => {
  try {
    const { list: excluded, updated_at } = await loadExcludedTypes()
    const excludedSet = new Set(excluded)

    const members = await fetchAllRows(() =>
      supabaseAdmin
        .from('abc_members')
        .select('membership_type')
        .eq('is_active', true))

    const counts = new Map()
    for (const m of members || []) {
      const type = m.membership_type || '(none)'
      counts.set(type, (counts.get(type) || 0) + 1)
    }

    const types = [...counts.entries()]
      .map(([membership_type, active_members]) => ({
        membership_type,
        active_members,
        excluded: excludedSet.has(membership_type),
      }))
      .sort((a, b) => b.active_members - a.active_members)

    res.json({ types, updated_at })
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

// Distinct membership_type values across ALL abc_members (no is_active
// filter, so rarely-active types still validate against the submitted
// excluded list).
async function loadKnownMembershipTypes() {
  const rows = await fetchAllRows(() =>
    supabaseAdmin
      .from('abc_members')
      .select('membership_type'))
  return new Set(rows.map(r => r.membership_type).filter(Boolean))
}

// PUT /admin/lapsed-checkins/types  body: { excluded: string[] }
router.put('/types', async (req, res) => {
  try {
    const { ok, error, list } = normalizeExcludedInput(req.body?.excluded)
    if (!ok) return res.status(400).json({ error })

    const knownTypes = await loadKnownMembershipTypes()
    const { ok: allKnown, unknown } = findUnknownTypes(list, knownTypes)
    if (!allKnown) {
      return res.status(400).json({ error: 'excluded contains unknown membership types', unknown })
    }

    const { error: upsertError } = await supabaseAdmin
      .from('app_config')
      .upsert(
        { key: CONFIG_KEY, value: list, updated_at: new Date().toISOString() },
        { onConflict: 'key' },
      )
    if (upsertError) throw upsertError

    res.json({ excluded: list })
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

// Load eligible members (is_active + member_status='Active' + not excluded
// type) with the columns needed for the dashboard's days-since math.
async function loadEligibleMembers(excludedSet, clubNumber) {
  const data = await fetchAllRows(() => {
    let query = supabaseAdmin
      .from('abc_members')
      .select('member_id, first_name, last_name, membership_type, last_check_in_timestamp, sign_date, begin_date, since_date, club_number')
      .eq('is_active', true)
      .eq('member_status', 'Active')
    if (clubNumber) query = query.eq('club_number', clubNumber)
    return query
  })
  return data.filter(m => !excludedSet.has(m.membership_type))
}

// GET /admin/lapsed-checkins/dashboard
// { clubs: [{ club, name, tier10, tier21, tier30 }], generated_at }
router.get('/dashboard', async (req, res) => {
  try {
    const { list: excluded } = await loadExcludedTypes()
    const excludedSet = new Set(excluded)
    const now = new Date()
    const members = await loadEligibleMembers(excludedSet)

    const byClub = new Map()
    for (const m of members) {
      const days = daysSinceForMember(m, now)
      const tier = bucketTier(days)
      if (!tier) continue
      const club = m.club_number || 'unknown'
      if (!byClub.has(club)) byClub.set(club, { club, name: CLUB_NAME_MAP[club] || club, tier10: 0, tier21: 0, tier30: 0 })
      byClub.get(club)[tier]++
    }

    // Include every known club (even with zero at-risk members) so the
    // dashboard doesn't have to special-case missing rows.
    for (const loc of LOCATIONS) {
      if (!byClub.has(loc.clubCode)) {
        byClub.set(loc.clubCode, { club: loc.clubCode, name: loc.name, tier10: 0, tier21: 0, tier30: 0 })
      }
    }

    const clubs = [...byClub.values()].sort((a, b) => a.name.localeCompare(b.name))
    res.json({ clubs, generated_at: now.toISOString() })
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

// GET /admin/lapsed-checkins/dashboard/:club/:tier
// { members: [{ member_id, name, membership_type, days_since, last_check_in }] }
router.get('/dashboard/:club/:tier', async (req, res) => {
  try {
    const { club, tier } = req.params
    const range = tierDayRange(tier)
    if (!range) return res.status(400).json({ error: 'tier must be one of 10, 21, 30' })

    const { list: excluded } = await loadExcludedTypes()
    const excludedSet = new Set(excluded)
    const now = new Date()
    const members = await loadEligibleMembers(excludedSet, club)

    const rows = members
      .map(m => ({ m, days: daysSinceForMember(m, now) }))
      .filter(({ days }) => inTierRange(days, range))
      .sort((a, b) => b.days - a.days)
      .map(({ m, days }) => ({
        member_id: m.member_id,
        name: memberName(m),
        membership_type: m.membership_type,
        days_since: days,
        last_check_in: m.last_check_in_timestamp || null,
      }))

    res.json({ members: rows })
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

module.exports = router
