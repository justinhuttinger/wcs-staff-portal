const supabase = require('../db/supabase');
const { fetchFirstHumanContact } = require('../ghl/conversations');

const RETRY_WINDOW_DAYS = 30;
const MEMBERSHIP_PIPELINE_NAME = 'Membership';
const PER_RUN_CAP = parseInt(process.env.SPEED_TO_LEAD_CAP || '300', 10);

// Membership-pipeline opportunities for a location that still need a first-contact
// check: no ghl_first_contact row yet, OR an unresolved row within the retry window.
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
  if (ids.length === 0) return [];
  const { data: rows } = await supabase
    .from('ghl_first_contact')
    .select('opportunity_id, resolved')
    .in('opportunity_id', ids);
  const resolved = new Set((rows || []).filter(r => r.resolved).map(r => r.opportunity_id));
  return (opps || []).filter(o => !resolved.has(o.id)).slice(0, PER_RUN_CAP);
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
  }
  return { checked: candidates.length, resolved: resolvedCount, errors };
}

module.exports = { computeFirstContact, selectCandidates };
