// Average Monthly Dues — what a dues-paying member is worth per month.
//
// Total monthly dues divided by the members paying them. Simple arithmetic
// sitting on two definitions that are not simple at all.
//
// WHO COUNTS AS A DUES-PAYING MEMBER
//
// An active member in the Dues category (the explicit mapping in
// abc_membership_categories, not a fallback) WITH a recurring charge on file.
// The second half matters: 530 active Dues members are on Cash or Cash Open
// terms, having paid up front, and carry no next_due_amount at all. They are
// dues members, but they are not paying monthly dues, and leaving them in the
// denominator would divide the same total by a bigger number and report an
// average nobody is charged.
//
// Insurance and Temp are excluded by the category, not by a guess. Insurance is
// a third of the member base and bills through a provider; averaging it in
// would drag the figure toward a number no club sets.
//
// NEXT_DUE_AMOUNT IS NOT A MONTHLY FIGURE, which is the trap in the whole
// report. Of the active dues members with a charge on file: 10,626 bill
// Monthly, 314 bill Bi-Weekly, and one bills Annually. Summing the raw column
// charges the fortnightly members as though $19.49 were their month, and the
// annual member as though $354 were. Everything is normalised to a month before
// anything is averaged.
//
// Eleven members carry a charge with NO frequency recorded, averaging $706 and
// running to $1,140 — plainly a paid-up-front sum rather than a monthly rate.
// There is no honest way to turn those into a monthly figure, so they are
// excluded and counted, rather than being allowed to lift the average.

const MONTHS_PER_YEAR = 12
// 26 fortnights a year, not 24: a bi-weekly member pays every two weeks, so two
// months out of twelve carry three charges. Treating it as twice a month would
// understate them by 8%.
const BIWEEKLY_PER_YEAR = 26

/**
 * A member's dues expressed as a monthly figure, or null where they cannot be.
 *
 * Null is not zero. Zero would say this member pays nothing and belongs in the
 * average as a free member; null says we cannot express what they pay as a
 * month, and they belong out of it entirely.
 */
function monthlyDues(amount, frequency) {
  const n = Number(amount)
  if (!Number.isFinite(n) || n <= 0) return null
  switch (String(frequency || '').trim()) {
    case 'Monthly': return n
    case 'Bi-Weekly': return (n * BIWEEKLY_PER_YEAR) / MONTHS_PER_YEAR
    case 'Annually': return n / MONTHS_PER_YEAR
    // Weekly and Semi-Monthly are not in the data today. Named rather than
    // folded into the default so that if ABC starts sending one, it lands in
    // `unknownFrequency` and is visible, instead of being silently averaged in
    // at the wrong rate.
    case 'Weekly': return (n * 52) / MONTHS_PER_YEAR
    case 'Semi-Monthly': return n * 2
    default: return null
  }
}

const round2 = v => Math.round(v * 100) / 100

/**
 * @param members  active Dues-category rows: { club_number, membership_type,
 *                 next_due_amount, payment_frequency }
 * @param opts     { viewBy: 'club' | 'membership_type', clubName, labelFor }
 */
function buildAverageDues(members, opts = {}) {
  const viewBy = opts.viewBy === 'membership_type' ? 'membership_type' : 'club'
  const clubName = opts.clubName || (n => n)

  const rows = new Map()
  const rowFor = (key, label) => {
    if (!rows.has(key)) {
      rows.set(key, { key, label, payingMembers: 0, totalDues: 0, noCharge: 0, unknownFrequency: 0 })
    }
    return rows.get(key)
  }

  let noCharge = 0
  let unknownFrequency = 0

  for (const m of members || []) {
    const key = viewBy === 'club'
      ? String(m.club_number)
      : (String(m.membership_type || '').trim() || 'Unknown')
    const label = viewBy === 'club' ? clubName(m.club_number) : key
    const row = rowFor(key, label)

    const amount = Number(m.next_due_amount)
    // Paid up front: a dues member with nothing recurring. Counted so the
    // report can say how many were set aside, never averaged as a zero.
    if (!Number.isFinite(amount) || amount <= 0) {
      row.noCharge += 1
      noCharge += 1
      continue
    }

    const monthly = monthlyDues(amount, m.payment_frequency)
    if (monthly === null) {
      row.unknownFrequency += 1
      unknownFrequency += 1
      continue
    }

    row.payingMembers += 1
    row.totalDues += monthly
  }

  const shape = r => ({
    key: r.key,
    label: r.label,
    payingMembers: r.payingMembers,
    totalDues: round2(r.totalDues),
    // Null, not zero, where nobody in the row pays dues: an average of nothing
    // is not $0.00, and printing that would put a club on the board as though
    // it charged nothing.
    avgDues: r.payingMembers > 0 ? round2(r.totalDues / r.payingMembers) : null,
    noCharge: r.noCharge,
    unknownFrequency: r.unknownFrequency,
  })

  const out = [...rows.values()]
    .map(shape)
    .filter(r => r.payingMembers > 0 || r.noCharge > 0)
    .sort((a, b) => b.payingMembers - a.payingMembers || a.label.localeCompare(b.label))

  const payingMembers = out.reduce((a, r) => a + r.payingMembers, 0)
  const totalDues = out.reduce((a, r) => a + r.totalDues, 0)

  return {
    viewBy,
    rows: out,
    summary: {
      payingMembers,
      totalDues: round2(totalDues),
      // The club average is computed from the TOTALS, not by averaging the
      // per-club averages. A mean of means weights a 400-member club the same
      // as a 3,000-member one and is simply a different, wrong number.
      avgDues: payingMembers > 0 ? round2(totalDues / payingMembers) : null,
      noCharge,
      unknownFrequency,
    },
    hasActivity: payingMembers > 0,
  }
}

module.exports = { buildAverageDues, monthlyDues }
