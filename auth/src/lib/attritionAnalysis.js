// ---------------------------------------------------------------------------
// Attrition Analysis — pure shaping, no I/O.
//
// The cancels report from the old Reporting view, rebuilt for Analytics: who
// left, what they were on, how long they had been members, who sold them, and
// what is queued to leave next.
//
// WHY THE TOTAL CAN DIFFER FROM CLUB SNAPSHOT'S "LEFT"
// Club Snapshot counts losses through analytics_topline_window, which applies
// the conditional-membership rule: A2 CORE and Active and Fit Limited count
// only where they checked in inside 60 days. This report deliberately does NOT,
// because the insurance split is the thing it exists to show — applying the
// rule would delete most of one of its two halves. The report says so on its
// face rather than leaving two numbers to be discovered as a contradiction.
// ---------------------------------------------------------------------------

// The three statuses ABC uses for a membership that has ended. Same list the
// topline function counts, so at least the population agrees even where the
// conditional rule does not.
const LOST_STATUSES = ['Cancelled', 'Expired', 'Return For Collection']

/**
 * Insurance plans, split out because they behave nothing like a paying member:
 * they bill through a provider, cancel in bulk when a provider changes terms,
 * and would otherwise swamp a month's real attrition.
 *
 * Matched on the type name because that is what ABC gives us — A2 CORE, A2
 * EXEC, A2 RECIP USE, and the Active and Fit variants.
 */
function isInsuranceType(type) {
  const t = String(type || '').toLowerCase()
  return t.startsWith('a2') || t.includes('active and fit')
}

function num(v) {
  const n = Number(v)
  return Number.isFinite(n) ? n : 0
}

function round1(v) {
  return Math.round(v * 10) / 10
}

/**
 * Whole CALENDAR months between two dates, or null when either is missing.
 *
 * Calendar months, not 30.44-day chunks. Dividing by an average month floors a
 * member who joined on 10 August and left on 10 August a year later to ELEVEN
 * months, because 365 days is 11.99 average months. Anyone reading "stayed 11
 * months" about a member who did exactly a year would be right to distrust
 * every other number on the card.
 *
 * The day of the month decides the last one: joined on the 10th and left on the
 * 9th is not yet a full month.
 */
function tenureMonths(since, until) {
  if (!since || !until) return null
  const a = new Date(`${String(since).slice(0, 10)}T00:00:00Z`)
  const b = new Date(`${String(until).slice(0, 10)}T00:00:00Z`)
  if (Number.isNaN(a.getTime()) || Number.isNaN(b.getTime())) return null
  let months = (b.getUTCFullYear() - a.getUTCFullYear()) * 12 + (b.getUTCMonth() - a.getUTCMonth())
  if (b.getUTCDate() < a.getUTCDate()) months -= 1
  return Math.max(0, months)
}

// How long they lasted. Bucketed rather than averaged alone, because a mean
// hides the shape: 40 members leaving at month one and 40 at year three
// averages to something neither group did.
const TENURE_BUCKETS = [
  { key: 'lt1', label: 'Under 1 month', min: 0, max: 1 },
  { key: 'm1_3', label: '1-3 months', min: 1, max: 3 },
  { key: 'm3_6', label: '3-6 months', min: 3, max: 6 },
  { key: 'm6_12', label: '6-12 months', min: 6, max: 12 },
  { key: 'y1_2', label: '1-2 years', min: 12, max: 24 },
  { key: 'y2plus', label: 'Over 2 years', min: 24, max: Infinity },
]

function bucketFor(months) {
  if (months === null) return null
  return TENURE_BUCKETS.find(b => months >= b.min && months < b.max) || null
}

/** Descending count, ties broken by label so the order never wobbles. */
function ranked(map) {
  return [...map.entries()]
    .map(([label, v]) => ({ label, ...v }))
    .sort((a, b) => b.count - a.count || a.label.localeCompare(b.label))
}

function tally(rows, pick) {
  const map = new Map()
  for (const r of rows) {
    const label = pick(r) || 'Unknown'
    const cur = map.get(label) || { count: 0, agreements: new Set() }
    cur.count += 1
    if (r.agreement_number) cur.agreements.add(r.agreement_number)
    map.set(label, cur)
  }
  return ranked(map).map(r => ({ label: r.label, count: r.count, agreements: r.agreements.size }))
}

