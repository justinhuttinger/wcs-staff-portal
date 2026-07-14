// Mirror of ghl-sync/src/abc/lapsedConfig.js SEED_EXCLUDED_TYPES — keep in sync.
// auth and ghl-sync are separate deployables that cannot import each other, so
// this list is duplicated here byte-for-byte. Both services read the LIVE value
// from app_config.lapsed_checkin_excluded_types at runtime; this seed only
// matters before the admin has ever saved a value.
const SEED_EXCLUDED_TYPES = [
  // non-member / staff / non-gym
  'NON-MEMBER', 'Employee', 'Employee FAO', 'STAFF', 'PT ONLY', 'CHILDCARE',
  'Z. Deleting Individual', 'Standard M2M',
  // third-party subsidized
  'Active and Fit Limited', 'Active and Fit All Access', 'Active and Fit Premium',
  'GYMPASS - WELLHUB',
  // reciprocal use
  'A2 RECIP USE -Active Adult Reciprocal Use',
  // short-term / seasonal
  'SUMMER MEMBERSHIP', 'TEMPORARY SINGLE', 'TEMPORARY STUDENT', 'TEMPORARY COUPLE',
  'EVENT ACCESS',
  // corporate
  'CORP', 'Corporate Business',
]

module.exports = { SEED_EXCLUDED_TYPES }
