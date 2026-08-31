// Pure shaping for Analytics > Payroll. No I/O; the route fetches.
//
// Deliberately plain. Commission per person for one period, from the two
// sources that pay it, and the totals that follow. No trend, no comparison, no
// rates — this is a document somebody reconciles against a payroll run, and
// every extra number on it is one more thing to have to explain.
//
// TWO THINGS IT DOES SAY, BECAUSE BOTH CHANGE WHAT THE NUMBERS MEAN:
//
//   A MISSING SOURCE. The sales half is a manual upload. A period with
//   recurring commission and no sales is not a quiet month, it is an upload
//   that has not happened, and August 2026 is in that state right now. Showing
//   everyone's pay as short without saying so would send people to argue about
//   their commission.
//
//   A SHARED NAME. One row is 'Victoria Mattox, Devyn Trebesch' — a split that
//   belongs to neither person alone. Flagged rather than guessed at or dropped:
//   the money is real, the attribution is not.

function num(v) {
  if (v === null || v === undefined) return 0
  const n = Number(v)
  return Number.isFinite(n) ? n : 0
}

function r2(v) {
  return Math.round(v * 100) / 100
}

/**
 * @param rows     analytics_payroll rows for the period
 * @param periods  analytics_payroll_periods rows
 * @param opts     { period }
 */
function buildPayroll(rows, periods, opts = {}) {
  const people = (rows || []).map(r => ({
    slug: r.slug,
    employee: r.employee,
    sales: r2(num(r.sales_commission)),
    recurring: r2(num(r.recurring_commission)),
    total: r2(num(r.total_commission)),
    salesLines: num(r.sales_lines),
    recurringLines: num(r.recurring_lines),
    sharedName: !!r.shared_name,
  }))

  const byClubMap = new Map()
  for (const p of people) {
    const cur = byClubMap.get(p.slug) || { slug: p.slug, sales: 0, recurring: 0, total: 0, people: 0 }
    cur.sales += p.sales
    cur.recurring += p.recurring
    cur.total += p.total
    cur.people += 1
    byClubMap.set(p.slug, cur)
  }
  const byClub = [...byClubMap.values()]
    .map(c => ({ ...c, sales: r2(c.sales), recurring: r2(c.recurring), total: r2(c.total) }))
    .sort((a, b) => b.total - a.total)

  const available = (periods || []).map(p => ({
    period: String(p.period).slice(0, 10),
    hasSales: !!p.has_sales,
    hasRecurring: !!p.has_recurring,
  }))

  const period = opts.period || (available[0] ? available[0].period : null)
  const current = available.find(p => p.period === period) || null

  const shared = people.filter(p => p.sharedName)

  return {
    period,
    periods: available,
    summary: {
      people: people.length,
      sales: r2(people.reduce((a, p) => a + p.sales, 0)),
      recurring: r2(people.reduce((a, p) => a + p.recurring, 0)),
      total: r2(people.reduce((a, p) => a + p.total, 0)),
      // Surfaced so a thin month can be read as a missing upload rather than a
      // bad month.
      hasSales: current ? current.hasSales : null,
      hasRecurring: current ? current.hasRecurring : null,
    },
    people,
    byClub,
    shared,
    notes: {
      missingSource: !current ? null
        : !current.hasSales && current.hasRecurring
          ? 'No sales commission has been uploaded for this period yet, so these totals are ' +
            'PT recurring commission only and will rise when it is.'
          : current.hasSales && !current.hasRecurring
            ? 'No recurring commission has been pulled for this period yet, so these totals are ' +
              'sales commission only.'
            : null,
      shared: shared.length === 0 ? null
        : `${shared.length} commission ${shared.length === 1 ? 'row names' : 'rows name'} more than ` +
          'one person and cannot be attributed to either. The amount is included in the club ' +
          'total; split it by hand before paying.',
    },
  }
}

module.exports = { buildPayroll }
