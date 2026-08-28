// Shared date maths and labelling for the Snapshot reports.
//
// A snapshot compares one window against something. Naming that something
// precisely is most of the job: "vs 2026-07-01 to 2026-07-28" tells a reader
// nothing they can hold in their head, where "vs July MTD" tells them
// everything.

const MONTHS = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
]

const pad = (n) => String(n).padStart(2, '0')

function daysInMonth(year, month) {
  return new Date(Date.UTC(year, month, 0)).getUTCDate()
}

/** Month-to-date for the month containing `today`. */
function monthToDate(today = new Date()) {
  const y = today.getUTCFullYear()
  const m = today.getUTCMonth() + 1
  return { start: `${y}-${pad(m)}-01`, end: today.toISOString().slice(0, 10) }
}

/**
 * The same window one month earlier.
 *
 * The day of month is CLAMPED to the shorter month rather than rolling over:
 * shifting 31 March back a month must give 28 February, not 3 March. A rollover
 * would silently compare 31 days against 3 and report a collapse.
 */
function priorMonthWindow(start, end) {
  const shift = (iso) => {
    const [y, m, d] = String(iso).split('-').map(Number)
    const total = y * 12 + (m - 1) - 1
    const py = Math.floor(total / 12)
    const pm = (total % 12) + 1
    return `${py}-${pad(pm)}-${pad(Math.min(d, daysInMonth(py, pm)))}`
  }
  return { start: shift(start), end: shift(end) }
}

/**
 * "2026-08-28" -> "August 28 2026".
 *
 * Parsed by hand rather than through Date: new Date('2026-08-28') is midnight
 * UTC, and a server west of Greenwich renders it as the 27th.
 */
function formatDateLong(iso) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(iso || ''))
  if (!m) return ''
  const name = MONTHS[Number(m[2]) - 1]
  return name ? `${name} ${Number(m[3])} ${m[1]}` : ''
}

/** "2026-07-01" -> "July". */
function monthName(iso) {
  const m = /^(\d{4})-(\d{2})/.exec(String(iso || ''))
  return m ? (MONTHS[Number(m[2]) - 1] || '') : ''
}

/** True when the window runs from the 1st to some day of the SAME month. */
function isMonthToDate(start, end) {
  const s = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(start || ''))
  const e = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(end || ''))
  if (!s || !e) return false
  return s[3] === '01' && s[1] === e[1] && s[2] === e[2]
}

/**
 * What the comparison column should be called.
 *
 * Month-to-date against month-to-date is the common case and deserves the name
 * of the month — "July MTD". Any other window falls back to its end date, which
 * is at least readable.
 */
function priorLabel(start, end) {
  const prior = priorMonthWindow(start, end)
  return isMonthToDate(start, end)
    ? `${monthName(prior.start)} MTD`
    : formatDateLong(prior.end)
}

/** "August 28 2026 vs July 28 2026" — the header line. */
function windowLabel(start, end) {
  return isMonthToDate(start, end)
    ? `${monthName(start)} MTD · through ${formatDateLong(end)}`
    : `${formatDateLong(start)} to ${formatDateLong(end)}`
}

/**
 * Percentage change, guarding the zero base.
 *
 * From nothing to something is not "infinite percent" — it is a new thing, and
 * the report says so with a null rather than a number nobody can read.
 */
function pctChange(now, prior) {
  // Null and undefined are checked BEFORE coercing: Number(null) is 0, which is
  // finite, so a missing value would read as a 100% drop rather than as an
  // unknown. That is the difference between "no data" and "lost everything".
  if (now === null || now === undefined || prior === null || prior === undefined) return null
  const a = Number(now)
  const b = Number(prior)
  if (!Number.isFinite(a) || !Number.isFinite(b) || b === 0) return null
  return Math.round(((a - b) / b) * 1000) / 10
}

module.exports = {
  monthToDate, priorMonthWindow, pctChange, daysInMonth,
  formatDateLong, monthName, isMonthToDate, priorLabel, windowLabel,
}