/**
 * @param rows     cancelled members in the window
 * @param pending  members sitting in Pending Cancel
 * @param opts     { start, end, monthly: [{month, count, insurance}] }
 */
function buildAttritionAnalysis(rows, pending, opts = {}) {
  const all = rows || []
  const membership = all.filter(r => !isInsuranceType(r.membership_type))
  const insurance = all.filter(r => isInsuranceType(r.membership_type))

  const withTenure = all
    .map(r => tenureMonths(r.since_date, r.member_status_date))
    .filter(t => t !== null)
  const avgTenure = withTenure.length
    ? round1(withTenure.reduce((a, b) => a + b, 0) / withTenure.length)
    : null

  // Agreements rather than members wherever ABC counts an agreement: a family
  // membership is several member rows and one thing that was cancelled.
  const agreementsOf = list => new Set(list.map(r => r.agreement_number).filter(Boolean)).size

  const tenureCounts = new Map(TENURE_BUCKETS.map(b => [b.key, 0]))
  let tenureUnknown = 0
  for (const r of all) {
    const b = bucketFor(tenureMonths(r.since_date, r.member_status_date))
    if (!b) { tenureUnknown += 1; continue }
    tenureCounts.set(b.key, tenureCounts.get(b.key) + 1)
  }

  const byDay = new Map()
  for (const r of all) {
    const d = r.member_status_date ? String(r.member_status_date).slice(0, 10) : null
    if (d) byDay.set(d, (byDay.get(d) || 0) + 1)
  }

  const stats = [
    { key: 'total', label: 'Members Lost', format: 'int', value: all.length, betterWhen: 'down' },
    { key: 'agreements', label: 'Agreements Lost', format: 'int', value: agreementsOf(all), betterWhen: 'down' },
    { key: 'membership', label: 'Paying Memberships', format: 'int', value: membership.length, betterWhen: 'down' },
    { key: 'insurance', label: 'Insurance Plans', format: 'int', value: insurance.length, betterWhen: 'down' },
    // Up is better here and nowhere else on the card: a member who stayed three
    // years before leaving is a different outcome from one who left in a month.
    { key: 'avgTenure', label: 'Avg Months Before Leaving', format: 'num', value: avgTenure, betterWhen: 'up' },
    { key: 'pending', label: 'Scheduled to Cancel', format: 'int', value: (pending || []).length, betterWhen: 'down' },
  ]

  return {
    hasActivity: all.length > 0 || (pending || []).length > 0,
    stats,
    breakdowns: {
      byStatus: tally(all, r => r.member_status),
      byType: tally(all, r => r.membership_type),
      // Who sold the membership that has now ended. Not blame — it is the only
      // way to see a plan or a person whose sales do not stick.
      bySalesperson: tally(membership, r => r.sales_person_name),
      byTenure: TENURE_BUCKETS
        .map(b => ({ label: b.label, count: tenureCounts.get(b.key), agreements: 0 }))
        .concat(tenureUnknown ? [{ label: 'Unknown', count: tenureUnknown, agreements: 0 }] : []),
    },
    days: [...byDay.entries()]
      .map(([day, count]) => ({ day, count }))
      .sort((a, b) => a.day.localeCompare(b.day)),
    // Supplied by the route from a 13-month scan; passed through so the shape
    // of the report is decided in one place.
    series: opts.monthly || [],
    pending: (pending || [])
      .map(r => ({
        member: `${r.first_name || ''} ${r.last_name || ''}`.trim() || 'Unnamed member',
        type: r.membership_type || '—',
        effective: r.member_status_date ? String(r.member_status_date).slice(0, 10) : null,
        salesperson: r.sales_person_name || '—',
      }))
      // Soonest first: this is a queue to work, not an archive.
      .sort((a, b) => String(a.effective || '9999').localeCompare(String(b.effective || '9999'))),
    note:
      'Counted on the date the membership ended, across Cancelled, Expired and Return For ' +
      'Collection. Insurance plans are shown separately because they cancel in bulk when a ' +
      'provider changes terms. This total can run above Club Snapshot’s Left, which drops ' +
      'insurance members who had not checked in for 60 days.',
  }
}

module.exports = {
  buildAttritionAnalysis, isInsuranceType, tenureMonths, bucketFor,
  TENURE_BUCKETS, LOST_STATUSES,
}
