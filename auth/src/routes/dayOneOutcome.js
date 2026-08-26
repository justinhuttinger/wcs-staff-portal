// The Day One outcome form, replacing the GHL Form that currently gets sent to
// the trainer when a Day One is completed.
//
// HOW THE LINK WORKS, AND WHY THERE IS NO TOKEN
// The link a GHL workflow sends carries only the contact id:
//
//     https://api.wcstrength.com/day-one/outcome?c={{contact.id}}
//
// {{contact.id}} is a NATIVE GHL merge variable, so nothing has to be written to
// a custom field for the link to resolve. That matters: minting a per-appointment
// token would have to live somewhere GHL can interpolate it, and the only such
// place is a custom field, which is the thing this whole project exists to stop
// depending on.
//
// The server then resolves WHICH Day One is meant by querying
// day_one_appointments for that contact's open rows. That query is only
// expressible because a contact can now have many appointments; against the old
// custom fields, "the open Day One for this contact" was undefined. When two are
// open the form asks instead of guessing.
//
// NO AUTH, DELIBERATELY (Justin's call, 2026-08-25). Same posture as the tour
// check-in page and the Day One booking widget: trainers are on their phones on
// a gym floor and a login wall means the form does not get filled in. Defence is
// the unguessable contact id plus the rate limits below.
//
// The form does not ask who is filling it in (dropped 2026-08-26, Justin's call:
// the appointment already names the trainer, so asking again was a question that
// bought nothing). submitted_by stays on the table for the rows that have it.
const { Router } = require('express')
const path = require('path')
const fs = require('fs')
const rateLimit = require('express-rate-limit')
const { supabaseAdmin } = require('../services/supabase')
const { getLocationBySlug } = require('../config/ghlLocations')
const { ghlFetch } = require('../services/ghlClient')
const { getFieldId } = require('../services/ghlCustomFields')
const {
  PT_SALE_TYPES, NO_SALE_REASONS, CANCEL_REASONS,
  validateOutcome, legacyGhlFields, pickOpenAppointments, displayStatus,
} = require('../lib/dayOneOutcomes')

const router = Router()

// This is a Supabase read only, but the endpoint is public, so it still gets a
// cap. A trainer legitimately loads it once or twice.
const readLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 60,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many requests, please wait a moment' },
})

// Submitting is a slow, deliberate human action at the end of a session.
const writeLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many submissions, slow down' },
})

const SELECT_COLS =
  'id, location_slug, ghl_appointment_id, ghl_contact_id, contact_name, ' +
  'scheduled_date, scheduled_start, trainer_name, booked_by_name, ' +
  'notes_for_trainer, status, outcome, outcome_recorded_at'

const PAGE_PATH = path.join(__dirname, '..', 'public', 'dayOneOutcome.html')
let pageTemplate = null

router.get('/', (req, res) => {
  try {
    if (!pageTemplate || process.env.NODE_ENV !== 'production') {
      pageTemplate = fs.readFileSync(PAGE_PATH, 'utf8')
    }
    res.type('html').send(
      pageTemplate.split('{{FORM_BASE}}').join(req.baseUrl || '/day-one/outcome'))
  } catch (e) {
    console.error('[dayOneOutcome] page render failed:', e.message)
    res.status(500).send('Form unavailable')
  }
})

// Which Day One is this, plus everything the form needs to render itself.
// Returns 200 with an empty list rather than 404 when a contact has nothing
// open, so the page can say "already recorded" instead of looking broken.
router.get('/api/appointment', readLimiter, async (req, res) => {
  const contactId = String(req.query.c || '').trim()
  if (!contactId) return res.status(400).json({ error: 'Missing contact id' })

  try {
    const { data, error } = await supabaseAdmin
      .from('day_one_appointments')
      .select(SELECT_COLS)
      .eq('ghl_contact_id', contactId)
      .order('scheduled_date', { ascending: false })
      .limit(20)
    if (error) throw new Error(error.message)

    const open = pickOpenAppointments(data || [])

    res.json({
      // display_status so the page and any future caller agree on what
      // "passed with no outcome" means without re-deriving it.
      appointments: open.map(a => ({ ...a, display_status: displayStatus(a) })),
      // Sent so the page can say "this one is already done" rather than showing
      // an empty form with no explanation.
      recorded: (data || []).filter(r => r.outcome_recorded_at).slice(0, 3),
      options: {
        pt_sale_types: PT_SALE_TYPES,
        no_sale_reasons: NO_SALE_REASONS,
        cancel_reasons: CANCEL_REASONS,
      },
    })
  } catch (err) {
    console.error('[dayOneOutcome] lookup failed:', err.message)
    res.status(500).json({ error: 'Could not load this Day One' })
  }
})

