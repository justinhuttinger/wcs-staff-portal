const test = require('node:test')
const assert = require('node:assert')
const fs = require('node:fs')
const path = require('node:path')
const { buildProblemAreas, CHECKS, settingKey, offKey, isJudgeableJob, jobDay,
} = require('./problemAreas')

// Every subject is a PERSON. Club-level rows were removed deliberately: a club
// figure is an average of the people in it, and averages are what the other
// reports are for.
const person = (name, department, metrics) =>
  ({ slug: 'salem', club: 'Salem', name, department, metrics })

const seller = (metrics, name = 'Sam Seller') => person(name, 'Membership', {
  dayone_book_pct: { value: 70, sample: 100, numerator: 70 },
  vip_pct: { value: 60, sample: 100, numerator: 60 },
  ...metrics,
})
const trainer = (metrics, name = 'Trainer Tam') => person(name, 'PT', {
  dayone_close_pct: { value: 45, sample: 50, numerator: 22 },
  dayone_open_forms: { value: 2, sample: 2 },
  ...metrics,
})
const opsPerson = (metrics, name = 'Kyra Scoggin') => person(name, 'Operations', {
  ops_jobs_below: { value: 0, sample: 20, numerator: 0 },
  ...metrics,
})

const build = (staff, settings = {}) => buildProblemAreas([], staff, settings)

test('people with nothing wrong produce nothing, and that reads as clean', () => {
  const out = build([seller(), trainer(), opsPerson()])
  assert.deepEqual(out.problems, [])
  assert.equal(out.clean, true)
  assert.ok(out.checksRun > 0)
})

test('club-level subjects are ignored entirely', () => {
  // The first argument is accepted and dropped: no check is club-scoped.
  const out = buildProblemAreas(
    [{ slug: 'salem', name: 'Salem', metrics: { vip_pct: { value: 0, sample: 500 } } }],
    [], {}
  )
  assert.equal(out.problems.length, 0)
})

test('below-threshold and above-threshold checks both fire the right way', () => {
  const out = build([
    seller({ dayone_book_pct: { value: 12, sample: 100, numerator: 12 } }),  // below 40
    trainer({ dayone_open_forms: { value: 120, sample: 120 } }),             // above 10
  ])
  const keys = out.problems.map(p => p.key).sort()
  assert.deepEqual(keys, ['dayone_book_pct', 'dayone_open_forms'])
})

test('the worst problem sorts first, measured against its own threshold', () => {
  const out = build([
    seller({ dayone_book_pct: { value: 38, sample: 100, numerator: 38 } }),  // just under 40
    opsPerson({ ops_jobs_below: { value: 40, sample: 60, numerator: 40 } }), // 40 against a tolerance of 0
  ])
  // A tolerance of zero would divide by zero and score the worst row at 0,
  // sinking it to the bottom of a list whose whole purpose is the top.
  assert.equal(out.problems[0].key, 'ops_jobs_below')
})

test('a check stays silent below its minimum sample rather than crying wolf', () => {
  const out = build([trainer({ dayone_close_pct: { value: 0, sample: 2, numerator: 0 } })])
  assert.ok(!out.problems.some(p => p.key === 'dayone_close_pct'))
})

test('judgement starts at four', () => {
  const three = build([seller({ vip_pct: { value: 0, sample: 3, numerator: 0 } })])
  assert.equal(three.problems.filter(p => p.key === 'vip_pct').length, 0)

  const four = build([seller({ vip_pct: { value: 0, sample: 4, numerator: 0 } })])
  assert.equal(four.problems.filter(p => p.key === 'vip_pct').length, 1)
})

test('missing data never fires, and never counts as a pass either', () => {
  // Milwaukie has no VIP fields at all, so its people report null rather than 0.
  const out = build([seller({ vip_pct: { value: null, sample: 100, numerator: null } })])
  assert.equal(out.problems.length, 0)
  // Not counted as a check that ran, so `clean` cannot be earned by an absent feed.
  const all = build([seller()])
  assert.ok(out.checksRun < all.checksRun)
})

test('an admin threshold overrides the built-in default', () => {
  const strict = build([seller()], { [settingKey('vip_pct')]: '80' })
  assert.equal(strict.problems.length, 1)
  assert.equal(strict.problems[0].threshold, 80)

  const lax = build([opsPerson({ ops_jobs_below: { value: 3, sample: 20, numerator: 3 } })],
    { [settingKey('ops_jobs_below')]: '10' })
  assert.equal(lax.problems.length, 0)
})

test('off is not the same as a threshold of zero', () => {
  const off = build([opsPerson({ ops_jobs_below: { value: 7, sample: 20, numerator: 7 } })],
    { [offKey('ops_jobs_below')]: '1' })
  assert.equal(off.problems.length, 0)
  assert.equal(off.checks.find(c => c.key === 'ops_jobs_below').off, true)

  // Off removes the check; a threshold merely moves the line.
  const on = build([opsPerson({ ops_jobs_below: { value: 7, sample: 20, numerator: 7 } })])
  assert.equal(on.problems.length, 1)
})

