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
// Created by scripts/create-cancel-reason-field.js --name="Day One Cancel Reason".
// Distinct from contact.cancel_reason, which is MEMBERSHIP cancellation.
const DAY_ONE_CANCEL_REASON_FIELD = 'contact.day_one_cancel_reason'

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

const calendarCache = {} // slug -> { promise, at }
const fieldCache = {}    // slug -> { promise, at }
const userCache = {}     // slug -> { promise, at }
const CACHE_TTL = 15 * 60 * 1000

// Caches the in-flight PROMISE, not the resolved value, which makes it
// single-flight: /api/config asks for the calendar, the roster and the fields
// concurrently, and the roster needs the calendar too. Caching values alone
// meant all of those raced past an empty cache and each refetched the same
// calendar — three duplicate round trips on every cold request.
function cached(store, key, ttl, produce) {
  const hit = store[key]
  if (hit && (Date.now() - hit.at) < ttl) return hit.promise
  // A rejection must not be cached, or one blip poisons the entry for the TTL.
  const promise = produce().catch(err => { delete store[key]; throw err })
  store[key] = { promise, at: Date.now() }
  return promise
}

function getDayOneCalendar(loc) {
  return cached(calendarCache, loc.slug, CACHE_TTL, async () => {
    const list = await ghlFetch('/calendars/', loc.apiKey, {
      params: { locationId: loc.id }, version: CAL_VERSION,
    })
    const match = (list.calendars || []).find(
      c => (c.name || '').trim().toLowerCase() === CALENDAR_NAME)
    if (!match) throw new Error(`No "Day One" calendar found for ${loc.name}`)
    // The list payload omits teamMembers on some calendars; the detail call is
    // authoritative for the round-robin roster and slot duration.
    const detail = await ghlFetch(`/calendars/${match.id}`, loc.apiKey, { version: CAL_VERSION })
    return detail.calendar || detail || match
  })
}

function getUsersById(loc) {
  return cached(userCache, loc.slug, CACHE_TTL, async () => {
    const data = await ghlFetch('/users/', loc.apiKey, { params: { locationId: loc.id } })
    const byId = {}
    for (const u of (data.users || [])) {
      byId[u.id] = {
        id: u.id,
        name: u.name || [u.firstName, u.lastName].filter(Boolean).join(' '),
        email: (u.email || '').toLowerCase(),
      }
    }
    return byId
  })
}

function getFieldsByKey(loc) {
  return cached(fieldCache, loc.slug, CACHE_TTL, async () => {
    const data = await ghlFetch(`/locations/${loc.id}/customFields`, loc.apiKey)
    const byKey = {}
    for (const f of (data.customFields || [])) {
      if (f.fieldKey) byKey[f.fieldKey] = f
    }
    return byKey
  })
}

// How far ahead this calendar will actually accept a booking, in days.
// free-slots simply stops returning slots past this, so asking wider is waste.
function bookableDays(calendar) {
  const n = Number(calendar.allowBookingFor)
  if (!Number.isFinite(n) || n <= 0) return 31
  const unit = String(calendar.allowBookingForUnit || 'days').toLowerCase()
  if (unit.startsWith('hour')) return Math.max(1, Math.ceil(n / 24))
  if (unit.startsWith('week')) return n * 7
  if (unit.startsWith('month')) return n * 31
  return n
}

// free-slots responses, cached briefly. Availability moves slowly relative to
// someone toggling between trainers or nudging the timezone, and every one of
// those was a fresh round trip before.
const slotsCache = {} // key -> { promise, at }
const SLOTS_TTL = 45 * 1000

function slotsFor(loc, calendar, params) {
  // Bucket the window so millisecond-different startDates still share an entry.
  const key = [
    loc.slug, calendar.id, params.userId || 'any', params.timezone,
    Math.floor(params.startDate / 60000), Math.floor(params.endDate / 60000),
  ].join('|')
  return cached(slotsCache, key, SLOTS_TTL, () =>
    ghlFetch(`/calendars/${calendar.id}/free-slots`, loc.apiKey, {
      params, version: CAL_VERSION,
    }))
}

// Run async work with a concurrency ceiling. GHL rate limits per location and
// ghlClient backs off a full 5s on a 429, so a burst is far more expensive than
// a queue: two at a time is dramatically faster than six at once.
async function mapLimit(items, limit, fn) {
  const out = new Array(items.length)
  let next = 0
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) {
      const i = next++
      out[i] = await fn(items[i], i)
    }
  })
  await Promise.all(workers)
  return out
}

