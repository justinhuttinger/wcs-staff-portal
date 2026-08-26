// Shapes the monthly rows from the analytics_club_activity() SQL function into
// the ten tiles the Club Activity Trends report draws.
//
// Pure: no I/O, no Supabase import, so the arithmetic is testable without a
// database. The route does the fetching.
//
// Every tile pairs a month against the SAME MONTH A YEAR EARLIER, never against
// the month before it, so seasonality does not read as trend. That is why the
// route asks for 12 months more than it displays: the oldest displayed month
// still needs a partner.

// How a tile's YTD headline is derived from its months:
//   point — a level, so YTD is the latest month (members on the books today is
//           not the sum of twelve monthly headcounts)
//   sum   — a flow, so YTD adds the months up
//   mean  — a rate, so YTD averages the monthly rates
const TILES = [
  { key: 'totalMembers', label: 'Total Members', format: 'int', kind: 'point' },
  { key: 'newMemberUnits', label: 'New Member Units', format: 'int', kind: 'sum' },
  { key: 'uniqueCheckins', label: 'Unique Daily Check-ins', format: 'int', kind: 'sum', needsCheckins: true },
  { key: 'totalRevenue', label: 'Total Revenue', format: 'money', kind: 'sum' },
  { key: 'ptRevenue', label: 'PT Revenue', format: 'money', kind: 'sum' },
  { key: 'lostMembers', label: 'Lost Members', format: 'int', kind: 'sum', negate: true },
  { key: 'netMembers', label: 'Net Members', format: 'int', kind: 'sum', signed: true },
  { key: 'avgCheckinsPerMember', label: 'Avg Check-ins Per Member', format: 'ratio', kind: 'mean', needsCheckins: true },
  { key: 'avgRevenuePerMember', label: 'Avg Revenue Per Member', format: 'money2', kind: 'mean' },
  { key: 'avgRevenuePerVisit', label: 'Avg Revenue Per Visit', format: 'money2', kind: 'mean', needsCheckins: true },
]

function num(v) {
  if (v === null || v === undefined) return null
  const n = Number(v)
  return Number.isFinite(n) ? n : null
}

function ratio(numerator, denominator) {
  const a = num(numerator)
  const b = num(denominator)
  if (a === null || b === null || b === 0) return null
  return a / b
}

/**
 * Expand a raw month row into every metric a tile can read, including the
 * derived ones. Check-in metrics return null — not 0 — for months before
 * checkins_hourly starts, because a zero there would read as "nobody came in"
 * rather than "we weren't collecting yet".
 */
function deriveMonth(row) {
  const hasCheckins = row.has_checkin_data !== false
  const totalMembers = num(row.total_members)
  const totalCheckins = hasCheckins ? num(row.total_checkins) : null
  const uniqueCheckins = hasCheckins ? num(row.unique_checkins) : null
  const totalRevenue = num(row.total_revenue)
  const newMemberUnits = num(row.new_member_units)
  const lostMembers = num(row.lost_members)

  return {
    // Keyed as YYYY-MM, not YYYY-MM-DD: the same-month-last-year lookup is
    // string arithmetic on this key, and a trailing day component would make
    // every partner miss.
    month: String(row.month_start).slice(0, 7),
    hasCheckins,
    totalMembers,
    newMemberUnits,
    lostMembers,
    netMembers: newMemberUnits === null || lostMembers === null ? null : newMemberUnits - lostMembers,
    uniqueCheckins,
    totalCheckins,
    totalRevenue,
    ptRevenue: num(row.pt_revenue),
    avgCheckinsPerMember: totalCheckins === null ? null : ratio(totalCheckins, totalMembers),
    avgRevenuePerMember: ratio(totalRevenue, totalMembers),
    avgRevenuePerVisit: totalCheckins === null ? null : ratio(totalRevenue, totalCheckins),
  }
}

function pctChange(current, prior) {
  if (current === null || prior === null || prior === 0) return null
  return Math.round(((current - prior) / Math.abs(prior)) * 1000) / 10
}

