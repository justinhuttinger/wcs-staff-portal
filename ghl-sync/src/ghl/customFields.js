const { get } = require('./client');

async function fetchCustomFields(locationId, apiKey) {
  const data = await get(`/locations/${locationId}/customFields`, {}, apiKey);
  const fields = data.customFields || [];

  return fields.map(f => ({
    id: f.id,
    name: f.name,
    field_key: f.fieldKey || null,
    data_type: f.dataType || null,
  }));
}

module.exports = { fetchCustomFields };
