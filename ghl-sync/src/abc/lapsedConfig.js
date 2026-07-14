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

const CONFIG_KEY = 'lapsed_checkin_excluded_types'

function parseExcludedValue(value) {
  let arr = value
  if (typeof value === 'string') {
    try { arr = JSON.parse(value) } catch { return [] }
  }
  if (!Array.isArray(arr)) return []
  return arr.filter(v => typeof v === 'string').map(v => v.trim()).filter(Boolean)
}

async function loadExcludedTypes(db) {
  const { data } = await db.from('app_config').select('value').eq('key', CONFIG_KEY).maybeSingle()
  if (!data) return new Set(SEED_EXCLUDED_TYPES)
  const parsed = parseExcludedValue(data.value)
  return new Set(parsed.length ? parsed : SEED_EXCLUDED_TYPES)
}

module.exports = { SEED_EXCLUDED_TYPES, CONFIG_KEY, parseExcludedValue, loadExcludedTypes }
