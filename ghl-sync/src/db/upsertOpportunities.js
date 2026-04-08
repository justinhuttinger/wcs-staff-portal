const supabase = require('./supabase');

const BATCH_SIZE = 500;

async function upsertOpportunities(opportunities) {
  let upserted = 0;
  const errors = [];

  for (let i = 0; i < opportunities.length; i += BATCH_SIZE) {
    const batch = opportunities.slice(i, i + BATCH_SIZE);

    const { error, count } = await supabase
      .from('ghl_opportunities_v2')
      .upsert(batch, { onConflict: 'id', count: 'exact' });

    if (error) {
      // If FK violation, retry without contact_id
      if (error.code === '23503') {
        const batchNoFk = batch.map(o => ({ ...o, contact_id: null }));
        const retry = await supabase
          .from('ghl_opportunities_v2')
          .upsert(batchNoFk, { onConflict: 'id', count: 'exact' });
        if (retry.error) {
          errors.push({ batch: Math.floor(i / BATCH_SIZE), error: retry.error.message });
        } else {
          upserted += retry.count || batchNoFk.length;
        }
      } else {
        console.error(`[DB] Opportunity upsert batch error:`, error.message);
        errors.push({ batch: Math.floor(i / BATCH_SIZE), error: error.message });
      }
    } else {
      upserted += count || batch.length;
    }
  }

  return { upserted, errors };
}

module.exports = { upsertOpportunities };
