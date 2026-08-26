// Pure shaping for Analytics > PT Penetration. No I/O; the route fetches.
//
// Turns per-club monthly rows into one line per club plus the headline rates.
//
// A PT member is someone who PAID for training inside the trailing window. That
// is a measurement, not a status: ABC gives us no PT agreement history —
// abc_recurring_pt_services is a snapshot of currently active recurring
// services with no start dates and no paid-in-full rows — so the only way to
// know who was a PT client in March 2025 is that they paid for training around
// then.

function num(v) {
  if (v === null || v === undefined) return null
  const n = Number(v)
  return Number.isFinite(n) ? n : null
}

function pct(part, whole) {
  if (!whole) return null
  return Math.round((part / whole) * 10000) / 100
}

function pctChange(current, prior) {
  if (current === null || prior === null || prior === 0) return null
  return Math.round(((current - prior) / Math.abs(prior)) * 1000) / 10
}

function round2(v) {
  return v === null ? null : Math.round(v * 100) / 100
}

const METRICS = [
  { key: 'penetration', label: 'PT Member Penetration %', format: 'pct' },
  { key: 'ptMembers', label: 'PT Members', format: 'int' },
  { key: 'ptRevenue', label: 'PT Revenue', format: 'money' },
  { key: 'revenuePerPtMember', label: 'PT Revenue Per PT Member', format: 'money2' },
]

const WINDOWS = [
  { key: 1, label: 'Paid this month' },
  { key: 3, label: 'Paid in last 3 months' },
  { key: 6, label: 'Paid in last 6 months' },
]

function shiftMonth(ym, delta) {
  const [y, m] = ym.split('-').map(Number)
  const total = y * 12 + (m - 1) + delta
  return `${Math.floor(total / 12)}-${String((total % 12) + 1).padStart(2, '0')}`
}

/**
 * @param rows  (month_start, club_number, members, pt_members, pt_revenue)
 * @param opts  { clubNameFor, metric }
 */
function buildPtPenetration(rows, opts = {}) {
  const clubNameFor = opts.clubNameFor || ((n) => n)
  const metric = METRICS.some(m => m.key === opts.metric) ? opts.metric : 'penetration'

  const monthSet = new Set()
  const byClub = new Map()
  const totalsByMonth = new Map()

  for (const r of (rows || [])) {
    const month = String(r.month_start).slice(0, 7)
    const club = clubNameFor(r.club_number)
    const members = num(r.members) || 0
    const ptMembers = num(r.pt_members) || 0
    const ptRevenue = num(r.pt_revenue) || 0

    monthSet.add(month)

    if (!byClub.has(club)) byClub.set(club, new Map())
    byClub.get(club).set(month, { members, ptMembers, ptRevenue })

    if (!totalsByMonth.has(month)) totalsByMonth.set(month, { members: 0, ptMembers: 0, ptRevenue: 0 })
    const t = totalsByMonth.get(month)
    t.members += members
    t.ptMembers += ptMembers
    t.ptRevenue += ptRevenue
  }

  // Training revenue starts partway into the member history, so the earliest
  // months have members but no PT transactions. Those are not 0% penetration,
  // they are months we cannot measure — plotting them draws a cliff at the
  // left edge that never happened. Leading months with no PT activity anywhere
  // are dropped; a genuine 0% month later in the series is kept.
  const ordered = [...monthSet].sort()
  const firstWithPt = ordered.findIndex(m => (totalsByMonth.get(m)?.ptMembers || 0) > 0)
  const months = firstWithPt <= 0 ? ordered : ordered.slice(firstWithPt)
  const trimmedLeadingMonths = firstWithPt <= 0 ? 0 : firstWithPt

  const valueOf = (cell) => {
    if (!cell) return null
    switch (metric) {
      case 'ptMembers': return cell.ptMembers
      case 'ptRevenue': return round2(cell.ptRevenue)
      case 'revenuePerPtMember': return cell.ptMembers ? round2(cell.ptRevenue / cell.ptMembers) : null
      default: return pct(cell.ptMembers, cell.members)
    }
  }

  // Clubs ordered by their most recent membership, so the legend is stable and
  // the biggest club is not buried at the bottom.
  const lastMonth = months[months.length - 1]
  const series = [...byClub.entries()]
    .map(([club, cells]) => ({
      name: club,
      lastMembers: cells.get(lastMonth)?.members || 0,
      points: months.map(month => {
        const cell = cells.get(month)
        return {
          month,
          // A club with no members that month has no rate. null breaks the line
          // rather than dropping it to zero, which would draw a collapse for a
          // club that simply had not opened yet.
          value: cell && cell.members > 0 ? valueOf(cell) : null,
          members: cell?.members || 0,
          ptMembers: cell?.ptMembers || 0,
        }
      }),
    }))
    .sort((a, b) => b.lastMembers - a.lastMembers)

  const totals = months.map(month => {
    const t = totalsByMonth.get(month) || { members: 0, ptMembers: 0, ptRevenue: 0 }
    return {
      month,
      members: t.members,
      ptMembers: t.ptMembers,
      ptRevenue: round2(t.ptRevenue),
      penetration: pct(t.ptMembers, t.members),
    }
  })

  const latest = totals[totals.length - 1] || null
  const yearAgo = latest ? totals.find(t => t.month === shiftMonth(latest.month, -12)) : null
  const priorMonth = totals.length > 1 ? totals[totals.length - 2] : null

  return {
    months,
    trimmedLeadingMonths,
    series,
    totals,
    metric,
    metrics: METRICS,
    windows: WINDOWS,
    summary: latest ? {
      month: latest.month,
      penetration: latest.penetration,
      ptMembers: latest.ptMembers,
      members: latest.members,
      ptRevenue: latest.ptRevenue,
      revenuePerPtMember: latest.ptMembers ? round2(latest.ptRevenue / latest.ptMembers) : null,
      vsPriorMonth: pctChange(latest.penetration, priorMonth?.penetration ?? null),
      vsPriorYear: pctChange(latest.penetration, yearAgo?.penetration ?? null),
      // Named so a missing year-ago comparison is visible rather than implied.
      hasPriorYear: !!yearAgo,
    } : null,
  }
}

module.exports = { buildPtPenetration, pct, pctChange, shiftMonth, METRICS, WINDOWS }
