// Revenue data only ever exists through *yesterday* — ABC's daily "Revenue by
// Profit Center" email for a given day doesn't arrive until the next morning.
// So any report range whose end is today (or later) must be capped to yesterday;
// otherwise an MTD view compares a short current period (1st → yesterday) against
// a full prior period (1st → same-day-of-month a month/year ago), which is
// unfair. Capping the end makes every comparison shift line up day-for-day.
//
// Pure helpers (no express) so the route can import them and tests can inject
// `now`. Pacific because the clubs — and ABC's payment_date — run on Pacific.

const { pacificDate } = require('../lib/operandioJobs')

const iso = (d) => d.toISOString().slice(0, 10)

// Pacific calendar 'yesterday' as YYYY-MM-DD. `now` is injectable for tests.
function pacificYesterday(now = new Date()) {
  const today = pacificDate(now) // 'YYYY-MM-DD' in America/Los_Angeles
  const d = new Date(today + 'T00:00:00Z')
  d.setUTCDate(d.getUTCDate() - 1)
  return iso(d)
}

// Cap an end date to the latest day revenue data can exist (Pacific yesterday).
// Returns the earlier of `endDate` and yesterday; past ranges pass through.
function capRevenueEndDate(endDate, now = new Date()) {
  const yesterday = pacificYesterday(now)
  return endDate > yesterday ? yesterday : endDate
}

module.exports = { pacificYesterday, capRevenueEndDate }
