// Pure helpers for Day One outcomes: the option lists, the conditional form's
// validation rules, reschedule stitching, and the diff that turns live GHL state
// into history events.
//
// Everything here is total and side-effect free so the rules can be tested
// without a network or a database. The routes and the reconciler own the IO.

// The 7 options are identical at all 7 clubs in GHL (verified 2026-08-25), so
// they are canonical here rather than fetched per location on every page load.
const PT_SALE_TYPES = [
  '1 x Week',
  '2 x Week',
  '3 x Week',
  '5 Pack',
  '10 Pack',
  '20 Pack',
  'Small Group',
]

// The legacy contact.why_no_sale custom field is LARGE_TEXT at every club. It
// collected 400+ distinct values, nearly all with a count of 1, including
// 'Poor' / 'poor' / 'Poor ' as three separate answers and 'Money' / 'money' /
// 'MOney' as three more. Nothing could be grouped or counted.
//
// These buckets are derived from that free text, ordered by how often the theme
// actually appeared. 'Other' stays last and opens a text box, so a genuinely
// novel reason is still capturable without reopening the free-text floodgate.
const NO_SALE_REASONS = [
  'Cannot afford it right now',
  'Needs to talk to spouse or partner',
  'Only wanted the free session or InBody scan',
  'Only wanted a machine or equipment orientation',
  'Already has a trainer or a program',
  'Wants to think about it',
  'Waiting on a second or promo session',
  'Wants to try on their own first',
  'Schedule does not work right now',
  'Moving away or only here temporarily',
  'Medical, injury, or awaiting clearance',
  'Too young or needs a parent',
  'Not interested in training',
  'Other',
]

const CANCEL_REASONS = [
  'Sick',
  'Work conflict',
  'Family or childcare conflict',
  'Transportation',
  'Forgot',
  'No longer interested',
  'Other',
]

// What the trainer picks first. Cancelled and Rescheduled sit alongside the
// show / no-show pair because a Day One that never happened is not a no-show,
// and counting it as one is what makes show rate untrustworthy.
const FORM_STATUSES = ['completed', 'no_show', 'cancelled', 'rescheduled']

const SALE_RESULTS = ['Sale', 'No Sale']

const FREE_TEXT_MAX = 500

function clean(v, max = FREE_TEXT_MAX) {
  if (v === undefined || v === null) return ''
  return String(v).trim().slice(0, max)
}

// Validate one outcome submission against the conditional flow:
//
//   status?
//     completed  -> Sale or No Sale?
//                     Sale     -> what did they sell?   (pt_sale_type)
//                     No Sale  -> why?                  (why_no_sale, + text if Other)
//     no_show    -> done
//     cancelled  -> optional reason
//     rescheduled-> done
//
// Returns { ok: true, value } or { ok: false, error }. Callers must not trust
// the client to have enforced any of this: the form is public.
function validateOutcome(body = {}) {
  const status = clean(body.status, 32)
  if (!FORM_STATUSES.includes(status)) {
    return { ok: false, error: 'Pick what happened with this Day One.' }
  }

  const out = {
    status,
    outcome: null,
    pt_sale_type: null,
    why_no_sale: null,
    why_no_sale_other: null,
    cancel_reason: null,
    submitted_by: clean(body.submitted_by, 120) || null,
  }

  if (status === 'completed') {
    const outcome = clean(body.outcome, 32)
    if (!SALE_RESULTS.includes(outcome)) {
      return { ok: false, error: 'Pick whether this was a sale or a no sale.' }
    }
    out.outcome = outcome

    if (outcome === 'Sale') {
      const t = clean(body.pt_sale_type, 64)
      if (!PT_SALE_TYPES.includes(t)) {
        return { ok: false, error: 'Pick what was sold.' }
      }
      out.pt_sale_type = t
    } else {
      const why = clean(body.why_no_sale, 96)
      if (!NO_SALE_REASONS.includes(why)) {
        return { ok: false, error: 'Pick a reason for the no sale.' }
      }
      out.why_no_sale = why
      if (why === 'Other') {
        const other = clean(body.why_no_sale_other)
        if (!other) {
          return { ok: false, error: 'Type the reason for the no sale.' }
        }
        out.why_no_sale_other = other
      }
    }
  }

  if (status === 'cancelled') {
    // Deliberately optional. Requiring it would push trainers toward picking
    // whatever clears the form fastest, which is how the free-text field filled
    // up with 'hi' and 'Testing'.
    const reason = clean(body.cancel_reason, 96)
    if (reason && !CANCEL_REASONS.includes(reason)) {
      return { ok: false, error: 'Pick a cancellation reason from the list.' }
    }
    out.cancel_reason = reason || null
  }

  return { ok: true, value: out }
}

