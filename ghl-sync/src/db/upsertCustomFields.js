const supabase = require('./supabase');

async function upsertCustomFields(fields, locationId) {
  let upserted = 0;
  const errors = [];

  const rows = fields.map(f => ({
    id: f.id,
    location_id: locationId,
    name: f.name,
    field_key: f.field_key,
    data_type: f.data_type,
    synced_at: new Date().toISOString(),
  }));

  if (rows.length === 0) return { upserted: 0, errors: [] };

  const { error, count } = await supabase
    .from('ghl_custom_field_defs')
    .upsert(rows, { onConflict: 'id', count: 'exact' });

  if (error) {
    errors.push({ error: error.message });
  } else {
    upserted = count || rows.length;
  }

  return { upserted, errors };
}

module.exports = { upsertCustomFields };
