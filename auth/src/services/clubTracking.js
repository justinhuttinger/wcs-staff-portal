// Club-wide GHL External Tracking, set in Admin -> Club Integrations
// (club_integrations.ghl_tracking_src / ghl_tracking_id, migration 209).
// Quizzes fall back to it when they have no per-club override; forms at a club
// always use it. Keyed by location_slug = lowercased club name.

// Lazy-require: services/supabase throws at import without env vars.
function db() {
  return require('./supabase').supabaseAdmin
}

// Never throws: tracking is best-effort and must not break a public page.
async function getClubTracking(locationName) {
  const slug = String(locationName || '').trim().toLowerCase()
  if (!slug) return null
  try {
    const { data, error } = await db().from('club_integrations')
      .select('ghl_tracking_src, ghl_tracking_id').eq('location_slug', slug).maybeSingle()
    if (error) throw error
    return data || null
  } catch (err) {
    console.error('[clubTracking] lookup failed:', err.message)
    return null
  }
}

// { [location_slug]: row } for every club, for the portal Clubs tab.
async function getAllClubTracking() {
  try {
    const { data, error } = await db().from('club_integrations')
      .select('location_slug, ghl_tracking_src, ghl_tracking_id')
    if (error) throw error
    return Object.fromEntries((data || []).map(r => [r.location_slug, r]))
  } catch (err) {
    console.error('[clubTracking] list failed:', err.message)
    return {}
  }
}

module.exports = { getClubTracking, getAllClubTracking }
