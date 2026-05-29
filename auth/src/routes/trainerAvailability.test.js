const { test } = require('node:test')
const assert = require('node:assert')
const { buildPriorityUpdateBody } = require('./trainerAvailabilityHelpers')

// node:test + node:assert, CommonJS. Run with `node --test`.
//
// Regression: changing a trainer's round-robin priority on the Day One calendar
// must NOT reset the calendar's booking-config scalars. GHL's PUT /calendars/:id
// reverts omitted scalars (slotDuration etc.) to its 30-min default, so the body
// MUST re-send them from the freshly-read calendar.

// Shape mirrors a real GHL GET /calendars/:id for a round-robin "Day One" calendar.
function sampleCal() {
  return {
    id: 'cal_123',
    name: 'Day One',
    calendarType: 'round_robin',
    eventType: 'RoundRobin_OptimizeForAvailability',
    eventColor: '#039be5',
    eventTitle: null,
    slotDuration: 60,
    slotDurationUnit: 'mins',
    slotInterval: 60,
    slotIntervalUnit: 'mins',
    slotBuffer: null,
    slotBufferUnit: 'mins',
    appoinmentPerSlot: 1,
    appoinmentPerDay: null,
    autoConfirm: true,
    slug: 'day-one-salem',
    widgetSlug: 'day-one-salem',
    isActive: true,
    openHours: [{ daysOfTheWeek: [1, 2, 3], hours: [{ openHour: 9, openMinute: 0, closeHour: 17, closeMinute: 0 }] }],
    notifications: [{ type: 'email', shouldSendToContact: true }],
    locationConfigurations: [{ kind: 'physical' }],
    teamMembers: [
      { userId: 'u1', priority: 0.5, isPrimary: true, locationConfigurations: [{ kind: 'physical' }] },
      { userId: 'u2', priority: 0.5, isPrimary: false },
    ],
  }
}

test('preserves slotDuration when changing a priority', () => {
  const body = buildPriorityUpdateBody(sampleCal(), 'u1', 1)
  assert.strictEqual(body.slotDuration, 60, 'slotDuration must be re-sent as 60, not dropped')
  assert.strictEqual(body.slotDurationUnit, 'mins')
})

test('preserves the rest of the booking-config scalars', () => {
  const body = buildPriorityUpdateBody(sampleCal(), 'u1', 1)
  assert.strictEqual(body.slotInterval, 60)
  assert.strictEqual(body.slotIntervalUnit, 'mins')
  assert.strictEqual(body.appoinmentPerSlot, 1)
  assert.strictEqual(body.autoConfirm, true)
  assert.strictEqual(body.eventType, 'RoundRobin_OptimizeForAvailability')
})

test('updates only the target trainer priority and keeps the team set intact', () => {
  const body = buildPriorityUpdateBody(sampleCal(), 'u1', 1)
  const u1 = body.teamMembers.find(m => m.userId === 'u1')
  const u2 = body.teamMembers.find(m => m.userId === 'u2')
  assert.strictEqual(u1.priority, 1, 'target priority changed')
  assert.strictEqual(u1.isPrimary, true, 'other member fields preserved')
  assert.strictEqual(u2.priority, 0.5, 'non-target priority untouched')
  assert.strictEqual(body.teamMembers.length, 2)
})

test('does NOT echo nested fields that the prior full-object PUT corrupted', () => {
  // GHL preserves these when omitted (proven: teamMembers-only PUT never wiped openHours).
  // Re-sending them is what broke the earlier full-object approach, so they must stay out.
  const body = buildPriorityUpdateBody(sampleCal(), 'u1', 1)
  assert.strictEqual(body.openHours, undefined)
  assert.strictEqual(body.notifications, undefined)
  assert.strictEqual(body.locationConfigurations, undefined)
  assert.strictEqual(body.id, undefined)
})
