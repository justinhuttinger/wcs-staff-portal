// Gym Tour booking page: book.westcoaststrength.com/tour/<slug>.
//
// Same idea as the Day One page, built on the same helpers, but simpler: each
// club's tour calendar is a `personal` GHL calendar with one team member, so
// there is no trainer to choose or round-robin to resolve. GHL assigns the
// owner, the same as the Meet with Justin page.
//
// Which calendar: app_config `tour_calendar_<slug>` (a GHL calendar id). If that
// is not set, the id is read from the club's Tour action link
// (`tour_url_<slug>`) when that is a GHL /widget/booking/<id> link, which is
// what every club had before this page existed. The separate key lets the Tour
// action link point at this page later without losing the calendar.
//
// Personal links from GHL texts work like Day One: /tour/<slug>?c={{contact.id}}
// shows "Booking for Jane D." and books that contact; "Not you?" brings back the
// blank form. Cancel and reschedule stay in GHL's own flow.
const { Router } = require('express')
const path = require('path')
const fs = require('fs')
const rateLimit = require('express-rate-limit')
const { LOCATIONS, getLocationBySlug } = require('../config/ghlLocations')
const { ghlFetch } = require('../services/ghlClient')
const { supabaseAdmin } = require('../services/supabase')
const { CAL_VERSION, cached, bookableDays, slotsFor, slotsByDate } = require('../lib/ghlBooking')
const { linkedContact, publicName } = require('../lib/ghlContactLink')

const router = Router()

// Public page, so the limits are the protection (same numbers as Day One).
const bookLimiter = rateLimit({
  windowMs: 60 * 1000, max: 6, standardHeaders: true, legacyHeaders: false,
  message: { error: 'Too many booking attempts, slow down' },
})
const readLimiter = rateLimit({
  windowMs: 60 * 1000, max: 60, standardHeaders: true, legacyHeaders: false,
  message: { error: 'Too many requests, please wait a moment' },
})

const CACHE_TTL = 5 * 60 * 1000
const calendarCache = {} // slug -> { promise, at }