function round(value, places) {
  if (value === null) return null
  const f = 10 ** places
  return Math.round(value * f) / f
}

function aggregate(kind, values) {
  const present = values.filter(v => v !== null)
  if (present.length === 0) return null
  if (kind === 'point') return present[present.length - 1]
  if (kind === 'mean') return present.reduce((a, b) => a + b, 0) / present.length
  return present.reduce((a, b) => a + b, 0)
}

/**
 * @param rows   month rows from analytics_club_activity(), ascending
 * @param months how many months to display (the rest are comparison partners)
 */
function buildTrends(rows, months = 13) {
  const derived = (rows || []).map(deriveMonth)
  const byMonth = new Map(derived.map(m => [m.month, m]))

  // A month's partner is the same month one year earlier. Built by calendar
  // arithmetic rather than by index so a gap in the series cannot silently
  // shift every comparison by a month.
  const priorOf = (month) => {
    const [y, m] = month.split('-')
    return byMonth.get(`${Number(y) - 1}-${m}`) || null
  }

  const shown = derived.slice(-months)
  const anchor = shown[shown.length - 1] || null
  const anchorYear = anchor ? anchor.month.slice(0, 4) : null

  // Year to date = calendar months of the anchor's year up to and including it.
  const ytdMonths = anchor ? derived.filter(m => m.month.slice(0, 4) === anchorYear && m.month <= anchor.month) : []

  const tiles = TILES.map(tile => {
    const series = shown.map(m => {
      const prior = priorOf(m.month)
      const value = m[tile.key]
      const priorValue = prior ? prior[tile.key] : null
      return {
        month: m.month,
        value: round(value, tile.format === 'int' ? 0 : 2),
        priorValue: round(priorValue, tile.format === 'int' ? 0 : 2),
        changePct: pctChange(value, priorValue),
      }
    })

    // The headline YTD is every month of the year so far.
    const ytd = aggregate(tile.kind, ytdMonths.map(m => m[tile.key]))

    // The year-over-year comparison is LIKE FOR LIKE: only months that have a
    // partner count, on both sides. Aggregating a full seven-month YTD against
    // however many partners happen to exist produces numbers like +600% —
    // arithmetically true, completely meaningless.
    const comparable = ytdMonths
      .map(m => ({ current: m[tile.key], prior: priorOf(m.month)?.[tile.key] ?? null }))
      .filter(p => p.current !== null && p.prior !== null)
    const ytdCompared = aggregate(tile.kind, comparable.map(p => p.current))
    const ytdPrior = aggregate(tile.kind, comparable.map(p => p.prior))

    return {
      key: tile.key,
      label: tile.label,
      format: tile.format,
      kind: tile.kind,
      // Lost Members reads as a negative on the headline, matching the source
      // tool: losing 3,846 members is "-3,846", not a positive achievement.
      negate: !!tile.negate,
      signed: !!tile.signed,
      ytd: round(ytd, tile.format === 'int' ? 0 : 2),
      ytdPrior: round(ytdPrior, tile.format === 'int' ? 0 : 2),
      yoyPct: pctChange(ytdCompared, ytdPrior),
      // How many of the YTD months actually had a partner to compare against.
      comparedMonths: comparable.length,
      series,
      // True when the tile has nothing to compare against, so the UI can say
      // "no prior-year data" instead of drawing an empty dashed line.
      missingPriorYear: series.every(p => p.priorValue === null),
    }
  })

  return {
    tiles,
    asOfMonth: anchor ? anchor.month : null,
    months: shown.map(m => m.month),
    // Months displayed that predate check-in collection, so the report can name
    // the limitation rather than leaving a mystery gap in three tiles.
    checkinGapMonths: shown.filter(m => !m.hasCheckins).map(m => m.month),
  }
}

module.exports = { buildTrends, deriveMonth, pctChange, aggregate, TILES }