// The legacy GHL custom-field writes, kept on during the comparison week so the
// old reports and the new table can be diffed against the same submissions.
// Delete this and its caller once the numbers agree and the GHL workflow audit
// is done. Nothing READS these fields in the new path.
//
// The status field mirrors the lifecycle the GHL workflow already maintained:
// Scheduled on booking, then Cancelled / Completed / No Show.
function legacyGhlFields(v) {
  const f = {}
  if (v.status === 'completed') {
    f['contact.day_one_status'] = 'Completed'
    f['contact.show_or_no_show'] = 'Show'
    if (v.outcome) f['contact.day_one_sale'] = v.outcome
    if (v.pt_sale_type) f['contact.pt_sale_type'] = v.pt_sale_type
    if (v.why_no_sale) {
      // The old field was free text, so send the typed reason when there is one.
      // That keeps a week of side-by-side comparison honest.
      f['contact.why_no_sale'] = v.why_no_sale === 'Other'
        ? (v.why_no_sale_other || 'Other')
        : v.why_no_sale
    }
  } else if (v.status === 'no_show') {
    f['contact.day_one_status'] = 'No Show'
    f['contact.show_or_no_show'] = 'No Show'
  } else if (v.status === 'cancelled') {
    f['contact.day_one_status'] = 'Cancelled'
  } else if (v.status === 'rescheduled') {
    f['contact.day_one_status'] = 'Scheduled'
  }
  return f
}

// Which Day One is the trainer being asked about? The link carries only
// {{contact.id}}, which is a NATIVE GHL merge variable, so no custom field is
// needed to route the form. This is the query that makes that work, and it is
// only expressible because one contact can now have many appointments.
//
// Four rules, each earned from real data (counts measured 2026-08-25):
//
//   1. Not already recorded. Obvious.
//   2. Not cancelled. A cancelled Day One is resolved, not pending, and offering
//      one invites a trainer to record an outcome for a session that never
//      happened. 67 rows were being offered this way.
//   3. Recent only. 647 open rows are more than three weeks old: nobody is ever
//      going to fill those in, and they would clutter the picker forever.
//   4. One row per date. The backfill and the reconciler can describe the SAME
//      Day One (437 pairs did), and showing a trainer two identical entries is
//      worse than useless. The row carrying a real GHL appointment id wins.
//
// Together these took the number of contacts showing a picker from 179 to 4,
// which is the point: the picker should mean "this member really did have two",
// not "our data is untidy".
const DEFAULT_WINDOW_BACK_DAYS = 21
const DEFAULT_WINDOW_FORWARD_DAYS = 2

function pickOpenAppointments(rows, now = new Date(), opts = {}) {
  const t = now.getTime()
  const back = (opts.windowBackDays ?? DEFAULT_WINDOW_BACK_DAYS) * 86400000
  const forward = (opts.windowForwardDays ?? DEFAULT_WINDOW_FORWARD_DAYS) * 86400000

  const open = (rows || []).filter(r => !r.outcome_recorded_at && r.status !== 'cancelled')

  // Collapse rows describing the same Day One. Preferring the one with a GHL
  // appointment id keeps the row the reconciler will go on maintaining.
  const byDate = new Map()
  for (const r of open) {
    const key = r.scheduled_date || String(dateValue(r))
    const held = byDate.get(key)
    if (!held || (!held.ghl_appointment_id && r.ghl_appointment_id)) byDate.set(key, r)
  }

  const sorted = [...byDate.values()].sort((a, b) => {
    const at = dateValue(a), bt = dateValue(b)
    const aPast = at <= t, bPast = bt <= t
    // A trainer is almost always reporting on one that already happened.
    if (aPast !== bPast) return aPast ? -1 : 1
    return Math.abs(at - t) - Math.abs(bt - t)
  })

  const inWindow = sorted.filter(r => {
    const d = dateValue(r)
    return d >= t - back && d <= t + forward
  })

  // Fall back to the nearest open Day One when nothing is in the window, so
  // someone catching up on a month-old session still has a way to record it.
  // A hard window with no escape hatch would just be a dead end.
  return inWindow.length ? inWindow : sorted.slice(0, 1)
}

