const test = require('node:test')
const assert = require('node:assert/strict')
const {
  PT_SALE_TYPES, NO_SALE_REASONS, CANCEL_REASONS,
  validateOutcome, legacyGhlFields, pickOpenAppointments,
  linkReschedules, diffAppointment, statusFromGhl, pacificDate,
  rowFromEvent, bookerFromEvent, flattenWebhookBody, webhookLabels,
} = require('./dayOneOutcomes')

// --- the conditional form ---------------------------------------------------

test('rejects a missing or unknown status', () => {
  assert.equal(validateOutcome({}).ok, false)
  assert.equal(validateOutcome({ status: 'showed_up' }).ok, false)
})

test('no-show is complete on its own', () => {
  const r = validateOutcome({ status: 'no_show' })
  assert.equal(r.ok, true)
  assert.equal(r.value.outcome, null)
  assert.equal(r.value.pt_sale_type, null)
})

test('rescheduled is complete on its own', () => {
  assert.equal(validateOutcome({ status: 'rescheduled' }).ok, true)
})

test('completed requires a sale result', () => {
  const r = validateOutcome({ status: 'completed' })
  assert.equal(r.ok, false)
  assert.match(r.error, /sale or a no sale/i)
})

test('a sale requires what was sold, and only from the list', () => {
  assert.equal(validateOutcome({ status: 'completed', outcome: 'Sale' }).ok, false)
  assert.equal(
    validateOutcome({ status: 'completed', outcome: 'Sale', pt_sale_type: '7 Pack' }).ok,
    false,
    'an off-list package must not be accepted from a public form',
  )
  const ok = validateOutcome({ status: 'completed', outcome: 'Sale', pt_sale_type: '5 Pack' })
  assert.equal(ok.ok, true)
  assert.equal(ok.value.pt_sale_type, '5 Pack')
  assert.equal(ok.value.why_no_sale, null)
})

test('a no sale requires a reason from the curated list', () => {
  assert.equal(validateOutcome({ status: 'completed', outcome: 'No Sale' }).ok, false)
  assert.equal(
    validateOutcome({ status: 'completed', outcome: 'No Sale', why_no_sale: 'Broke af' }).ok,
    false,
    'free text must not sneak back in through the canonical field',
  )
  const ok = validateOutcome({
    status: 'completed', outcome: 'No Sale', why_no_sale: 'Cannot afford it right now',
  })
  assert.equal(ok.ok, true)
  assert.equal(ok.value.why_no_sale_other, null)
})

test('Other requires the typed reason, and keeps it', () => {
  const missing = validateOutcome({ status: 'completed', outcome: 'No Sale', why_no_sale: 'Other' })
  assert.equal(missing.ok, false)
  assert.match(missing.error, /type the reason/i)

  const ok = validateOutcome({
    status: 'completed', outcome: 'No Sale', why_no_sale: 'Other',
    why_no_sale_other: '  Waiting on a workers comp payout  ',
  })
  assert.equal(ok.ok, true)
  assert.equal(ok.value.why_no_sale, 'Other')
  assert.equal(ok.value.why_no_sale_other, 'Waiting on a workers comp payout')
})

test('a sale does not carry a no-sale reason even if one is posted', () => {
  const r = validateOutcome({
    status: 'completed', outcome: 'Sale', pt_sale_type: '1 x Week',
    why_no_sale: 'Cannot afford it right now', why_no_sale_other: 'ignored',
  })
  assert.equal(r.ok, true)
  assert.equal(r.value.why_no_sale, null)
  assert.equal(r.value.why_no_sale_other, null)
})

test('cancellation reason is optional but must be on-list when given', () => {
  assert.equal(validateOutcome({ status: 'cancelled' }).ok, true)
  assert.equal(validateOutcome({ status: 'cancelled', cancel_reason: 'Sick' }).ok, true)
  assert.equal(validateOutcome({ status: 'cancelled', cancel_reason: 'whatever' }).ok, false)
})

test('free text is capped so a pasted essay cannot reach the database', () => {
  const r = validateOutcome({
    status: 'completed', outcome: 'No Sale', why_no_sale: 'Other',
    why_no_sale_other: 'x'.repeat(5000),
  })
  assert.equal(r.ok, true)
  assert.equal(r.value.why_no_sale_other.length, 500)
})

