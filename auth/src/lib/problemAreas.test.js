const test = require('node:test')
const assert = require('node:assert')
const fs = require('node:fs')
const path = require('node:path')
const { buildProblemAreas, CHECKS, settingKey, offKey } = require('./problemAreas')

const club = (name, metrics) => ({ slug: name.toLowerCase(), name, metrics })

// Everything healthy, with samples above every minimum.
const healthy = {
  dayone_book_pct: { value: 70, sample: 100 },
  vip_pct: { value: 60, sample: 100 },
  dayone_close_pct: { value: 45, sample: 50 },
  dayone_open_forms: { value: 2, sample: 2 },
  ops_jobs_below: { value: 0, sample: 200 },
}

test('a healthy club produces nothing and is reported as clean', () => {
  const out = buildProblemAreas([club('Salem', healthy)], [], {})
  assert.deepEqual(out.problems, [])
  assert.equal(out.clean, true)
  assert.equal(out.checksRun, CHECKS.length)
})

test('below-threshold and above-threshold checks both fire the right way', () => {
  const out = buildProblemAreas([club('Salem', {
    ...healthy,
    dayone_book_pct: { value: 12, sample: 100 },   // below 40 -> fires
    dayone_open_forms: { value: 120, sample: 120 }, // above 10 -> fires
  })], [], {})
  const keys = out.problems.map(p => p.key)
  assert.ok(keys.includes('dayone_book_pct'))
  assert.ok(keys.includes('dayone_open_forms'))
  assert.equal(out.problems.length, 2)
})

test('the worst problem sorts first, measured against its own threshold', () => {
  const out = buildProblemAreas([
    club('Salem', { ...healthy, dayone_book_pct: { value: 38, sample: 100 } }),  // just under 40
    club('Milwaukie', { ...healthy, ops_jobs_below: { value: 40, sample: 224 } }),     // 2.2 against 75
  ], [], {})
  // An absolute gap would rank 38-vs-40 and 2-vs-75 by the wrong order; the
  // miss is scored as a share of the threshold so the collapse comes first.
  assert.equal(out.problems[0].club, 'Milwaukie')
  assert.equal(out.problems[0].key, 'ops_jobs_below')
})

test('a check abstains below its minimum sample rather than crying wolf', () => {
  const out = buildProblemAreas([club('Salem', {
    ...healthy,
    dayone_close_pct: { value: 0, sample: 2 },  // 0% but only two Day Ones
  })], [], {})
  // Silent, not listed: the check simply does not fire on two Day Ones.
  assert.equal(out.problems.length, 0)
  assert.ok(!out.problems.some(p => p.key === 'dayone_close_pct'))
})

test('missing data never fires, and never counts as a pass either', () => {
  const out = buildProblemAreas([club('Milwaukie', {
    ...healthy,
    vip_pct: { value: null, sample: 100 },  // Milwaukie has no VIP fields at all
  })], [], {})
  assert.equal(out.problems.length, 0)
  // A club that cannot be measured is not a club with no problems: the check is
  // not counted as having run, so `clean` cannot be earned by an absent feed.
  assert.equal(out.checksRun, CHECKS.length - 1)
})

test('an admin threshold overrides the built-in default', () => {
  // Healthy VIP collection is 60%; demanding 80% turns it into a problem.
  const strict = buildProblemAreas([club('Salem', healthy)], [], { [settingKey('vip_pct')]: '80' })
  assert.equal(strict.problems.length, 1)
  assert.equal(strict.problems[0].threshold, 80)

  // And a tolerance above the value makes a real miss acceptable.
  const lax = buildProblemAreas(
    [club('Salem', { ...healthy, ops_jobs_below: { value: 3, sample: 200 } })], [],
    { [settingKey('ops_jobs_below')]: '10' })
  assert.equal(lax.problems.length, 0)
})

test('off is not the same as a threshold of zero', () => {
  const off = buildProblemAreas([club('Salem', { ...healthy, ops_jobs_below: { value: 7, sample: 200 } })], [],
    { [offKey('ops_jobs_below')]: '1' })
  assert.equal(off.problems.length, 0)
  assert.equal(off.checks.find(c => c.key === 'ops_jobs_below').off, true)

  // A threshold of zero on a below-check fires on nothing; off removes the
  // check entirely. Both are quiet here, but only one is a deliberate silence.
  const zero = buildProblemAreas([club('Salem', { ...healthy, ops_jobs_below: { value: 7, sample: 200 } })], [],
    { [settingKey('ops_jobs_below')]: '0' })
  assert.equal(zero.checksRun, CHECKS.length)
})

