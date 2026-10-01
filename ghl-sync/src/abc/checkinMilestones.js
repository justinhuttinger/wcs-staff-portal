// Check-in milestone alerts: which members get a "CELEBRATE 10TH VISIT!"
// show-once ABC alert tonight, so it pops on the check-in card of their
// milestone visit. Pure; the job that reads the DB and writes to ABC is
// checkinMilestonesJob.js.

// Which numbers are milestones now lives in the admin-editable settings
// (Portal Admin -> Check-in Celebrations; celebrationSettings.js). The
// defaults are Justin's original list: 10, 25, 50, 100, 150, 200, 250, 300,
// then every 100.
const { DEFAULT_SETTINGS, isLifetimeMilestone, lifetimeText, MAX_TEXT } = require('./celebrationSettings')

function isMilestone(n, lifetime = DEFAULT_SETTINGS.lifetime) {
  return isLifetimeMilestone(n, lifetime)
}

const alertText = lifetimeText

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

function planAlert({ member, visits, excludedTypes, backfillStart, lifetime = DEFAULT_SETTINGS.lifetime }) {
  const next = Number(visits) + 1
  if (!isMilestone(next, lifetime) || !isEligible(member, excludedTypes, backfillStart)) return null
  const text = alertText(next)
  return text ? { milestone: next, text } : null
}

module.exports = { isMilestone, alertText, earliestJoin, isEligible, planAlert, MAX_TEXT }
