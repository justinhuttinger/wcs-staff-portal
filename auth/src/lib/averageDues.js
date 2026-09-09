// Average Monthly Dues — what a dues-paying membership is worth per month.
//
// DUES ARE BILLED PER AGREEMENT, NOT PER MEMBER, and getting that wrong is how
// this report first shipped reporting $877k of monthly dues when the clubs
// collect about $624k of dues and fees in a month.
//
// A family is several member rows sharing one agreement, and ABC stamps an
// amount on EVERY one of those rows. Summing the column across members charges
// a family several times over. Measured against what those agreements were
// actually billed in August, across 1,028 multi-member agreements:
//
//   actually billed                 $127.65
//   summed across the member rows   $415.32   <- what summing gives
//   the primary member's amount     $123.81   <- within 3%
//
// So one charge per agreement, taken from the PRIMARY member. The rows within
// an agreement disagree with each other — a two-member agreement has different
// amounts on the two rows in 863 of 1,193 cases — and the primary's is the one
// that matches the bill. It is also the maximum in every family checked, so the
// fallback where no row is flagged primary is the largest, not the first.
//
// The remaining 3% against the billed figure is fees and mid-month changes:
// this is what the base is BILLED for dues, not everything that lands in the
// Dues & Fees revenue class.
//
// WHO COUNTS AS A DUES-PAYING MEMBERSHIP
//
// An active agreement in the Dues category (the explicit mapping in
// abc_membership_categories, not a fallback) WITH a recurring charge on file.
// The second half matters: hundreds of active Dues members are on Cash or Cash
// Open terms, having paid up front, and carry no next_due_amount at all. They
// are dues members but they are not paying monthly dues, and leaving them in
// the denominator reports an average nobody is charged.
//
// Insurance and Temp are excluded by category, not by a guess. Insurance is a
// third of the member base and bills through a provider.
//
// NEXT_DUE_AMOUNT IS NOT A MONTHLY FIGURE either. Most members bill Monthly,
// but some bill Bi-Weekly and a few Annually. Everything is normalised to a
// month before anything is summed or averaged.

const MONTHS_PER_YEAR = 12
// 26 fortnights a year, not 24: a bi-weekly member pays every two weeks, so two
// months out of twelve carry three charges. Treating it as twice a month would
// understate them by 8%.
const BIWEEKLY_PER_YEAR = 26

/**
 * A charge expressed as a monthly figure, or null where it cannot be.
 *
 * Null is not zero. Zero would say this membership pays nothing and belongs in
 * the average as a free one; null says we cannot express what it pays as a
 * month, and it belongs out of the average entirely.
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
 * One agreement's key. Members with no agreement number stand alone rather than
 * being pooled together — an absent number is not a shared membership, and
 * bucketing them would merge unrelated people into one enormous "agreement".
 */
function agreementKey(m) {
  const agr = String(m.agreement_number || '').trim()
  return agr ? `${m.club_number}:${agr}` : `member:${m.club_number}:${m.member_id}`
}

/**
 * @param members  active Dues-category rows: { member_id, club_number,
 *                 agreement_number, is_primary_member, membership_type,
 *                 next_due_amount, payment_frequency }
 * @param opts     { viewBy: 'club'|'membership_type', basis: 'members'|'agreements', clubName }
 */
