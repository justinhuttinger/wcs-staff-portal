// Check-in milestone alerts: which members get a "CELEBRATE 10TH VISIT!"
// show-once ABC alert tonight, so it pops on the check-in card of their
// milestone visit. Pure; the job that reads the DB and writes to ABC is
// checkinMilestonesJob.js.

// Justin's list (2026-09-30): these, then every 100 after 300.
const FIXED = [10, 25, 50, 100, 150, 200, 250, 300]

function isMilestone(n) {
  return Number.isInteger(n) && (FIXED.includes(n) || (n > 300 && n % 100 === 0))
}

// ABC caps alert text at 22 chars (alpha, numeric, spaces and ,_!%+-@^; a "/"
// is rejected outright). Every milestone ends in 0 or 5, so the suffix is
// always TH. "CELEBRATE 1000TH VISIT" only fits without the "!".
const MAX_TEXT = 22
function alertText(n) {
  const full = `CELEBRATE ${n}TH VISIT!`
  if (full.length <= MAX_TEXT) return full
  const bare = full.slice(0, -1)
  return bare.length <= MAX_TEXT ? bare : null
}

function ymd(v) {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(v || '').trim())
  return m ? `${m[1]}-${m[2]}-${m[3]}` : null
}

// Earliest, not first-non-blank: a rejoin's newer sign_date must not hide an
// older since_date, or someone whose visits predate the backfill slips in
// with a short count and gets celebrated late.
function earliestJoin(member) {
  const dates = [member.sign_date, member.begin_date, member.since_date].map(ymd).filter(Boolean).sort()
  return dates[0] || null
}

// Counts only go back to the check-in backfill, so only members who joined
// on or after it have a true lifetime count (Justin, 2026-09-30).
function isEligible(member, excludedTypes, backfillStart) {
  if (member.is_active !== true || member.member_status !== 'Active') return false
  if (excludedTypes.has(member.membership_type)) return false
  const join = earliestJoin(member)
  return Boolean(join && backfillStart && join >= backfillStart)
}

function planAlert({ member, visits, excludedTypes, backfillStart }) {
  const next = Number(visits) + 1
  if (!isMilestone(next) || !isEligible(member, excludedTypes, backfillStart)) return null
  const text = alertText(next)
  return text ? { milestone: next, text } : null
}

module.exports = { isMilestone, alertText, earliestJoin, isEligible, planAlert, MAX_TEXT }
