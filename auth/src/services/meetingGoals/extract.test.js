// node --test auth/src/services/meetingGoals/extract.test.js
'use strict'

const test = require('node:test')
const assert = require('node:assert')
const { kindForProcess, mondayOf, actionPlansFromSteps, entryFromJob } = require('./extract')

test('kindForProcess maps only the two meeting processes', () => {
  assert.equal(kindForProcess('MC Weekly Meeting'), 'MC')
  assert.equal(kindForProcess('PT Weekly Meeting'), 'PT')
  assert.equal(kindForProcess('  PT Weekly Meeting  '), 'PT') // tolerates padding
})

test('kindForProcess ignores lookalike processes', () => {
  // A startsWith('PT') test would wrongly claim all of these.
  assert.equal(kindForProcess('PT Audit'), null)
  assert.equal(kindForProcess('PT - Check In'), null)
  assert.equal(kindForProcess('Membership Weekly Meeting'), null)
  assert.equal(kindForProcess(''), null)
  assert.equal(kindForProcess(undefined), null)
})

test('mondayOf anchors each day to its own week', () => {
  assert.equal(mondayOf('2026-08-24'), '2026-08-24') // Monday -> itself
  assert.equal(mondayOf('2026-08-28'), '2026-08-24') // Friday
  assert.equal(mondayOf('2026-08-30'), '2026-08-24') // Sunday stays in its week
  assert.equal(mondayOf('2026-08-31'), '2026-08-31') // next Monday
})

test('mondayOf survives a DST boundary', () => {
  // US DST ends Sun 2026-11-01; the Monday before is 2026-10-26.
  assert.equal(mondayOf('2026-11-01'), '2026-10-26')
  assert.equal(mondayOf('2026-11-02'), '2026-11-02')
})

test('actionPlansFromSteps keeps order and drops the gaps', () => {
  const steps = [
    { name: 'Action Plan 3', position: 24, response: 'third' },
    { name: 'Action Plan 1', position: 22, response: 'first' },
    { name: 'Action Plan 2', position: 23, response: '   ' },   // whitespace only
    { name: 'Action Plan 4', position: 25, response: null },
    { name: 'Action Plan 5', position: 26, response: 'fifth\n' }, // trailing newline
  ]
  assert.deepEqual(actionPlansFromSteps(steps), ['first', 'third', 'fifth'])
})

test('actionPlansFromSteps ignores every other step in the job', () => {
  const steps = [
    { name: 'Weekly Action Plan', position: 21, response: 'section header' },
    { name: 'Review Weekly Action Plan', position: 1, response: 'instruction' },
    { name: 'Coaching & Training Needs', position: 12, response: 'true' },
    { name: 'Action Plan 1', position: 22, response: 'the only one' },
  ]
  assert.deepEqual(actionPlansFromSteps(steps), ['the only one'])
})

test('actionPlansFromSteps handles a job with nothing filled in', () => {
  assert.deepEqual(actionPlansFromSteps([]), [])
  assert.deepEqual(actionPlansFromSteps(null), [])
  assert.deepEqual(actionPlansFromSteps([{ name: 'Action Plan 1', response: '' }]), [])
})

test('entryFromJob builds a row for a submitted meeting', () => {
  const job = {
    id: 'job-1', location_slug: 'salem', process_name: 'MC Weekly Meeting',
    job_date: '2026-08-28', submitted: true,
    submitted_at: '2026-08-28T17:00:00Z', submitted_by: 'Ryan Harris',
  }
  const entry = entryFromJob(job, [{ name: 'Action Plan 1', position: 22, response: 'do the thing' }])
  assert.equal(entry.job_id, 'job-1')
  assert.equal(entry.kind, 'MC')
  assert.equal(entry.location_slug, 'salem')
  assert.equal(entry.week_start, '2026-08-24')
  assert.equal(entry.submitted_by, 'Ryan Harris')
  assert.deepEqual(entry.action_plans, ['do the thing'])
})

test('entryFromJob rejects jobs that are not ours or not submitted', () => {
  const base = {
    id: 'j', location_slug: 'salem', process_name: 'MC Weekly Meeting',
    job_date: '2026-08-28', submitted: true,
  }
  assert.equal(entryFromJob({ ...base, submitted: false }, []), null)
  assert.equal(entryFromJob({ ...base, process_name: 'PT Audit' }, []), null)
  assert.equal(entryFromJob({ ...base, job_date: null }, []), null)
})

test('entryFromJob keeps an empty submission as evidence the meeting ran', () => {
  const job = {
    id: 'job-2', location_slug: 'keizer', process_name: 'PT Weekly Meeting',
    job_date: '2026-08-25', submitted: true, submitted_by: 'Someone',
  }
  const entry = entryFromJob(job, [{ name: 'Action Plan 1', position: 22, response: '  ' }])
  assert.notEqual(entry, null)
  assert.deepEqual(entry.action_plans, [])
})
