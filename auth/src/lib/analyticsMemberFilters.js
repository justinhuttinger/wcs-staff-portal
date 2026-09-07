// ---------------------------------------------------------------------------
// The two member filters shared by the Analytics reports.
//
// CATEGORY  all | Insurance | Temp | Dues
//   Which kind of membership to count. Mapped in abc_membership_categories
//   (migration 194), not derived: ABC invents membership types without telling
//   us, and a rule in code can only be changed by a deploy.
//
//   The three named buckets DO NOT sum to All: an unmapped type counts under
//   All and under none of the three. Other is deliberately NOT selectable —
//   'unmapped' is a state of our configuration, not a kind of membership, and
//   offering it as a peer of Insurance invites reading it as one. The unmapped
//   list lives on the admin screen, where it is a job to do rather than a
//   category to report on.
//
// BASIS     members | agreements
//   Members counts people. Agreements counts primary members only, so a FAMILY
//   sign-up is one agreement rather than three members. Measured 2026-09-07:
//   19,335 members against 16,153 agreements.
//
// Parsed here rather than in each route so that "insurance" and "Insurance"
// cannot mean different things on two reports, and so an unknown value always
// widens rather than narrows — a typo that returned zero rows would read as
// "we have no members", which is the worst way for a filter to fail.
// ---------------------------------------------------------------------------

const MEMBER_CATEGORIES = ['Insurance', 'Temp', 'Dues']

/** 'all', or one of MEMBER_CATEGORIES. Anything else widens to 'all'. */
function parseCategory(value) {
  const v = String(value || '').trim().toLowerCase()
  if (!v || v === 'all') return 'all'
  return MEMBER_CATEGORIES.find(c => c.toLowerCase() === v) || 'all'
}

/** 'members' (default) or 'agreements'. */
function parseBasis(value) {
  return String(value || '').trim().toLowerCase() === 'agreements' ? 'agreements' : 'members'
}

/**
 * A sentence naming the filter in force, or undefined when nothing is filtered.
 *
 * Insurance alone is 32% of the member base, so a filtered report has to say so
 * on its face: a screenshot of one is otherwise indistinguishable from a
 * collapse.
 */
function filterNote({ category, basis }) {
  const parts = []
  if (category && category !== 'all') parts.push(`${category} memberships only`)
  if (basis === 'agreements') {
    parts.push('counting agreements rather than people, so a family counts once')
  }
  if (parts.length === 0) return undefined
  return `Filtered: ${parts.join('; ')}.`
}

/**
 * The same rule as the SQL predicate, for the reports that filter in JS
 * (Membership Mix, Past Due) rather than through a report function.
 *
 * Kept beside the parsers on purpose: two definitions of one filter is how the
 * numbers on two reports start disagreeing.
 */
function matchesFilters(row, { category, basis, categoryMap }) {
  if (category && category !== 'all') {
    // Two row shapes, one rule. Rows read through abc_members_counted carry
    // membership_category already; rows selected straight from abc_members do
    // not, and pass the mapping instead — pointing three hot queries at the
    // view to pick up one string would add two joins for nothing.
    const resolved = categoryMap
      ? (categoryMap.get(String(row.membership_type || '').toLowerCase()) || 'Other')
      : (row.membership_category || 'Other')
    // Unmapped rows read 'Other' and therefore match none of the three, which
    // is the intended behaviour: they are visible under All and nowhere else.
    if (resolved !== category) return false
  }
  // is_primary_member true only. A null flag is a member ABC no longer returns
  // (migration 193), and a ghost is exactly what this basis exists to exclude.
  if (basis === 'agreements' && row.is_primary_member !== true) return false
  return true
}

/**
 * The membership_type -> category mapping, lowercased for lookup.
 *
 * Small (33 rows today) and read per request rather than cached: it is edited
 * from Admin, and a stale map would quietly put members in the wrong bucket,
 * which is a worse failure than one more trivial query.
 */
async function loadCategoryMap(supabaseAdmin) {
  const { data, error } = await supabaseAdmin
    .from('abc_membership_categories')
    .select('membership_type, category')
  if (error) throw new Error(`membership categories: ${error.message}`)
  return new Map((data || []).map(r => [String(r.membership_type).toLowerCase(), r.category]))
}

module.exports = {
  MEMBER_CATEGORIES, parseCategory, parseBasis, filterNote, matchesFilters, loadCategoryMap,
}
