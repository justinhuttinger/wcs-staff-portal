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
const fs = require('fs')
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
// Each location gets its own link (/day-one-booking/salem). The page is served
// with the mount base and location baked in rather than letting the client infer
// them from the URL — with a location segment in the path, any client-side
// guess at the API base is wrong the moment the route shape changes.
const PAGE_PATH = path.join(__dirname, '..', 'public', 'dayOneBooking.html')
let pageTemplate = null

function renderPage(req, res, slug) {
  try {
    if (!pageTemplate || process.env.NODE_ENV !== 'production') {
      pageTemplate = fs.readFileSync(PAGE_PATH, 'utf8')
    }
    const html = pageTemplate
      .split('{{WIDGET_BASE}}').join(req.baseUrl || '/day-one-booking')
      .split('{{WIDGET_LOCATION}}').join(slug || '')
    res.type('html').send(html)
  } catch (e) {
    console.error('[DayOneWidget] page render failed:', e.message)
    res.status(500).send('Booking page unavailable')
  }
}

// /day-one-booking/ — no location; the page offers the per-location links.
// ?location=salem is also honored so an existing link keeps working.
router.get('/', (req, res) => {
  const slug = String(req.query.location || '').toLowerCase()
  renderPage(req, res, getLocationBySlug(slug) ? slug : '')
})

