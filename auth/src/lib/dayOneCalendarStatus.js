// Per-appointment Day One status for the calendar views.
//
// WHY THIS EXISTS
// /day-one-tracker/appointments lists the live GHL calendar events and used to
// label each one from the CONTACT's day_one_* custom fields. A contact holds one
// set of those fields forever, so a member whose first Day One was cancelled
// carried day_one_status='Cancelled' onto their rebooked one. The calendar
// only opens the outcome form for a blank/Scheduled/Confirmed status, so the
// rebooked Day One rendered as an unclickable card and could never get an
// outcome (Evan Demaris, Clackamas, 2026-09-17).
//
// day_one_appointments has one row per appointment, keyed by the GHL event id,
// so it is the source of truth wherever a row exists. The contact fields are
// kept only as a fallback for an event the reconciler has not picked up yet
// (it runs every 15 minutes; bookings usually land sooner through the webhook).
//
// Status labels mirror dayOneReporting's STATUS_LABEL. That module pulls in
// services/supabase, so it is not required here and this file stays pure.

const STATUS_LABEL = {
  completed: 'Completed',
  no_show: 'No Show',
  cancelled: 'Cancelled',
  scheduled: 'Scheduled',
}

/**
 * Overlay a day_one_appointments row onto one calendar appointment.
 * `apt` is the shape the route builds; `row` may be null/undefined.
 * Returns a new object and never mutates `apt`.
 */
function applyAppointmentRow(apt, row) {
  if (!row) return apt
  const label = STATUS_LABEL[row.status] || null
  const out = {
    ...apt,
    day_one_appointment_id: row.id,
    day_one_status: label,
    // Outcome fields come only from THIS appointment. Falling back to the
    // contact would resurrect another appointment's answer, the bug above.
    day_one_sale: row.outcome || null,
    show_or_no_show: label === 'Completed' ? 'Show' : (label === 'No Show' ? 'No Show' : null),
    pt_sale_type: row.pt_sale_type || null,
    why_no_sale: row.why_no_sale || null,
    day_one_trainer: row.trainer_name || apt.day_one_trainer || null,
    day_one_booking_team_member: row.booked_by_name || apt.day_one_booking_team_member || null,
  }
  // Cancelled through the outcome form while the GHL event is still booked:
  // show it as cancelled rather than as a Scheduled card nobody can open.
  if (row.status === 'cancelled') out.status = 'cancelled'
  return out
}

module.exports = { applyAppointmentRow, STATUS_LABEL }
