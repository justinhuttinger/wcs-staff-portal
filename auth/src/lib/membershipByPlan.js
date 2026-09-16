const { shape } = require('./membershipByCategory')
const { PLAN_TYPES } = require('./planType')

// Rows for Club Snapshot's plan breakdown, from analytics_membership_by_plan
// (migration 202) for the window and the one before it. Same rules as the
// category rows: fixed order rather than by size, every plan shown even at zero.
function buildPlanRows(current, prior) {
  const cur = new Map((current || []).map(r => [r.plan, r]))
  const pri = new Map((prior || []).map(r => [r.plan, r]))
  const row = (p) => {
    const { category, ...rest } = shape(p.key, cur.get(p.key), pri.get(p.key))
    return { plan: p.key, label: p.label, ...rest }
  }
  return PLAN_TYPES.map(row)
}

module.exports = { buildPlanRows }