function dateValue(r) {
  const raw = r.scheduled_start || r.scheduled_date
  const t = raw ? new Date(raw).getTime() : NaN
  return Number.isFinite(t) ? t : 0
}

const DEFAULT_RESCHEDULE_WINDOW_HOURS = 72

// GHL keeps the appointment id when an appointment is edited in place, so most
// reschedules are a field change on one row and need no linking at all. This
// covers the other shape: a Day One is cancelled and the same member books a
// fresh one, which is a reschedule in every way that matters to a report but
// arrives as two unrelated appointments.
//
// Works in both directions because it compares an absolute time difference:
// cancel-then-rebook and rebook-then-cancel-the-old both land inside the window.
//
// Takes rows for ONE contact. Returns [{ from, to }] id pairs to link. Pure, so
// the window rule is testable without conjuring appointments in GHL.
function linkReschedules(rows, opts = {}) {
  const windowMs = (opts.windowHours || DEFAULT_RESCHEDULE_WINDOW_HOURS) * 3600 * 1000
  const cancelled = (rows || [])
    .filter(r => r.status === 'cancelled' && !r.rescheduled_to_id)
    .sort((a, b) => stamp(a) - stamp(b))
  const candidates = (rows || [])
    .filter(r => r.status !== 'cancelled' && !r.rescheduled_from_id)
    .sort((a, b) => stamp(a) - stamp(b))

  const taken = new Set()
  const links = []
  for (const c of cancelled) {
    let best = null
    let bestGap = Infinity
    for (const n of candidates) {
      if (n.id === c.id || taken.has(n.id)) continue
      const gap = Math.abs(stamp(n) - stamp(c))
      if (gap <= windowMs && gap < bestGap) { best = n; bestGap = gap }
    }
    if (best) {
      taken.add(best.id)
      links.push({ from: c.id, to: best.id })
    }
  }
  return links
}

// When the change happened, as best we know it. booked_at is when the row
// entered its current shape; updated_at moves when the reconciler sees a
// cancellation, which is the event we are pairing against.
function stamp(r) {
  const raw = r.updated_at || r.booked_at || r.created_at || r.scheduled_date
  const t = raw ? new Date(raw).getTime() : NaN
  return Number.isFinite(t) ? t : 0
}

// Turn a stored row plus its live GHL counterpart into history events. Returns
// [] when nothing moved, so the reconciler can stay quiet on a no-op pass
// instead of writing a row every time it runs.
function diffAppointment(stored, live) {
  const events = []
  if (!stored || !live) return events

  if (sameInstant(stored.scheduled_start, live.scheduled_start) === false) {
    events.push({
      event_type: 'rescheduled',
      from_value: { scheduled_start: stored.scheduled_start },
      to_value: { scheduled_start: live.scheduled_start },
    })
  }

  if ((stored.trainer_ghl_user_id || null) !== (live.trainer_ghl_user_id || null)) {
    events.push({
      event_type: 'reassigned',
      from_value: { trainer_ghl_user_id: stored.trainer_ghl_user_id, trainer_name: stored.trainer_name },
      to_value: { trainer_ghl_user_id: live.trainer_ghl_user_id, trainer_name: live.trainer_name },
    })
  }

  if ((stored.status || null) !== (live.status || null)) {
    // An outcome recorded through the form is not a GHL-visible status change,
    // so only the cancel/restore pair is attributed to the reconciler here.
    if (live.status === 'cancelled') {
      events.push({ event_type: 'cancelled', from_value: { status: stored.status }, to_value: { status: 'cancelled' } })
    } else if (stored.status === 'cancelled') {
      events.push({ event_type: 'restored', from_value: { status: 'cancelled' }, to_value: { status: live.status } })
    }
  }

  return events
}

function sameInstant(a, b) {
  if (!a && !b) return true
  if (!a || !b) return false
  return new Date(a).getTime() === new Date(b).getTime()
}