// A GHL calendar id from a /widget/booking/<id> link, or null.
function calendarIdFromUrl(url) {
  const m = /\/widget\/booking\/([A-Za-z0-9]{10,40})(?:[/?#]|$)/.exec(String(url || ''))
  return m ? m[1] : null
}

async function tourCalendarId(slug) {
  const { data, error } = await supabaseAdmin
    .from('app_config').select('key, value')
    .in('key', [`tour_calendar_${slug}`, `tour_url_${slug}`])
  if (error) throw error
  const byKey = Object.fromEntries((data || []).map(r => [r.key, r.value]))
  const direct = String(byKey[`tour_calendar_${slug}`] || '').trim()
  if (/^[A-Za-z0-9]{10,40}$/.test(direct)) return direct
  return calendarIdFromUrl(byKey[`tour_url_${slug}`])
}

// The club's tour calendar, checked to belong to the club's own GHL location so
// a mistyped id can never book into another account.
function getTourCalendar(loc) {
  return cached(calendarCache, loc.slug, CACHE_TTL, async () => {
    const id = await tourCalendarId(loc.slug)
    if (!id) {
      const err = new Error(`No tour calendar is set for ${loc.name}`)
      err.status = 404
      throw err
    }
    const detail = await ghlFetch(`/calendars/${id}`, loc.apiKey, { version: CAL_VERSION })
    const calendar = detail.calendar || detail
    if (!calendar?.id || (calendar.locationId && calendar.locationId !== loc.id)) {
      const err = new Error(`The tour calendar for ${loc.name} is not in its GHL account`)
      err.status = 502
      throw err
    }
    return calendar
  })
}

function minutesOf(calendar) {
  return calendar.slotDurationUnit === 'hours'
    ? (calendar.slotDuration || 1) * 60
    : (calendar.slotDuration || 15)
}

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

const PAGE_PATH = path.join(__dirname, '..', 'public', 'tourBooking.html')
let template = null

function renderPage(req, res, slug) {
  try {
    if (!template || process.env.NODE_ENV !== 'production') {
      template = fs.readFileSync(PAGE_PATH, 'utf8')
    }
    res.type('html').send(template
      .split('{{WIDGET_BASE}}').join(req.baseUrl || '/tour')
      .split('{{WIDGET_LOCATION}}').join(slug || ''))
  } catch (e) {
    console.error('[TourWidget] page render failed:', e.message)
    res.status(500).send('Booking page unavailable')
  }
}

router.get('/', (req, res) => {
  const slug = String(req.query.location || '').toLowerCase()
  renderPage(req, res, getLocationBySlug(slug) ? slug : '')
})

router.get('/logo.png', (req, res) => {
  res.sendFile(path.join(__dirname, '..', 'assets', 'logo.png'))
})

// ---------------------------------------------------------------------------
// API
// ---------------------------------------------------------------------------

router.get('/api/locations', readLimiter, (req, res) => {
  res.json({ locations: LOCATIONS.map(l => ({ slug: l.slug, name: l.name })) })
})

router.get('/api/config', readLimiter, async (req, res) => {
  const loc = getLocationBySlug(String(req.query.location || '').toLowerCase())
  if (!loc) return res.status(400).json({ error: 'Unknown location' })
  try {
    if (req.query.refresh) delete calendarCache[loc.slug]
    const calendar = await getTourCalendar(loc)
    res.json({
      location: { slug: loc.slug, name: loc.name },
      calendar: {
        id: calendar.id,
        name: calendar.name,
        minutes: minutesOf(calendar),
      },
    })
  } catch (e) {
    console.error('[TourWidget] config failed:', e.message)
    res.status(e.status || 502).json({ error: e.message })
  }
})

router.get('/api/slots', readLimiter, async (req, res) => {
  const loc = getLocationBySlug(String(req.query.location || '').toLowerCase())
  if (!loc) return res.status(400).json({ error: 'Unknown location' })
  try {
    const calendar = await getTourCalendar(loc)
    const days = Math.min(Math.max(parseInt(req.query.days, 10) || 14, 1), bookableDays(calendar))
    const startDate = Date.now()
    const data = await slotsFor(loc, calendar, {
      startDate,
      endDate: startDate + days * 86400000,
      timezone: req.query.timezone || 'America/Los_Angeles',
    })
    res.json({ calendarId: calendar.id, days: slotsByDate(data) })
  } catch (e) {
    console.error('[TourWidget] slots failed:', e.message)
    res.status(e.status || 502).json({ error: e.message })
  }
})

// Personal link: first name + last initial only.
router.get('/api/prefill', readLimiter, async (req, res) => {
  res.set('Cache-Control', 'no-store')
  const loc = getLocationBySlug(String(req.query.location || '').toLowerCase())
  try {
    const contact = loc ? await linkedContact(loc, req.query.c) : null
    if (!contact) return res.status(404).json({ error: 'Link not recognized' })
    res.json(publicName(contact))
  } catch (e) {
    console.error('[TourWidget] prefill failed:', e.message)
    res.status(502).json({ error: 'Could not look you up' })
  }
})

// Book: the contact (the linked one as-is, or an upsert from the four fields),
// then the appointment with toNotify so the calendar's own confirmations fire.
router.post('/api/book', bookLimiter, async (req, res) => {
  const { location, startTime, contactId: linkId } = req.body || {}
  let { firstName, lastName, email, phone } = req.body || {}
  firstName = String(firstName || '').trim()
  lastName = String(lastName || '').trim()
  email = String(email || '').trim()
  phone = String(phone || '').trim()

  const loc = getLocationBySlug(String(location || '').toLowerCase())
  if (!loc) return res.status(400).json({ error: 'Unknown location' })
  if (!startTime || !Number.isFinite(new Date(startTime).getTime())) {
    return res.status(400).json({ error: 'Pick a time' })
  }
  if (!linkId) {
    if (!firstName) return res.status(400).json({ error: 'First name is required' })
    if (!lastName) return res.status(400).json({ error: 'Last name is required' })
    if (!phone) return res.status(400).json({ error: 'Phone is required' })
    if (!/^\S+@\S+\.\S+$/.test(email)) return res.status(400).json({ error: 'A valid email is required' })
  }

  try {
    // A personal link books that GHL contact; the name comes from GHL, never
    // from the request. Checked before anything is written.
    let contactId = null
    if (linkId) {
      const linked = await linkedContact(loc, linkId)
      if (!linked) return res.status(400).json({ error: 'contact_not_found' })
      contactId = linked.id
      firstName = String(linked.firstName || '').trim()
      lastName = String(linked.lastName || '').trim()
    }

    const calendar = await getTourCalendar(loc)

    if (!contactId) {
      const upserted = await ghlFetch('/contacts/upsert', loc.apiKey, {
        method: 'POST',
        body: { locationId: loc.id, firstName, lastName, email, phone },
      })
      contactId = upserted?.contact?.id
      if (!contactId) throw new Error('Contact upsert returned no id')
    }

    const endTime = new Date(new Date(startTime).getTime() + minutesOf(calendar) * 60000).toISOString()
    const appt = await ghlFetch('/calendars/events/appointments', loc.apiKey, {
      method: 'POST',
      body: {
        calendarId: calendar.id,
        locationId: loc.id,
        contactId,
        startTime,
        endTime,
        title: `Gym Tour - ${[firstName, lastName].filter(Boolean).join(' ')}`.trim(),
        appointmentStatus: 'confirmed',
        // Makes the calendar's own notification set fire, as on Day One.
        toNotify: true,
        ignoreDateRange: false,
      },
      version: CAL_VERSION,
    })

    res.json({
      ok: true,
      appointmentId: appt.id,
      contactId,
      startTime: appt.startTime || startTime,
      endTime: appt.endTime || endTime,
    })
  } catch (e) {
    console.error('[TourWidget] booking failed:', e.message)
    res.status(e.status || 502).json({ error: e.message })
  }
})

// Per-club page. Registered last so it never shadows /api/* or /logo.png.
router.get('/:location', (req, res, next) => {
  const slug = String(req.params.location || '').toLowerCase()
  if (!getLocationBySlug(slug)) return next()
  renderPage(req, res, slug)
})

module.exports = router
module.exports.calendarIdFromUrl = calendarIdFromUrl