test('a person is only judged on their own department', () => {
  // A trainer has no hand in booking a Day One, so a membership metric sitting
  // on their row must not fire against them.
  const out = build([trainer({
    dayone_close_pct: { value: 5, sample: 40, numerator: 2 },
    dayone_book_pct: { value: 0, sample: 100, numerator: 0 },
  })])
  assert.deepEqual(out.problems.map(p => p.key), ['dayone_close_pct'])
})

test('a job somebody worked is attributed to them', () => {
  const out = build([opsPerson({ ops_jobs_below: { value: 6, sample: 10, numerator: 6 } })])
  assert.equal(out.problems.length, 1)
  assert.equal(out.problems[0].person, 'Kyra Scoggin')
  assert.equal(out.problems[0].value, 6)
  assert.equal(out.problems[0].sample, 10)
})

test('people with no usable name are dropped', () => {
  const out = build([
    trainer({ dayone_close_pct: { value: 1, sample: 40, numerator: 0 } }, 'Unknown'),
    trainer({ dayone_close_pct: { value: 1, sample: 40, numerator: 0 } }, '   '),
    trainer({ dayone_close_pct: { value: 1, sample: 40, numerator: 0 } }, 'Real Person'),
  ])
  // 'Unknown' on a problem list is an accusation nobody can act on.
  assert.deepEqual(out.problems.map(p => p.person), ['Real Person'])
})

test('a percentage problem carries the numbers behind it', () => {
  const out = build([seller({ dayone_book_pct: { value: 30, sample: 40, numerator: 12 } })])
  const p = out.problems.find(x => x.key === 'dayone_book_pct')
  // "12 of 40, needs 16, 4 short" — a bare 30% tells a manager nothing to act on.
  assert.equal(p.numerator, 12)
  assert.equal(p.sample, 40)
  assert.equal(p.target, 16)
  assert.equal(p.shortBy, 4)
})

test('every problem carries a department, and the counts add up', () => {
  const out = build([
    seller({ vip_pct: { value: 2, sample: 60, numerator: 1 } }),
    opsPerson({ ops_jobs_below: { value: 5, sample: 20, numerator: 5 } }),
  ])
  assert.ok(out.problems.every(p => p.department))
  const total = out.departments.reduce((a, d) => a + d.count, 0)
  assert.equal(total, out.problems.length)
  assert.equal(out.departments.find(d => d.key === 'Membership').count, 1)
  assert.equal(out.departments.find(d => d.key === 'Operations').count, 1)
})

test('people group on club AND name', () => {
  const out = build([
    { slug: 'salem', club: 'Salem', name: 'Same Name', department: 'PT',
      metrics: { dayone_close_pct: { value: 1, sample: 40, numerator: 0 } } },
    { slug: 'keizer', club: 'Keizer', name: 'Same Name', department: 'PT',
      metrics: { dayone_close_pct: { value: 1, sample: 40, numerator: 0 } } },
  ])
  // Two clubs can employ the same name; merging them would put one person's
  // numbers against another.
  assert.equal(out.byPerson.length, 2)
})

test('every problem names a person', () => {
  const out = build([
    seller({ vip_pct: { value: 1, sample: 60, numerator: 0 } }),
    trainer({ dayone_close_pct: { value: 1, sample: 40, numerator: 0 } }),
  ])
  assert.ok(out.problems.length > 0)
  assert.ok(out.problems.every(p => p.person), 'a people-only report must name everyone it flags')
  assert.ok(out.problems.every(p => p.scope === 'staff'))
})

test('the Admin tile edits exactly the keys the builder reads', () => {
  // A key invented in the Admin UI saves happily and changes nothing. That is
  // how three stats shipped permanently blank on an earlier report, so the two
  // lists are pinned to each other here rather than trusted to stay in step.
  const admin = fs.readFileSync(
    path.join(__dirname, '../../../portal/src/components/admin/ProblemThresholdsAdmin.jsx'), 'utf8')
  for (const c of CHECKS) {
    assert.ok(admin.includes(`'${settingKey(c.key)}'`),
      `ProblemThresholdsAdmin is missing a field for ${settingKey(c.key)}`)
  }
})

test('a subject can attach the rows behind its number', () => {
  const out = build([{
    slug: 'salem', club: 'Salem', name: 'Kyra Scoggin', department: 'Operations',
    metrics: { ops_jobs_below: { value: 2, sample: 10, numerator: 2 } },
    details: {
      ops_jobs_below: [
        { name: 'Closing Checklist (Daily)', pct: 12, date: '2026-08-27', via: 'rostered' },
        { name: 'Opening Checklist (Daily)', pct: 0, date: '2026-08-26', via: 'worked' },
      ],
    },
  }])
  const p = out.problems[0]
  // A count of missed checklists is not actionable until you can see which.
  assert.equal(p.details.length, 2)
  assert.equal(p.details[0].name, 'Closing Checklist (Daily)')
  assert.equal(p.details[0].via, 'rostered')
})

