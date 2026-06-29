const supabase = require('./supabase');

const BATCH_SIZE = 500;

// Upsert email_stats rows, conflict target (location, source_id) so re-runs
// update in place. Dedup within the batch first — a send can recur across pages.
async function upsertEmailStats(rows) {
  let upserted = 0;
  const errors = [];

  const seen = new Map();
  for (const r of rows) {
    if (!r.source_id) continue;
    seen.set(`${r.location}|${r.source_id}`, r); // last occurrence wins
  }
  const deduped = Array.from(seen.values());

  for (let i = 0; i < deduped.length; i += BATCH_SIZE) {
    const batch = deduped.slice(i, i + BATCH_SIZE);
    const { error, count } = await supabase
      .from('email_stats')
      .upsert(batch, { onConflict: 'location,source_id', count: 'exact' });

    if (error) {
      console.error('[DB] email_stats upsert batch error:', error.message);
      errors.push({ batch: Math.floor(i / BATCH_SIZE), error: error.message });
    } else {
      upserted += count || batch.length;
    }
  }

  return { upserted, errors };
}

module.exports = { upsertEmailStats };
