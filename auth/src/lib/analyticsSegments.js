// Shared segment vocabulary and series capping for the Analytics reports.
//
// The SQL side has one definition of what a segment IS (the abc_member_segments
// view, migration 135). This is the other half: what a reader is allowed to
// pick, and what happens when a segment has more distinct values than a chart
// can honestly draw.

/**
 * Member-based segments, offered by the reports whose rows are people.
 *
 * NOT every report offers all of these — see each route. A segment is only
 * worth showing where it can change the answer: salesperson tells you something
 * about who signed a member, and nothing useful about what profit centre their
 * drink purchase landed in.
 */
const MEMBER_SEGMENTS = [
  { key: 'club', label: 'Club' },
  { key: 'membership_type', label: 'Membership Type' },
  { key: 'gender', label: 'Gender' },
  { key: 'age_group', label: 'Age Group' },
  { key: 'generation', label: 'Generation' },
  { key: 'payment_term', label: 'Payment Term' },
  { key: 'payment_method', label: 'Payment Method' },
  { key: 'join_source', label: 'Join Source' },
  { key: 'salesperson', label: 'Salesperson' },
  { key: 'relationship', label: 'Member Relationship' },
]

/**
 * Revenue Trends can also cut by things that live on the TRANSACTION rather
 * than the member — those need no agreement join, so they are exact.
 */
const REVENUE_SEGMENTS = [
  { key: 'overall', label: 'Overall' },
  { key: 'club', label: 'Club' },
  { key: 'dues_discretionary', label: 'Dues vs Discretionary' },
  { key: 'profit_center_group', label: 'Profit Center Group' },
  { key: 'profit_center', label: 'Profit Center' },
  { key: 'item', label: 'Item' },
  { key: 'payment_type', label: 'Payment Type' },
  { key: 'membership_type', label: 'Membership Type' },
  { key: 'gender', label: 'Gender' },
  { key: 'age_group', label: 'Age Group' },
  { key: 'generation', label: 'Generation' },
  { key: 'payment_term', label: 'Payment Term' },
  { key: 'join_source', label: 'Join Source' },
]

/** Segments whose value comes from the member, so revenue must be attributed. */
const MEMBER_ATTRIBUTED = new Set([
  'membership_type', 'gender', 'age_group', 'generation', 'join_source', 'payment_term',
])

/**
 * The most distinct series a categorical chart may draw before the rest is
 * folded into "Other".
 *
 * Eight is not arbitrary: past it, adjacent colours stop being reliably
 * distinguishable, and a reader who cannot tell two lines apart is worse served
 * than one told the tail is pooled. Item and Profit Center regularly run to
 * hundreds of values, so this is load-bearing rather than theoretical.
 */
const MAX_SERIES = 8
const OTHER_LABEL = 'Other'

function isValidSegment(key, list) {
  return list.some(s => s.key === key)
}

/**
 * Rank segment values by total magnitude and fold everything past MAX_SERIES
 * into one "Other" bucket.
 *
 * Ranked by ABSOLUTE total, so a segment that is large and negative (refunds,
 * chargebacks) is kept rather than hidden behind six trivial positives.
 *
 * @param rows      any array of objects
 * @param segKey    property holding the segment name
 * @param valueKey  property holding the number to rank by
 * @param max       how many named series to keep
 * @returns { keep: Set<string>, other: string[] } — `other` names what was
 *          pooled, so the report can say so instead of pretending it is one
 *          thing.
 */
function rankSegments(rows, segKey, valueKey, max = MAX_SERIES) {
  const totals = new Map()
  for (const r of rows || []) {
    const k = r[segKey]
    if (k === null || k === undefined) continue
    const v = Number(r[valueKey])
    totals.set(k, (totals.get(k) || 0) + (Number.isFinite(v) ? v : 0))
  }
  const ordered = [...totals.entries()].sort((a, b) => Math.abs(b[1]) - Math.abs(a[1]))
  const keep = new Set(ordered.slice(0, max).map(([k]) => k))
  const other = ordered.slice(max).map(([k]) => k)
  return { keep, other }
}

/** Map a raw segment value through the keep-set, so the tail reads as Other. */
function foldSegment(value, keep) {
  if (value === null || value === undefined) return OTHER_LABEL
  return keep.has(value) ? value : OTHER_LABEL
}

module.exports = {
  MEMBER_SEGMENTS, REVENUE_SEGMENTS, MEMBER_ATTRIBUTED,
  MAX_SERIES, OTHER_LABEL,
  isValidSegment, rankSegments, foldSegment,
}
