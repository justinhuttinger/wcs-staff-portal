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

module.exports = { formatPacific }
