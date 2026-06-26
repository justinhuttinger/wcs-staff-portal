const supabase = require('./supabase');
const { decidePrune } = require('./pruneDecision');

const BATCH_SIZE = 500;

async function upsertOpportunities(opportunities) {
  let upserted = 0;
  const errors = [];

  // Deduplicate by id — GHL can return the same opportunity across pages
  const seen = new Map();
  for (const opp of opportunities) {
    seen.set(opp.id, opp); // last occurrence wins
  }
  const deduped = Array.from(seen.values());

  for (let i = 0; i < deduped.length; i += BATCH_SIZE) {
    const batch = deduped.slice(i, i + BATCH_SIZE);

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

// Remove opportunities that GHL no longer returns for a location ("zombies").
//
// fetchAllOpportunities pulls GHL's COMPLETE authoritative opp set for a location
// (no status/date filter), and the upsert above stamps every fetched row's
// synced_at to `runStartIso`. So after a full sync, any row for this location with
// synced_at < runStartIso is one GHL did NOT return this run — i.e. it was deleted
// or merged in GHL. Pure-upsert never removed these, so they accumulated and kept
// their last-known stage/status forever, inflating every stage-based count (e.g. a
// trial-conversion denominator counting opps long gone from GHL's "Trial Started").
//
// SAFETY FLOOR: a transient partial fetch (mid-pagination 429/timeout) must never
// be allowed to mass-delete a location's opps. Only prune when the freshly-stamped
// ("alive") set is a healthy fraction of what's on disk. A >50% single-run drop is
// almost certainly a fetch problem, not that half the opps were really deleted.
async function pruneStaleOpportunities(locationId, runStartIso) {
  const base = () => supabase
    .from('ghl_opportunities_v2')
    .select('*', { count: 'exact', head: true })
    .eq('location_id', locationId);

  const { count: total, error: totalErr } = await base();
  if (totalErr) return { pruned: 0, skipped: true, reason: `count: ${totalErr.message}` };

  const { count: alive, error: aliveErr } = await base().gte('synced_at', runStartIso);
  if (aliveErr) return { pruned: 0, skipped: true, reason: `count-alive: ${aliveErr.message}` };

  const decision = decidePrune(total, alive);
  if (!decision.prune) return { pruned: 0, skipped: true, reason: decision.reason };

  const { error: delErr, count } = await supabase
    .from('ghl_opportunities_v2')
    .delete({ count: 'exact' })
    .eq('location_id', locationId)
    .lt('synced_at', runStartIso);
  if (delErr) return { pruned: 0, skipped: true, reason: `delete: ${delErr.message}` };

  return { pruned: count || 0, skipped: false };
}

module.exports = { upsertOpportunities, pruneStaleOpportunities };
