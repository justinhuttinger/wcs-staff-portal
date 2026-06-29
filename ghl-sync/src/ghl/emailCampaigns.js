const { get, sleep } = require('./client');

// GHL Email V2 campaign lists + stats.
//   List:  GET /emails/public/v2/locations/{loc}/campaigns/{listSegment}
//          -> { campaigns: [...], total }, limit hard-capped at 20, paginate via `offset`.
//   Stats: GET /emails/public/v2/locations/{loc}/campaigns/stats/{statsSource}/{sourceId}
//          -> full counts + GHL-precomputed rate fields.
// Each list segment maps to a fixed stats-source token.
const LIST_LIMIT = 20; // GHL rejects limit > 20 on these endpoints (422)
const STATS_DELAY_MS = Number(process.env.EMAIL_STATS_DELAY_MS || 120); // ~120ms keeps us under 100 req / 10s

const EMAIL_SOURCES = [
  { listSegment: 'emails',       statsSource: 'email-campaigns' },
  { listSegment: 'bulk-actions', statsSource: 'bulk-actions' },
  { listSegment: 'workflows',    statsSource: 'workflow-campaigns' },
];

// List every send for one location + source, paging through `offset` up to `total`.
async function listCampaigns(locationId, listSegment, apiKey) {
  const all = [];
  let offset = 0;
  let total = Infinity;
  while (offset < total) {
    const data = await get(
      `/emails/public/v2/locations/${locationId}/campaigns/${listSegment}`,
      { limit: LIST_LIMIT, offset },
      apiKey
    );
    const batch = data?.campaigns || [];
    all.push(...batch);
    total = typeof data?.total === 'number' ? data.total : all.length;
    if (batch.length < LIST_LIMIT) break;
    offset += LIST_LIMIT;
    await sleep(STATS_DELAY_MS);
  }
  return all;
}

// Aggregate stats for a single send. Endpoint returns the stats object directly
// (older shape nests it under `.stats`); handle both.
async function getCampaignStats(locationId, statsSource, sourceId, apiKey) {
  const data = await get(
    `/emails/public/v2/locations/${locationId}/campaigns/stats/${statsSource}/${sourceId}`,
    {},
    apiKey
  );
  return data?.stats || data || {};
}

// Merge a list record + its stats into one email_stats row.
function transformRow(loc, statsSource, record, stats) {
  return {
    location: loc.slug,
    location_id: loc.id,
    source: statsSource,
    source_id: record.sourceId,
    campaign_id: record.id || null,
    name: record.name || null,
    subject: record.emailMetadata?.subject || null,
    status: record.status || null,
    schedule_type: record.scheduleType || null,
    completed_at: record.completedAt || null,
    created_at_ghl: record.createdAt || null,
    updated_at_ghl: record.updatedAt || null,
    sent: stats.sent ?? 0,
    accepted: stats.accepted ?? 0,
    delivered: stats.delivered ?? 0,
    opened: stats.opened ?? 0,
    clicked: stats.clicked ?? 0,
    unsubscribed: stats.unsubscribed ?? 0,
    complained: stats.complained ?? 0,
    permanent_fail: stats.permanentFail ?? 0,
    temporary_fail: stats.temporaryFail ?? 0,
    rejected: stats.rejected ?? 0,
    failed: stats.failed ?? 0,
    replied: stats.replied ?? 0,
    open_rate: stats.openRate ?? 0,
    click_rate: stats.clickRate ?? 0,
    unsubscribe_rate: stats.unsubscribeRate ?? 0,
    complaint_rate: stats.complaintRate ?? 0,
    bounce_rate: stats.bounceRate ?? 0,
    reply_rate: stats.replyRate ?? 0,
    synced_at: new Date().toISOString(),
  };
}

module.exports = { EMAIL_SOURCES, LIST_LIMIT, STATS_DELAY_MS, listCampaigns, getCampaignStats, transformRow };
