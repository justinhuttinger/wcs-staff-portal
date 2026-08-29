// Like-for-like comparison windows.
//
// LENGTH IS THE WHOLE GAME. The default Analytics view is month-to-date, so
// comparing 27 days of August against all 31 of July reports a 13% fall that is
// nothing but a shorter window. Every comparison here covers the same NUMBER of
// days as the window on screen.
//
// SHIFTED BY CALENDAR MONTH OR YEAR, THEN CLAMPED TO THAT LENGTH — never by
// subtracting 30 or 365 days. Month lengths differ and leap years exist, and
// "the same span last year" means the same dates, not 365 days ago.
//
// The start is shifted on the calendar and the end is derived from the span.
// Shifting both ends independently is the bug this exists to avoid: 1-31 March
// against 1-28 February compares 31 days with 28 and invents a 10% drop.
//
// Free of I/O and of the route's dependencies so it can be tested directly.

const DAY = 86_400_000

const iso = d => d.toISOString().slice(0, 10)
const parse = s => new Date(`${String(s).slice(0, 10)}T00:00:00Z`)

/** Days covered by an inclusive date range. 1 March to 1 March is one day. */
function spanDays(start, end) {
  return Math.round((parse(end) - parse(start)) / DAY) + 1
}

/**
 * The same span, shifted back by whole months or years.
 *
 * @returns { start, end } covering exactly spanDays(start, end) days.
 */
function shiftedWindow(start, end, { months = 0, years = 0 } = {}) {
  const days = spanDays(start, end)
  const s = parse(start)
  if (years) s.setUTCFullYear(s.getUTCFullYear() - years)
  if (months) s.setUTCMonth(s.getUTCMonth() - months)
  const e = new Date(s.getTime() + (days - 1) * DAY)
  return { start: iso(s), end: iso(e) }
}

module.exports = { shiftedWindow, spanDays }
