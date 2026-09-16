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
// (analytics_membership_by_plan, migrations 202 + 204; no longer called by the
// portal, which now only shows the Plan column in drill-downs) — change one,
// change both.
//
// agreement_term is the member's CURRENT term. A figure "as of" an earlier date
// still files the member under the plan they are on today.
// ---------------------------------------------------------------------------

// THREE PLANS, as Justin asked (2026-09-16): 1-Year, Month-to-Month, Paid in
// Full. Month-to-Month is the catch-all — Open, Cash Open (nothing drafting:
// insurance, comps) and a missing/unrecognised term all land there. Only
// Installment and Cash are named, so a new ABC term can never vanish.
const PLAN_TYPES = [
  { key: 'one-year', label: '1-Year', terms: ['installment'] },
  { key: 'mtm', label: 'Month-to-Month', terms: ['open', 'cash open'] },
  { key: 'pif', label: 'Paid in Full', terms: ['cash'] },
]

const MTM = PLAN_TYPES[1]

const BY_TERM = new Map(PLAN_TYPES.flatMap(p => p.terms.map(t => [t, p])))
const BY_KEY = new Map(PLAN_TYPES.map(p => [p.key, p]))

function planFor(term) {
  return BY_TERM.get(String(term || '').trim().toLowerCase()) || MTM
}

const planKeyFor = (term) => planFor(term).key
const planLabelFor = (term) => planFor(term).label

/** A `plan` query param, or null when absent or not a plan we know. */
function parsePlan(value) {
  const key = String(value || '').trim().toLowerCase()
  return BY_KEY.has(key) ? key : null
}

const planLabelForKey = (key) => BY_KEY.get(key)?.label || null

/** { 'one-year': 0, mtm: 0, pif: 0 } */
function emptyPlanCounts() {
  return Object.fromEntries(PLAN_TYPES.map(p => [p.key, 0]))
}

module.exports = {
  PLAN_TYPES, planFor, planKeyFor, planLabelFor, parsePlan,
  planLabelForKey, emptyPlanCounts,
}
