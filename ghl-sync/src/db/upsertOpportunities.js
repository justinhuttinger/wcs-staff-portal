const supabase = require('./supabase');
const { decidePrune } = require('./pruneDecision');
const { nullMissingContacts } = require('./contactRepair');

const BATCH_SIZE = 500;
// Chunk size for the contact-existence lookup. PostgREST caps `.in()` list
// length, and a batch can carry up to BATCH_SIZE distinct contact_ids.
const CONTACT_LOOKUP_CHUNK = 300;

// Which of the given contact_ids currently exist in ghl_contacts_v2. Chunked so a
// full-size batch's worth of ids never exceeds the PostgREST `.in()` limit.
async function fetchExistingContactIds(contactIds) {
  const existing = new Set();
  for (let i = 0; i < contactIds.length; i += CONTACT_LOOKUP_CHUNK) {
    const chunk = contactIds.slice(i, i + CONTACT_LOOKUP_CHUNK);
    const { data, error } = await supabase
      .from('ghl_contacts_v2')
      .select('id')
      .in('id', chunk);
    if (error) throw error;
    for (const row of (data || [])) existing.add(row.id);
  }
  return existing;
}

// Repair a FK-violating batch by nulling only the genuinely-orphaned contact_ids.
async function repairBatchContacts(batch) {
  const contactIds = [...new Set(batch.map(o => o.contact_id).filter(Boolean))];
  if (contactIds.length === 0) return batch;
  const existing = await fetchExistingContactIds(contactIds);
  return nullMissingContacts(batch, existing);
}

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
    const batchNum = Math.floor(i / BATCH_SIZE);

    const { error, count } = await supabase
      .from('ghl_opportunities_v2')
      .upsert(batch, { onConflict: 'id', count: 'exact' });

    if (!error) {
      upserted += count || batch.length;
      continue;
    }

    // FK violation (23503): at least one opp points at a contact/pipeline/stage
    // not present locally. Repair by nulling ONLY the opps whose contact is
    // missing, so valid opps keep their contact link.
    if (error.code === '23503') {
      let repaired;
      try {
        repaired = await repairBatchContacts(batch);
      } catch (lookupErr) {
        // Lookup failed — fall back to prior behavior (null all contact_id) so
        // the batch still lands rather than being lost entirely.
        console.error(`[DB] Opportunity contact lookup failed (batch ${batchNum}):`, lookupErr.message);
        repaired = batch.map(o => ({ ...o, contact_id: null }));
      }

      const retry = await supabase
        .from('ghl_opportunities_v2')
        .upsert(repaired, { onConflict: 'id', count: 'exact' });

      if (!retry.error) {
        upserted += retry.count || repaired.length;
      } else if (retry.error.code === '23503') {
        // Still violating — the offending FK isn't contact_id (e.g. pipeline/stage),
        // or a contact vanished mid-run. Last resort: preserve prior behavior and
        // null every contact_id so the batch lands.
        const batchNoFk = batch.map(o => ({ ...o, contact_id: null }));
        const retry2 = await supabase
          .from('ghl_opportunities_v2')
          .upsert(batchNoFk, { onConflict: 'id', count: 'exact' });
        if (retry2.error) {
          errors.push({ batch: batchNum, error: retry2.error.message });
        } else {
          upserted += retry2.count || batchNoFk.length;
        }
      } else {
        errors.push({ batch: batchNum, error: retry.error.message });
      }
    } else {
      console.error(`[DB] Opportunity upsert batch error:`, error.message);
      errors.push({ batch: batchNum, error: error.message });
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

module.exports = {
  upsertOpportunities,
  pruneStaleOpportunities,
  repairBatchContacts,
};
