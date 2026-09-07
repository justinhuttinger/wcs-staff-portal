// ---------------------------------------------------------------------------
// The membership breakdown the snapshot reports expand into.
//
// Club Snapshot and Daily Snapshot do not take the Insurance / Temp / Dues
// filter, because only a handful of their metrics are member counts and
// filtering would empty the rest of the page. They get this instead: a toggle
// that ADDS a row per category to the membership block and takes nothing away.
//
// The numbers come from analytics_membership_by_category (migration 197), which
// uses the same three rules as the block it sits under, so the rows add up to
// it. This module only shapes them for display.
// ---------------------------------------------------------------------------

/**
 * Fixed display order.
 *
 * Deliberately NOT sorted by size. Sorting would reshuffle the rows whenever a
 * club's mix changed, and somebody comparing two clubs side by side would be
 * comparing different rows in the same position.
 */
const CATEGORY_ORDER = ['Insurance', 'Dues', 'Temp']

/** The reconciliation remainder. Not a category, and never offered as one. */
const UNMAPPED = 'Unmapped'

function num(v) {
  const n = Number(v)
  return Number.isFinite(n) ? n : 0
}

function shape(category, current, prior) {
  const joined = num(current?.joined)
  const left = num(current?.left_count)
  return {
    category,
    members: num(current?.members),
    joined,
    left,
    // Recomputed rather than read from the row's own `net`, so the three
    // numbers on screen can never fail to agree with each other.
    net: joined - left,
    priorMembers: num(prior?.members),
    priorJoined: num(prior?.joined),
    priorLeft: num(prior?.left_count),
    priorNet: num(prior?.joined) - num(prior?.left_count),
  }
}

/**
 * Pair the current and prior windows into display rows.
 *
 * Every named category gets a row even at zero — an absent row would read as
 * "we have no insurance members" the same way a zero does, but only one of
 * those is a number you can compare against last month.
 *
 * Unmapped is the exception: it appears only when it holds somebody or somebody
 * moved through it, because it exists to stop the rows failing to add up. Once
 * the types behind it are mapped in Admin it disappears for good.
 */
function buildCategoryRows(current, prior) {
  const byCat = new Map((current || []).map(r => [r.category, r]))
  const priorByCat = new Map((prior || []).map(r => [r.category, r]))

  const rows = CATEGORY_ORDER.map(c => shape(c, byCat.get(c), priorByCat.get(c)))

  const unmapped = shape(UNMAPPED, byCat.get(UNMAPPED), priorByCat.get(UNMAPPED))
  if (unmapped.members !== 0 || unmapped.joined !== 0 || unmapped.left !== 0) {
    rows.push(unmapped)
  }

  return rows
}

module.exports = { buildCategoryRows, CATEGORY_ORDER, UNMAPPED }
