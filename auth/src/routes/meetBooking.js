// "Meet with Justin" — the second booking type, and the first that is a
// calendar GROUP rather than a single calendar.
//
// The group holds one calendar per meeting length (15 / 30 / 60), so the
// visitor picks a length first and that choice selects the calendar; everything
// after it is the same shape as Day One. These are `personal` calendars with a
// single team member, so there is no round-robin to resolve and no trainer to
// choose — GHL assigns the owner.
//
// Lives in the corporate sub-account, which is separate from the seven clubs,
// so it carries its own token rather than going through config/ghlLocations.
const { Router } = require('express')
const path = require('path')
const fs = require('fs')
const rateLimit = require('express-rate-limit')
const { ghlFetch } = require('../services/ghlClient')
const {
  CAL_VERSION, cached, bookableDays, slotsFor, slotsByDate,
} = require('../lib/ghlBooking')

const router = Router()

// One booking type today. Adding another group is a config block, not a module.
const TYPES = {
  meetjustin: {
    slug: 'meetjustin',
    title: 'Meet with Justin',
    blurb: 'Pick a length and a time that works for you.',
    groupId: 'Xdv87CClIXaznbgqoRgq',
  },
}

// "30 minutes" / "1 hour" — the visitor picks a length, so say it the way a
// person would rather than echoing the calendar's internal name.
function durationLabel(minutes) {
  if (minutes % 60 === 0) {
    const h = minutes / 60
    return h === 1 ? '1 hour' : h + ' hours'
  }
  return minutes + ' minutes'
}

function corporate() {
  const id = process.env.GHL_CORPORATE_LOCATION
  const apiKey = process.env.GHL_CORPORATE_API_KEY
  if (!id || !apiKey) return null
  return { id, apiKey, slug: 'corporate', name: 'Corporate' }
}

// Public page, so the limits are the protection. Booking creates a real
// appointment and sends real notifications; reads mostly hit cache but a miss
// costs a GHL call against a rate-limited location.
const bookLimiter = rateLimit({
  windowMs: 60 * 1000, max: 6, standardHeaders: true, legacyHeaders: false,
  message: { error: 'Too many booking attempts, slow down' },
})
const readLimiter = rateLimit({
  windowMs: 60 * 1000, max: 60, standardHeaders: true, legacyHeaders: false,
  message: { error: 'Too many requests, please wait a moment' },
})

const CACHE_TTL = 5 * 60 * 1000
const groupCache = {}   // slug -> { promise, at }

// The calendars in the group, which are the lengths on offer. Sorted shortest
// first: the list reads as a menu, and 15/30/60 in that order is what people
// expect.
function getOptions(loc, type) {
  return cached(groupCache, type.slug, CACHE_TTL, async () => {
    const data = await ghlFetch('/calendars/', loc.apiKey, {
      params: { locationId: loc.id, groupId: type.groupId },
      version: CAL_VERSION,
    })
    const cals = (data.calendars || [])
      .filter(c => c.isActive !== false)
      .map(c => {
        const minutes = c.slotDurationUnit === 'hours'
          ? (c.slotDuration || 1) * 60
          : (c.slotDuration || 30)
        return { id: c.id, name: c.name, minutes, label: durationLabel(minutes), calendar: c }
      })
    cals.sort((a, b) => a.minutes - b.minutes)
    if (!cals.length) throw new Error('No active calendars in this booking group')
    return cals
  })
}

async function findOption(loc, type, calendarId) {
  const options = await getOptions(loc, type)
  // Scoped to this group: a calendar id from elsewhere in the account must not
  // be bookable through this page.
  return options.find(o => o.id === calendarId) || null
}

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

const PAGE_PATH = path.join(__dirname, '..', 'public', 'meetBooking.html')
let template = null

function renderPage(req, res, type) {
  try {
    if (!template || process.env.NODE_ENV !== 'production') {
      template = fs.readFileSync(PAGE_PATH, 'utf8')
    }
    res.type('html').send(template
      .split('{{WIDGET_BASE}}').join(req.baseUrl || '/meetjustin')
      .split('{{WIDGET_TYPE}}').join(type.slug)
      .split('{{WIDGET_TITLE}}').join(type.title)
      .split('{{WIDGET_BLURB}}').join(type.blurb))
  } catch (e) {
    console.error('[MeetWidget] page render failed:', e.message)
    res.status(500).send('Booking page unavailable')
  }
}

router.get('/', (req, res) => renderPage(req, res, TYPES.meetjustin))

router.get('/logo.png', (req, res) => {
  res.sendFile(path.join(__dirname, '..', 'assets', 'logo.png'))
})

// ---------------------------------------------------------------------------
// API
// ---------------------------------------------------------------------------

