// Standalone Day One booking widget — an API-driven replacement for the embedded
// GHL booking widget (`/widget/booking/<calendarId>`).
//
// Why this exists: the embedded widget shows a Cloudflare "verify you are human"
// checkbox inside the portal iframe. That box is NOT a Cloudflare WAF rule and
// cannot be turned off from our side — the widget bundle flips it on solely when
// `POST /forms/submit` returns 429:
//
//     .catch(x => { if ([429].includes(x.status) ? qe.value = !0 : at(), ...
//
// A whole gym shares one WAN IP hitting one form, and in a cross-origin iframe the
// widget's `__cf_bm` cookie is partitioned away, so every submit looks like a brand
// new anonymous client. Booking through the Calendar API sidesteps the form endpoint
// entirely.
//
// Verified live before building (Salem "Day One", 2026-08-17): an appointment created
// via POST /calendars/events/appointments with `toNotify: true` DOES fire the
// calendar's own notification set — the contact SMS and the assigned-trainer SMS both
// arrived — even though the record shows `createdBy: {source:"third_party"}`. Those
// notifications live at GET /calendars/:id/notifications, NOT on the calendar document
// (which reports `notifications: []` and misleads you into thinking there are none).
//
// This module is deliberately standalone: it serves its own page and is not wired
// into the portal. Wiring it into the tour check-in flow is a separate change.
const { Router } = require('express')
const path = require('path')
const rateLimit = require('express-rate-limit')
const { LOCATIONS, getLocationBySlug } = require('../config/ghlLocations')
const { ghlFetch } = require('../services/ghlClient')

const router = Router()

// Calendar endpoints need the older version header; contacts use the client default.
const CAL_VERSION = '2021-04-15'
const CALENDAR_NAME = 'day one'
const DAY_ONE_TEAM_FIELD = 'contact.day_one_booking_team_member'
const DAY_ONE_DATE_FIELD = 'contact.day_one_booking_date'
const DAY_ONE_BOOKED_FIELD = 'contact.day_one_booked'

// The page itself is harmless to load, but every API call is gated on a shared
// secret while this is a test artifact. Fail CLOSED: if the env var is missing the
// endpoints refuse rather than standing up an open booking API on the internet.
function requireWidgetSecret(req, res, next) {
  const expected = process.env.DAYONE_WIDGET_SECRET
  if (!expected) {
    return res.status(503).json({ error: 'DAYONE_WIDGET_SECRET is not configured; booking API disabled' })
  }
  const given = req.get('x-widget-secret') || req.query.secret || ''
  if (given !== expected) return res.status(401).json({ error: 'Invalid or missing widget secret' })
  next()
}

// Booking writes to GHL and sends SMS, so cap it well below anything a human needs.
const bookLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many booking attempts, slow down' },
})

// ---------------------------------------------------------------------------
// GHL lookups (cached — calendar shape and field IDs change rarely, and the
// custom-field IDs differ per location so they must never be hardcoded)
// ---------------------------------------------------------------------------

const calendarCache = {} // slug -> { calendar, at }
const fieldCache = {}    // slug -> { byKey, at }
const userCache = {}     // slug -> { byId, at }
const CACHE_TTL = 15 * 60 * 1000

function fresh(entry) {
  return entry && (Date.now() - entry.at) < CACHE_TTL
}

async function getDayOneCalendar(loc) {
  if (fresh(calendarCache[loc.slug])) return calendarCache[loc.slug].calendar
  const list = await ghlFetch('/calendars/', loc.apiKey, {
    params: { locationId: loc.id }, version: CAL_VERSION,
  })
  const match = (list.calendars || []).find(
    c => (c.name || '').trim().toLowerCase() === CALENDAR_NAME)
  if (!match) throw new Error(`No "Day One" calendar found for ${loc.name}`)
  // The list payload omits teamMembers on some calendars; the detail call is
  // authoritative for the round-robin roster and slot duration.
  const detail = await ghlFetch(`/calendars/${match.id}`, loc.apiKey, { version: CAL_VERSION })
  const calendar = detail.calendar || detail || match
  calendarCache[loc.slug] = { calendar, at: Date.now() }
  return calendar
}

async function getUsersById(loc) {
  if (fresh(userCache[loc.slug])) return userCache[loc.slug].byId
  const data = await ghlFetch('/users/', loc.apiKey, { params: { locationId: loc.id } })
  const byId = {}
  for (const u of (data.users || [])) {
    byId[u.id] = {
      id: u.id,
      name: u.name || [u.firstName, u.lastName].filter(Boolean).join(' '),
      email: (u.email || '').toLowerCase(),
    }
  }
  userCache[loc.slug] = { byId, at: Date.now() }
  return byId
}

