/**
 * Count VIPs grouped by the per-location custom field `contact.vip_team_member`.
 *
 * Primary path: `count_vips_by_team_member` RPC (migration 018) — aggregates in
 * Postgres in <1s using GIN/btree indexes. Fall-back path: paginated row scan
 * (the original impl) used until the RPC is available, so the endpoint never
 * 500s when the migration hasn't been applied yet.
 *
 * locationFilter: { column: 'location_id' | 'location_slug', value } or null
 * Returns { total, byPerson } where byPerson is keyed by raw team-member name.
 */

// Resolve the report location filter into GHL location ids.
//   null  -> no filter (count VIPs across ALL locations in one aggregate call)
//   []    -> a filter that matched no location (e.g. NO_ACCESS) -> count 0
//   [...] -> one id per requested club (summed by the caller)
//
// Accepts BOTH filter shapes in use: reports.js passes `{ values: [...] }` (an
// array) while leaderboard.js passes `{ value: slug }` (singular). A prior version
// read only `.value`, so reports.js (which sets `.values`) always fell through to
// loc_id=null and counted ALL clubs' VIPs against each single club's members,
// massively inflating per-club VIP%. The blended (all) view was the only correct
// one. Reading both shapes scopes each club correctly.
async function resolveLocationIds(supabaseAdmin, locationFilter) {
  if (!locationFilter) return null
  let values = Array.isArray(locationFilter.values)
    ? locationFilter.values
    : (locationFilter.value != null ? [locationFilter.value] : [])
  // NO_ACCESS sentinel -> count nothing.
  if (values.includes('__no_access__')) return []
  // 'all' (or empty) -> no scoping, count across every location.
  values = values.filter(v => v && v !== 'all')
  if (values.length === 0) return null
  // location_id values are already GHL ids; slugs must be resolved by name.
  if (locationFilter.column === 'location_id') return values
  const ids = []
  for (const slug of values) {
    const { data: loc } = await supabaseAdmin
      .from('ghl_locations').select('id')
      .ilike('name', '%' + slug + '%').limit(1).maybeSingle()
    if (loc?.id) ids.push(loc.id)
  }
  return ids
}

async function countViaRpc(supabaseAdmin, { startISO, endISO, locId }) {
  const { data, error } = await supabaseAdmin.rpc('count_vips_by_team_member', {
    start_iso: startISO || null,
    end_iso: endISO || null,
    loc_id: locId || null,
  })
  if (error) {
    // PGRST202 = function not found (migration not applied yet).
    if (error.code === 'PGRST202' || /Could not find the function/i.test(error.message || '')) {
      return null // signal fall-back
    }
    throw new Error(`count_vips_by_team_member RPC failed: ${error.message}`)
  }
  const byPerson = {}
  let total = 0
  for (const row of (data || [])) {
    const name = row.team_member
    const n = parseInt(row.total, 10) || 0
    if (!name) continue
    byPerson[name] = (byPerson[name] || 0) + n
    total += n
  }
  return { total, byPerson }
}

async function countViaScan(supabaseAdmin, { startISO, endISO, locId }) {
  const { data: fieldDefs } = await supabaseAdmin
    .from('ghl_custom_field_defs')
    .select('location_id, id')
    .eq('field_key', 'contact.vip_team_member')

  const fieldIdByLocation = {}
  for (const f of (fieldDefs || [])) fieldIdByLocation[f.location_id] = f.id
  if (Object.keys(fieldIdByLocation).length === 0) {
    return { total: 0, byPerson: {} }
  }

  let q = supabaseAdmin
    .from('ghl_contacts_v2')
    .select('location_id, custom_fields')
  if (startISO) q = q.gte('created_at_ghl', startISO)
  if (endISO) q = q.lte('created_at_ghl', endISO)
  if (locId) q = q.eq('location_id', locId)

  const rows = []
  let from = 0
  while (true) {
    const { data, error } = await q.range(from, from + 999)
    if (error) throw new Error(`countVipsByTeamMember scan failed: ${error.message}`)
    if (!data || data.length === 0) break
    rows.push(...data)
    if (data.length < 1000) break
    from += 1000
  }

  let total = 0
  const byPerson = {}
  for (const r of rows) {
    const fid = fieldIdByLocation[r.location_id]
    if (!fid || !r.custom_fields) continue
    const val = r.custom_fields[fid]
    if (val == null) continue
    const name = String(val).trim()
    if (!name) continue
    total += 1
    byPerson[name] = (byPerson[name] || 0) + 1
  }
  return { total, byPerson }
}

// Count VIPs for one location id (or null = all): RPC first, scan as fallback.
async function countForLoc(supabaseAdmin, { startISO, endISO, locId }) {
  const viaRpc = await countViaRpc(supabaseAdmin, { startISO, endISO, locId })
  if (viaRpc) return viaRpc
  console.warn('[vipsByTeamMember] RPC count_vips_by_team_member missing; falling back to row scan. Apply migration 018_perf_helpers.sql.')
  return countViaScan(supabaseAdmin, { startISO, endISO, locId })
}

async function countVipsByTeamMember(supabaseAdmin, { startISO, endISO, locationFilter } = {}) {
  const locIds = await resolveLocationIds(supabaseAdmin, locationFilter)

  // No filter -> single aggregate call across all locations.
  if (locIds === null) return countForLoc(supabaseAdmin, { startISO, endISO, locId: null })
  // Filter matched no location (e.g. NO_ACCESS) -> nothing to count.
  if (locIds.length === 0) return { total: 0, byPerson: {} }

  // Sum across each requested club so a multi-club selection is correct.
  let total = 0
  const byPerson = {}
  for (const locId of locIds) {
    const r = await countForLoc(supabaseAdmin, { startISO, endISO, locId })
    total += r.total
    for (const [name, n] of Object.entries(r.byPerson)) byPerson[name] = (byPerson[name] || 0) + n
  }
  return { total, byPerson }
}

module.exports = { countVipsByTeamMember }