test('every curated list is non-empty and Other sorts last where it exists', () => {
  assert.ok(PT_SALE_TYPES.length === 7)
  assert.equal(NO_SALE_REASONS.at(-1), 'Other')
  assert.equal(CANCEL_REASONS.at(-1), 'Other')
})

// --- the legacy GHL mirror --------------------------------------------------

test('a completed sale mirrors the full legacy field set', () => {
  const f = legacyGhlFields(validateOutcome({
    status: 'completed', outcome: 'Sale', pt_sale_type: '10 Pack',
  }).value)
  assert.equal(f['contact.day_one_status'], 'Completed')
  assert.equal(f['contact.show_or_no_show'], 'Show')
  assert.equal(f['contact.day_one_sale'], 'Sale')
  assert.equal(f['contact.pt_sale_type'], '10 Pack')
})

test('a no-show mirrors status and show flag but no sale fields', () => {
  const f = legacyGhlFields(validateOutcome({ status: 'no_show' }).value)
  assert.equal(f['contact.day_one_status'], 'No Show')
  assert.equal(f['contact.show_or_no_show'], 'No Show')
  assert.equal(f['contact.day_one_sale'], undefined)
})

test('a cancellation mirrors only the status, matching the old workflow', () => {
  const f = legacyGhlFields(validateOutcome({ status: 'cancelled' }).value)
  assert.deepEqual(Object.keys(f), ['contact.day_one_status'])
  assert.equal(f['contact.day_one_status'], 'Cancelled')
})

test('a reschedule puts the contact back to Scheduled', () => {
  const f = legacyGhlFields(validateOutcome({ status: 'rescheduled' }).value)
  assert.equal(f['contact.day_one_status'], 'Scheduled')
})

test('Other sends the typed text to the legacy free-text field', () => {
  const f = legacyGhlFields(validateOutcome({
    status: 'completed', outcome: 'No Sale', why_no_sale: 'Other', why_no_sale_other: 'Moving to Bend',
  }).value)
  assert.equal(f['contact.why_no_sale'], 'Moving to Bend')
})

// --- resolving which Day One the link means ---------------------------------

const NOW = new Date('2026-08-25T20:00:00Z')

test('already-recorded appointments are never offered', () => {
  const rows = [
    { id: 'done', scheduled_date: '2026-08-25', scheduled_start: '2026-08-25T17:00:00Z', outcome_recorded_at: '2026-08-25T18:00:00Z' },
    { id: 'open', scheduled_date: '2026-08-24', scheduled_start: '2026-08-24T17:00:00Z', outcome_recorded_at: null },
  ]
  assert.deepEqual(pickOpenAppointments(rows, NOW).map(r => r.id), ['open'])
})

test('a cancelled Day One is never offered, it did not happen', () => {
  // 67 rows were being offered this way: cancelled but with no outcome recorded.
  const rows = [
    { id: 'cancelled', scheduled_date: '2026-08-24', scheduled_start: '2026-08-24T17:00:00Z', status: 'cancelled', outcome_recorded_at: null },
    { id: 'live', scheduled_date: '2026-08-25', scheduled_start: '2026-08-25T17:00:00Z', status: 'scheduled', outcome_recorded_at: null },
  ]
  assert.deepEqual(pickOpenAppointments(rows, NOW).map(r => r.id), ['live'])
})

test('stale open Day Ones are not offered alongside a current one', () => {
  // 647 open rows are more than three weeks old. Nobody is filling those in, and
  // they would sit in the picker forever.
  const rows = [
    { id: 'ancient', scheduled_date: '2026-06-01', scheduled_start: '2026-06-01T17:00:00Z', outcome_recorded_at: null },
    { id: 'today', scheduled_date: '2026-08-25', scheduled_start: '2026-08-25T17:00:00Z', outcome_recorded_at: null },
  ]
  assert.deepEqual(pickOpenAppointments(rows, NOW).map(r => r.id), ['today'])
})

test('but a lone stale Day One is still offered, so a late entry is possible', () => {
  const rows = [{ id: 'ancient', scheduled_date: '2026-06-01', scheduled_start: '2026-06-01T17:00:00Z', outcome_recorded_at: null }]
  assert.deepEqual(pickOpenAppointments(rows, NOW).map(r => r.id), ['ancient'],
    'a hard window with no escape hatch would be a dead end')
})

