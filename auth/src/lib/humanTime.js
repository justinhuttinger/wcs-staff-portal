// Timestamps that leave the building for a human to read.
//
// An outbound webhook lands in GHL, where the value is looked at by a person
// or dropped into a message — not parsed. An ISO string ("2026-09-09T16:05:51.004Z")
// is the wrong shape for both: it is hard to scan, and its UTC clock reads
// seven hours ahead of the club, so a 4pm tour appears to have happened at 11pm.
//
// Every club is in Oregon, so Pacific is the only clock that matters and the
// output carries no zone label.

const PARTS = new Intl.DateTimeFormat('en-US', {
  timeZone: 'America/Los_Angeles',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: 'numeric',
  minute: '2-digit',
  hour12: true,
})

/**
 * "2026-09-09T23:05:51.004Z" -> "09/09/2026 | 4:05 PM"
 *
 * Returns null for anything that is not a real instant — absent, blank, or
 * unparseable — so the field stays empty rather than carrying "Invalid Date"
 * into a customer-facing message.
 *
 * @param {string|number|Date|null|undefined} value
 * @returns {string|null}
 */
function formatPacific(value) {
  if (value == null || value === '') return null

  const d = value instanceof Date ? value : new Date(value)
  if (Number.isNaN(d.getTime())) return null

  const p = {}
  for (const { type, value: v } of PARTS.formatToParts(d)) p[type] = v

  // Assembled by hand rather than trusting the locale's own punctuation, which
  // varies by runtime ICU build and would drift the format between machines.
  return `${p.month}/${p.day}/${p.year} | ${p.hour}:${p.minute} ${p.dayPeriod}`
}

const DATE_PARTS = new Intl.DateTimeFormat('en-US', {
  timeZone: 'America/Los_Angeles',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
})

/**
 * The day a pass of `days` runs out, counted from `from`, as "MM-DD-YYYY".
 *
 * The count starts from the calendar day at the club, not from the UTC one: a
 * tour saved after 5pm Pacific has already tipped into tomorrow in UTC, and
 * counting from there would hand out an extra day.
 *
 * Returns null when there is no pass to date -- no day count, or a count of
 * zero -- so "no pass" stays distinguishable from a pass ending today.
 *
 * @param {string|number|Date|null|undefined} from
 * @param {number|string|null|undefined} days
 * @returns {string|null}
 */
function passEndDate(from, days) {
  const n = Number(days)
  if (!Number.isFinite(n) || n < 1) return null

  const start = from == null || from === '' ? new Date() : new Date(from)
  if (Number.isNaN(start.getTime())) return null

  const p = {}
  for (const { type, value } of DATE_PARTS.formatToParts(start)) p[type] = value

  // Rebuilt as a UTC midnight so the day arithmetic cannot be nudged by an
  // offset, then read back with the UTC getters. Calendar-safe across month,
  // year and daylight-saving boundaries.
  const d = new Date(Date.UTC(Number(p.year), Number(p.month) - 1, Number(p.day)))
  d.setUTCDate(d.getUTCDate() + n)

  const pad = v => String(v).padStart(2, '0')
  return `${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}-${d.getUTCFullYear()}`
}

module.exports = { formatPacific, passEndDate }
