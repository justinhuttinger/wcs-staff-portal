// ---------------------------------------------------------------------------
// Plan type — what kind of agreement a member is on.
//
// Read from ABC's agreement.term (abc_members.agreement_term), NOT from the
// payment plan's name. Checked against the active base on 2026-09-16:
//
//   Installment  3,257  97% expire 11-13 months after begin, every plan name
//                       says 1YR -> a 1-year contract
//   Open        12,939  no expiration date -> month to month
//   Cash Open    3,872  open with nothing drafting: insurance / Limited plans
//                       and comps
//   Cash           705  paid in full for a fixed stretch (1-12 months)
//
// The plan NAME lies for 1,687 "Open" members whose plan says "1 YEAR": their
// contract ran out and they rolled onto month to month. The term follows that;
// the name does not. So the term is the one rule, here and in SQL
// (analytics_membership_by_plan, migration 202) — change one, change both.
//
// agreement_term is the member's CURRENT term. A figure "as of" an earlier date
// still files the member under the plan they are on today.
// ---------------------------------------------------------------------------

const PLAN_TYPES = [
  { key: 'one-year', label: '1-Year', term: 'Installment' },
  { key: 'mtm', label: 'Month-to-Month', term: 'Open' },
  { key: 'no-draft', label: 'No-Draft', term: 'Cash Open' },
  { key: 'pif', label: 'Paid in Full', term: 'Cash' },
]

const UNKNOWN_PLAN = { key: 'unknown', label: 'Unknown' }

const BY_TERM = new Map(PLAN_TYPES.map(p => [p.term.toLowerCase(), p]))
const BY_KEY = new Map([...PLAN_TYPES, UNKNOWN_PLAN].map(p => [p.key, p]))

function planFor(term) {
  return BY_TERM.get(String(term || '').trim().toLowerCase()) || UNKNOWN_PLAN
}

const planKeyFor = (term) => planFor(term).key
const planLabelFor = (term) => planFor(term).label

/** A `plan` query param, or null when absent or not a plan we know. */
function parsePlan(value) {
  const key = String(value || '').trim().toLowerCase()
  return BY_KEY.has(key) ? key : null
}

const planLabelForKey = (key) => BY_KEY.get(key)?.label || null

/** { 'one-year': 0, mtm: 0, 'no-draft': 0, pif: 0, unknown: 0 } */
function emptyPlanCounts() {
  return Object.fromEntries([...PLAN_TYPES, UNKNOWN_PLAN].map(p => [p.key, 0]))
}

module.exports = {
  PLAN_TYPES, UNKNOWN_PLAN, planFor, planKeyFor, planLabelFor, parsePlan,
  planLabelForKey, emptyPlanCounts,
}
