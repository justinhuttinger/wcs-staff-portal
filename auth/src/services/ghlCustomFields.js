const { supabaseAdmin } = require('./supabase')
const { ghlFetch } = require('./ghlClient')

const TTL_MS = 24 * 60 * 60 * 1000 // 24 hours

// Resolve a GHL custom field's id by its fieldKey for a given location.
// Cached in Supabase (ghl_custom_field_cache) with a 24h TTL. On a miss or
// stale entry we refresh ALL fields for the location in one GET, then
// upsert the cache and return the requested match (or null).
async function getFieldId(locationId, apiKey, fieldKey) {
  if (!locationId || !apiKey || !fieldKey) return null

  const { data: cached } = await supabaseAdmin
    .from('ghl_custom_field_cache')
    .select('field_id, refreshed_at')
    .eq('location_id', locationId)
    .eq('field_key', fieldKey)
    .maybeSingle()

  if (cached?.field_id && cached.refreshed_at && (Date.now() - new Date(cached.refreshed_at).getTime() < TTL_MS)) {
    return cached.field_id
  }

  const fresh = await refreshLocation(locationId, apiKey)
  const match = fresh.find(f => f.fieldKey === fieldKey)
  return match?.id || null
}

// GET /locations/{id}/customFields, upsert every row into the cache, return
// the array. Safe to call directly when you need to force a refresh (e.g.
// a manual admin trigger).
async function refreshLocation(locationId, apiKey) {
  const data = await ghlFetch('/locations/' + locationId + '/customFields', apiKey)
  const fields = data?.customFields || []
  if (fields.length === 0) return []

  const rows = fields
    .filter(f => f.id && f.fieldKey)
    .map(f => ({
      location_id: locationId,
      field_key: f.fieldKey,
      field_id: f.id,
      name: f.name || null,
      data_type: f.dataType || null,
      refreshed_at: new Date().toISOString(),
    }))

  if (rows.length > 0) {
    const { error } = await supabaseAdmin
      .from('ghl_custom_field_cache')
      .upsert(rows, { onConflict: 'location_id,field_key' })
    if (error) {
      console.warn('[ghlCustomFields] cache upsert failed:', error.message)
    }
  }

  return fields
}

module.exports = { getFieldId, refreshLocation }
