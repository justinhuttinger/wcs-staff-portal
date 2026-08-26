// Pure aggregation for Analytics > Past Due. No I/O, so the arithmetic is
// testable without a database; the route does the fetching.
//
// WHO COUNTS
//
// Only members who are still in the club and still collectable. These statuses
// are excluded outright — not offered as a toggle:
//
//   Return For Collection   sent to collections; 2,055 members owing ~$468k,
//                           which is 89% of all past-due dollars and would
//                           drown out everyone worth calling today
//   Cancelled / Expired     gone, balance is a write-off question
//   Pending Cancel          on the way out
//
// What remains is Active, Problem, Freeze, Need Address and Need Phone Number:
// members a front desk can actually chase. That reconciles with the external
// tool's past-due amount to within a few hundred dollars.

const EXCLUDED_STATUSES = new Set([
  'Return For Collection',
  'Cancelled',
  'Expired',
  'Pending Cancel',
  'Inactive',
])

// The route filters on this too, so the two can never drift apart.
function isChaseable(member) {
  if (!member) return false
  if (EXCLUDED_STATUSES.has(member.member_status)) return false
  return member.is_active === true
}

function num(v) {
  const n = Number(v)
  return Number.isFinite(n) ? n : 0
}

function round2(v) {
  return Math.round(v * 100) / 100
}

function pct(numerator, denominator) {
  if (!denominator) return null
  return Math.round((numerator / denominator) * 1000) / 10
}

const VIEW_BY = ['club', 'membership_type', 'member_status', 'payment_method']

function groupKeyFor(member, viewBy, clubName) {
  switch (viewBy) {
    case 'membership_type': return member.membership_type || 'Unknown'
    case 'member_status': return member.member_status || 'Unknown'
    case 'payment_method': return member.agreement_payment_method || 'Unknown'
    default: return clubName
  }
}

/**
 * @param pastDue  members carrying a past-due balance
 * @param totals   { [clubNumber]: chaseableMemberCount } for the % of members line
 * @param opts     { viewBy, clubNameFor }
 */
function buildPastDue(pastDue, totals, opts = {}) {
  const viewBy = VIEW_BY.includes(opts.viewBy) ? opts.viewBy : 'club'
  const clubNameFor = opts.clubNameFor || ((n) => n)

  const rows = new Map()
  let excluded = 0

  for (const m of pastDue || []) {
    // Belt and braces: the route filters these out already, but a status that
    // slipped through would quietly add collections debt to a front-desk
    // worklist, so it is checked again here.
    if (!isChaseable(m)) { excluded += 1; continue }

    const pastDueAmount = num(m.past_due_balance)
    const lateFees = num(m.late_fee_amount)
    const totalOwed = num(m.total_past_due_balance)
    // Whatever ABC's total carries beyond dues and late fees is the member's
    // club account — POS charges billed to the account rather than paid at the
    // till. Floored at zero so a rounding artefact cannot invent a negative.
    const clubAccount = Math.max(0, totalOwed - pastDueAmount - lateFees)

    const key = groupKeyFor(m, viewBy, clubNameFor(m.club_number))
    if (!rows.has(key)) {
      rows.set(key, {
        key,
        clubNumber: viewBy === 'club' ? m.club_number : null,
        members: 0, pastDue: 0, lateFees: 0, clubAccount: 0, totalOwed: 0, largest: 0,
      })
    }
    const row = rows.get(key)
    row.members += 1
    row.pastDue += pastDueAmount
    row.lateFees += lateFees
    row.clubAccount += clubAccount
    row.totalOwed += totalOwed
    if (pastDueAmount > row.largest) row.largest = pastDueAmount
  }

  const out = [...rows.values()].map(r => ({
    key: r.key,
    label: r.key,
    clubNumber: r.clubNumber,
    members: r.members,
    pastDue: round2(r.pastDue),
    lateFees: round2(r.lateFees),
    clubAccount: round2(r.clubAccount),
    totalOwed: round2(r.totalOwed),
    avgPastDue: r.members ? round2(r.pastDue / r.members) : null,
    largestBalance: round2(r.largest),
    // Only meaningful grouped by club, where there is a membership base to
    // divide by. Any other grouping has no denominator of its own.
    pctOfClubMembers: r.clubNumber ? pct(r.members, totals?.[r.clubNumber]) : null,
  }))

  const totalsAcc = out.reduce((acc, r) => {
    acc.members += r.members
    acc.pastDue += r.pastDue
    acc.lateFees += r.lateFees
    acc.clubAccount += r.clubAccount
    acc.totalOwed += r.totalOwed
    return acc
  }, { members: 0, pastDue: 0, lateFees: 0, clubAccount: 0, totalOwed: 0 })

  // Denominator is the membership base of the clubs in scope, not of the rows
  // shown — grouping by membership type must not change what "% of members
  // past due" means.
  const memberBase = Object.values(totals || {}).reduce((a, b) => a + num(b), 0)

  return {
    rows: out,
    summary: {
      members: totalsAcc.members,
      pastDue: round2(totalsAcc.pastDue),
      lateFees: round2(totalsAcc.lateFees),
      clubAccount: round2(totalsAcc.clubAccount),
      totalOwed: round2(totalsAcc.totalOwed),
      avgPastDue: totalsAcc.members ? round2(totalsAcc.pastDue / totalsAcc.members) : null,
      memberBase,
      pctOfMembers: pct(totalsAcc.members, memberBase),
    },
    excludedRows: excluded,
    viewBy,
  }
}

module.exports = { buildPastDue, isChaseable, EXCLUDED_STATUSES, VIEW_BY, pct }
