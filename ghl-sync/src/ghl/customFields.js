const { get } = require('./client');

async function fetchCustomFields(locationId) {
  const data = await get(`/locations/${locationId}/customFields`);
  const fields = data.customFields || [];

  return fields.map(f => ({
    id: f.id,
    name: f.name,
    field_key: f.fieldKey || null,
    data_type: f.dataType || null,
  }));
}

module.exports = { fetchCustomFields };