// The lengths on offer, plus the copy the page renders.
router.get('/api/options', readLimiter, async (req, res) => {
  const loc = corporate()
  if (!loc) return res.status(503).json({ error: 'Corporate GHL credentials are not configured' })
  const type = TYPES.meetjustin
  try {
    const options = await getOptions(loc, type)
    res.json({
      title: type.title,
      blurb: type.blurb,
      options: options.map(o => ({
        id: o.id,
        // "30 Minutes - Meet with Justin" is the calendar's name; the page only
        // needs the length, so send both and let it choose.
        name: o.name,
        minutes: o.minutes,
        label: o.label,
      })),
    })
  } catch (e) {
    console.error('[MeetWidget] options failed:', e.message)
    res.status(502).json({ error: e.message })
  }
})

// Availability for one chosen length.
router.get('/api/slots', readLimiter, async (req, res) => {
  const loc = corporate()
  if (!loc) return res.status(503).json({ error: 'Corporate GHL credentials are not configured' })
  try {
    const option = await findOption(loc, TYPES.meetjustin, String(req.query.calendarId || ''))
    if (!option) return res.status(400).json({ error: 'Unknown meeting length' })

    const days = Math.min(
      Math.max(parseInt(req.query.days, 10) || 14, 1),
      bookableDays(option.calendar))
    const startDate = Date.now()
    const data = await slotsFor(loc, option.calendar, {
      startDate,
      endDate: startDate + days * 86400000,
      timezone: req.query.timezone || 'America/Los_Angeles',
    })
    res.json({ calendarId: option.id, minutes: option.minutes, days: slotsByDate(data) })
  } catch (e) {
    console.error('[MeetWidget] slots failed:', e.message)
    res.status(502).json({ error: e.message })
  }
})

// Book. Contact first so the notification merge fields resolve to a real
// person, then the appointment with toNotify — which is what makes the
// calendar's own notifications fire.
router.post('/api/book', bookLimiter, async (req, res) => {
  const loc = corporate()
  if (!loc) return res.status(503).json({ error: 'Corporate GHL credentials are not configured' })

  const { calendarId, startTime, firstName, lastName, email, phone, notes } = req.body || {}
  if (!startTime) return res.status(400).json({ error: 'Pick a time' })
  if (!firstName?.trim()) return res.status(400).json({ error: 'First name is required' })
  if (!email?.trim() && !phone?.trim()) {
    return res.status(400).json({ error: 'An email or phone is required' })
  }

  try {
    const option = await findOption(loc, TYPES.meetjustin, String(calendarId || ''))
    if (!option) return res.status(400).json({ error: 'Unknown meeting length' })

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

    // Duration comes from the chosen calendar, so the booking can never
    // disagree with the length the visitor picked.
    const endTime = new Date(new Date(startTime).getTime() + option.minutes * 60000).toISOString()
    const name = [firstName, lastName].filter(Boolean).join(' ').trim()

    // Free text from a public page, so capped before it goes anywhere.
    const topic = String(notes || '').trim().slice(0, 1000)

    const appt = await ghlFetch('/calendars/events/appointments', loc.apiKey, {
      method: 'POST',
      body: {
        calendarId: option.id,
        locationId: loc.id,
        contactId,
        startTime,
        endTime,
        title: `${option.label || option.minutes + ' min'} - ${name}`.trim(),
        appointmentStatus: 'confirmed',
        toNotify: true,
        ignoreDateRange: false,
        // What they want to talk about, ON THE APPOINTMENT. A contact note
        // alone is not enough: opening the meeting in the calendar showed
        // nothing, which is exactly where you look before a call. Both fields
        // are sent because GHL surfaces them in different views, and both were
        // verified to persist.
        ...(topic ? { notes: topic, description: topic } : {}),
      },
      version: CAL_VERSION,
    })

    // Also kept on the contact, where it survives the appointment and builds a
    // history of what someone has wanted to discuss over time.
    let noteWritten = false
    if (topic) {
      try {
        await ghlFetch(`/contacts/${contactId}/notes`, loc.apiKey, {
          method: 'POST',
          body: { body: `Booked ${option.label || option.minutes + ' min'}: ${topic}` },
        })
        noteWritten = true
      } catch (e) {
        // Never cost someone their booking over a note.
        console.error('[MeetWidget] note write failed (booking kept):', e.message)
      }
    }

    res.json({
      ok: true,
      appointmentId: appt.id,
      contactId,
      startTime: appt.startTime || startTime,
      endTime: appt.endTime || endTime,
      minutes: option.minutes,
      noteWritten,
    })
  } catch (e) {
    console.error('[MeetWidget] booking failed:', e.message)
    res.status(502).json({ error: e.message })
  }
})

module.exports = router
