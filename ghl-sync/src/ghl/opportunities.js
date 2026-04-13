const { getPaginated } = require('./client');

const PAGE_SIZE = parseInt(process.env.OPPS_PAGE_SIZE) || 100;

async function fetchAllOpportunities(locationId, apiKey) {
  return getPaginated(
    '/opportunities/search',
    { location_id: locationId, limit: PAGE_SIZE },
    'opportunities',
    { paginationType: 'meta' },
    apiKey
  );
}

async function fetchOpportunitiesDelta(locationId, sinceDate, apiKey) {
  // GHL opportunities search has no date filter — fetch all and let upsert deduplicate
  return getPaginated(
    '/opportunities/search',
    { location_id: locationId, limit: PAGE_SIZE },
    'opportunities',
    { paginationType: 'meta' },
    apiKey
  );
}

function transformOpportunity(raw, locationId) {
  const customFields = {};
  for (const field of (raw.customFields || [])) {
    if (field.id && field.value !== undefined && field.value !== null) {
      customFields[field.id] = field.value;
    }
  }

  return {
    id: raw.id,
    location_id: locationId,
    contact_id: raw.contactId || null,
    pipeline_id: raw.pipelineId || null,
    stage_id: raw.pipelineStageId || null,
    pipeline_name: raw.pipelineName || raw.pipeline?.name || null,
    stage_name: raw.stageName || raw.stage?.name || null,
    name: raw.name || null,
    status: raw.status || null,
    monetary_value: raw.monetaryValue != null ? parseFloat(raw.monetaryValue) : null,
    assigned_user_id: raw.assignedTo || null,
    assigned_user_name: null,
    source: raw.source || null,
    custom_fields: Object.keys(customFields).length > 0 ? customFields : null,
    lost_reason: raw.lostReasonId || null,
    created_at_ghl: raw.createdAt || null,
    updated_at_ghl: raw.updatedAt || null,
    closed_at: raw.closedAt || raw.closedDate || null,
    synced_at: new Date().toISOString(),
  };
}

module.exports = { fetchAllOpportunities, fetchOpportunitiesDelta, transformOpportunity };