test('two rows describing the SAME Day One collapse to one', () => {
  // The backfill and the reconciler both described 437 real Day Ones. Offering a
  // trainer two identical choices is worse than useless.
  const rows = [
    { id: 'backfill', scheduled_date: '2026-08-25', scheduled_start: null, ghl_appointment_id: null, outcome_recorded_at: null },
    { id: 'live', scheduled_date: '2026-08-25', scheduled_start: '2026-08-25T17:00:00Z', ghl_appointment_id: 'abc', outcome_recorded_at: null },
  ]
  const picked = pickOpenAppointments(rows, NOW)
  assert.equal(picked.length, 1)
  assert.equal(picked[0].id, 'live', 'the row with a real appointment id wins')
})

test('the live row wins regardless of which order they arrive in', () => {
  const rows = [
    { id: 'live', scheduled_date: '2026-08-25', ghl_appointment_id: 'abc', scheduled_start: '2026-08-25T17:00:00Z', outcome_recorded_at: null },
    { id: 'backfill', scheduled_date: '2026-08-25', ghl_appointment_id: null, scheduled_start: null, outcome_recorded_at: null },
  ]
  assert.equal(pickOpenAppointments(rows, NOW)[0].id, 'live')
})

test('a past Day One outranks a future one, because that is what is being reported', () => {
  const rows = [
    { id: 'future', scheduled_date: '2026-08-26', scheduled_start: '2026-08-26T21:00:00Z', outcome_recorded_at: null },
    { id: 'past', scheduled_date: '2026-08-25', scheduled_start: '2026-08-25T16:00:00Z', outcome_recorded_at: null },
  ]
  assert.equal(pickOpenAppointments(rows, NOW)[0].id, 'past')
})

test('two genuinely different open Day Ones are both returned, so the form can ask', () => {
  // This is what the picker is FOR: the member really did have two.
  const rows = [
    { id: 'a', scheduled_date: '2026-08-18', scheduled_start: '2026-08-18T16:00:00Z', outcome_recorded_at: null },
    { id: 'b', scheduled_date: '2026-08-25', scheduled_start: '2026-08-25T17:00:00Z', outcome_recorded_at: null },
  ]
  assert.equal(pickOpenAppointments(rows, NOW).length, 2)
})

test('a backfilled row with only a date still resolves', () => {
  const rows = [{ id: 'legacy', scheduled_date: '2026-08-20', scheduled_start: null, outcome_recorded_at: null }]
  assert.equal(pickOpenAppointments(rows, NOW)[0].id, 'legacy')
})

test('the window is configurable', () => {
  const rows = [
    { id: 'old', scheduled_date: '2026-07-20', scheduled_start: '2026-07-20T17:00:00Z', outcome_recorded_at: null },
    { id: 'new', scheduled_date: '2026-08-25', scheduled_start: '2026-08-25T17:00:00Z', outcome_recorded_at: null },
  ]
  assert.equal(pickOpenAppointments(rows, NOW).length, 1)
  assert.equal(pickOpenAppointments(rows, NOW, { windowBackDays: 60 }).length, 2)
})

test('no rows at all is an empty list, not a crash', () => {
  assert.deepEqual(pickOpenAppointments([], NOW), [])
  assert.deepEqual(pickOpenAppointments(null, NOW), [])
})

// --- reschedule stitching ---------------------------------------------------

test('cancel then rebook inside the window links as a reschedule', () => {
  const rows = [
    { id: 'old', status: 'cancelled', updated_at: '2026-08-20T10:00:00Z' },
    { id: 'new', status: 'scheduled', updated_at: '2026-08-20T14:00:00Z' },
  ]
  assert.deepEqual(linkReschedules(rows), [{ from: 'old', to: 'new' }])
})

test('rebook first then cancel the old one also links, because the gap is absolute', () => {
  const rows = [
    { id: 'new', status: 'scheduled', updated_at: '2026-08-20T10:00:00Z' },
    { id: 'old', status: 'cancelled', updated_at: '2026-08-20T14:00:00Z' },
  ]
  assert.deepEqual(linkReschedules(rows), [{ from: 'old', to: 'new' }])
})

