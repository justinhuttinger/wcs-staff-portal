const supabase = require('../db/supabase');

const BATCH_SIZE = 500;

/**
 * Bulk upsert ABC members into the abc_members table.
 * Deduplicates by member_id + club_number.
 */
async function upsertABCMembers(members) {
  let upserted = 0;
  const errors = [];

  // Deduplicate by member_id + club_number
  const seen = new Map();
  for (const m of members) {
    const key = `${m.member_id}:${m.club_number}`;
    seen.set(key, m);
  }
  const deduped = Array.from(seen.values());

  for (let i = 0; i < deduped.length; i += BATCH_SIZE) {
    const batch = deduped.slice(i, i + BATCH_SIZE);
    const { error, count } = await supabase
      .from('abc_members')
      .upsert(batch, { onConflict: 'member_id,club_number', count: 'exact' });

    if (error) {
      console.error(`[ABC DB] Member upsert batch error:`, error.message);
      errors.push({ batch: Math.floor(i / BATCH_SIZE), error: error.message });
    } else {
      upserted += count || batch.length;
    }
  }

  return { upserted, errors };
}

module.exports = { upsertABCMembers };