async function getFieldsByKey(loc) {
  if (fresh(fieldCache[loc.slug])) return fieldCache[loc.slug].byKey
  const data = await ghlFetch(`/locations/${loc.id}/customFields`, loc.apiKey)
  const byKey = {}
  for (const f of (data.customFields || [])) {
    if (f.fieldKey) byKey[f.fieldKey] = f
  }
  fieldCache[loc.slug] = { byKey, at: Date.now() }
  return byKey
}

function optionLabel(o) {
  if (typeof o === 'string') return o
  return (o && (o.label || o.value || o.name || o.option)) || ''
}

// The trainer roster shown to staff must be the calendar's actual round-robin
// members (those are who GHL can assign), resolved to real names.
async function trainerRoster(loc) {
  const [calendar, usersById] = await Promise.all([getDayOneCalendar(loc), getUsersById(loc)])
  const members = Array.isArray(calendar.teamMembers) ? calendar.teamMembers : []
  return members
    .map(m => {
      const userId = typeof m === 'string' ? m : (m.userId || m.id)
      const user = usersById[userId]
      if (!user) return null
      return { userId, name: user.name, email: user.email, priority: m.priority ?? null }
    })
    .filter(Boolean)
    .sort((a, b) => (b.priority ?? 0) - (a.priority ?? 0) || a.name.localeCompare(b.name))
}

// ---------------------------------------------------------------------------
// Routes
// ---------------------------------------------------------------------------

// The standalone page. No secret needed to view it; it prompts for one and sends
// it on every API call.
router.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, '..', 'public', 'dayOneBooking.html'))
})

router.get('/api/locations', requireWidgetSecret, (req, res) => {
  res.json({ locations: LOCATIONS.map(l => ({ slug: l.slug, name: l.name })) })
})

// Calendar shape + who can be booked + the valid "tour member" picklist values.
router.get('/api/config', requireWidgetSecret, async (req, res) => {
  const loc = getLocationBySlug(String(req.query.location || '').toLowerCase())
  if (!loc) return res.status(400).json({ error: 'Unknown location' })
  try {
    const [calendar, trainers, fields] = await Promise.all([
      getDayOneCalendar(loc), trainerRoster(loc), getFieldsByKey(loc),
    ])
    const teamField = fields[DAY_ONE_TEAM_FIELD]
    res.json({
      location: { slug: loc.slug, name: loc.name },
      calendar: {
        id: calendar.id,
        name: calendar.name,
        slotDuration: calendar.slotDuration,
        slotDurationUnit: calendar.slotDurationUnit,
        // free-slots stops returning slots past this cap, so the UI should not
        // offer a date range beyond it and then look broken.
        allowBookingFor: calendar.allowBookingFor,
        allowBookingForUnit: calendar.allowBookingForUnit,
      },
      trainers,
      tourMembers: (teamField?.picklistOptions || teamField?.options || [])
        .map(optionLabel).filter(Boolean),
    })
  } catch (e) {
    console.error('[DayOneWidget] config failed:', e.message)
    res.status(502).json({ error: e.message })
  }
})

// Availability. Omit userId for "anyone" (GHL applies its round-robin priority);
// pass one to narrow to that trainer's own schedule.
router.get('/api/slots', requireWidgetSecret, async (req, res) => {
  const loc = getLocationBySlug(String(req.query.location || '').toLowerCase())
  if (!loc) return res.status(400).json({ error: 'Unknown location' })
  const days = Math.min(Math.max(parseInt(req.query.days, 10) || 14, 1), 31)
  try {
    const calendar = await getDayOneCalendar(loc)
    const startDate = Date.now()
    const endDate = startDate + days * 86400000
    const params = {
      startDate, endDate,
      timezone: req.query.timezone || 'America/Los_Angeles',
    }
    if (req.query.userId) params.userId = req.query.userId
    const data = await ghlFetch(`/calendars/${calendar.id}/free-slots`, loc.apiKey, {
      params, version: CAL_VERSION,
    })
    // Response is keyed by date with a stray traceId mixed in at the top level.
    const byDate = {}
    for (const [key, val] of Object.entries(data)) {
      if (key === 'traceId' || !val || !Array.isArray(val.slots)) continue
      if (val.slots.length) byDate[key] = val.slots
    }
    res.json({ calendarId: calendar.id, days: byDate })
  } catch (e) {
    console.error('[DayOneWidget] slots failed:', e.message)
    res.status(502).json({ error: e.message })
  }
})