// Every trainer's open instants across the booking window, as Sets keyed by
// userId. Fetched once per window and cached, which turns "who can take this
// slot?" into an in-memory lookup instead of an availability call per pick.
const trainerSlotsCache = {} // key -> { promise, at }

function getTrainerSlots(loc, calendar, timezone, days) {
  const startDate = Date.now()
  const endDate = startDate + days * 86400000
  const key = [loc.slug, calendar.id, timezone, days, Math.floor(startDate / 60000)].join('|')
  return cached(trainerSlotsCache, key, SLOTS_TTL, async () => {
    const roster = await trainerRoster(loc)
    const byUser = {}
    await mapLimit(roster, 2, async t => {
      try {
        const data = await slotsFor(loc, calendar, {
          startDate, endDate, timezone, userId: t.userId,
        })
        const set = new Set()
        for (const [k, v] of Object.entries(data)) {
          if (k === 'traceId' || !Array.isArray(v?.slots)) continue
          // Store instants: the same moment can be spelled with a different
          // UTC offset than the client sends back.
          for (const s of v.slots) set.add(new Date(s).getTime())
        }
        byUser[t.userId] = set
      } catch (e) {
        console.warn(`[DayOneWidget] slot prefetch failed for ${t.name}:`, e.message)
        byUser[t.userId] = new Set()
      }
    })
    return byUser
  })
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

// Cancel / reschedule share one page; the mode decides what it renders.
const MANAGE_PATH = path.join(__dirname, '..', 'public', 'dayOneManage.html')
let managePageTemplate = null

function renderManagePage(req, res, slug, mode) {
  try {
    if (!managePageTemplate || process.env.NODE_ENV !== 'production') {
      managePageTemplate = fs.readFileSync(MANAGE_PATH, 'utf8')
    }
    const html = managePageTemplate
      .split('{{WIDGET_BASE}}').join(req.baseUrl || '/day-one-booking')
      .split('{{WIDGET_LOCATION}}').join(slug)
      .split('{{WIDGET_MODE}}').join(mode)
    res.type('html').send(html)
  } catch (e) {
    console.error('[DayOneWidget] manage page render failed:', e.message)
    res.status(500).send('Page unavailable')
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

    // Warm the per-trainer availability in the background. The user still has
    // to pick a date and a time before it is needed, so by then it is cached
    // and the "who will they be with" step is instant instead of a fan-out.
    // Deliberately not awaited, and failures are the cache's problem, not this
    // response's.
    getTrainerSlots(loc, calendar, req.query.timezone || 'America/Los_Angeles',
      bookableDays(calendar)).catch(() => {})
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
  const requested = Math.min(Math.max(parseInt(req.query.days, 10) || 14, 1), 31)
  try {
    const calendar = await getDayOneCalendar(loc)
    // Never ask for a wider window than the calendar will actually book. The
    // page asks for a month so it can drive its grid, but Day One caps at
    // allowBookingFor (10 days) — the extra three weeks are pure latency for
    // slots GHL will never return.
    const days = Math.min(requested, bookableDays(calendar))
    const startDate = Date.now()
    const endDate = startDate + days * 86400000
    const params = {
      startDate, endDate,
      timezone: req.query.timezone || 'America/Los_Angeles',
    }
    if (req.query.userId) params.userId = req.query.userId
    const data = await slotsFor(loc, calendar, params)
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
//
// PERFORMANCE: this used to check every trainer concurrently and then filter.
// Six parallel free-slots calls against one location trips GHL's burst limit,
// and ghlClient backs off for a FULL FIVE SECONDS per 429 — a warm request
// measured 10.7s with 12 rate-limit retries logged. Ordering the roster first
// and checking one at a time until someone is free gives the identical answer
// (the first free trainer in priority order IS the top-tier free one) while
// normally costing a single call.

// Candidate order: the sequence we would hand the slot to. Pure and total, so
// the selection rule stays unit-testable without touching the network.
function orderCandidates(roster, counts) {
  return roster.slice().sort((a, b) =>
    (b.priority ?? 0) - (a.priority ?? 0) ||
    (counts[a.userId] || 0) - (counts[b.userId] || 0) ||
    a.name.localeCompare(b.name))
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

// Resolve who gets an "Anyone" booking. Used by both the pre-submit preview and
// the booking itself, so the name shown is produced by the same code that
// assigns it.
//
// Availability comes from the prefetched per-trainer window, so this is an
// in-memory scan. Checking candidates one at a time against GHL instead meant
// up to six sequential calls per slot, which repeatedly tripped the rate limit
// and its 5s backoff — a warm pick measured 11.6s.
async function resolveAssignment(loc, startTime, timezone) {
  const tz = timezone || 'America/Los_Angeles'
  const calendar = await getDayOneCalendar(loc)
  const [roster, counts, byUser] = await Promise.all([
    trainerRoster(loc),
    upcomingCounts(loc, calendar),
    getTrainerSlots(loc, calendar, tz, bookableDays(calendar)),
  ])
  const target = new Date(startTime).getTime()
  const pick = orderCandidates(roster, counts)
    .find(t => byUser[t.userId] && byUser[t.userId].has(target)) || null
  return { calendar, pick, counts }
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
    const { pick } = await resolveAssignment(loc, startTime, req.query.timezone)
    res.json({ pick: pick || null })
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

// ---------------------------------------------------------------------------
// Member-facing manage links (cancel / reschedule)
// ---------------------------------------------------------------------------
//
// These replace GHL's own /widget/booking/<calId>/<eventId>[/cancel] links,
// which route through the same widget that trips the captcha.
//
// They CANNOT be secret-gated: members do not have the widget secret. They are
// keyed on the GHL contact id, which is a 20-char random string — the same
// security model GHL itself uses, since its links carry a bare eventId. The
// server still confirms the contact actually has an upcoming Day One at that
// location before doing anything, and these routes are rate limited.

// Deliberately small and fixed. Free-text alone gives unreportable answers;
// a list makes "why are Salem Day Ones falling over" a query instead of a read.
const CANCEL_REASONS = [
  'Schedule conflict',
  'Sick / not feeling well',
  'No longer interested',
  'Joined somewhere else',
  'Cost',
  'Other',
]

const manageLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 20,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many requests, please wait a moment' },
})

// The member's upcoming Day One at this location, or null. Shared by the
// cancel and reschedule flows so both agree on what "their appointment" means.
// Resolve WHICH appointment a manage link refers to.
//
// The appointment id is authoritative when the link carries one. Falling back to
// "their soonest upcoming" is only safe when they have exactly one: with two
// booked, a link sent for the later appointment would silently move or cancel
// the earlier one, and the confirmation would look completely normal. So when
// the caller gives no id and more than one exists, this returns them all and
// refuses to guess — the page asks which.
async function upcomingForContact(loc, contactId, appointmentId) {
  const calendar = await getDayOneCalendar(loc)
  const data = await ghlFetch('/calendars/events', loc.apiKey, {
    params: {
      locationId: loc.id,
      calendarId: calendar.id,
      startTime: Date.now(),
      endTime: Date.now() + 120 * 86400000,
    },
    version: CAL_VERSION,
  })
  const mine = (data.events || [])
    .filter(e => e.contactId === contactId && !e.deleted)
    .filter(e => String(e.appointmentStatus || '').toLowerCase() !== 'cancelled')
    .sort((a, b) => new Date(a.startTime) - new Date(b.startTime))

  const usersById = await getUsersById(loc)
  const withTrainer = appt => ({
    calendar,
    appointment: appt,
    trainer: appt ? (usersById[appt.assignedUserId] || null) : null,
    candidates: mine,
  })

  if (appointmentId) {
    // Scoped to this contact's own appointments, so an id from elsewhere
    // cannot be used to reach someone else's booking.
    const exact = mine.find(e => e.id === appointmentId)
    return withTrainer(exact || null)
  }
  if (mine.length > 1) return { calendar, appointment: null, trainer: null, candidates: mine }
  return withTrainer(mine[0] || null)
}

// What the manage pages render from.
router.get('/api/appointment', manageLimiter, async (req, res) => {
  const loc = getLocationBySlug(String(req.query.location || '').toLowerCase())
  if (!loc) return res.status(400).json({ error: 'Unknown location' })
  const contactId = String(req.query.c || '').trim()
  if (!contactId) return res.status(400).json({ error: 'Missing link id' })
  try {
    const usersById = await getUsersById(loc)
    const { appointment, trainer, candidates } =
      await upcomingForContact(loc, contactId, String(req.query.a || '').trim() || null)

    // More than one upcoming and nothing to disambiguate: hand the list back so
    // the member picks, rather than acting on whichever happens to be first.
    if (!appointment && (candidates || []).length > 1) {
      return res.json({
        location: { slug: loc.slug, name: loc.name },
        appointment: null,
        reasons: CANCEL_REASONS,
        candidates: candidates.map(a => ({
          id: a.id,
          startTime: a.startTime,
          endTime: a.endTime,
          trainerName: (usersById[a.assignedUserId] || {}).name || null,
        })),
      })
    }
    if (!appointment) {
      return res.status(404).json({ error: 'No upcoming Day One found for this link.' })
    }
    res.json({
      location: { slug: loc.slug, name: loc.name },
      appointment: {
        id: appointment.id,
        startTime: appointment.startTime,
        endTime: appointment.endTime,
        title: appointment.title,
      },
      trainer: trainer ? { userId: appointment.assignedUserId, name: trainer.name } : null,
      reasons: CANCEL_REASONS,
    })
  } catch (e) {
    console.error('[DayOneWidget] appointment lookup failed:', e.message)
    res.status(502).json({ error: e.message })
  }
})

// Open times for a reschedule.
//
// A dedicated endpoint rather than reusing /api/slots: that one is secret-gated
// for staff, and members do not have the secret. Keying on the contact also
// means the trainer is resolved server-side — the client cannot ask for someone
// else's availability, and cannot smuggle in a different trainer.
router.get('/api/reschedule-slots', manageLimiter, async (req, res) => {
  const loc = getLocationBySlug(String(req.query.location || '').toLowerCase())
  if (!loc) return res.status(400).json({ error: 'Unknown location' })
  const contactId = String(req.query.c || '').trim()
  if (!contactId) return res.status(400).json({ error: 'Missing link id' })

  try {
    const { calendar, appointment, trainer } = await upcomingForContact(loc, contactId, String(req.query.a || '').trim() || null)
    if (!appointment) {
      return res.status(404).json({ error: 'No upcoming Day One found for this link.' })
    }
    // Same trainer only. Without an assignment there is nobody to hold the
    // slot for, so send them to the phone rather than silently reassigning.
    if (!appointment.assignedUserId) {
      return res.json({ trainer: null, days: {} })
    }

    const days = Math.min(31, bookableDays(calendar))
    const startDate = Date.now()
    const data = await slotsFor(loc, calendar, {
      startDate,
      endDate: startDate + days * 86400000,
      timezone: req.query.timezone || 'America/Los_Angeles',
      userId: appointment.assignedUserId,
    })

    const current = new Date(appointment.startTime).getTime()
    const byDate = {}
    for (const [key, val] of Object.entries(data)) {
      if (key === 'traceId' || !Array.isArray(val?.slots)) continue
      // Their existing slot is already theirs; offering it back reads as a bug.
      const open = val.slots.filter(s => new Date(s).getTime() !== current)
      if (open.length) byDate[key] = open
    }
    res.json({
      trainer: trainer ? { userId: appointment.assignedUserId, name: trainer.name } : null,
      days: byDate,
    })
  } catch (e) {
    console.error('[DayOneWidget] reschedule slots failed:', e.message)
    res.status(502).json({ error: e.message })
  }
})

// Cancel, capturing why.
//
// The reason is recorded BEFORE the appointment is cancelled: cancelling first
// and then failing to record would lose the answer entirely, which is the whole
// point of the flow. The Supabase row is the reportable copy; the GHL field is
// for front desk and only ever holds the latest value.
router.post('/api/cancel', manageLimiter, async (req, res) => {
  const { location, c: contactId, reason, notes } = req.body || {}
  const loc = getLocationBySlug(String(location || '').toLowerCase())
  if (!loc) return res.status(400).json({ error: 'Unknown location' })
  if (!contactId) return res.status(400).json({ error: 'Missing link id' })
  if (!CANCEL_REASONS.includes(reason)) {
    return res.status(400).json({ error: 'Please choose a reason' })
  }

  try {
    const { appointment, trainer } = await upcomingForContact(loc, String(contactId), String(req.body.a || '').trim() || null)
    if (!appointment) {
      return res.status(404).json({ error: 'No upcoming Day One found for this link.' })
    }

    // Free text from an unauthenticated page: cap it so a bad actor cannot
    // stuff the contact record or the table with a 100kb payload.
    const cleanNotes = String(notes || '').trim().slice(0, 1000)
    const detail = `${reason}${cleanNotes ? ` — ${cleanNotes}` : ''}`

    // 1. Reportable copy. Unique on appointment id, so a double submit updates
    // rather than inflating the counts.
    try {
      // Required lazily: services/supabase builds its client at import time and
      // throws without SUPABASE_URL, which would make this whole module — and
      // the pure selection logic its unit tests cover — unimportable without a
      // database configured.
      const { supabaseAdmin } = require('../services/supabase')
      await supabaseAdmin.from('day_one_cancellations').upsert({
        location_slug: loc.slug,
        ghl_contact_id: String(contactId),
        ghl_appointment_id: appointment.id,
        assigned_user_id: appointment.assignedUserId || null,
        trainer_name: trainer?.name || null,
        appointment_start: appointment.startTime || null,
        reason,
        notes: cleanNotes || null,
      }, { onConflict: 'ghl_appointment_id' })
    } catch (e) {
      console.error('[DayOneWidget] cancellation record failed:', e.message)
    }

    // 2. Front-desk visibility on the contact. Skipped without complaint if the
    // field has not been created yet (scripts/create-cancel-reason-field.js
    // --name="Day One Cancel Reason").
    try {
      const fields = await getFieldsByKey(loc)
      const field = fields[DAY_ONE_CANCEL_REASON_FIELD]
      if (field) {
        await ghlFetch(`/contacts/${contactId}`, loc.apiKey, {
          method: 'PUT', body: { customFields: [{ id: field.id, value: detail }] },
        })
      } else {
        console.warn(`[DayOneWidget] ${DAY_ONE_CANCEL_REASON_FIELD} missing at ${loc.name}; reason kept in Supabase only`)
      }
    } catch (e) {
      console.error('[DayOneWidget] cancel reason write failed:', e.message)
    }

    // 3. Cancel in GHL. Status update, NOT DELETE: DELETE removes the
    // appointment silently and the member and trainer are never told.
    await ghlFetch(`/calendars/events/appointments/${appointment.id}`, loc.apiKey, {
      method: 'PUT',
      body: { appointmentStatus: 'cancelled', toNotify: true },
      version: CAL_VERSION,
    })

    res.json({ ok: true, appointmentId: appointment.id, reason })
  } catch (e) {
    console.error('[DayOneWidget] cancel failed:', e.message)
    res.status(502).json({ error: e.message })
  }
})

// Reschedule, keeping the same trainer.
router.post('/api/reschedule', manageLimiter, async (req, res) => {
  const { location, c: contactId, startTime } = req.body || {}
  const loc = getLocationBySlug(String(location || '').toLowerCase())
  if (!loc) return res.status(400).json({ error: 'Unknown location' })
  if (!contactId) return res.status(400).json({ error: 'Missing link id' })
  if (!startTime) return res.status(400).json({ error: 'Pick a new time' })

  try {
    const { calendar, appointment } = await upcomingForContact(loc, String(contactId), String(req.body.a || '').trim() || null)
    if (!appointment) {
      return res.status(404).json({ error: 'No upcoming Day One found for this link.' })
    }

    const minutes = calendar.slotDurationUnit === 'hours'
      ? (calendar.slotDuration || 1) * 60
      : (calendar.slotDuration || 60)
    const endTime = new Date(new Date(startTime).getTime() + minutes * 60000).toISOString()

    // assignedUserId is re-sent unchanged. GHL's PUT does not reliably preserve
    // omitted fields, and silently reassigning someone's trainer on a
    // reschedule is exactly the surprise this flow exists to avoid.
    const updated = await ghlFetch(`/calendars/events/appointments/${appointment.id}`, loc.apiKey, {
      method: 'PUT',
      body: {
        calendarId: calendar.id,
        startTime,
        endTime,
        assignedUserId: appointment.assignedUserId,
        toNotify: true,
      },
      version: CAL_VERSION,
    })

    res.json({
      ok: true,
      appointmentId: appointment.id,
      startTime: updated?.startTime || startTime,
      endTime: updated?.endTime || endTime,
      assignedUserId: appointment.assignedUserId || null,
    })
  } catch (e) {
    console.error('[DayOneWidget] reschedule failed:', e.message)
    res.status(502).json({ error: e.message })
  }
})

// Manage pages. Two segments, so they are matched before the one-segment
// per-location booking link below.
router.get('/:location/cancel', (req, res, next) => {
  const slug = String(req.params.location || '').toLowerCase()
  if (!getLocationBySlug(slug)) return next()
  renderManagePage(req, res, slug, 'cancel')
})

router.get('/:location/reschedule', (req, res, next) => {
  const slug = String(req.params.location || '').toLowerCase()
  if (!getLocationBySlug(slug)) return next()
  renderManagePage(req, res, slug, 'reschedule')
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
module.exports.orderCandidates = orderCandidates
