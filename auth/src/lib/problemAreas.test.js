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
  ops_pct: { value: 90, sample: 200 },
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
    club('Milwaukie', { ...healthy, ops_pct: { value: 2.2, sample: 224 } }),     // 2.2 against 75
  ], [], {})
  // An absolute gap would rank 38-vs-40 and 2-vs-75 by the wrong order; the
  // miss is scored as a share of the threshold so the collapse comes first.
  assert.equal(out.problems[0].club, 'Milwaukie')
  assert.equal(out.problems[0].key, 'ops_pct')
})

test('a check abstains below its minimum sample rather than crying wolf', () => {
  const out = buildProblemAreas([club('Salem', {
    ...healthy,
    dayone_close_pct: { value: 0, sample: 2 },  // 0% but only two Day Ones
  })], [], {})
  assert.equal(out.problems.length, 0)
  const s = out.skipped.find(x => x.key === 'dayone_close_pct')
  assert.ok(s, 'expected the check to be skipped, not passed')
  assert.match(s.reason, /only 2 completed Day Ones/)
})

test('missing data is skipped, never counted as a pass', () => {
  const out = buildProblemAreas([club('Milwaukie', {
    ...healthy,
    vip_pct: { value: null, sample: 100 },  // Milwaukie has no VIP fields at all
  })], [], {})
  assert.equal(out.problems.length, 0)
  // A club that cannot be measured is not a club with no problems.
  assert.equal(out.skipped.find(x => x.key === 'vip_pct').reason, 'no data')
  assert.equal(out.checksRun, CHECKS.length - 1)
})

test('an admin threshold overrides the built-in default', () => {
  const strict = buildProblemAreas([club('Salem', healthy)], [], { [settingKey('ops_pct')]: '95' })
  assert.equal(strict.problems.length, 1)
  assert.equal(strict.problems[0].threshold, 95)

  const lax = buildProblemAreas([club('Salem', { ...healthy, ops_pct: { value: 50, sample: 200 } })], [],
    { [settingKey('ops_pct')]: '10' })
  assert.equal(lax.problems.length, 0)
})

test('off is not the same as a threshold of zero', () => {
  const off = buildProblemAreas([club('Salem', { ...healthy, ops_pct: { value: 1, sample: 200 } })], [],
    { [offKey('ops_pct')]: '1' })
  assert.equal(off.problems.length, 0)
  assert.equal(off.checks.find(c => c.key === 'ops_pct').off, true)

  // A threshold of zero on a below-check fires on nothing; off removes the
  // check entirely. Both are quiet here, but only one is a deliberate silence.
  const zero = buildProblemAreas([club('Salem', { ...healthy, ops_pct: { value: 1, sample: 200 } })], [],
    { [settingKey('ops_pct')]: '0' })
  assert.equal(zero.checksRun, CHECKS.length)
})

test('problems group by club as well as by severity', () => {
  const out = buildProblemAreas([
    club('Salem', { ...healthy, dayone_book_pct: { value: 5, sample: 100 } }),
    club('Keizer', { ...healthy, vip_pct: { value: 1, sample: 100 }, ops_pct: { value: 5, sample: 200 } }),
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

test('club-only checks never fire at staff level', () => {
  // Operandio jobs carry an assignment, not an owner; naming somebody for work
  // nobody picked up would blame the wrong person.
  const out = buildProblemAreas([], [
    person('Ops Ollie', 'Operations', { ops_pct: { value: 1, sample: 500 } }),
  ], {})
  assert.equal(out.problems.length, 0)
})

test('every problem carries a department, and the counts add up', () => {
  const out = buildProblemAreas(
    [club('Salem', { ...healthy, ops_pct: { value: 10, sample: 200 } })],
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
    [club('Salem', { ...healthy, ops_pct: { value: 10, sample: 200 } })],
    [person('Sam Seller', 'Membership', { vip_pct: { value: 2, sample: 60 } })],
    {}
  )
  assert.equal(out.problems.filter(p => p.scope === 'club').length, 1)
  assert.equal(out.problems.filter(p => p.scope === 'staff').length, 1)
  assert.equal(out.problems.find(p => p.scope === 'staff').person, 'Sam Seller')
  assert.equal(out.problems.find(p => p.scope === 'club').person, null)
})
