// Which tour outcomes each club offers, and which of them count as a tour.
//
// Both live on tour_outcomes (migration 200). NLPT, Swim and Day Pass are
// recorded through the tour check-in because that is where staff are, but none
// of them is somebody being shown round the gym, so the tour reports leave them
// out. NLPT and Swim are also only offered at the clubs that sell them:
// location_slugs lists those clubs, and null means every club.

const TTL_MS = 60 * 1000
let cache = null // { at, rules }

async function loadOutcomeRules() {
  if (cache && Date.now() - cache.at < TTL_MS) return cache.rules
  // Required here rather than at the top so report modules that use this can
  // still be loaded by their tests without Supabase credentials.
  const { supabaseAdmin } = require('../services/supabase')
  const { data, error } = await supabaseAdmin
    .from('tour_outcomes')
    .select('outcome, sort_order, counts_as_tour, location_slugs')
    .order('sort_order', { ascending: true })
  if (error) throw new Error(error.message)
  cache = { at: Date.now(), rules: data || [] }
  return cache.rules
}

// For the reports: an unreadable table means every row counts, as it did before
// this table said otherwise, rather than a report that fails to load.
async function loadOutcomeRulesOrNone(tag) {
  try {
    return await loadOutcomeRules()
  } catch (err) {
    console.error(`[${tag}] tour outcome rules unavailable, counting every outcome:`, err.message)
    return []
  }
}

/** The outcomes a club offers, in sort order. Takes a slug or a location name. */
function outcomesForLocation(rules, location) {
  const slug = String(location || '').trim().toLowerCase()
  return rules
    .filter(r => !r.location_slugs || r.location_slugs.includes(slug))
    .map(r => r.outcome)
}

/**
 * Rows whose outcome counts as a tour. A row with no outcome is kept: that is a
 * tour nobody picked a result for, not one of the excluded kinds.
 */
function onlyTours(rows, rules) {
  const skip = new Set(rules.filter(r => r.counts_as_tour === false).map(r => r.outcome))
  return rows.filter(r => !skip.has(r.outcome))
}

module.exports = { loadOutcomeRules, loadOutcomeRulesOrNone, outcomesForLocation, onlyTours }
