const supabase = require('../db/supabase');

async function writeSyncLog({ syncType, entity, locationId, recordsFetched, recordsUpserted, errors, startedAt }) {
  const completedAt = new Date();
  const durationMs = completedAt.getTime() - new Date(startedAt).getTime();

  const { error } = await supabase
    .from('ghl_sync_log')
    .insert({
      sync_type: syncType,
      entity,
      location_id: locationId,
      records_fetched: recordsFetched,
      records_upserted: recordsUpserted,
      errors: errors.length > 0 ? errors : null,
      started_at: startedAt,
      completed_at: completedAt.toISOString(),
      duration_ms: durationMs,
    });

  if (error) {
    console.error(`[SyncLog] Failed to write log:`, error.message);
  }
}

module.exports = { writeSyncLog };
