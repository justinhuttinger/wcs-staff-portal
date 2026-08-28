const test = require('node:test')
const assert = require('node:assert')
const { buildCompliance, median } = require('./complianceAnalytics')

const row = (slug, over = {}) => ({
  month: '2026-08-01',
  slug,
  jobs: 100, decided: 90, on_time: 60, late: 10, missed: 20, not_yet_due: 10,
  steps_total: 1000, steps_done: 800,
  ...over,
})

test('median handles both parities and ignores nulls', () => {
  assert.equal(median([1, 2, 3]), 2)
  assert.equal(median([1, 2, 3, 4]), 2.5)
  assert.equal(median([null, 5, null]), 5)
  assert.equal(median([]), null)
})

test('rates come from decided jobs, never from all jobs', () => {
  // 10 of the 100 are not yet due. Judging them would be judging work that
  // cannot have been done.
  const out = buildCompliance([row('salem')], [], [])
  assert.equal(out.summary.decided, 90)
  assert.equal(out.summary.notYetDue, 10)
  assert.equal(out.summary.onTimeRate, 66.7)   // 60/90
  assert.equal(out.summary.taskPct, 80)        // 800/1000
})

// --- the outlier rule ------------------------------------------------------
//
// In August six clubs sat between 72% and 87% and Milwaukie sat at 3.8%, which
// dragged the pooled company figure to 56%. One headline number would have
// described a problem six of seven clubs do not have.

test('a club far below the median is named, not just flagged', () => {
  const out = buildCompliance([
    row('salem', { steps_total: 1000, steps_done: 869 }),
    row('eugene', { steps_total: 1000, steps_done: 759 }),
    row('medford', { steps_total: 1000, steps_done: 724 }),
    row('milwaukie', { steps_total: 1000, steps_done: 38 }),
  ], [], [])

  assert.equal(out.outliers.length, 1)
  assert.equal(out.outliers[0].slug, 'milwaukie')
  // Named with its number, because "the average is distorted" is not actionable
  // and "Milwaukie is at 3.8%" is.
  assert.match(out.notes.outlier, /milwaukie \(3\.8%\)/)
  assert.match(out.notes.outlier, /median club is at/)
})

test('the median is reported beside the pooled figure', () => {
  const out = buildCompliance([
    row('salem', { steps_total: 1000, steps_done: 869 }),
    row('eugene', { steps_total: 1000, steps_done: 759 }),
    row('milwaukie', { steps_total: 1000, steps_done: 38 }),
  ], [], [])

  // Pooled is dragged down; the median is not. Both travel together so the
  // reader can see the gap rather than trust one number.
  assert.equal(out.summary.taskPct, 55.5)
  assert.equal(out.summary.medianClubTaskPct, 75.9)
  assert.ok(out.summary.medianClubTaskPct > out.summary.taskPct)
})

test('clubs that are merely behind are not called outliers', () => {
  const out = buildCompliance([
    row('salem', { steps_total: 1000, steps_done: 869 }),
    row('eugene', { steps_total: 1000, steps_done: 759 }),
    row('medford', { steps_total: 1000, steps_done: 724 }),
  ], [], [])
  assert.deepEqual(out.outliers, [])
  assert.equal(out.notes.outlier, null)
})

test('clubs are ranked best first by task completion', () => {
  const out = buildCompliance([
    row('milwaukie', { steps_total: 1000, steps_done: 38 }),
    row('salem', { steps_total: 1000, steps_done: 869 }),
  ], [], [])
  assert.deepEqual(out.byClub.map(c => c.slug), ['salem', 'milwaukie'])
})

// --- checklists ------------------------------------------------------------

test('checklists keep their club so one club is not read as all seven', () => {
  const out = buildCompliance([row('milwaukie')], [
    { name: 'Daily Club Closing Checklist', slug: 'milwaukie', jobs: 88, decided: 88,
      missed: 88, steps_total: 2581, steps_done: 0, task_pct: 0 },
  ], [])

  const c = out.checklists[0]
  assert.equal(c.slug, 'milwaukie')
  assert.equal(c.taskPct, 0)
})

test('a checklist never once started is separated from one merely behind', () => {
  const out = buildCompliance([row('milwaukie')], [
    { name: 'Never Opened', slug: 'milwaukie', jobs: 88, decided: 88, missed: 88,
      steps_total: 2581, steps_done: 0, task_pct: 0 },
    { name: 'Behind', slug: 'salem', jobs: 30, decided: 30, missed: 5,
      steps_total: 600, steps_done: 400, task_pct: 66.7 },
  ], [])

  assert.equal(out.neverStarted.length, 1)
  assert.equal(out.neverStarted[0].name, 'Never Opened')
})

test('a checklist with no steps at all is not counted as never started', () => {
  // Zero of zero is not a failure to act; there was nothing to do.
  const out = buildCompliance([row('salem')], [
    { name: 'Empty', slug: 'salem', jobs: 5, decided: 5, missed: 0,
      steps_total: 0, steps_done: 0, task_pct: null },
  ], [])
  assert.deepEqual(out.neverStarted, [])
})

// --- misc ------------------------------------------------------------------

test('day of week is named and carries its rate', () => {
  const out = buildCompliance([], [], [
    { dow: 0, decided: 526, task_pct: 54 },
    { dow: 5, decided: 650, task_pct: 62.1 },
  ])
  assert.equal(out.dow[0].label, 'Sunday')
  assert.equal(out.dow[1].taskPct, 62.1)
})

test('period change is null with no prior rather than a fake zero', () => {
  const out = buildCompliance([row('salem')], [], [], { priorMonthly: [] })
  assert.equal(out.summary.priorTaskPct, null)
  assert.equal(out.summary.taskPctChange, null)
})

test('the trend uses its own window when one is supplied', () => {
  const out = buildCompliance([row('salem')], [], [], {
    trendMonthly: [
      row('salem', { month: '2026-07-01', steps_total: 100, steps_done: 50 }),
      row('salem', { month: '2026-06-01', steps_total: 100, steps_done: 40 }),
    ],
  })
  assert.deepEqual(out.months.map(m => m.month), ['2026-06-01', '2026-07-01'])
  assert.equal(out.months[0].taskPct, 40)
})