test('problems group by club as well as by severity', () => {
  const out = buildProblemAreas([
    club('Salem', { ...healthy, dayone_book_pct: { value: 5, sample: 100 } }),
    club('Keizer', { ...healthy, vip_pct: { value: 1, sample: 100 }, ops_jobs_below: { value: 9, sample: 200 } }),
  ], [], {})
  // Four problems at one club is a different conversation from one each at four.
  assert.equal(out.byClub[0].club, 'Keizer')
  assert.equal(out.byClub[0].problems.length, 2)
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

// ---------------------------------------------------------------------------
// Departments and staff

const person = (name, department, metrics) =>
  ({ slug: 'salem', club: 'Salem', name, department, metrics })

test('a staff row is only judged on its own department', () => {
  // A trainer has no hand in booking a Day One, so a membership metric sitting
  // on their row must not fire against them.
  const out = buildProblemAreas([], [
    person('Trainer Tam', 'PT', {
      dayone_close_pct: { value: 5, sample: 40 },
      dayone_book_pct: { value: 0, sample: 100 },
    }),
  ], {})
  assert.deepEqual(out.problems.map(p => p.key), ['dayone_close_pct'])
})

test('a job somebody worked IS attributed to them', () => {
  // The counterpart to the club case: a below-standard job with a name on it
  // belongs to that person. Jobs nobody touched have no name and stay at club
  // level, which the route handles by never building a staff row for them.
  const out = buildProblemAreas([], [
    person('Kyra Scoggin', 'Operations', { ops_jobs_below: { value: 6, sample: 10 } }),
  ], {})
  assert.equal(out.problems.length, 1)
  assert.equal(out.problems[0].person, 'Kyra Scoggin')
  assert.equal(out.problems[0].value, 6)
  assert.equal(out.problems[0].sample, 10)
})

test('people with no usable name are dropped', () => {
  const out = buildProblemAreas([], [
    person('Unknown', 'PT', { dayone_close_pct: { value: 1, sample: 40 } }),
    person('   ', 'PT', { dayone_close_pct: { value: 1, sample: 40 } }),
    person('Real Person', 'PT', { dayone_close_pct: { value: 1, sample: 40 } }),
  ], {})
  // 'Unknown' on a problem list is an accusation nobody can act on.
  assert.deepEqual(out.problems.map(p => p.person), ['Real Person'])
})

test('a percentage problem carries the numbers behind it', () => {
  const out = buildProblemAreas([club('Salem', {
    ...healthy,
    dayone_book_pct: { value: 30, sample: 40, numerator: 12 },
  })], [], {})
  const p = out.problems.find(x => x.key === 'dayone_book_pct')
  // "12 of 40, needs 16, 4 short" — a bare 30% tells a manager nothing they can
  // act on.
  assert.equal(p.numerator, 12)
  assert.equal(p.sample, 40)
  assert.equal(p.target, 16)
  assert.equal(p.shortBy, 4)
})

test('judgement starts at four', () => {
  const three = buildProblemAreas([club('Salem', {
    ...healthy, vip_pct: { value: 0, sample: 3, numerator: 0 },
  })], [], {})
  assert.equal(three.problems.filter(p => p.key === 'vip_pct').length, 0)

  const four = buildProblemAreas([club('Salem', {
    ...healthy, vip_pct: { value: 0, sample: 4, numerator: 0 },
  })], [], {})
  assert.equal(four.problems.filter(p => p.key === 'vip_pct').length, 1)
})

test('every problem carries a department, and the counts add up', () => {
  const out = buildProblemAreas(
    [club('Salem', { ...healthy, ops_jobs_below: { value: 12, sample: 200 } })],
    [person('Sam Seller', 'Membership', { vip_pct: { value: 2, sample: 60 } })],
    {}
  )
  assert.ok(out.problems.every(p => p.department))
  const total = out.departments.reduce((a, d) => a + d.count, 0)
  assert.equal(total, out.problems.length)
  assert.equal(out.departments.find(d => d.key === 'Operations').count, 1)
  assert.equal(out.departments.find(d => d.key === 'Membership').count, 1)
})

test('staff problems group by person, keyed on club as well as name', () => {
  const out = buildProblemAreas([], [
    { slug: 'salem', club: 'Salem', name: 'Same Name', department: 'PT',
      metrics: { dayone_close_pct: { value: 1, sample: 40 } } },
    { slug: 'keizer', club: 'Keizer', name: 'Same Name', department: 'PT',
      metrics: { dayone_close_pct: { value: 1, sample: 40 } } },
  ], {})
  // Two clubs can employ the same name; merging them would blame one person for
  // another person's numbers.
  assert.equal(out.byPerson.length, 2)
})

test('club and staff rows are separable by scope', () => {
  const out = buildProblemAreas(
    [club('Salem', { ...healthy, ops_jobs_below: { value: 12, sample: 200 } })],
    [person('Sam Seller', 'Membership', { vip_pct: { value: 2, sample: 60 } })],
    {}
  )
  assert.equal(out.problems.filter(p => p.scope === 'club').length, 1)
  assert.equal(out.problems.filter(p => p.scope === 'staff').length, 1)
  assert.equal(out.problems.find(p => p.scope === 'staff').person, 'Sam Seller')
  assert.equal(out.problems.find(p => p.scope === 'club').person, null)
})