// Book. Three steps, in this order:
//   1. upsert the contact (so we have a contactId and the notification merge
//      fields resolve to a real person)
//   2. create the appointment with toNotify — this is what fires the SMS
//   3. write the Day One custom fields onto the contact
// Step 3 is last on purpose: a custom-field failure must not cost us the booking,
// so it is reported but non-fatal.
router.post('/api/book', requireWidgetSecret, bookLimiter, async (req, res) => {
  const {
    location, firstName, lastName, email, phone,
    userId, startTime, tourMember, notes,
  } = req.body || {}

  const loc = getLocationBySlug(String(location || '').toLowerCase())
  if (!loc) return res.status(400).json({ error: 'Unknown location' })
  if (!startTime) return res.status(400).json({ error: 'startTime is required' })
  if (!firstName?.trim()) return res.status(400).json({ error: 'First name is required' })
  if (!email?.trim() && !phone?.trim()) {
    return res.status(400).json({ error: 'An email or phone is required' })
  }

  try {
    const calendar = await getDayOneCalendar(loc)

    // 1. Contact. upsert matches on email/phone so re-booking an existing member
    // updates them instead of creating a duplicate.
    const contactBody = {
      locationId: loc.id,
      firstName: firstName.trim(),
      lastName: (lastName || '').trim(),
    }
    if (email?.trim()) contactBody.email = email.trim()
    if (phone?.trim()) contactBody.phone = phone.trim()
    const upserted = await ghlFetch('/contacts/upsert', loc.apiKey, {
      method: 'POST', body: contactBody,
    })
    const contactId = upserted?.contact?.id
    if (!contactId) throw new Error('Contact upsert returned no id')

    // 2. Appointment. endTime is derived from the calendar's own slot duration so
    // we never disagree with what the slot picker offered.
    const minutes = calendar.slotDurationUnit === 'hours'
      ? (calendar.slotDuration || 1) * 60
      : (calendar.slotDuration || 60)
    const endTime = new Date(new Date(startTime).getTime() + minutes * 60000).toISOString()

    const apptBody = {
      calendarId: calendar.id,
      locationId: loc.id,
      contactId,
      startTime,
      endTime,
      title: `Day One - ${[firstName, lastName].filter(Boolean).join(' ')}`.trim(),
      appointmentStatus: 'confirmed',
      // The whole point: this is what makes the calendar's notification set fire.
      toNotify: true,
      ignoreDateRange: false,
    }
    // Omitted entirely for "anyone" so GHL runs its round-robin rotation.
    if (userId) apptBody.assignedUserId = userId

    const appt = await ghlFetch('/calendars/events/appointments', loc.apiKey, {
      method: 'POST', body: apptBody, version: CAL_VERSION,
    })

    // 3. Custom fields. IDs differ per location, so resolve by fieldKey.
    let customFieldsWritten = true
    let customFieldError = null
    try {
      const fields = await getFieldsByKey(loc)
      const customFields = []
      const push = (key, value) => {
        const f = fields[key]
        if (f && value !== undefined && value !== null && value !== '') {
          customFields.push({ id: f.id, value })
        }
      }
      push(DAY_ONE_TEAM_FIELD, tourMember)
      // DATE field wants a plain calendar date, not the full ISO timestamp.
      push(DAY_ONE_DATE_FIELD, String(startTime).slice(0, 10))
      push(DAY_ONE_BOOKED_FIELD, 'Yes')
      if (customFields.length) {
        await ghlFetch(`/contacts/${contactId}`, loc.apiKey, {
          method: 'PUT', body: { customFields },
        })
      }
    } catch (e) {
      customFieldsWritten = false
      customFieldError = e.message
      console.error('[DayOneWidget] custom field write failed (booking kept):', e.message)
    }

    res.json({
      ok: true,
      appointmentId: appt.id,
      contactId,
      assignedUserId: appt.assignedUserId || null,
      startTime: appt.startTime || startTime,
      endTime: appt.endTime || endTime,
      notes: notes || null,
      customFieldsWritten,
      customFieldError,
    })
  } catch (e) {
    console.error('[DayOneWidget] booking failed:', e.message)
    res.status(502).json({ error: e.message })
  }
})

module.exports = router
