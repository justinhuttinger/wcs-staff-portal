const test = require('node:test')
const assert = require('node:assert')
const { canSeeProgram, canEditProgram, copyFields, treeFromRows, programsToReplace, pacificDate, shiftDate } = require('./coachingAccess')

const ME = '11111111-1111-4111-8111-111111111111'
const OTHER = '22222222-2222-4222-8222-222222222222'

const wcsTemplate = { id: 't1', kind: 'template', owner_staff_id: null, name: 'PPL' }
const myTemplate = { id: 't2', kind: 'template', owner_staff_id: ME, name: 'Mine' }
const theirTemplate = { id: 't3', kind: 'template', owner_staff_id: OTHER, name: 'Theirs' }
const client = { id: 'c1', kind: 'client', member_id: 'm1', club_number: '30935', name: 'Block 1', source_template_id: 't1' }

const trainer = { staffId: ME, isManager: false }
const manager = { staffId: ME, isManager: true }

test('templates: the WCS library and my own are visible, another trainer\'s is not', () => {
  assert.equal(canSeeProgram(wcsTemplate, trainer), true)
  assert.equal(canSeeProgram(myTemplate, trainer), true)
  assert.equal(canSeeProgram(theirTemplate, trainer), false)
  assert.equal(canSeeProgram(theirTemplate, manager), true)
  assert.equal(canSeeProgram(null, manager), false)
})

test('only managers edit the WCS library; a private template by its owner or a manager', () => {
  assert.equal(canEditProgram(wcsTemplate, trainer), false)
  assert.equal(canEditProgram(wcsTemplate, manager), true)
  assert.equal(canEditProgram(myTemplate, trainer), true)
  assert.equal(canEditProgram(theirTemplate, trainer), false)
  assert.equal(canEditProgram(theirTemplate, manager), true)
  assert.equal(canEditProgram(client, trainer), true)
})

test('copyFields: template -> client is an assignment', () => {
  const { fields, error } = copyFields(wcsTemplate, { kind: 'client', member_id: 'm9', club_number: 30935, starts_on: '2026-11-02' }, ME)
  assert.equal(error, undefined)
  assert.equal(fields.kind, 'client')
  assert.equal(fields.member_id, 'm9')
  assert.equal(fields.club_number, '30935')
  assert.equal(fields.source_template_id, 't1')
  assert.equal(fields.owner_staff_id, null)
  assert.equal(fields.starts_on, '2026-11-02')
  assert.equal(fields.name, 'PPL')
})

test('copyFields: a client copy needs a member and club', () => {
  assert.ok(copyFields(wcsTemplate, { kind: 'client' }, ME).error)
  assert.ok(copyFields(wcsTemplate, { kind: 'nope' }, ME).error)
})

test('copyFields: client -> template saves to my templates', () => {
  const { fields } = copyFields(client, { kind: 'template', name: ' Keeper ' }, ME)
  assert.equal(fields.kind, 'template')
  assert.equal(fields.member_id, null)
  assert.equal(fields.club_number, null)
  assert.equal(fields.owner_staff_id, ME)
  assert.equal(fields.source_template_id, null)
  assert.equal(fields.name, 'Keeper')
})

test('copyFields: template -> template is a private duplicate; client -> client keeps the source template', () => {
  const dup = copyFields(wcsTemplate, { kind: 'template' }, ME).fields
  assert.equal(dup.owner_staff_id, ME)
  assert.equal(dup.name, 'PPL (copy)')
  const again = copyFields(client, { kind: 'client', member_id: 'm1', club_number: '30935' }, ME).fields
  assert.equal(again.source_template_id, 't1')
})

test('treeFromRows builds the normalised tree shape from stored rows', () => {
  const tree = treeFromRows(
    { name: 'P', overview: null, tags: ['a'], goal: null, level: null, equipment: null, days_per_week: 3, starts_on: null, ends_on: null },
    [{ id: 'd2', position: 1, name: 'B', instructions: null }, { id: 'd1', position: 0, name: 'A', instructions: 'x' }],
    [
      { id: 'i2', day_id: 'd1', position: 1, section: 'workout', exercise_id: 'e2', sets: 3 },
      { id: 'i1', day_id: 'd1', position: 0, section: 'warmup', exercise_id: 'e1', sets: 1 },
    ],
  )
  assert.deepEqual(tree.days.map(d => d.id), ['d1', 'd2'])
  assert.deepEqual(tree.days[0].items.map(i => i.id), ['i1', 'i2'])
  assert.equal(tree.days[0].items[0].day_id, undefined)
  assert.deepEqual(tree.days[1].items, [])
  assert.equal(tree.program.days_per_week, 3)
})