test('a check with no details attached carries null, not undefined', () => {
  const out = build([seller({ vip_pct: { value: 1, sample: 60, numerator: 0 } })])
  // Null so the UI can test for it plainly rather than guessing at absence.
  assert.equal(out.problems[0].details, null)
})

const { clubOffKey } = require('./problemAreas')

test('a check can be turned off for one club without touching the others', () => {
  const staff = [
    { slug: 'milwaukie', club: 'Milwaukie', name: 'M Person', department: 'Membership',
      metrics: { vip_pct: { value: 0, sample: 60, numerator: 0 } } },
    { slug: 'salem', club: 'Salem', name: 'S Person', department: 'Membership',
      metrics: { vip_pct: { value: 0, sample: 60, numerator: 0 } } },
  ]
  // Milwaukie has no VIP fields in GHL, so a VIP check there measures the setup
  // rather than the staff.
  const out = build(staff, { [clubOffKey('vip_pct', 'milwaukie')]: '1' })
  assert.deepEqual(out.problems.map(p => p.club), ['Salem'])
})

test('the global switch beats the per-club one', () => {
  const staff = [{ slug: 'salem', club: 'Salem', name: 'S', department: 'Membership',
    metrics: { vip_pct: { value: 0, sample: 60, numerator: 0 } } }]
  // Turning a check off everywhere must not require unticking it seven times.
  const out = build(staff, { [offKey('vip_pct')]: '1', [clubOffKey('vip_pct', 'keizer')]: '1' })
  assert.equal(out.problems.length, 0)
})

test('the payload says which clubs a check is off at', () => {
  const out = build([], {
    [clubOffKey('vip_pct', 'milwaukie')]: '1',
    [clubOffKey('vip_pct', 'eugene')]: '1',
  })
  const vip = out.checks.find(c => c.key === 'vip_pct')
  assert.deepEqual(vip.offClubs.sort(), ['eugene', 'milwaukie'])
  assert.equal(vip.off, false)
})


// --- a job is not a failure before it is due -----------------------------
//
// Salem at 3:12pm Pacific was being marked down for a Closing Checklist that
// does not open until 8:00pm. Month-to-date that was 110 jobs not yet due, 75
// of them below the bar and landing on somebody's name.

const AT_312PM = Date.parse('2026-08-28T22:12:00Z') // 3:12pm Pacific

test('a job whose deadline has not arrived is not judged', () => {
  const closing = {
    available_from: '2026-08-29T03:00:00Z', // 8:00pm Pacific on the 28th
    due_at: '2026-08-29T06:30:00Z',         // 11:30pm Pacific on the 28th
  }
  assert.equal(isJudgeableJob(closing, AT_312PM), false)
})

test('a job past its due time is judged', () => {
  const opening = {
    available_from: '2026-08-28T11:00:00Z',
    due_at: '2026-08-28T14:00:00Z', // 7:00am Pacific, long gone by 3:12pm
  }
  assert.equal(isJudgeableJob(opening, AT_312PM), true)
})

test('with no due_at, a job that has not opened is still not judged', () => {
  // 14 jobs of 1,623 carry no due_at.
  assert.equal(isJudgeableJob({ available_from: '2026-08-29T03:00:00Z' }, AT_312PM), false)
  assert.equal(isJudgeableJob({ available_from: '2026-08-28T11:00:00Z' }, AT_312PM), true)
})

test('a job with no timestamps at all is judged, not silently dropped', () => {
  // There is nothing to wait for, so it keeps the old behaviour rather than
  // vanishing from the report.
  assert.equal(isJudgeableJob({}, AT_312PM), true)
  assert.equal(isJudgeableJob({ due_at: null, available_from: null }, AT_312PM), true)
})

// --- the day a job belongs to is the club's day, not UTC's ----------------

test('job_date is used verbatim when present', () => {
  assert.equal(jobDay({ job_date: '2026-08-28', available_from: '2026-08-29T03:00:00Z' }), '2026-08-28')
})

test('the fallback dates the closing shift in Pacific, not UTC', () => {
  // 8:00pm Pacific on the 28th is 03:00Z on the 29th. Slicing the ISO string
  // reported a missed job dated a day in the FUTURE, which is how this was
  // spotted.
  assert.equal(jobDay({ available_from: '2026-08-29T03:00:00Z' }), '2026-08-28')
  assert.equal(jobDay({ due_at: '2026-08-29T06:30:00Z' }), '2026-08-28')
})

test('jobDay returns null rather than an invalid date', () => {
  assert.equal(jobDay({}), null)
  assert.equal(jobDay(null), null)
  assert.equal(jobDay({ available_from: 'not a date' }), null)
})
