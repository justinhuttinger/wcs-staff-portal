const test = require('node:test')
const assert = require('node:assert')
const { canSeeProgram, canEditProgram, copyFields, treeFromRows } = require('./coachingAccess')

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
