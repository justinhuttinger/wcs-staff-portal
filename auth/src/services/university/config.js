// WCS University — milestone config loader.
//
// The curriculum + pass thresholds live in the milestone_config table (spec
// §9.6) so they can be tuned without a redeploy. We cache the single row for
// 60s; admin writes should invalidate via clearCache().

const { supabaseAdmin } = require('../supabase')

const TTL_MS = 60 * 1000

// Mirrors the seed in migration 047 so the system still works if the row is
// somehow missing (defensive — the table is seeded on migrate).
const FALLBACK_CONFIG = {
  pass_threshold_default: 80,
  milestones: [
    { key: 'mod1', type: 'curriculum', required: true },
    { key: 'first_call_made', type: 'curriculum', required: true },
    { key: 'roleplay_easy', type: 'competency', required: true, pass_threshold: 75 },
    { key: 'roleplay_medium', type: 'competency', required: true, pass_threshold: 80 },
    { key: 'roleplay_hard', type: 'competency', required: true, pass_threshold: 85 },
    { key: 'objection_handling', type: 'competency', required: true, pass_threshold: 80 },
  ],
}

let _cache = null
let _cachedAt = 0

async function getMilestoneConfig() {
  if (_cache && Date.now() - _cachedAt < TTL_MS) return _cache

  const { data, error } = await supabaseAdmin
    .from('milestone_config')
    .select('config')
    .eq('id', true)
    .maybeSingle()

  if (error) {
    console.warn('[university/config] load failed, using fallback:', error.message)
    return FALLBACK_CONFIG
  }

  _cache = data?.config || FALLBACK_CONFIG
  _cachedAt = Date.now()
  return _cache
}

function clearCache() {
  _cache = null
  _cachedAt = 0
}

// Pass threshold for a competency milestone key, falling back to the default.
function resolveThreshold(config, key) {
  const m = (config.milestones || []).find(x => x.key === key)
  if (m && typeof m.pass_threshold === 'number') return m.pass_threshold
  return typeof config.pass_threshold_default === 'number' ? config.pass_threshold_default : 80
}

module.exports = { getMilestoneConfig, clearCache, resolveThreshold, FALLBACK_CONFIG }
