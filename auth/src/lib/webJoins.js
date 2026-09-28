// ---------------------------------------------------------------------------
// Web Joins — pure builder for the Analytics report.
//
// A WEB JOIN is a member whose agreement ABC records as entered on the web
// (`agreement_entry_source = 'Web'`): ABC's own hosted signup and our Online
// Join flow both land there. Everything else (DataTrak EAE at the desk,
// Transfer, ABC, Home) is an in-club join.
//
// JOINS are counted on since_date, with the skip list applied and no ghost
// removal — the same population as Club Snapshot's "Joined", so the two
// reports agree on the denominator. See reference_abc_sign_date_moves: a
// sign_date count decays as members re-sign.
//
// Caveat carried on the report: entry source belongs to the member's CURRENT
// agreement. A web joiner who later re-signs at the desk reads as in-club.
// ---------------------------------------------------------------------------

function isWebSource(source) {
  return String(source || '').trim().toLowerCase() === 'web'
}

function pct(part, whole) {
  return whole > 0 ? (part / whole) * 100 : null
}

/** 'YYYY-MM' for each month from the one holding `start` through the one holding `end`. */
function monthsBetween(start, end) {
  const out = []
  let y = Number(start.slice(0, 4))
  let m = Number(start.slice(5, 7))
  const ey = Number(end.slice(0, 4))
  const em = Number(end.slice(5, 7))
  while (y < ey || (y === ey && m <= em)) {
    out.push(`${y}-${String(m).padStart(2, '0')}`)
    m += 1
    if (m > 12) { m = 1; y += 1 }
  }
  return out
}

/** First day of the month `n` months before the month holding `date`. */
function monthsBack(date, n) {
  let y = Number(date.slice(0, 4))
  let m = Number(date.slice(5, 7)) - n
  while (m < 1) { m += 12; y -= 1 }
  return `${y}-${String(m).padStart(2, '0')}-01`
}

function tally(rows) {
  let total = 0
  let web = 0
  for (const r of rows) {
    total += 1
    if (isWebSource(r.agreement_entry_source)) web += 1
  }
  return { total, web, inClub: total - web, webPct: pct(web, total) }
}

/**
 * @param rows   abc_members rows already filtered to the clubs, skip list and
 *               member filters: { club_number, since_date, agreement_entry_source }
 * @param opts   { start, end, trendStart, clubs: [{ clubNumber, name }] }
 *               rows may span trendStart..end; the range figures use start..end.
 */
function buildWebJoins(rows, { start, end, trendStart, clubs }) {
  const inRange = rows.filter(r => r.since_date >= start && r.since_date <= end)
  const summary = tally(inRange)

  // One row per club, dropping clubs with no joins at all in the range.
  const byClub = clubs
    .map(c => ({ key: c.clubNumber, label: c.name, ...tally(inRange.filter(r => r.club_number === c.clubNumber)) }))
    .filter(c => c.total > 0)
    .sort((a, b) => (b.webPct ?? -1) - (a.webPct ?? -1) || b.web - a.web)

  // Monthly trend. The last month is partial whenever `end` is mid-month, and
  // is flagged so the reader does not compare a half month against full ones.
  const lastDay = new Date(Date.UTC(Number(end.slice(0, 4)), Number(end.slice(5, 7)), 0)).getUTCDate()
  const endIsMonthEnd = Number(end.slice(8, 10)) === lastDay
  const months = monthsBetween(trendStart, end).map((mo, i, arr) => {
    const t = tally(rows.filter(r => r.since_date && r.since_date.slice(0, 7) === mo && r.since_date <= end))
    return { month: mo, partial: i === arr.length - 1 && !endIsMonthEnd, ...t }
  })

  return { summary, byClub, months }
}

module.exports = { buildWebJoins, isWebSource, monthsBetween, monthsBack }
