// Ingest a Day One booking pushed from a GHL workflow.
//
// THE COURIER PATTERN, AND WHY THE CUSTOM FIELD SURVIVES
// 94% of Day Ones are created by GHL's own booking widget, and those appointments
// carry createdBy.userId = null (measured 2026-08-25: 803 of 853). So the booking
// team member simply cannot be read off the appointment for the common case. The
// only place it exists is contact.day_one_booking_team_member, written by the
// booking form.
//
// That field therefore stays, but demoted from a STORE to a COURIER: GHL fills
// it, this endpoint drains it into day_one_appointments, and then clears it.
// Nothing ever reads it for reporting again.
//
// Clearing matters for a better reason than tidiness. A custom field holds one
// value per contact forever, so a value left behind gets silently misattributed
// to the NEXT Day One that member books. That is the exact bug this whole
// migration exists to kill, and it would sneak straight back in through the
// courier if the field were left populated.
//
// ORDERING IS DELIBERATE: store first, clear second, and only on success. If the
// portal is mid-deploy or throws, the field stays populated and the reconciler
// picks it up on its next pass. Clearing inside the GHL workflow instead would
// destroy the value the moment a webhook failed, with no way to recover it.
const { supabaseAdmin } = require('./supabase')
const { LOCATIONS, getLocationBySlug, getLocationById } = require('../config/ghlLocations')
const { ghlFetch } = require('./ghlClient')
const { getFieldId } = require('./ghlCustomFields')
const {
  pacificDate, flattenWebhookBody, webhookLabels, statusFromGhl, bookerFromEvent,
} = require('../lib/dayOneOutcomes')
const { getUsersById, CAL_VERSION } = require('../lib/ghlBooking')

const COURIER_FIELD = 'contact.day_one_booking_team_member'

function pick(body, ...keys) {
  for (const k of keys) {
    const v = body[k]
    if (v !== undefined && v !== null && String(v).trim() !== '') return String(v).trim()
  }
  return null
}

function resolveLocation(body) {
  const slug = String(body.location_slug || body.locationSlug || '').trim().toLowerCase()
  if (slug) {
    const bySlug = getLocationBySlug(slug)
    if (bySlug) return bySlug
  }
  // GHL also sends the sub-account as `location: { id, name }` on workflow
  // webhooks, so a payload with no slug at all is still resolvable.
  const nestedId = body.location && typeof body.location === 'object'
    ? String(body.location.id || '').trim() : ''
  const id = pick(body, 'location_id', 'locationId') || nestedId
  if (id) {
    const byId = getLocationById(id)
    if (byId) return byId
  }
  const nestedName = body.location && typeof body.location === 'object'
    ? String(body.location.name || '').trim().toLowerCase() : ''
  return nestedName ? getLocationBySlug(nestedName) : null
}

// Ask GHL what this appointment actually is.
//
// WHY THE SERVER DOES THIS INSTEAD OF A GHL WORKFLOW
// The alternative was a workflow with custom code doing
// {{appointment.id}} -> GET the appointment -> GET /users/{id} -> return a name,
// and then feeding that back through the webhook. That put an API token in
// workflow code, needed maintaining per location, and still could not supply a
// start time the merge fields refused to resolve.
//
// One GET here replaces all of it and gives MORE: the true start and end, the
// assigned trainer, GHL's own dateAdded and dateUpdated, the live status (so a
// cancellation lands immediately instead of waiting for the next reconcile), and
// createdBy.userId for the staff-booked minority.
//
// The webhook then only has to carry what GHL cannot tell us: which club, which
// contact, which appointment, and the booking team member from the courier field.
//
// Non-fatal by design. If this call fails the row is still stored from whatever
// the payload carried, and the reconciler repairs it within 15 minutes.
async function enrichFromGhl(loc, appointmentId) {
  if (!appointmentId) return null
  try {
    const data = await ghlFetch(`/calendars/events/appointments/${appointmentId}`, loc.apiKey, {
      version: CAL_VERSION,
    })
    const appt = data?.appointment || data
    if (!appt || !appt.id) return null
    const usersById = await getUsersById(loc).catch(() => ({}))
    const trainer = usersById[appt.assignedUserId] || null
    return {
      startTime: appt.startTime || null,
      endTime: appt.endTime || null,
      dateAdded: appt.dateAdded || null,
      dateUpdated: appt.dateUpdated || null,
      status: statusFromGhl(appt.appointmentStatus),
      calendarId: appt.calendarId || null,
      trainerUserId: appt.assignedUserId || null,
      trainerName: trainer ? trainer.name : null,
      booker: bookerFromEvent(appt, usersById),
    }
  } catch (e) {
    console.warn(`[dayOneIngest] could not fetch appointment ${appointmentId}: ${e.message}`)
    return null
  }
}

