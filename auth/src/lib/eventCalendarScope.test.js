const test = require('node:test')
const assert = require('node:assert')
const { inView, canEdit, buildEventRow } = require('./eventCalendarScope')

const ev = (locations, type = 'event') => ({ type, locations })

test('a GM sees events that touch any of their clubs, and only events', () => {
  const scope = ['salem']
  assert.equal(inView(ev(['salem']), scope), true)
  assert.equal(inView(ev(['salem', 'eugene']), scope), true)
  assert.equal(inView(ev(['eugene']), scope), false)
  assert.equal(inView(ev(['salem'], 'meta_ad'), scope), false)
})

test('a GM can only edit events whose clubs are all theirs', () => {
  const scope = ['salem', 'keizer']
  assert.equal(canEdit(ev(['salem']), scope), true)
  assert.equal(canEdit(ev(['salem', 'keizer']), scope), true)
  assert.equal(canEdit(ev(['salem', 'eugene']), scope), false)
  assert.equal(canEdit(ev([]), scope), false)
})

test('corporate (null scope) sees and edits every event but no other types', () => {
  assert.equal(inView(ev(['medford']), null), true)
  assert.equal(canEdit(ev(['medford', 'salem']), null), true)
  assert.equal(canEdit(ev(['salem'], 'email'), null), false)
})

test('buildEventRow forces type event and ignores status from the client', () => {
  const { row, error } = buildEventRow({
    title: '  Bring a Friend BBQ ', type: 'meta_ad', status: 'complete',
    start_at: '2026-10-10T19:00:00.000Z', locations: ['Salem'],
    custom: { description: 'Burgers', creative_link: 'https://x' },
  }, ['salem'])
  assert.equal(error, undefined)
  assert.equal(row.type, 'event')
  assert.equal(row.title, 'Bring a Friend BBQ')
  assert.equal('status' in row, false)
  assert.deepEqual(row.locations, ['salem'])
  assert.deepEqual(row.custom, { description: 'Burgers' })
})

test('buildEventRow rejects clubs outside the caller scope with a 403', () => {
  const r = buildEventRow({ title: 'x', start_at: '2026-10-10T19:00:00.000Z', locations: ['salem', 'eugene'] }, ['salem'])
  assert.equal(r.status, 403)
})

test('buildEventRow validates title, dates and clubs', () => {
  assert.match(buildEventRow({ start_at: '2026-10-10', locations: ['salem'] }, null).error, /Title/)
  assert.match(buildEventRow({ title: 'x', locations: ['salem'] }, null).error, /Start/)
  assert.match(buildEventRow({ title: 'x', start_at: '2026-10-10', locations: ['nowhere'] }, null).error, /club/)
  assert.match(buildEventRow({ title: 'x', start_at: '2026-10-10', end_at: '2026-10-09', locations: ['salem'] }, null).error, /End/)
})