test('copyFields: starts_on must be a real YYYY-MM-DD date', () => {
  const body = (starts_on) => ({ kind: 'client', member_id: 'm1', club_number: '30935', starts_on })
  assert.equal(copyFields(wcsTemplate, body('2026-11-02'), ME).fields.starts_on, '2026-11-02')
  assert.equal(copyFields(wcsTemplate, body(null), ME).fields.starts_on, null)
  assert.equal(copyFields(wcsTemplate, body(''), ME).fields.starts_on, null)
  for (const bad of ['2026-02-30', 'tomorrow', '11/02/2026', 20261102]) {
    assert.match(copyFields(wcsTemplate, body(bad), ME).error, /start date/i, String(bad))
  }
})

test('copyFields: coach_staff_id must be a uuid', () => {
  const body = (coach_staff_id) => ({ kind: 'client', member_id: 'm1', club_number: '30935', coach_staff_id })
  assert.equal(copyFields(wcsTemplate, body(OTHER), ME).fields.coach_staff_id, OTHER)
  assert.equal(copyFields(wcsTemplate, body(''), ME).fields.coach_staff_id, null)
  assert.match(copyFields(wcsTemplate, body('bob'), ME).error, /coach/i)
  assert.match(copyFields(wcsTemplate, body("x' or 1=1"), ME).error, /coach/i)
})

test('treeFromRows renumbers duplicate or gapped positions so copies keep their order', () => {
  const tree = treeFromRows(
    { name: 'P' },
    [{ id: 'd1', position: 0, name: 'A' }, { id: 'd2', position: 0, name: 'B' }, { id: 'd3', position: 5, name: 'C' }],
    [
      { id: 'i1', day_id: 'd2', position: 1, exercise_id: 'e1' },
      { id: 'i2', day_id: 'd2', position: 1, exercise_id: 'e2' },
      { id: 'i3', day_id: 'd3', position: 9, exercise_id: 'e3' },
    ],
  )
  assert.deepEqual(tree.days.map(d => [d.id, d.position]), [['d1', 0], ['d2', 1], ['d3', 2]])
  assert.deepEqual(tree.days[1].items.map(i => [i.id, i.position]), [['i1', 0], ['i2', 1]])
  assert.deepEqual(tree.days[2].items.map(i => i.position), [0])
})

test('pacificDate and shiftDate work in Pacific calendar days', () => {
  // 2026-10-20 03:00 UTC is still the 19th in Los Angeles.
  assert.equal(pacificDate(new Date('2026-10-20T03:00:00Z')), '2026-10-19')
  assert.equal(shiftDate('2026-10-19', -1), '2026-10-18')
  assert.equal(shiftDate('2026-03-01', -1), '2026-02-28')
  assert.equal(shiftDate('2026-01-01', -1), '2025-12-31')
})

test('programsToReplace ends the member\'s other programs that are live today', () => {
  const today = '2026-10-19'
  const p = (id, over) => ({ id, kind: 'client', is_active: true, starts_on: null, ends_on: null, ...over })
  const programs = [
    p('new'),                                         // the one just assigned
    p('open'),                                        // no dates: live
    p('started', { starts_on: '2026-09-01' }),        // started, open-ended
    p('endsLater', { starts_on: '2026-09-01', ends_on: '2026-11-30' }),
    p('endsToday', { ends_on: today }),               // still live today
    p('startedToday', { starts_on: today }),          // live, but ending yesterday would precede its start
    p('ended', { ends_on: '2026-10-18' }),            // already over
    p('future', { starts_on: '2026-10-20' }),         // queued, not live
    p('archived', { is_active: false }),
    { ...p('tmpl'), kind: 'template' },
  ]
  const out = programsToReplace(programs, today, 'new')
  assert.deepEqual(out, [
    { id: 'open', patch: { ends_on: '2026-10-18' } },
    { id: 'started', patch: { ends_on: '2026-10-18' } },
    { id: 'endsLater', patch: { ends_on: '2026-10-18' } },
    { id: 'endsToday', patch: { ends_on: '2026-10-18' } },
    { id: 'startedToday', patch: { is_active: false } },
  ])
})

test('coachForClientProgram: only managers may name the coach on a client program', () => {
  const { coachForClientProgram } = require('./coachingAccess')
  const COACH = '33333333-3333-4333-8333-333333333333'
  // A trainer's body coach_staff_id is ignored: the client's coach, else them.
  assert.equal(coachForClientProgram({ requested: OTHER, clientCoach: COACH, staffId: ME, isManager: false }), COACH)
  assert.equal(coachForClientProgram({ requested: OTHER, clientCoach: null, staffId: ME, isManager: false }), ME)
  // A manager may pick one.
  assert.equal(coachForClientProgram({ requested: OTHER, clientCoach: COACH, staffId: ME, isManager: true }), OTHER)
  assert.equal(coachForClientProgram({ requested: '', clientCoach: COACH, staffId: ME, isManager: true }), COACH)
  assert.equal(coachForClientProgram({ requested: null, clientCoach: null, staffId: null, isManager: true }), null)
})
