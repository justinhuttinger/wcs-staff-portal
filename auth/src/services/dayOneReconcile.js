// Keeps day_one_appointments in step with the GHL Day One calendars.
//
// WHY POLL AT ALL, GIVEN THERE IS A WEBHOOK
// The webhook is an accelerator, not the source of truth. Webhook-only ingestion
// is exactly how ghl_opportunities ended up counting deleted records (#363) and
// how the ABC calendar undercounted late completions (#252). A reconciler makes
// the table self-healing: miss a webhook, ship a bad deploy, or have an outage,
// and the next pass repairs it. It is also what makes the backfill re-runnable.
//
// Measured against the live calendars on 2026-08-25: 94% of Day Ones are created
// by GHL's own booking widget with createdBy.userId null, so the booking team
// member cannot be read off the appointment for the common case. That is what
// the webhook courier is for; this job only fills it in for the 6% booked inside
// GHL, where createdBy.userId is present on all of them.
const cron = require('node-cron')
const { supabaseAdmin } = require('./supabase')
const { LOCATIONS } = require('../config/ghlLocations')
const { ghlFetch } = require('./ghlClient')
const { getDayOneCalendar, getUsersById, CAL_VERSION } = require('../lib/ghlBooking')
const {
  rowFromEvent, bookerFromEvent, diffAppointment, linkReschedules,
  DEFAULT_RESCHEDULE_WINDOW_HOURS,
} = require('../lib/dayOneOutcomes')

// How far either side of today to reconcile. Backwards far enough to catch an
// outcome recorded late, forwards far enough to cover the whole bookable window
// (the Day One calendar caps at 10 days, so 45 is generous).
const LOOKBACK_DAYS = Number(process.env.DAY_ONE_RECONCILE_LOOKBACK_DAYS || 45)
const LOOKAHEAD_DAYS = Number(process.env.DAY_ONE_RECONCILE_LOOKAHEAD_DAYS || 45)
const RESCHEDULE_WINDOW_HOURS =
  Number(process.env.DAY_ONE_RESCHEDULE_WINDOW_HOURS || DEFAULT_RESCHEDULE_WINDOW_HOURS)

async function fetchEvents(loc, calendar) {
  const startTime = Date.now() - LOOKBACK_DAYS * 86400000
  const endTime = Date.now() + LOOKAHEAD_DAYS * 86400000
  const data = await ghlFetch('/calendars/events', loc.apiKey, {
    params: {
      locationId: loc.id,
      calendarId: calendar.id,
      startTime: String(startTime),
      endTime: String(endTime),
    },
    version: CAL_VERSION,
  })
  // A deleted appointment still comes back with deleted:true. Dropping it here
  // rather than storing it keeps "how many Day Ones" from counting ghosts.
  return (data.events || []).filter(e => e && e.id && !e.deleted)
}

async function reconcileLocation(loc) {
  const calendar = await getDayOneCalendar(loc)
  const [events, usersById] = await Promise.all([
    fetchEvents(loc, calendar),
    getUsersById(loc),
  ])
  if (!events.length) return { location: loc.slug, seen: 0, inserted: 0, updated: 0, events: 0, linked: 0 }

  const ids = events.map(e => e.id)
  const { data: existing, error: readErr } = await supabaseAdmin
    .from('day_one_appointments')
    .select('*')
    .in('ghl_appointment_id', ids)
  if (readErr) throw new Error(`read day_one_appointments: ${readErr.message}`)

  const byGhlId = {}
  for (const r of (existing || [])) byGhlId[r.ghl_appointment_id] = r

  const rows = []
  const historyRows = []
  let inserted = 0
  let updated = 0

  for (const evt of events) {
    const live = rowFromEvent(evt, { loc, usersById })
    if (!live.ghl_contact_id || !live.scheduled_date) continue
    const stored = byGhlId[evt.id]

    if (stored) {
      for (const e of diffAppointment(stored, live)) {
        historyRows.push({ ...e, appointment_id: stored.id, detected_by: 'reconciler' })
      }
      updated++
    } else {
      inserted++
    }

    // Whole rows only. A partial upsert always fails the NOT NULL columns on an
    // insert, which is the trap that produced #473.
    const row = {
      ...live,
      // Never clobber what a first-hand source already established. The webhook
      // and the booking widget know the booking team member; this job does not,
      // except for the staff-booked minority.
      booked_by_name: stored?.booked_by_name ?? null,
      booked_by_source: stored?.booked_by_source ?? null,
      contact_name: stored?.contact_name ?? null,
      contact_email: stored?.contact_email ?? null,
      contact_phone: stored?.contact_phone ?? null,
      notes_for_trainer: stored?.notes_for_trainer ?? null,
      // Outcomes belong to the form. The calendar's showed/noshow marks are kept
      // on 5% of appointments, so reading them back would overwrite good data
      // with a blank on almost every pass.
      outcome: stored?.outcome ?? null,
      pt_sale_type: stored?.pt_sale_type ?? null,
      why_no_sale: stored?.why_no_sale ?? null,
      why_no_sale_other: stored?.why_no_sale_other ?? null,
      cancel_reason: stored?.cancel_reason ?? null,
      outcome_recorded_at: stored?.outcome_recorded_at ?? null,
      submitted_by: stored?.submitted_by ?? null,
      rescheduled_from_id: stored?.rescheduled_from_id ?? null,
      rescheduled_to_id: stored?.rescheduled_to_id ?? null,
      source: stored?.source ?? 'ghl_reconcile',
      updated_at: new Date().toISOString(),
    }
    // An outcome already recorded is the trainer's answer, and the calendar must
    // not undo it. Only a cancellation is allowed to override, because that
    // genuinely happened after the fact.
    if (stored?.outcome_recorded_at && live.status !== 'cancelled') {
      row.status = stored.status
    }
    if (!stored) {
      const booker = bookerFromEvent(evt, usersById)
      if (booker) Object.assign(row, booker)
    }
    rows.push(row)
  }

  if (rows.length) {
    const { error } = await supabaseAdmin
      .from('day_one_appointments')
      .upsert(rows, { onConflict: 'ghl_appointment_id' })
    if (error) throw new Error(`upsert day_one_appointments: ${error.message}`)
  }

  if (historyRows.length) {
    const { error } = await supabaseAdmin.from('day_one_appointment_events').insert(historyRows)
    // History is an audit trail, not a gate: losing a row must not fail the sync.
    if (error) console.warn(`[dayOneReconcile] history insert failed: ${error.message}`)
  }

  const linked = await stitchReschedules(loc.slug)
  return { location: loc.slug, seen: events.length, inserted, updated, events: historyRows.length, linked }
}