function buildAverageDues(members, opts = {}) {
  const viewBy = opts.viewBy === 'membership_type' ? 'membership_type' : 'club'
  const basis = opts.basis === 'agreements' ? 'agreements' : 'members'
  const clubName = opts.clubName || (n => n)

  // --- collapse members onto their agreement --------------------------------
  const agreements = new Map()
  for (const m of members || []) {
    const key = agreementKey(m)
    if (!agreements.has(key)) {
      agreements.set(key, {
        club_number: m.club_number,
        membership_type: m.membership_type,
        membersCovered: 0,
        primaryDues: null,
        bestDues: null,
        anyCharge: false,
        anyUnknownFrequency: false,
      })
    }
    const a = agreements.get(key)
    a.membersCovered += 1

    const amount = Number(m.next_due_amount)
    if (!Number.isFinite(amount) || amount <= 0) continue
    a.anyCharge = true

    const monthly = monthlyDues(amount, m.payment_frequency)
    if (monthly === null) { a.anyUnknownFrequency = true; continue }

    if (m.is_primary_member) {
      a.primaryDues = a.primaryDues === null ? monthly : Math.max(a.primaryDues, monthly)
    }
    a.bestDues = a.bestDues === null ? monthly : Math.max(a.bestDues, monthly)
    // The agreement is described by the primary's row, so its membership type
    // comes from there too rather than from whichever row happened to be first.
    if (m.is_primary_member) a.membership_type = m.membership_type
  }

  // --- group the agreements -------------------------------------------------
  const rows = new Map()
  const rowFor = (key, label) => {
    if (!rows.has(key)) {
      rows.set(key, {
        key, label,
        agreements: 0, membersCovered: 0, totalDues: 0,
        noCharge: 0, unknownFrequency: 0,
      })
    }
    return rows.get(key)
  }

  let noCharge = 0
  let unknownFrequency = 0

  for (const a of agreements.values()) {
    const key = viewBy === 'club'
      ? String(a.club_number)
      : (String(a.membership_type || '').trim() || 'Unknown')
    const label = viewBy === 'club' ? clubName(a.club_number) : key
    const row = rowFor(key, label)

    // The primary's charge is the bill. Where no row on the agreement is
    // flagged primary, the largest is — it matched the billed figure in every
    // family checked, and the smallest would systematically understate.
    const dues = a.primaryDues !== null ? a.primaryDues : a.bestDues

    if (dues === null) {
      if (a.anyUnknownFrequency) {
        row.unknownFrequency += 1
        unknownFrequency += 1
      } else {
        // Paid up front: a dues agreement with nothing recurring. Counted so
        // the report can say how many were set aside, never averaged as zero.
        row.noCharge += 1
        noCharge += 1
      }
      continue
    }

    row.agreements += 1
    row.membersCovered += a.membersCovered
    row.totalDues += dues
  }

  const denom = r => (basis === 'agreements' ? r.agreements : r.membersCovered)

  const shape = r => ({
    key: r.key,
    label: r.label,
    agreements: r.agreements,
    membersCovered: r.membersCovered,
    totalDues: round2(r.totalDues),
    // Null, not zero, where nothing here pays dues: an average of nothing is
    // not $0.00, and printing that would put a club on the board as though it
    // charged nothing.
    avgDues: denom(r) > 0 ? round2(r.totalDues / denom(r)) : null,
    noCharge: r.noCharge,
    unknownFrequency: r.unknownFrequency,
  })

  const out = [...rows.values()]
    .map(shape)
    .filter(r => r.agreements > 0 || r.noCharge > 0)
    .sort((a, b) => b.agreements - a.agreements || a.label.localeCompare(b.label))

  const totalAgreements = out.reduce((a, r) => a + r.agreements, 0)
  const totalMembers = out.reduce((a, r) => a + r.membersCovered, 0)
  const totalDues = out.reduce((a, r) => a + r.totalDues, 0)
  const overallDenom = basis === 'agreements' ? totalAgreements : totalMembers

  return {
    viewBy,
    basis,
    rows: out,
    summary: {
      agreements: totalAgreements,
      membersCovered: totalMembers,
      totalDues: round2(totalDues),
      // Computed from the TOTALS, not by averaging the per-club averages. A
      // mean of means weights a 400-member club the same as a 3,000-member one
      // and is simply a different, wrong number.
      avgDues: overallDenom > 0 ? round2(totalDues / overallDenom) : null,
      noCharge,
      unknownFrequency,
    },
    hasActivity: totalAgreements > 0,
  }
}

module.exports = { buildAverageDues, monthlyDues }