test('a rebooking outside the window is a new Day One, not a reschedule', () => {
  const rows = [
    { id: 'old', status: 'cancelled', updated_at: '2026-06-01T10:00:00Z' },
    { id: 'new', status: 'scheduled', updated_at: '2026-08-20T10:00:00Z' },
  ]
  assert.deepEqual(linkReschedules(rows), [])
})

test('the window is configurable', () => {
  const rows = [
    { id: 'old', status: 'cancelled', updated_at: '2026-08-20T10:00:00Z' },
    { id: 'new', status: 'scheduled', updated_at: '2026-08-24T10:00:00Z' },
  ]
  assert.deepEqual(linkReschedules(rows), [], '96h apart is outside the 72h default')
  assert.deepEqual(linkReschedules(rows, { windowHours: 120 }), [{ from: 'old', to: 'new' }])
})

test('the nearest candidate wins when several are in range', () => {
  const rows = [
    { id: 'old', status: 'cancelled', updated_at: '2026-08-20T10:00:00Z' },
    { id: 'far', status: 'scheduled', updated_at: '2026-08-22T09:00:00Z' },
    { id: 'near', status: 'scheduled', updated_at: '2026-08-20T12:00:00Z' },
  ]
  assert.deepEqual(linkReschedules(rows), [{ from: 'old', to: 'near' }])
})

test('one replacement is never claimed by two cancellations', () => {
  const rows = [
    { id: 'c1', status: 'cancelled', updated_at: '2026-08-20T10:00:00Z' },
    { id: 'c2', status: 'cancelled', updated_at: '2026-08-20T11:00:00Z' },
    { id: 'new', status: 'scheduled', updated_at: '2026-08-20T12:00:00Z' },
  ]
  const links = linkReschedules(rows)
  assert.equal(links.length, 1)
  assert.equal(links[0].to, 'new')
})

test('already-linked rows are left alone so the reconciler is idempotent', () => {
  const rows = [
    { id: 'old', status: 'cancelled', updated_at: '2026-08-20T10:00:00Z', rescheduled_to_id: 'new' },
    { id: 'new', status: 'scheduled', updated_at: '2026-08-20T12:00:00Z', rescheduled_from_id: 'old' },
  ]
  assert.deepEqual(linkReschedules(rows), [])
})

test('a lone cancellation with nothing to pair against links nothing', () => {
  assert.deepEqual(linkReschedules([{ id: 'old', status: 'cancelled', updated_at: '2026-08-20T10:00:00Z' }]), [])
})

// --- diffing live GHL state against what we stored --------------------------

test('an unchanged appointment produces no history', () => {
  const row = { scheduled_start: '2026-08-25T17:00:00Z', trainer_ghl_user_id: 'u1', status: 'scheduled' }
  assert.deepEqual(diffAppointment(row, { ...row }), [])
})

test('a moved appointment records a reschedule with both times', () => {
  const stored = { scheduled_start: '2026-08-25T17:00:00Z', trainer_ghl_user_id: 'u1', status: 'scheduled' }
  const live = { ...stored, scheduled_start: '2026-08-26T17:00:00Z' }
  const [e] = diffAppointment(stored, live)
  assert.equal(e.event_type, 'rescheduled')
  assert.equal(e.from_value.scheduled_start, '2026-08-25T17:00:00Z')
  assert.equal(e.to_value.scheduled_start, '2026-08-26T17:00:00Z')
})

test('the same instant written differently is not a reschedule', () => {
  const stored = { scheduled_start: '2026-08-25T17:00:00Z', status: 'scheduled' }
  const live = { scheduled_start: '2026-08-25T10:00:00-07:00', status: 'scheduled' }
  assert.deepEqual(diffAppointment(stored, live), [])
})

test('a trainer swap records a reassignment', () => {
  const stored = { scheduled_start: '2026-08-25T17:00:00Z', trainer_ghl_user_id: 'u1', trainer_name: 'A', status: 'scheduled' }
  const live = { ...stored, trainer_ghl_user_id: 'u2', trainer_name: 'B' }
  const [e] = diffAppointment(stored, live)
  assert.equal(e.event_type, 'reassigned')
  assert.equal(e.to_value.trainer_name, 'B')
})

