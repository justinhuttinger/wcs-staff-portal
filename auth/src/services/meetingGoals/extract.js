// auth/src/services/meetingGoals/extract.js
// Pure transforms from synced job/step rows to a goal entry. No I/O.
'use strict'

const { KINDS, ACTION_PLAN_RE } = require('./config')
const { addDays } = require('../kpiDigest/week')

// Article kind for a process name, or null if this job isn't one of ours.
function kindForProcess(processName) {
  return KINDS[String(processName || '').trim()] || null
}

// The Monday on-or-before a YYYY-MM-DD date. Meetings are weekly but can be
// submitted late, so the week is derived from the job's own date rather than
// from when the sync happened to notice it.
function mondayOf(ymd) {
  const [y, m, d] = ymd.split('-').map(Number)
  const dow = new Date(Date.UTC(y, m - 1, d, 12, 0, 0)).getUTCDay() // 0=Sun
  return addDays(ymd, -((dow + 6) % 7))
}

// The action plan texts from a job's step rows, in step order.
//
// Empties are dropped, not preserved as blanks: staff are told to set 3-5
// priorities, so gaps are normal and a rendered empty bullet is noise. A
// long_text response arrives as plain text and routinely carries trailing
// newlines, hence the trim.
function actionPlansFromSteps(steps) {
  return (steps || [])
    .filter((s) => ACTION_PLAN_RE.test(String(s.name || '').trim()))
    .slice()
    .sort((a, b) => (a.position ?? 0) - (b.position ?? 0))
    .map((s) => (typeof s.response === 'string' ? s.response.trim() : ''))
    .filter((text) => text.length > 0)
}

// One goal entry row from a synced job + its steps, or null if the job isn't
// an MC/PT Weekly Meeting or hasn't been submitted yet.
function entryFromJob(job, steps) {
  const kind = kindForProcess(job.process_name)
  if (!kind || !job.submitted || !job.job_date) return null
  return {
    job_id: job.id,
    location_slug: job.location_slug,
    kind,
    job_date: job.job_date,
    week_start: mondayOf(job.job_date),
    submitted_at: job.submitted_at || null,
    submitted_by: job.submitted_by || null,
    action_plans: actionPlansFromSteps(steps),
    synced_at: new Date().toISOString(),
  }
}

module.exports = { kindForProcess, mondayOf, actionPlansFromSteps, entryFromJob }
