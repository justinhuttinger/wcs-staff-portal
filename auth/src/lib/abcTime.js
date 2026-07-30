// ABC returns naive club-local Pacific timestamps ("2026-07-28 10:00:00.000000"),
// never UTC and never with an offset. This module is the single place that
// knows that. Everything else in the codebase should import from here rather
// than re-deriving the offset.

// US Pacific DST: second Sunday in March through first Sunday in November.
function isDstPacific(d) {
  const y = d.getUTCFullYear()
  const mar = new Date(Date.UTC(y, 2, 1))
  mar.setUTCDate(mar.getUTCDate() + ((7 - mar.getUTCDay()) % 7) + 7)
  const nov = new Date(Date.UTC(y, 10, 1))
  nov.setUTCDate(nov.getUTCDate() + ((7 - nov.getUTCDay()) % 7))
  return d >= mar && d < nov
}

// "2026-07-28 10:00:00.000000" -> { utc: ISO string, local: "2026-07-28 10:00:00" }
function parseAbcTs(s) {
  if (!s) return { utc: null, local: null }
  const cleaned = String(s).replace('T', ' ').replace(/\.\d+$/, '')
  // Probe the offset by reading the naive time as if it were UTC. Only ever
  // wrong inside the one ambiguous hour of the fall-back transition, when a
  // class is not being taught anyway.
  const probe = new Date(cleaned + 'Z')
  const offset = isDstPacific(probe) ? '-07:00' : '-08:00'
  return { utc: new Date(cleaned.replace(' ', 'T') + offset).toISOString(), local: cleaned }
}

// 'YYYY-MM-DD' shifted by N days, still 'YYYY-MM-DD'.
function padDate(s, days) {
  const d = new Date(s + 'T00:00:00Z')
  d.setUTCDate(d.getUTCDate() + days)
  return toIsoDate(d)
}

function toIsoDate(d) {
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`
}

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/
const TIME_RE = /^([01]\d|2[0-3]):([0-5]\d)(:([0-5]\d))?$/

// Builds the naive club-local timestamp ABC wants on writes:
// ("2026-08-03", "06:00") -> "2026-08-03 06:00:00"
function buildLocalTimestamp(date, time) {
  if (!DATE_RE.test(String(date || ''))) throw new Error('invalid date, expected YYYY-MM-DD')
  const m = TIME_RE.exec(String(time || ''))
  if (!m) throw new Error('invalid time, expected HH:mm')
  return `${date} ${m[1]}:${m[2]}:${m[4] || '00'}`
}

module.exports = { isDstPacific, parseAbcTs, padDate, toIsoDate, buildLocalTimestamp, DATE_RE, TIME_RE }