test('a cancellation and an un-cancellation are both recorded', () => {
  const base = { scheduled_start: '2026-08-25T17:00:00Z', status: 'scheduled' }
  assert.equal(diffAppointment(base, { ...base, status: 'cancelled' })[0].event_type, 'cancelled')
  assert.equal(diffAppointment({ ...base, status: 'cancelled' }, base)[0].event_type, 'restored')
})

test('a move and a swap in one pass record both events', () => {
  const stored = { scheduled_start: '2026-08-25T17:00:00Z', trainer_ghl_user_id: 'u1', status: 'scheduled' }
  const live = { scheduled_start: '2026-08-26T17:00:00Z', trainer_ghl_user_id: 'u2', status: 'scheduled' }
  assert.deepEqual(diffAppointment(stored, live).map(e => e.event_type), ['rescheduled', 'reassigned'])
})

// --- GHL status mapping -----------------------------------------------------

test('only cancelled is taken from the calendar', () => {
  assert.equal(statusFromGhl('cancelled'), 'cancelled')
  assert.equal(statusFromGhl('canceled'), 'cancelled')
  assert.equal(statusFromGhl('confirmed'), 'scheduled')
})

test('the calendar showed/noshow marks are ignored, because they are kept on 5% of appointments', () => {
  assert.equal(statusFromGhl('showed'), 'scheduled')
  assert.equal(statusFromGhl('noshow'), 'scheduled')
})

// --- Pacific reporting date -------------------------------------------------

test('an evening Pacific appointment stays on its own local day', () => {
  // 7pm Pacific on the 25th is already the 26th in UTC. Grouping on the UTC day
  // is the day-walk bug this column exists to prevent.
  assert.equal(pacificDate('2026-08-26T02:00:00Z'), '2026-08-25')
})

test('a morning Pacific appointment maps to the same day', () => {
  assert.equal(pacificDate('2026-08-25T17:00:00Z'), '2026-08-25')
})

test('a missing or unparseable timestamp yields null rather than a wrong day', () => {
  assert.equal(pacificDate(null), null)
  assert.equal(pacificDate('not a date'), null)
})

// --- mapping a live GHL event onto a row -------------------------------------

const loc = { slug: 'salem', id: 'loc1', name: 'Salem' }
const usersById = {
  u1: { id: 'u1', name: 'Rion Derry', email: 'rion@wcstrength.com' },
  u2: { id: 'u2', name: 'Katie Castlio', email: 'katie@wcstrength.com' },
}

// A real event shape, taken verbatim from the live Salem calendar 2026-08-25.
const EVENT = {
  id: 'BcG6jdteLwqVcHOtHngG',
  contactId: 'sNvWbM5FRM02CZqlByXO',
  calendarId: 'Gq92GXsDRAgTGZeHh7mx',
  assignedUserId: 'u1',
  appointmentStatus: 'confirmed',
  startTime: '2026-06-26T05:00:00-07:00',
  endTime: '2026-06-26T06:00:00-07:00',
  dateAdded: '2026-06-22T17:37:49.000Z',
  createdBy: { source: 'contactdetails_page', userId: 'u2' },
}

test('maps a live event onto a storable row', () => {
  const r = rowFromEvent(EVENT, { loc, usersById })
  assert.equal(r.location_slug, 'salem')
  assert.equal(r.ghl_appointment_id, 'BcG6jdteLwqVcHOtHngG')
  assert.equal(r.ghl_contact_id, 'sNvWbM5FRM02CZqlByXO')
  assert.equal(r.trainer_ghl_user_id, 'u1')
  assert.equal(r.trainer_name, 'Rion Derry')
  assert.equal(r.status, 'scheduled')
  assert.equal(r.source, 'ghl_reconcile')
})

test('the reporting date is the Pacific local day, not the UTC one', () => {
  // 5am Pacific offset means the UTC instant is noon on the same day here, but
  // an evening appointment would roll over. Assert the local day directly.
  assert.equal(rowFromEvent(EVENT, { loc, usersById }).scheduled_date, '2026-06-26')
  const evening = { ...EVENT, startTime: '2026-06-26T19:00:00-07:00' }
  assert.equal(rowFromEvent(evening, { loc, usersById }).scheduled_date, '2026-06-26')
})

