// Tiles that only make sense at a club that has the thing.
//
// The roles grid says WHO may see Courts & Pool; club_features says WHERE it
// exists. Eugene has neither courts nor a pool, so a Eugene-only member opening
// the tile gets a screen with no facility pills and nothing to schedule. Gate
// the permission keys on the facts in club_features and the tile stays off that
// board entirely.
//
// A key survives if ANY of the caller's clubs has ANY of the features it needs,
// so a director covering Springfield and Eugene keeps the tile.
const { enabledIn } = require('./clubFeatures')

const FEATURE_REQUIREMENTS = {
  facility: ['courts', 'pool'],
  'facility:schedule-edit': ['courts', 'pool'],
  groupX: ['groupx'],
  'groupX:schedule-edit': ['groupx'],
  'groupX:attendance': ['groupx'],
}

// Cheap pre-check so the common request never pays for a club lookup.
function hasGatedKeys(keys) {
  return (keys || []).some(k => FEATURE_REQUIREMENTS[k])
}

// Pure: permission keys + the caller's clubs + a club_features map -> the keys
// to keep. Ungated keys pass through untouched.
function filterByFeatures(keys, clubs, map) {
  return (keys || []).filter(key => {
    const needed = FEATURE_REQUIREMENTS[key]
    if (!needed) return true
    return needed.some(f => (clubs || []).some(c => enabledIn(map, c.clubNumber, f)))
  })
}

module.exports = { FEATURE_REQUIREMENTS, hasGatedKeys, filterByFeatures }
