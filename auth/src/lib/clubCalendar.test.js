const test = require('node:test')
const assert = require('node:assert')
const { shortName, shortFromFull, toEntries, buildClubCalendar } = require('./clubCalendar')

test('names shrink to first name + last initial', () => {
  assert.strictEqual(shortName('Justin', 'Huttinger'), 'Justin H.')
  assert.strictEqual(shortName('Justin', ''), 'Justin')
  assert.strictEqual(shortName('samantha', 'wells'), 'Samantha W.')
  assert.strictEqual(shortName('', ''), '')
  assert.strictEqual(shortFromFull('Mary Ann van Dyke'), 'Mary A.')
  assert.strictEqual(shortFromFull(''), '')
})

test('entries carry no contact details, and cancelled ones are dropped', () => {
  const events = [
    { id: 'e2', startTime: '2026-09-30T18:00:00Z', contactId: 'c1', assignedUserId: 'u1', appointmentStatus: 'confirmed',
      contactEmail: 'x@y.com', contactPhone: '+1503', notes: 'secret' },
    { id: 'e1', startTime: '2026-09-30T16:00:00Z', contactName: 'Pat Caller', appointmentStatus: 'showed' },
    { id: 'e3', startTime: '2026-09-30T17:00:00Z', contactId: 'c1', appointmentStatus: 'cancelled' },
  ]
  const out = buildClubCalendar(toEntries(events, 'Tour', { c1: { first_name: 'Ann', last_name: 'Lee' } }, { u1: 'Kirstyn' }))
  assert.deepStrictEqual(out.map(e => [e.id, e.name, e.staff, e.status]), [
    ['e1', 'Pat C.', null, 'showed'],
    ['e2', 'Ann L.', 'Kirstyn', 'confirmed'],
  ])
  for (const e of out) {
    assert.deepStrictEqual(Object.keys(e).sort(), ['end', 'id', 'name', 'staff', 'start', 'status', 'type'])
  }
})
