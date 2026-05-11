/**
 * Count VIPs grouped by the per-location custom field `contact.vip_team_member`.
 *
 * As of 2026-05 VIPs are no longer allotted by the `vip` tag — each gym uses
 * a per-location custom field "VIP Team Member" that names the salesperson
 * the VIP is credited to. The field ID differs per location, so we resolve
 * IDs from ghl_custom_field_defs once, then read custom_fields JSONB on each
 * contact.
 *
 * locationFilter: { column: 'location_id' | 'location_slug', value } or null
 * Returns { total, byPerson } where byPerson is keyed by raw team-member
 * name (caller normalizes for matching).
 */
async function countVipsByTeamMember(supabaseAdmin, { startISO, endISO, locationFilter } = {}) {
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
  if (locationFilter?.column === 'location_slug') {
    const { data: loc } = await supabaseAdmin
      .from('ghl_locations').select('id')
      .ilike('name', '%' + locationFilter.value + '%').limit(1).maybeSingle()
    if (loc) q = q.eq('location_id', loc.id)
    else return { total: 0, byPerson: {} }
  } else if (locationFilter?.column === 'location_id') {
    q = q.eq('location_id', locationFilter.value)
  }

  const rows = []
  let from = 0
  while (true) {
    const { data, error } = await q.range(from, from + 999)
    if (error) throw new Error(`countVipsByTeamMember failed: ${error.message}`)
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

module.exports = { countVipsByTeamMember }