// Pair cancellations with the replacement booking the same member made. GHL
// keeps the appointment id when an appointment is edited in place (measured:
// 424/853 events had dateUpdated ahead of dateAdded with the id intact), so most
// reschedules never reach this path. This is for the cancel-and-rebook shape.
async function stitchReschedules(locationSlug) {
  const since = new Date(Date.now() - LOOKBACK_DAYS * 86400000).toISOString().slice(0, 10)
  const { data, error } = await supabaseAdmin
    .from('day_one_appointments')
    .select('id, ghl_contact_id, status, updated_at, booked_at, created_at, scheduled_date, rescheduled_from_id, rescheduled_to_id')
    .eq('location_slug', locationSlug)
    .gte('scheduled_date', since)
  if (error) throw new Error(`read for stitching: ${error.message}`)

  const byContact = {}
  for (const r of (data || [])) {
    if (!r.ghl_contact_id) continue
    ;(byContact[r.ghl_contact_id] = byContact[r.ghl_contact_id] || []).push(r)
  }

  let linked = 0
  for (const rows of Object.values(byContact)) {
    if (rows.length < 2) continue
    for (const { from, to } of linkReschedules(rows, { windowHours: RESCHEDULE_WINDOW_HOURS })) {
      const a = await supabaseAdmin.from('day_one_appointments')
        .update({ rescheduled_to_id: to, updated_at: new Date().toISOString() }).eq('id', from)
      const b = await supabaseAdmin.from('day_one_appointments')
        .update({ rescheduled_from_id: from, updated_at: new Date().toISOString() }).eq('id', to)
      if (a.error || b.error) {
        console.warn('[dayOneReconcile] reschedule link failed:', (a.error || b.error).message)
        continue
      }
      await supabaseAdmin.from('day_one_appointment_events').insert({
        appointment_id: to,
        event_type: 'rescheduled',
        from_value: { rescheduled_from_id: from },
        to_value: { rescheduled_to_id: to },
        detected_by: 'reconciler',
      })
      linked++
    }
  }
  return linked
}

// Locations are done one at a time on purpose. Six concurrent free-slot calls
// against one location trips GHL's burst limit, and ghlClient backs off a full
// five seconds per 429; the booking widget already paid for that lesson.
async function runOnce() {
  const results = []
  for (const loc of LOCATIONS) {
    try {
      results.push(await reconcileLocation(loc))
    } catch (err) {
      console.error(`[dayOneReconcile] ${loc.slug} failed:`, err.message)
      results.push({ location: loc.slug, error: err.message })
    }
  }
  const total = results.reduce((n, r) => n + (r.seen || 0), 0)
  console.log(`[dayOneReconcile] pass complete, ${total} appointments across ${results.length} locations`)
  return results
}

function start() {
  if (process.env.DAY_ONE_RECONCILE_ENABLED !== 'true') {
    console.log('[dayOneReconcile] disabled (set DAY_ONE_RECONCILE_ENABLED=true to enable)')
    return
  }
  // Every 15 minutes. The webhook covers the seconds-level case, so this only
  // has to be frequent enough that a missed one is not noticed by a trainer.
  cron.schedule('*/15 * * * *', () => {
    runOnce().catch(err => console.error('[dayOneReconcile] pass failed:', err.message))
  }, { timezone: 'America/Los_Angeles' })
  console.log('[dayOneReconcile] scheduled every 15 minutes')
}

module.exports = { start, runOnce, reconcileLocation, stitchReschedules }