// Served from the mount point so the page can reference it relatively.
router.get('/logo.png', (req, res) => {
  res.sendFile(path.join(__dirname, '..', 'assets', 'logo.png'))
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

// --- "Anyone" assignment ----------------------------------------------------
//
// GHL never reveals its round-robin decision until the appointment exists, so
// as long as we omit assignedUserId the best we can ever say is "likely". To
// state the trainer as FACT before submitting, we make the choice ourselves and
// send assignedUserId explicitly — the assignment is then ours, not GHL's.
//
// That means we owe the roster a fair distribution, because always taking the
// highest priority would dump every Day One on one person. The rule:
//   1. only trainers actually free at that slot are eligible
//   2. among those, keep the highest priority tier present — this preserves the
//      calendar's own config, so a priority-0 member is only reached when they
//      are the only one open
//   3. within that tier, pick whoever has the fewest upcoming Day Ones
//   4. tie-break on name so the result is deterministic and testable

// Who is genuinely free at this exact instant?
async function freeTrainersForSlot(loc, calendar, roster, startTime, timezone) {
  const target = new Date(startTime).getTime()
  const params = {
    // Narrow window keeps this to one cheap call per trainer.
    startDate: target - 60 * 60000,
    endDate: target + 60 * 60000,
    timezone: timezone || 'America/Los_Angeles',
  }
  const checks = await Promise.all(roster.map(async t => {
    try {
      const data = await ghlFetch(`/calendars/${calendar.id}/free-slots`, loc.apiKey, {
        params: { ...params, userId: t.userId }, version: CAL_VERSION,
      })
      // Compare instants, not strings: the same moment can be spelled with a
      // different UTC offset than the client sent.
      const free = Object.entries(data).some(([key, val]) =>
        key !== 'traceId' && Array.isArray(val?.slots) &&
        val.slots.some(s => new Date(s).getTime() === target))
      return free ? t : null
    } catch (e) {
      console.warn(`[DayOneWidget] availability check failed for ${t.name}:`, e.message)
      return null
    }
  }))
  return checks.filter(Boolean)
}

// Upcoming Day One count per trainer, for load balancing. Short TTL: it changes
// with every booking, and a stale count would skew the rotation.
const loadCache = {} // slug -> { counts, at }
const LOAD_TTL = 60 * 1000

async function upcomingCounts(loc, calendar) {
  const hit = loadCache[loc.slug]
  if (hit && (Date.now() - hit.at) < LOAD_TTL) return hit.counts
  const counts = {}
  try {
    const data = await ghlFetch('/calendars/events', loc.apiKey, {
      params: {
        locationId: loc.id, calendarId: calendar.id,
        startTime: Date.now(), endTime: Date.now() + 30 * 86400000,
      },
      version: CAL_VERSION,
    })
    for (const e of (data.events || [])) {
      if (e.assignedUserId) counts[e.assignedUserId] = (counts[e.assignedUserId] || 0) + 1
    }
  } catch (e) {
    // Balancing is an optimization; an empty map just falls back to name order.
    console.warn('[DayOneWidget] upcoming counts failed, balancing skipped:', e.message)
  }
  loadCache[loc.slug] = { counts, at: Date.now() }
  return counts
}

function chooseTrainer(free, counts) {
  if (!free.length) return null
  const topPriority = Math.max(...free.map(t => t.priority ?? 0))
  return free
    .filter(t => (t.priority ?? 0) === topPriority)
    .slice()
    .sort((a, b) =>
      (counts[a.userId] || 0) - (counts[b.userId] || 0) ||
      a.name.localeCompare(b.name))[0]
}

// Resolve who gets an "Anyone" booking. Used by both the pre-submit preview and
// the booking itself, so the name shown is produced by the same code that
// assigns it.
async function resolveAssignment(loc, startTime, timezone) {
  const [calendar, roster] = await Promise.all([getDayOneCalendar(loc), trainerRoster(loc)])
  const free = await freeTrainersForSlot(loc, calendar, roster, startTime, timezone)
  const counts = await upcomingCounts(loc, calendar)
  return { calendar, free, pick: chooseTrainer(free, counts), counts }
}

// Pre-submit: who WILL take this slot. `pick` is the trainer we will actually
// send, not a guess — the booking assigns explicitly.
router.get('/api/slot-trainers', requireWidgetSecret, async (req, res) => {
  const loc = getLocationBySlug(String(req.query.location || '').toLowerCase())
  if (!loc) return res.status(400).json({ error: 'Unknown location' })
  const startTime = String(req.query.startTime || '')
  if (!startTime) return res.status(400).json({ error: 'startTime is required' })
  if (!Number.isFinite(new Date(startTime).getTime())) {
    return res.status(400).json({ error: 'Invalid startTime' })
  }
  try {
    const { free, pick } = await resolveAssignment(loc, startTime, req.query.timezone)
    res.json({ trainers: free, pick: pick || null })
  } catch (e) {
    console.error('[DayOneWidget] slot-trainers failed:', e.message)
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

    // 0. Decide the trainer BEFORE writing anything. "Anyone" is resolved here,
    // at booking time, by the same code that produced the pre-submit preview —
    // so the name the user saw is the name that gets assigned. `expectedUserId`
    // is what the page displayed; if availability shifted in the seconds since,
    // we re-pick and say so rather than silently assigning someone else.
    let assignTo = userId || null
    let autoAssigned = false
    let reassignedFrom = null
    if (!assignTo) {
      const { pick } = await resolveAssignment(loc, startTime, req.body.timezone)
      if (!pick) {
        return res.status(409).json({
          error: 'No trainer is available at that time. Please pick another slot.',
        })
      }
      autoAssigned = true
      assignTo = pick.userId
      const expected = req.body.expectedUserId
      if (expected && expected !== pick.userId) reassignedFrom = expected
    }

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
    // Always explicit. Leaving this off would hand the choice back to GHL's
    // opaque rotation, which is exactly what makes the trainer unknowable
    // before submit.
    apptBody.assignedUserId = assignTo

    const appt = await ghlFetch('/calendars/events/appointments', loc.apiKey, {
      method: 'POST', body: apptBody, version: CAL_VERSION,
    })

    // 3. Custom fields. IDs differ per location, so resolve by fieldKey.
    let customFieldsWritten = true
    let customFieldError = null
    const customFieldsSet = []
    const customFieldsSkipped = []
    try {
      const fields = await getFieldsByKey(loc)
      const customFields = []
      const push = (key, value) => {
        const f = fields[key]
        if (!f) return customFieldsSkipped.push(`${key} (no such field at ${loc.name})`)
        if (value === undefined || value === null || value === '') {
          return customFieldsSkipped.push(`${key} (empty value)`)
        }
        customFields.push({ id: f.id, value })
        customFieldsSet.push(key.replace(/^contact\./, ''))
      }
      push(DAY_ONE_TEAM_FIELD, tourMember)
      // DATE field wants a plain calendar date, not the full ISO timestamp.
      // NOTE: this is the APPOINTMENT date. A GHL workflow also writes Day One
      // fields on booking and may overwrite this with the date the booking was
      // made — if reports look off, check the workflow before this line.
      push(DAY_ONE_DATE_FIELD, String(startTime).slice(0, 10))
      push(DAY_ONE_BOOKED_FIELD, 'Yes')
      if (customFields.length) {
        await ghlFetch(`/contacts/${contactId}`, loc.apiKey, {
          method: 'PUT', body: { customFields },
        })
      } else {
        // Nothing resolved. Previously this reported success, which made a
        // total no-op look identical to a clean write.
        customFieldsWritten = false
        customFieldError = 'No fields resolved: ' + customFieldsSkipped.join('; ')
      }
      if (customFieldsSkipped.length) {
        console.warn('[DayOneWidget] custom fields skipped:', customFieldsSkipped.join('; '))
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
      assignedUserId: appt.assignedUserId || assignTo || null,
      autoAssigned,
      reassignedFrom,
      startTime: appt.startTime || startTime,
      endTime: appt.endTime || endTime,
      notes: notes || null,
      customFieldsWritten,
      customFieldsSet,
      customFieldsSkipped,
      customFieldError,
    })
  } catch (e) {
    console.error('[DayOneWidget] booking failed:', e.message)
    res.status(502).json({ error: e.message })
  }
})

// Per-location link: /day-one-booking/salem. Declared LAST so it can never
// shadow /logo.png or the /api/* routes above it, and it only matches a real
// location slug so a typo 404s instead of silently serving a locationless page.
router.get('/:location', (req, res, next) => {
  const slug = String(req.params.location || '').toLowerCase()
  if (!getLocationBySlug(slug)) return next()
  renderPage(req, res, slug)
})

module.exports = router
// Exported for unit tests: the selection rule is the part that must stay
// deterministic and fair, and it cannot be exercised through the live API when
// the roster has no upcoming appointments to balance against.
module.exports.chooseTrainer = chooseTrainer
