const supabase = require('./supabase');
const { COUNTER_FIELDS } = require('../sync/emailSnapshotDiff');

const BATCH_SIZE = 500;

// Build a WHOLE email_stats_daily row from an email_stats row. Whole rows only:
// a partial upsert always fails the NOT NULL counter columns.
function snapshotRow(statsRow, snapshotDate) {
  const row = {
    location: statsRow.location,
    source: statsRow.source,
    source_id: statsRow.source_id,
    snapshot_date: snapshotDate,
    name: statsRow.name || null,
    subject: statsRow.subject || null,
    synced_at: new Date().toISOString(),
  };
  for (const f of COUNTER_FIELDS) {
    const n = Number(statsRow[f]);
    row[f] = Number.isFinite(n) ? n : 0;
  }
  return row;
}

// Upsert snapshots, conflict target (location, source_id, snapshot_date) so a
// second run the same day overwrites rather than duplicating.
async function upsertEmailStatsDaily(rows) {
  let upserted = 0;
  const errors = [];

  const seen = new Map();
  for (const r of rows) {
    if (!r.source_id || !r.snapshot_date) continue;
    seen.set(`${r.location}|${r.source_id}|${r.snapshot_date}`, r); // last wins
  }
  const deduped = Array.from(seen.values());

  for (let i = 0; i < deduped.length; i += BATCH_SIZE) {
    const batch = deduped.slice(i, i + BATCH_SIZE);
    const { error, count } = await supabase
      .from('email_stats_daily')
      .upsert(batch, { onConflict: 'location,source_id,snapshot_date', count: 'exact' });

    if (error) {
      console.error('[DB] email_stats_daily upsert batch error:', error.message);
      errors.push({ batch: Math.floor(i / BATCH_SIZE), error: error.message });
    } else {
      upserted += count || batch.length;
    }
  }

  return { upserted, errors };
}

module.exports = { upsertEmailStatsDaily, snapshotRow };
