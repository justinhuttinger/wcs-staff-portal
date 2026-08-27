// Pure shaping for Analytics > First Purchases by Join Month. No I/O.
//
// Of the members we signed, how many go on to buy personal training, and how
// long after joining.
//
// TWO DIFFERENT DENOMINATORS, and confusing them is the easy mistake here:
//
//   The Overall chart is % OF PURCHASES — each bar is that bucket's share of
//   everyone who ever bought. The bars sum to 100%.
//
//   The tiles are % OF MEMBERS — buyers over the whole signed cohort. That is a
//   much smaller number (about 2%), and it answers "do our members buy PT",
//   where the chart answers "when do the buyers buy".

const { rankSegments, foldSegment, OTHER_LABEL } = require('./analyticsSegments')

const BUCKETS = ['Month 1', 'Months 2-6', 'Months 7-12', 'Year 2', 'Year 3', 'Year 4+']

function num(v) {
  if (v === null || v === undefined) return 0
  const n = Number(v)
  return Number.isFinite(n) ? n : 0
}

/** A share with no denominator is unknown, not zero. */
function pct(part, whole) {
  if (!whole) return null
  return Math.round((part / whole) * 1000) / 10
}

/**
 * @param rows from analytics_first_pt_purchase()
 * @param opts { labelFor, maxSeries }
 */
function buildFirstPtPurchase(rows, opts = {}) {
  const labelFor = opts.labelFor || (v => v)

  const src = (rows || []).map(r => ({
    segment: r.segment,
    bucket: r.bucket,
    order: num(r.bucket_order),
    purchasers: num(r.purchasers),
    segmentMembers: num(r.segment_members),
    segmentPurchasers: num(r.segment_purchasers),
  }))

  // One row per segment carries its cohort size, repeated across buckets — take
  // it once rather than summing, or a six-bucket segment reports six times its
  // membership.
  const cohort = new Map()
  for (const r of src) {
    if (!cohort.has(r.segment)) {
      cohort.set(r.segment, { members: r.segmentMembers, purchasers: r.segmentPurchasers })
    }
  }

  const ranked = [...cohort.entries()].map(([segment, c]) => ({ segment, members: c.members }))
  const { keep, other } = rankSegments(ranked, 'segment', 'members', opts.maxSeries)

  // Fold the tail, summing both the bucket counts and the cohort sizes.
  const foldedBuckets = new Map()
  const foldedCohort = new Map()
  for (const [segment, c] of cohort) {
    const seg = foldSegment(segment, keep)
    const prev = foldedCohort.get(seg) || { members: 0, purchasers: 0 }
    foldedCohort.set(seg, {
      members: prev.members + c.members,
      purchasers: prev.purchasers + c.purchasers,
    })
  }
  for (const r of src) {
    const seg = foldSegment(r.segment, keep)
    const k = `${seg}|${r.bucket}`
    foldedBuckets.set(k, (foldedBuckets.get(k) || 0) + r.purchasers)
  }

  const totalMembers = [...foldedCohort.values()].reduce((s, c) => s + c.members, 0)
  const totalPurchasers = [...foldedCohort.values()].reduce((s, c) => s + c.purchasers, 0)

  const overall = BUCKETS.map(bucket => {
    const n = [...foldedCohort.keys()]
      .reduce((s, seg) => s + (foldedBuckets.get(`${seg}|${bucket}`) || 0), 0)
    return { bucket, purchasers: n, pct: pct(n, totalPurchasers) }
  })

  const segmentNames = [...foldedCohort.keys()].sort((a, b) => {
    if (a === OTHER_LABEL) return 1
    if (b === OTHER_LABEL) return -1
    return (foldedCohort.get(b)?.members || 0) - (foldedCohort.get(a)?.members || 0)
  })

  // Each segment's bars are a share of ITS OWN purchasers, so a small club is
  // comparable with a large one. Sharing one denominator would make every
  // segment chart a copy of the club-size chart.
  const bySegment = segmentNames.map(seg => {
    const c = foldedCohort.get(seg)
    return {
      key: seg,
      label: labelFor(seg),
      members: c.members,
      purchasers: c.purchasers,
      purchaseRate: pct(c.purchasers, c.members),
      buckets: BUCKETS.map(bucket => {
        const n = foldedBuckets.get(`${seg}|${bucket}`) || 0
        return { bucket, purchasers: n, pct: pct(n, c.purchasers) }
      }),
    }
  })

  return {
    buckets: BUCKETS,
    overall,
    bySegment,
    other,
    tiles: [
      { key: 'purchased', label: 'Members Who Purchased PT', format: 'int', value: totalPurchasers },
      { key: 'notPurchased', label: 'Members Who Did Not', format: 'int', value: totalMembers - totalPurchasers },
      { key: 'pctPurchased', label: '% Who Purchased', format: 'pct', value: pct(totalPurchasers, totalMembers) },
      { key: 'pctNot', label: '% Who Did Not', format: 'pct', value: pct(totalMembers - totalPurchasers, totalMembers) },
    ],
  }
}

module.exports = { buildFirstPtPurchase, BUCKETS, pct }