router.post('/api/submit', writeLimiter, async (req, res) => {
  const appointmentId = String(req.body?.appointment_id || '').trim()
  if (!appointmentId) return res.status(400).json({ error: 'Missing appointment' })

  // The form is public, so every rule is re-checked here. The client's own
  // conditional logic is a convenience, never the gate.
  const check = validateOutcome(req.body)
  if (!check.ok) return res.status(400).json({ error: check.error })
  const v = check.value

  try {
    const { data: appt, error: readErr } = await supabaseAdmin
      .from('day_one_appointments')
      .select(SELECT_COLS)
      .eq('id', appointmentId)
      .maybeSingle()
    if (readErr) throw new Error(readErr.message)
    if (!appt) return res.status(404).json({ error: 'Day One not found' })

    // Idempotent by design: a trainer double-tapping submit, or opening the SMS
    // link twice, must not produce two conflicting answers or two history rows.
    if (appt.outcome_recorded_at) {
      return res.status(409).json({
        error: 'This Day One was already recorded.',
        recorded_at: appt.outcome_recorded_at,
        submitted_by: appt.submitted_by || null,
      })
    }

    const now = new Date().toISOString()
    const { error: updErr } = await supabaseAdmin
      .from('day_one_appointments')
      .update({
        status: v.status === 'rescheduled' ? 'scheduled' : v.status,
        outcome: v.outcome,
        pt_sale_type: v.pt_sale_type,
        why_no_sale: v.why_no_sale,
        why_no_sale_other: v.why_no_sale_other,
        cancel_reason: v.cancel_reason,
        // A reschedule is not an outcome: the Day One has not happened yet, so
        // leaving this null keeps the appointment open for the real result and
        // lets the reconciler stitch it to whatever gets booked next.
        outcome_recorded_at: v.status === 'rescheduled' ? null : now,
        submitted_by: v.submitted_by,
        updated_at: now,
      })
      .eq('id', appointmentId)
    if (updErr) throw new Error(updErr.message)

    await supabaseAdmin.from('day_one_appointment_events').insert({
      appointment_id: appointmentId,
      event_type: v.status === 'rescheduled' ? 'rescheduled' : 'outcome_recorded',
      from_value: { status: appt.status },
      to_value: {
        status: v.status, outcome: v.outcome, pt_sale_type: v.pt_sale_type,
        why_no_sale: v.why_no_sale, submitted_by: v.submitted_by,
      },
      detected_by: 'form',
    })

    // Legacy mirror. ON during the comparison week so the old reports and the new
    // table are fed by the same submissions and can be diffed honestly. Failure
    // is non-fatal: Supabase is the system of record now, and a GHL hiccup must
    // not cost us the trainer's answer.
    const legacy = await writeLegacyGhlFields(appt, v)

    res.json({ success: true, legacy })
  } catch (err) {
    console.error('[dayOneOutcome] submit failed:', err.message)
    res.status(500).json({ error: 'Could not save this outcome' })
  }
})

// DELETE ME once the comparison week is done and the GHL workflow audit has
// confirmed nothing else reads these fields. Nothing in the new path reads them;
// this exists purely so the old reports keep moving during the overlap.
async function writeLegacyGhlFields(appt, v) {
  const loc = getLocationBySlug(appt.location_slug)
  if (!loc || !appt.ghl_contact_id) return { written: false, reason: 'no location or contact' }

  const wanted = legacyGhlFields(v)
  const keys = Object.keys(wanted)
  if (!keys.length) return { written: false, reason: 'nothing to write' }

  try {
    const customFields = []
    for (const key of keys) {
      // Field ids differ per location, so they are always resolved by key.
      const id = await getFieldId(loc.id, loc.apiKey, key)
      if (id) customFields.push({ id, value: wanted[key] })
    }
    if (!customFields.length) return { written: false, reason: 'no field ids resolved' }
    await ghlFetch(`/contacts/${appt.ghl_contact_id}`, loc.apiKey, {
      method: 'PUT', body: { customFields },
    })
    return { written: true, fields: customFields.length }
  } catch (e) {
    console.warn('[dayOneOutcome] legacy GHL write failed:', e.message)
    return { written: false, reason: e.message }
  }
}

module.exports = router
