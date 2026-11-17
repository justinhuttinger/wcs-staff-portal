// Pure shaping for Analytics > L10. No I/O; the route fetches.
//
// The weekly-meeting scorecard: Net Membership's in / out / net, plus the money
// — dues, personal training, POS goods and total revenue — on one page, per club
// and in total, against either last month or the average of the last six.
//
// SEVEN WINDOWS OF THE SAME LENGTH. Index 0 is the window on screen; 1..6 are
// the same span shifted back 1..6 calendar months (lib/comparisonWindow). So a
// month-to-date view through the 17th is set against the 1st-17th of each of the
// prior months, never against six whole months — that would read as a 45% fall
// on day 17 that is nothing but a shorter window.
//
// "LAST MONTH" IS WINDOW 1. "6-MONTH AVERAGE" IS THE MEAN OF WINDOWS 1..6. The
// current window is never part of its own average.
//
// WHAT EACH MONEY LINE IS (categories from analytics_revenue_category, mig 171):
//   Dues      every dues PRODUCT — Dues, A2 Exec Dues, First Month Dues, Paid In
//             Full Dues, Corporate Dues… Migration 171 split them so they could
//             each be watched; for a scorecard they are one line again.
//   PT        Training (TRAINING + the old PERSONAL TRAINING spelling).
//   POS       Snacks + Drinks + Merchandise + Supplements — goods only. Dues and
//             training rung up at the desk stay in their own lines.
//   Total     every profit center, refunds and chargebacks included, so it is
//             what actually landed. It is NOT the sum of the lines above.

const POS_CATEGORIES = ['Snacks', 'Drinks', 'Merchandise', 'Supplements']
const PT_CATEGORIES = ['Training']

function isDues(category) {
  return /\bdues$/i.test(String(category || '').trim())
}

function num(v) {
  if (v === null || v === undefined) return 0
  const n = Number(v)
  return Number.isFinite(n) ? n : 0
}

const r2 = v => Math.round(v * 100) / 100
const r1 = v => Math.round(v * 10) / 10

// Metric order is the order the report reads in.
const METRICS = [
  { key: 'newMembers', label: 'New Members', format: 'int' },
  { key: 'lostMembers', label: 'Lost Members', format: 'int', lowerIsBetter: true },
  { key: 'net', label: 'Net Members', format: 'int', signed: true },
  { key: 'dues', label: 'Dues Revenue', format: 'money' },
  { key: 'pt', label: 'PT Revenue', format: 'money' },
  { key: 'pos', label: 'POS Revenue', format: 'money', parts: POS_CATEGORIES },
  { key: 'total', label: 'Total Revenue', format: 'money' },
]

/**
 * Percentage change, or null with no base. Net members can be negative, so a
 * change across zero has no meaningful percentage and is left to the delta.
 */
function pctChange(now, base) {
  if (base === null || base === undefined || base === 0) return null
  if (base < 0 || now < 0) return null
  return r1(((now - base) / base) * 100)
}

function emptyBucket() {
  const b = { newMembers: 0, lostMembers: 0, dues: 0, pt: 0, pos: 0, total: 0, posParts: {} }
  for (const c of POS_CATEGORIES) b.posParts[c] = 0
  return b
}

/**
 * One window's raw rows into { [slug]: bucket }.
 *
 * @param membership  analytics_net_membership(segment 'club') rows
 * @param revenue     analytics_revenue_by_club rows
 * @param slugForClubNumber  club_number -> slug
 */
function bucketWindow(membership, revenue, slugForClubNumber) {
  const out = {}
  const get = slug => (out[slug] = out[slug] || emptyBucket())

  for (const r of membership || []) {
    const slug = slugForClubNumber(r.segment)
    if (!slug) continue
    const b = get(slug)
    b.newMembers += num(r.new_members)
    b.lostMembers += num(r.lost_members)
  }

  for (const r of revenue || []) {
    if (!r.slug) continue
    const b = get(r.slug)
    const v = num(r.revenue)
    b.total += v
    if (isDues(r.category)) b.dues += v
    else if (PT_CATEGORIES.includes(r.category)) b.pt += v
    else if (POS_CATEGORIES.includes(r.category)) {
      b.pos += v
      b.posParts[r.category] += v
    }
  }
  return out
}

function sumBuckets(list) {
  const t = emptyBucket()
  for (const b of list) {
    if (!b) continue
    t.newMembers += b.newMembers
    t.lostMembers += b.lostMembers
    t.dues += b.dues
    t.pt += b.pt
    t.pos += b.pos
    t.total += b.total
    for (const c of POS_CATEGORIES) t.posParts[c] += b.posParts[c]
  }
  return t
}

function flatten(b) {
  const out = {
    newMembers: b.newMembers,
    lostMembers: b.lostMembers,
    net: b.newMembers - b.lostMembers,
    dues: r2(b.dues),
    pt: r2(b.pt),
    pos: r2(b.pos),
    total: r2(b.total),
  }
  for (const c of POS_CATEGORIES) out[`pos:${c}`] = r2(b.posParts[c])
  return out
}

function average(flatList) {
  const keys = Object.keys(flatList[0] || {})
  const out = {}
  for (const k of keys) {
    const mean = flatList.reduce((a, f) => a + num(f[k]), 0) / (flatList.length || 1)
    // Member counts average to fractions; one decimal is honest, a whole
    // number would hide a 0.4 drift in a small club.
    out[k] = k.startsWith('pos') || ['dues', 'pt', 'total'].includes(k) ? r2(mean) : r1(mean)
  }
  return out
}

function compare(current, base) {
  const out = {}
  for (const k of Object.keys(current)) {
    const now = current[k]
    const b = base ? base[k] : null
    out[k] = {
      value: now,
      base: b,
      delta: b === null || b === undefined ? null : r2(now - b),
      pct: b === null || b === undefined ? null : pctChange(now, b),
    }
  }
  return out
}

/**
 * @param windows  [{ start, end, membership, revenue }] — index 0 current,
 *                 1..6 the same span 1..6 months back
 * @param opts     { clubs: [{ slug, name, clubNumber }], slugForClubNumber }
 */
function buildL10(windows, opts = {}) {
  const clubs = opts.clubs || []
  const slugFor = opts.slugForClubNumber || (() => null)

  const bucketed = windows.map(w => bucketWindow(w.membership, w.revenue, slugFor))

  function lineFor(pick) {
    const series = bucketed.map(pick).map(flatten)
    const current = series[0]
    const lastMonth = series[1] || null
    const prior = series.slice(1)
    const avg6 = prior.length ? average(prior) : null
    return {
      lastMonth: compare(current, lastMonth),
      avg6: compare(current, avg6),
      // The six prior windows oldest first, so the reader can see whether the
      // average is being dragged by one odd month.
      history: series.slice(1).reverse(),
      current,
    }
  }

  const clubRows = clubs.map(c => ({
    key: c.slug,
    label: c.name,
    ...lineFor(byClub => byClub[c.slug] || emptyBucket()),
  }))

  const totals = {
    key: 'total',
    label: 'All Selected Clubs',
    ...lineFor(byClub => sumBuckets(clubs.map(c => byClub[c.slug]))),
  }

  return {
    metrics: METRICS,
    posParts: POS_CATEGORIES,
    totals,
    rows: clubRows,
    windows: windows.map(w => ({ start: w.start, end: w.end })),
  }
}

module.exports = { buildL10, bucketWindow, isDues, pctChange, METRICS, POS_CATEGORIES }
