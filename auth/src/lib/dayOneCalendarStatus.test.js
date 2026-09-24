const test = require('node:test')
const assert = require('node:assert')
const { applyAppointmentRow } = require('./dayOneCalendarStatus')

// The route's shape, carrying a contact whose EARLIER Day One was cancelled.
const staleContactApt = {
  id: 'evt1',
  status: 'confirmed',
  day_one_status: 'Cancelled',
  day_one_sale: null,
  show_or_no_show: null,
  pt_sale_type: null,
  why_no_sale: null,
  day_one_booking_team_member: null,
  day_one_trainer: null,
}

test('a scheduled row overrides a stale Cancelled from the contact', () => {
  const out = applyAppointmentRow(staleContactApt, { id: 'r1', status: 'scheduled', trainer_name: 'Kirstyn', booked_by_name: 'Talya' })
  assert.strictEqual(out.day_one_status, 'Scheduled')
  assert.strictEqual(out.status, 'confirmed')
  assert.strictEqual(out.day_one_trainer, 'Kirstyn')
  assert.strictEqual(out.day_one_booking_team_member, 'Talya')
  assert.strictEqual(out.day_one_appointment_id, 'r1')
})

test('outcome fields come from the row, never the contact', () => {
  const apt = { ...staleContactApt, day_one_status: 'Completed', day_one_sale: 'Sale', show_or_no_show: 'Show', pt_sale_type: '12 pack' }
  const out = applyAppointmentRow(apt, { id: 'r2', status: 'scheduled' })
  assert.strictEqual(out.day_one_sale, null)
  assert.strictEqual(out.show_or_no_show, null)
  assert.strictEqual(out.pt_sale_type, null)
})

test('completed and no-show rows map to the legacy labels', () => {
  const done = applyAppointmentRow(staleContactApt, { id: 'r3', status: 'completed', outcome: 'No Sale', why_no_sale: 'Price' })
  assert.strictEqual(done.day_one_status, 'Completed')
  assert.strictEqual(done.show_or_no_show, 'Show')
  assert.strictEqual(done.day_one_sale, 'No Sale')
  assert.strictEqual(done.why_no_sale, 'Price')

  const ns = applyAppointmentRow(staleContactApt, { id: 'r4', status: 'no_show' })
  assert.strictEqual(ns.day_one_status, 'No Show')
  assert.strictEqual(ns.show_or_no_show, 'No Show')
})

test('a cancelled row marks the event cancelled', () => {
  const out = applyAppointmentRow({ ...staleContactApt, day_one_status: null }, { id: 'r5', status: 'cancelled' })
  assert.strictEqual(out.day_one_status, 'Cancelled')
  assert.strictEqual(out.status, 'cancelled')
})

test('no row keeps the contact fallback and does not copy', () => {
  assert.strictEqual(applyAppointmentRow(staleContactApt, null), staleContactApt)
  const out = applyAppointmentRow(staleContactApt, { id: 'r6', status: 'scheduled' })
  assert.notStrictEqual(out, staleContactApt)
  assert.strictEqual(staleContactApt.day_one_status, 'Cancelled')
})