// GHL appointmentStatus -> our status. Only 'cancelled' is trustworthy: the
// showed/noshow marks are maintained on 5% of appointments (40/853 measured
// 2026-08-25), so the outcome form stays the source of truth for show vs no-show
// and this deliberately never derives one from the calendar.
function statusFromGhl(appointmentStatus) {
  const s = String(appointmentStatus || '').toLowerCase()
  if (s === 'cancelled' || s === 'canceled') return 'cancelled'
  return 'scheduled'
}

// The Pacific local calendar day an appointment falls on. Reports group on this,
// so it is computed once here rather than re-derived from a UTC instant at every
// call site, which is where the day-walk bugs come from.
function pacificDate(iso) {
  if (!iso) return null
  const d = new Date(iso)
  if (!Number.isFinite(d.getTime())) return null
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Los_Angeles',
    year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(d)
  const get = t => parts.find(p => p.type === t)?.value
  return `${get('year')}-${get('month')}-${get('day')}`
}

// Map one GHL calendar event onto our row shape. Kept here rather than in the
// reconciler so what the sync believes about an appointment can be tested
// without a database connection.
function rowFromEvent(evt, { loc, usersById }) {
  const trainer = usersById[evt.assignedUserId] || null
  const start = evt.startTime || null
  return {
    location_slug: loc.slug,
    ghl_appointment_id: evt.id,
    ghl_contact_id: evt.contactId || null,
    ghl_calendar_id: evt.calendarId || null,
    scheduled_date: pacificDate(start),
    scheduled_start: start ? new Date(start).toISOString() : null,
    scheduled_end: evt.endTime ? new Date(evt.endTime).toISOString() : null,
    booked_at: evt.dateAdded ? new Date(evt.dateAdded).toISOString() : null,
    // GHL's own last-touched stamp. A reschedule moves this and leaves
    // dateAdded alone, which is what lets an orphan find its appointment.
    ghl_updated_at: evt.dateUpdated ? new Date(evt.dateUpdated).toISOString() : null,
    trainer_ghl_user_id: evt.assignedUserId || null,
    trainer_name: trainer ? trainer.name : null,
    status: statusFromGhl(evt.appointmentStatus),
    source: 'ghl_reconcile',
  }
}

// Who booked it, when GHL actually knows. Only staff-made bookings carry a
// userId; the widget's is always null (803 of 853 appointments measured
// 2026-08-25), and inventing a name from the assigned trainer would credit the
// wrong person on the leaderboard.
function bookerFromEvent(evt, usersById) {
  const userId = evt?.createdBy?.userId
  if (!userId) return null
  const user = usersById[userId]
  if (!user) return null
  return { booked_by_name: user.name, booked_by_source: 'created_by' }
}

// A GHL workflow Webhook action sends the "Custom Data" key/value rows NESTED
// under `customData`, while a form submission's answers arrive at the top level.
// The two look identical when you configure them in GHL, so a reader that only
// checks the top level silently sees nothing and falls back to a default. That
// exact trap cost a Day One run its brand in PR #602.
//
// Flattening here means the endpoint accepts either shape, which is the only
// sane contract when the sender's nesting depends on where a human clicked.
function flattenWebhookBody(body = {}) {
  const nested = body.customData || body.custom_data || {}
  // Top level wins: a form answer is more specific than an action's Custom Data.
  return { ...(typeof nested === 'object' && nested !== null ? nested : {}), ...body }
}

// Field LABELS only, never values: the payload carries member PII, and a
// silently-defaulted run has to be diagnosable without logging a client's name.
function webhookLabels(body = {}) {
  const top = Object.keys(body)
  const nested = body.customData || body.custom_data
  const inner = (nested && typeof nested === 'object') ? Object.keys(nested) : []
  return inner.length ? `${top.join(',')} + customData{${inner.join(',')}}` : top.join(',')
}


module.exports = {
  sameInstant,
  flattenWebhookBody,
  webhookLabels,
  rowFromEvent,
  bookerFromEvent,
  PT_SALE_TYPES,
  NO_SALE_REASONS,
  CANCEL_REASONS,
  FORM_STATUSES,
  SALE_RESULTS,
  DEFAULT_RESCHEDULE_WINDOW_HOURS,
  validateOutcome,
  legacyGhlFields,
  pickOpenAppointments,
  linkReschedules,
  diffAppointment,
  statusFromGhl,
  pacificDate,
}
