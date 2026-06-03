const supabase = require('../db/supabase');
const { fetchFirstHumanContact } = require('../ghl/conversations');
const { sleep } = require('../ghl/client');

const RETRY_WINDOW_DAYS = 30;
// GHL pipeline that holds new leads (leads enter at the "New Lead" stage).
// Overridable in case the pipeline is named differently than 'Membership' in
// GHL — verify against ghl_opportunities_v2.pipeline_name.
const MEMBERSHIP_PIPELINE_NAME = process.env.SPEED_TO_LEAD_PIPELINE || 'Membership';
const PER_RUN_CAP = parseInt(process.env.SPEED_TO_LEAD_CAP || '300', 10);
// Throttle between per-contact conversation fetches to respect GHL rate limits.
const CONTACT_DELAY_MS = parseInt(process.env.SPEED_TO_LEAD_DELAY_MS || '250', 10);
// Don't re-check the same unresolved lead more often than this (cuts churn).
const RECHECK_COOLDOWN_MS = parseInt(process.env.SPEED_TO_LEAD_RECHECK_MS || '3600000', 10); // 1h

// Membership-pipeline opportunities for a location that still need a first-contact
// check: no ghl_first_contact row yet, OR an unresolved row not checked recently.
async function selectCandidates(locationId) {
  const cutoff = new Date(Date.now() - RETRY_WINDOW_DAYS * 86400000).toISOString();
  const { data: opps, error } = await supabase
    .from('ghl_opportunities_v2')
    .select('id, contact_id, created_at_ghl, location_id')
    .eq('location_id', locationId)
    .eq('pipeline_name', MEMBERSHIP_PIPELINE_NAME)
    .not('contact_id', 'is', null)
    .gte('created_at_ghl', cutoff)
    .order('created_at_ghl', { ascending: false })
    .limit(PER_RUN_CAP * 3);
  if (error) throw error;
  const ids = (opps || []).map(o => o.id);
  if (ids.length === 0) {
    // No recent leads in this pipeline. For an active club this likely means the
    // pipeline name does not match GHL — surface it rather than failing silently.
    console.warn(`[Speed to Lead] No '${MEMBERSHIP_PIPELINE_NAME}' pipeline opportunities (last ${RETRY_WINDOW_DAYS}d) for location ${locationId}. Verify SPEED_TO_LEAD_PIPELINE matches ghl_opportunities_v2.pipeline_name.`);
    return [];
  }
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

async function computeFirstContact(location) {
  const candidates = await selectCandidates(location.id);
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

module.exports = { computeFirstContact, selectCandidates };