// Returns { ok, status, body } so the route stays a thin wrapper.
async function ingestBooking(raw = {}) {
  const body = flattenWebhookBody(raw)

  const loc = resolveLocation(body)
  if (!loc) {
    // Name the keys that DID arrive. Without this, a nesting mismatch looks
    // identical to a typo and takes a deploy-and-guess cycle to tell apart.
    console.warn(`[dayOneIngest] no location resolved; payload carried: ${webhookLabels(raw)}`)
    return {
      ok: false,
      status: 400,
      body: {
        error: 'Unknown or missing location',
        hint: 'Send location_slug as one of: ' + LOCATIONS.map(l => l.slug).join(', '),
        keys_received: webhookLabels(raw),
      },
    }
  }

  const contactId = pick(body, 'contact_id', 'contactId')
  if (!contactId) {
    console.warn(`[dayOneIngest] no contact id; payload carried: ${webhookLabels(raw)}`)
    return { ok: false, status: 400, body: { error: 'contact_id is required', keys_received: webhookLabels(raw) } }
  }

  const appointmentId = pick(body, 'appointment_id', 'appointmentId')
  const start = pick(body, 'appointment_start', 'appointmentStart', 'start_time', 'startTime')
  const end = pick(body, 'appointment_end', 'appointmentEnd', 'end_time', 'endTime')
  const teamMember = pick(body, 'booking_team_member', 'bookingTeamMember', 'day_one_booking_team_member')
  const first = pick(body, 'contact_first_name', 'contactFirstName', 'first_name', 'firstName')
  const last = pick(body, 'contact_last_name', 'contactLastName', 'last_name', 'lastName')
  const name = pick(body, 'contact_name', 'contactName')
    || [first, last].filter(Boolean).join(' ') || null

  // Existing row wins on anything the webhook does not carry, so a re-fire never
  // blanks a field that the reconciler or the outcome form already filled in.
  let stored = null
  if (appointmentId) {
    const { data } = await supabaseAdmin
      .from('day_one_appointments')
      .select('*')
      .eq('ghl_appointment_id', appointmentId)
      .maybeSingle()
    stored = data || null
  }

  // The webhook's ONE irreplaceable contribution is the booking team member: the
  // reconciler can recover every other field from the calendar within 15 minutes,
  // but it can never recover this one, because 94% of appointments carry
  // createdBy.userId = null. So a bad or missing start time must NOT cost us the
  // booking. If GHL sends an appointment merge field that does not resolve, we
  // still store the row, dated today, and let the reconciler correct the date on
  // its next pass (it upserts on ghl_appointment_id and owns scheduling data).
  //
  // Rejecting here instead would trade the only unrecoverable field for the most
  // recoverable one.
  // Authoritative appointment data, straight from GHL, before anything is
  // derived from the payload.
  const live = await enrichFromGhl(loc, appointmentId)

  const now = new Date().toISOString()
  const parsedDate = pacificDate(live?.startTime || start)
  const scheduledDate = parsedDate || stored?.scheduled_date || pacificDate(now)
  const dateIsProvisional = !parsedDate && !stored?.scheduled_date
  if (dateIsProvisional) {
    console.warn(
      `[dayOneIngest] no usable appointment start for contact ${contactId} ` +
      `(got ${JSON.stringify(start)}); storing with today's date for the reconciler to correct`)
  }

  // A webhook that could not tell us its appointment id has NO natural identity,
  // so a re-fire would insert a second row. GHL retried this endpoint 6 seconds
  // apart on the first live booking and produced exactly that.
  //
  // The fallback identity is deliberately restricted to OTHER ORPHANS: rows that
  // also have no appointment id. It must never match a row the reconciler owns.
  //
  // The first version of this matched on (contact, date) alone and did real
  // damage. When the appointment start does not parse the date defaults to
  // today, so a booking for Friday matched a CANCELLED appointment from today,
  // took its row, and the whole-row write nulled out its real appointment id.
  // A provisional date must never be allowed to claim a real appointment.
  if (!stored && !appointmentId) {
    const { data } = await supabaseAdmin
      .from('day_one_appointments')
      .select('*')
      .eq('ghl_contact_id', contactId)
      .eq('scheduled_date', scheduledDate)
      .is('ghl_appointment_id', null)
      .is('outcome_recorded_at', null)
      .neq('status', 'cancelled')
      .order('created_at', { ascending: false })
      .limit(1)
    stored = (data && data[0]) || null
  }

  const row = {
    location_slug: loc.slug,
    // Never downgrade a known appointment id to null. A webhook that cannot
    // name its appointment has no business erasing one we already have.
    ghl_appointment_id: appointmentId || stored?.ghl_appointment_id || null,
    ghl_contact_id: contactId,
    ghl_calendar_id: live?.calendarId || pick(body, 'calendar_id', 'calendarId') || stored?.ghl_calendar_id || null,
    contact_name: name || stored?.contact_name || null,
    contact_email: pick(body, 'contact_email', 'contactEmail', 'email') || stored?.contact_email || null,
    contact_phone: pick(body, 'contact_phone', 'contactPhone', 'phone') || stored?.contact_phone || null,
    scheduled_date: scheduledDate,
    scheduled_start: live?.startTime
      ? new Date(live.startTime).toISOString()
      : (parsedDate ? new Date(start).toISOString() : (stored?.scheduled_start || null)),
    scheduled_end: live?.endTime
      ? new Date(live.endTime).toISOString()
      : (end ? new Date(end).toISOString() : (stored?.scheduled_end || null)),
    booked_at: (live?.dateAdded && new Date(live.dateAdded).toISOString()) || stored?.booked_at || now,
    ghl_updated_at: (live?.dateUpdated && new Date(live.dateUpdated).toISOString()) || stored?.ghl_updated_at || null,
    // A credit carried over from the original booking outranks the courier.
    // Otherwise a webhook re-fire would hand the credit back to whoever rebooked,
    // and the reschedule link already exists so the carryover would never be
    // re-applied to correct it.
    booked_by_name: stored?.booked_by_source === 'reschedule_carryover'
      ? stored.booked_by_name
      : (teamMember || stored?.booked_by_name || live?.booker?.booked_by_name || null),
    booked_by_source: stored?.booked_by_source === 'reschedule_carryover'
      ? 'reschedule_carryover'
      : (teamMember ? 'webhook'
        : (stored?.booked_by_source || live?.booker?.booked_by_source || null)),
    trainer_name: live?.trainerName || pick(body, 'trainer_name', 'trainerName') || stored?.trainer_name || null,
    trainer_ghl_user_id: live?.trainerUserId
      || pick(body, 'trainer_user_id', 'assigned_user_id', 'assignedUserId')
      || stored?.trainer_ghl_user_id || null,
    notes_for_trainer: pick(body, 'notes_for_trainer', 'notesForTrainer', 'notes')
      || stored?.notes_for_trainer || null,
    // A modify/cancel firing of the workflow carries no status of its own, so
    // take GHL's. This is what lets one workflow cover made, modified AND
    // cancelled without waiting for the next reconcile pass.
    status: live?.status || stored?.status || 'scheduled',
    outcome: stored?.outcome ?? null,
    pt_sale_type: stored?.pt_sale_type ?? null,
    why_no_sale: stored?.why_no_sale ?? null,
    why_no_sale_other: stored?.why_no_sale_other ?? null,
    cancel_reason: stored?.cancel_reason ?? null,
    outcome_recorded_at: stored?.outcome_recorded_at ?? null,
    submitted_by: stored?.submitted_by ?? null,
    rescheduled_from_id: stored?.rescheduled_from_id ?? null,
    rescheduled_to_id: stored?.rescheduled_to_id ?? null,
    source: stored?.source || 'webhook',
    updated_at: now,
  }

  // A booking with no appointment id still gets stored, because a Day One we
  // know about imprecisely beats one we lose entirely. It just cannot be
  // reconciled against the calendar later.
  const q = appointmentId
    ? supabaseAdmin.from('day_one_appointments').upsert(row, { onConflict: 'ghl_appointment_id' }).select('id').single()
    : stored
      ? supabaseAdmin.from('day_one_appointments').update(row).eq('id', stored.id).select('id').single()
      : supabaseAdmin.from('day_one_appointments').insert(row).select('id').single()

  const { data: saved, error } = await q
  if (error) {
    console.error('[dayOneIngest] store failed:', error.message)
    return { ok: false, status: 500, body: { error: 'Could not store booking' } }
  }

  if (!stored) {
    await supabaseAdmin.from('day_one_appointment_events').insert({
      appointment_id: saved.id,
      event_type: 'booked',
      to_value: { scheduled_start: row.scheduled_start, booked_by_name: row.booked_by_name, trainer_name: row.trainer_name },
      detected_by: 'webhook',
    })
  }

  // Only now, with the row committed, is it safe to drain the courier field.
  let cleared = false
  if (teamMember) cleared = await clearCourierField(loc, contactId)

  return {
    ok: true,
    status: 200,
    body: {
      success: true,
      appointment_id: saved.id,
      booked_by: row.booked_by_name,
      courier_cleared: cleared,
      // Surfaced so a misconfigured merge field shows up in the GHL workflow's
      // own response log rather than silently producing wrongly-dated rows.
      date_provisional: dateIsProvisional,
    },
  }
}

async function clearCourierField(loc, contactId) {
  if (process.env.DAY_ONE_COURIER_CLEAR_DISABLED === '1') return false
  try {
    const id = await getFieldId(loc.id, loc.apiKey, COURIER_FIELD)
    if (!id) return false
    await ghlFetch(`/contacts/${contactId}`, loc.apiKey, {
      method: 'PUT', body: { customFields: [{ id, value: '' }] },
    })
    return true
  } catch (e) {
    // Non-fatal: the value is already safely stored. A leftover value only risks
    // a stale read by the reconciler, which marks its own attribution as such.
    console.warn('[dayOneIngest] courier clear failed:', e.message)
    return false
  }
}

module.exports = { ingestBooking, clearCourierField, COURIER_FIELD }
