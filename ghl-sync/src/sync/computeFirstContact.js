const supabase = require('../db/supabase');
const { fetchFirstHumanContact } = require('../ghl/conversations');
const { sleep } = require('../ghl/client');

const RETRY_WINDOW_DAYS = 30;
// Lead pipelines are matched by name pattern because (a) ghl_opportunities_v2
// .pipeline_name is not populated (always null) and (b) the pipeline is named
// "Membership Pipeline" at 6 clubs but "Standard Member Pipeline" at one — both
// contain "member". ILIKE '%member%' captures both and excludes Pre-Sale /
// Personal Training / Swim / VIP. Overridable via env.
const PIPELINE_PATTERN = process.env.SPEED_TO_LEAD_PIPELINE_PATTERN || '%member%';
const PER_RUN_CAP = parseInt(process.env.SPEED_TO_LEAD_CAP || '300', 10);
// Throttle between per-contact conversation fetches to respect GHL rate limits.
const CONTACT_DELAY_MS = parseInt(process.env.SPEED_TO_LEAD_DELAY_MS || '250', 10);
// Don't re-check the same unresolved lead more often than this (cuts churn).
const RECHECK_COOLDOWN_MS = parseInt(process.env.SPEED_TO_LEAD_RECHECK_MS || '3600000', 10); // 1h

// Resolve the set of "membership lead" pipeline IDs (across all locations) by
// name pattern. Returns string[] of ghl_pipelines.id.
async function resolveMembershipPipelineIds() {
  const { data, error } = await supabase
    .from('ghl_pipelines')
    .select('id, name')
    .ilike('name', PIPELINE_PATTERN);
  if (error) throw error;
  return (data || []).map(p => p.id);
}

// Membership-pipeline opportunities for a location that still need a first-contact
// check: no ghl_first_contact row yet, OR an unresolved row not checked recently.
async function selectCandidates(locationId, pipelineIds) {
  if (!pipelineIds || pipelineIds.length === 0) {
    console.warn(`[Speed to Lead] No pipelines matched '${PIPELINE_PATTERN}'. Verify SPEED_TO_LEAD_PIPELINE_PATTERN against ghl_pipelines.name.`);
    return [];
  }
  const cutoff = new Date(Date.now() - RETRY_WINDOW_DAYS * 86400000).toISOString();
  const { data: opps, error } = await supabase
    .from('ghl_opportunities_v2')
    .select('id, contact_id, created_at_ghl, location_id')
    .eq('location_id', locationId)
    .in('pipeline_id', pipelineIds)
    .not('contact_id', 'is', null)
    .gte('created_at_ghl', cutoff)
    .order('created_at_ghl', { ascending: false })
    .limit(PER_RUN_CAP * 3);
  if (error) throw error;
  const ids = (opps || []).map(o => o.id);
  if (ids.length === 0) return [];
  const { data: rows } = await supabase
    .from('ghl_first_contact')
    .select('opportunity_id, resolved, checked_at')
    .in('opportunity_id', ids);
  const now = Date.now();
  const skip = new Set();
  for (const r of (rows || [])) {
    if (r.resolved) { skip.add(r.opportunity_id); continue; }
    if (r.checked_at && (now - new Date(r.checked_at).getTime()) < RECHECK_COOLDOWN_MS) {
      skip.add(r.opportunity_id);
    }
  }
  return (opps || []).filter(o => !skip.has(o.id)).slice(0, PER_RUN_CAP);
}

async function computeFirstContact(location, pipelineIds) {
  // Resolve pipeline IDs once if not passed in (lets deltaSync resolve once for all locations).
  const ids = pipelineIds || await resolveMembershipPipelineIds();
  const candidates = await selectCandidates(location.id, ids);
  let resolvedCount = 0;
  const errors = [];
  for (const opp of candidates) {
    try {
      const found = await fetchFirstHumanContact(location.id, location.apiKey, opp.contact_id);
      const row = {
        opportunity_id: opp.id,
        contact_id: opp.contact_id,
        location_id: location.id,
        opportunity_created_at: opp.created_at_ghl,
        first_human_contact_at: found ? found.at : null,
        first_contact_kind: found ? found.kind : null,
        checked_at: new Date().toISOString(),
        resolved: !!found,
      };
      const { error } = await supabase.from('ghl_first_contact').upsert(row, { onConflict: 'opportunity_id' });
      if (error) { errors.push({ id: opp.id, error: error.message }); continue; }
      if (found) resolvedCount++;
    } catch (err) {
      errors.push({ id: opp.id, error: err.message });
    }
    // Throttle to stay under GHL rate limits, especially during backfill.
    await sleep(CONTACT_DELAY_MS);
  }
  return { checked: candidates.length, resolved: resolvedCount, errors };
}

module.exports = { computeFirstContact, selectCandidates, resolveMembershipPipelineIds };
