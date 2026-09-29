// GET /club-calendar?club=30935&start=YYYY-MM-DD&days=7  (launcher key)
//
// The WCS ABC "See Calendar" window: a club's tours (GHL "Gym Tour" calendar)
// and Day Ones (the same calendars the portal and reports count), read-only,
// no staff sign-in. See lib/clubCalendar.js for what's in each entry and why
// it's so little.

const { Router } = require('express')
const { supabaseAdmin } = require('../services/supabase')
const { clubByNumber } = require('../config/clubs')
const { getLocationBySlug } = require('../config/ghlLocations')
const { resolveDayOneCalendars } = require('../config/dayOneCalendars')
const { ghlFetch } = require('../services/ghlClient')
const { toEntries, buildClubCalendar } = require('../lib/clubCalendar')

const router = Router()
const CAL_VERSION = '2021-04-15'

function requireLauncherKey(req, res, next) {
  const key = process.env.LAUNCHER_KEY
  if (key && req.headers['x-launcher-key'] !== key) {
    return res.status(401).json({ error: 'Invalid launcher key' })
  }
  next()
}

const CACHE_MS = 60 * 1000
const cache = new Map() // `${slug}|${start}|${days}` -> { at, body }

async function eventsFor(location, calendarId, startMs, endMs) {
  const data = await ghlFetch('/calendars/events', location.apiKey, {
    params: { locationId: location.id, calendarId, startTime: String(startMs), endTime: String(endMs) },
    version: CAL_VERSION,
  })
  return data.events || []
}

router.get('/', requireLauncherKey, async (req, res) => {
  const club = clubByNumber(String(req.query.club || ''))
  if (!club) return res.status(400).json({ error: 'Unknown club' })
  const location = getLocationBySlug(club.slug)
  if (!location) return res.status(503).json({ error: 'GHL is not set up for this club' })

  const start = /^\d{4}-\d{2}-\d{2}$/.test(req.query.start || '') ? req.query.start : new Date().toISOString().slice(0, 10)
  const days = Math.min(14, Math.max(1, parseInt(req.query.days, 10) || 7))
  const key = `${club.slug}|${start}|${days}`
  const hit = cache.get(key)
  if (hit && Date.now() - hit.at < CACHE_MS) return res.json(hit.body)

  // Pacific day boundaries (Render runs in UTC; same offset as routes/tours.js).
  const startMs = new Date(start + 'T07:00:00Z').getTime()
  const endMs = startMs + days * 24 * 60 * 60 * 1000 - 1

  try {
    // Tours: the location's "Gym Tour" calendar.
    const cals = await ghlFetch('/calendars/', location.apiKey, { params: { locationId: location.id }, version: CAL_VERSION })
    const tourCal = (cals.calendars || []).find(c => c.name && c.name.toLowerCase().includes('gym tour'))
    const tourEvents = tourCal ? await eventsFor(location, tourCal.id, startMs, endMs) : []

    // Day Ones: every calendar the Day One reports count.
    const dayOneEvents = []
    for (const cal of await resolveDayOneCalendars(location)) {
      dayOneEvents.push(...await eventsFor(location, cal.id, startMs, endMs))
    }

    // Names from the synced contacts; staff from the location's GHL users.
    const all = [...tourEvents, ...dayOneEvents]
    const contactIds = [...new Set(all.map(e => e.contactId).filter(Boolean))]
    const contacts = {}
    for (let i = 0; i < contactIds.length; i += 200) {
      const { data } = await supabaseAdmin
        .from('ghl_contacts_v2').select('id, first_name, last_name').in('id', contactIds.slice(i, i + 200))
      for (const c of data || []) contacts[c.id] = c
    }
    const users = {}
    try {
      const u = await ghlFetch('/users/', location.apiKey, { params: { locationId: location.id } })
      for (const x of u.users || []) users[x.id] = x.name || [x.firstName, x.lastName].filter(Boolean).join(' ')
    } catch (e) {
      console.warn('[club-calendar] users lookup failed:', e.message)
    }

    const entries = buildClubCalendar([
      ...toEntries(tourEvents, 'Tour', contacts, users),
      ...toEntries(dayOneEvents, 'Day One', contacts, users),
    ])
    const body = { club: club.name, start, days, entries }
    cache.set(key, { at: Date.now(), body })
    if (cache.size > 200) cache.delete(cache.keys().next().value)
    res.json(body)
  } catch (err) {
    console.error('[club-calendar]', err.message)
    res.status(502).json({ error: 'Could not load the calendar' })
  }
})

module.exports = router