test('a cancelled appointment maps to cancelled', () => {
  const r = rowFromEvent({ ...EVENT, appointmentStatus: 'cancelled' }, { loc, usersById })
  assert.equal(r.status, 'cancelled')
})

test('the calendar showed mark does not become an outcome', () => {
  const r = rowFromEvent({ ...EVENT, appointmentStatus: 'showed' }, { loc, usersById })
  assert.equal(r.status, 'scheduled')
  assert.equal(r.outcome, undefined, 'the reconciler never invents an outcome')
})

test('an unknown assigned user leaves the name blank rather than guessing', () => {
  const r = rowFromEvent({ ...EVENT, assignedUserId: 'ghost' }, { loc, usersById })
  assert.equal(r.trainer_ghl_user_id, 'ghost')
  assert.equal(r.trainer_name, null)
})

test('a staff-made booking yields the booker', () => {
  assert.deepEqual(bookerFromEvent(EVENT, usersById), {
    booked_by_name: 'Katie Castlio',
    booked_by_source: 'created_by',
  })
})

test('a widget booking yields no booker, because GHL sends userId null', () => {
  // 803 of 853 appointments measured on 2026-08-25 look exactly like this.
  const widget = { ...EVENT, createdBy: { source: 'booking_widget', userId: null } }
  assert.equal(bookerFromEvent(widget, usersById), null)
})

test('an unrecognised booker id is dropped rather than credited to nobody', () => {
  const odd = { ...EVENT, createdBy: { source: 'calendar_page', userId: 'ghost' } }
  assert.equal(bookerFromEvent(odd, usersById), null)
})

test('a missing createdBy does not throw', () => {
  assert.equal(bookerFromEvent({ ...EVENT, createdBy: undefined }, usersById), null)
  assert.equal(bookerFromEvent({}, usersById), null)
})

// --- GHL webhook body shapes ------------------------------------------------

test('a workflow action nests its Custom Data, and it is still read', () => {
  // The bug: GHL sends the "Custom Data" rows nested under customData, while a
  // form submission sends its answers top-level. Reading only the top level
  // silently sees nothing, which is what produced "Unknown or missing location"
  // on a webhook that plainly had location_slug set to salem.
  const raw = { customData: { location_slug: 'salem', contact_id: 'abc' } }
  const flat = flattenWebhookBody(raw)
  assert.equal(flat.location_slug, 'salem')
  assert.equal(flat.contact_id, 'abc')
})

test('a top-level payload still works unchanged', () => {
  const flat = flattenWebhookBody({ location_slug: 'eugene', contact_id: 'xyz' })
  assert.equal(flat.location_slug, 'eugene')
  assert.equal(flat.contact_id, 'xyz')
})

test('both shapes at once: the top level wins', () => {
  const flat = flattenWebhookBody({
    location_slug: 'eugene',
    customData: { location_slug: 'salem' },
  })
  assert.equal(flat.location_slug, 'eugene', 'a form answer is more specific than action Custom Data')
})

test('customData under its snake_case spelling is read too', () => {
  assert.equal(flattenWebhookBody({ custom_data: { contact_id: 'q' } }).contact_id, 'q')
})

test('a junk or missing customData does not throw', () => {
  assert.deepEqual(flattenWebhookBody({}), {})
  assert.equal(flattenWebhookBody({ customData: null, a: 1 }).a, 1)
  assert.equal(flattenWebhookBody({ customData: 'nope', a: 1 }).a, 1)
  assert.deepEqual(flattenWebhookBody(), {})
})

test('the diagnostic names the keys and never the values', () => {
  const raw = {
    contact_id: 'secret-id',
    customData: { location_slug: 'salem', contact_email: 'member@example.com' },
  }
  const labels = webhookLabels(raw)
  assert.match(labels, /contact_id/)
  assert.match(labels, /customData\{/)
  assert.match(labels, /location_slug/)
  assert.ok(!labels.includes('member@example.com'), 'member PII must never reach the logs')
  assert.ok(!labels.includes('secret-id'))
})

test('the diagnostic omits the customData section when there is none', () => {
  assert.equal(webhookLabels({ a: 1, b: 2 }), 'a,b')
})
