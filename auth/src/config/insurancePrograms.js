// Insurance fitness programs the front desk checks eligibility for, and which
// ones each club offers.
//
// The programs themselves are fixed here (name + the insurer's own eligibility
// site). Which programs a club shows is set per club in portal Admin ->
// Insurance Programs, stored in app_config as `insurance_programs_<slug>`: a
// comma-separated list of program keys ('' = none). A club with no row yet uses
// DEFAULTS, which match the old strengthcoastwest.com/insurance/<slug> pages.

const PROGRAMS = [
  { key: 'optum', name: 'Renew Active / Optum', url: 'https://www.partneroptumfitness.com/' },
  { key: 'silversneakers', name: 'Silver Sneakers', url: 'https://instructor.tivityhealth.com/Home/EligibilityCheck' },
  { key: 'ash', name: 'Active & Fit / Silver & Fit', url: 'https://www.ashlink.com/' },
]

const KEYS = PROGRAMS.map(p => p.key)
const CONFIG_PREFIX = 'insurance_programs_'

// Every club took Optum and ASH; Eugene and Medford also took Silver Sneakers.
function defaultsFor(slug) {
  return ['eugene', 'medford'].includes(slug) ? ['optum', 'silversneakers', 'ash'] : ['optum', 'ash']
}

// A stored value -> known keys in catalog order. null/undefined = no row yet.
function parseStored(value, slug) {
  if (value === null || value === undefined) return defaultsFor(slug)
  const wanted = new Set(String(value).split(',').map(s => s.trim()).filter(Boolean))
  return KEYS.filter(k => wanted.has(k))
}

// Admin input (array of keys) -> the stored string, unknown keys dropped.
function toStored(keys) {
  const wanted = new Set(Array.isArray(keys) ? keys : [])
  return KEYS.filter(k => wanted.has(k)).join(',')
}

module.exports = { PROGRAMS, KEYS, CONFIG_PREFIX, defaultsFor, parseStored, toStored }
