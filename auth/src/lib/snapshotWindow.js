// Shared date maths for the Snapshot reports.
//
// A snapshot always shows one window beside the SAME window a month earlier, so
// month-to-date is compared with month-to-date rather than with a whole month.
// Getting that shift wrong is the difference between "down 40%" and "flat".

const pad = (n) => String(n).padStart(2, '0')

function daysInMonth(year, month) {
  return new Date(Date.UTC(year, month, 0)).getUTCDate()
}

/** Month-to-date for the month containing `today`. */
function monthToDate(today = new Date()) {
  const y = today.getUTCFullYear()
  const m = today.getUTCMonth() + 1
  return {
    start: `${y}-${pad(m)}-01`,
    end: today.toISOString().slice(0, 10),
  }
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

module.exports = { monthToDate, priorMonthWindow, pctChange, daysInMonth }
