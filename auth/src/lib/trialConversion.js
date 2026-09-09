// Trial Conversion — one definition, used by the KPI/Membership report and by
// Club Snapshot.
//
// Of the trials STARTED in a window, the share that were won. A trial is an
// opportunity sitting in a pipeline stage named 'Trial Started'; won is the
// opportunity's own status. Both halves come off the same rows, so the rate can
// never be built from two populations that disagree.
//
// The window is on `created_at_ghl` — when the opportunity was raised, not when
// it was won. A trial started in July and won in August belongs to July, which
// is what makes the rate a property of a cohort rather than of a month's luck.
// It also means a recent window understates: trials raised last week have not
// had their chance yet.

const { fetchAll } = require('./supabaseFetchAll')
const { getLocationBySlug } = require('../config/ghlLocations')

const TRIAL_STAGE = 'Trial Started'

/**
 * GHL location ids for club slugs, from the config that already maps them.
 *
 * The Membership report resolves these by matching ghl_locations.name against
 * '%slug%'. That works today and is a coin flip tomorrow — Milwaukie trades as
 * East Side Athletic Club, and any club renamed in GHL silently stops matching
 * while the report keeps rendering a smaller number as though it were the
 * answer. The slug -> id map is declared in config/ghlLocations, so use it.
 *
 * A slug with no configured location is skipped rather than defaulted: dropping
 * the filter would silently widen the query to every location in the account.
 */
function locationIdsForSlugs(slugs) {
  return (slugs || [])
    .map(s => getLocationBySlug(String(s).trim().toLowerCase())?.id)
    .filter(Boolean)
}

/**
 * Count trials started and won in one window.
 *
 * @param supabase     a supabase client
 * @param locationIds  GHL location ids; empty/null means every location
 * @param startISO     inclusive lower bound on created_at_ghl
 * @param endISO       inclusive upper bound
 * @returns {{ started: number, won: number, rate: number|null }}
 *
 * `rate` is null when no trial started. Zero would assert that trials were run
 * and none converted, which is a different and much worse fact than "there were
 * none to convert".
 */
async function countTrialConversion(supabase, { locationIds, startISO, endISO } = {}) {
  let q = supabase
    .from('ghl_opportunities_v2')
    .select('id, status, stage_id, pipeline_id, ghl_pipeline_stages(name)')
  if (locationIds && locationIds.length > 0) q = q.in('location_id', locationIds)
  if (startISO) q = q.gte('created_at_ghl', startISO)
  if (endISO) q = q.lte('created_at_ghl', endISO)

  const opps = await fetchAll(q)

  let started = 0
  let won = 0
  for (const opp of (opps || [])) {
    if ((opp.ghl_pipeline_stages?.name || '') !== TRIAL_STAGE) continue
    started += 1
    if (opp.status === 'won') won += 1
  }

  return { started, won, rate: started > 0 ? Math.round((won / started) * 100) : null }
}

module.exports = { countTrialConversion, locationIdsForSlugs, TRIAL_STAGE }
