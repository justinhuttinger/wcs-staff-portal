const { Router } = require('express')
const { supabaseAdmin } = require('../services/supabase')
const authenticate = require('../middleware/auth')

const router = Router()
router.use(authenticate)

// GET /tours?location_id=xxx&start_date=2026-04-07&end_date=2026-04-13
router.get('/', async (req, res) => {
  const { location_id, start_date, end_date } = req.query

  // Use staff's primary location if not specified
  const locId = location_id || req.staff.primary_location_id
  if (!locId) {
    return res.status(400).json({ error: 'No location specified' })
  }

  try {
    // Get GHL credentials for this location
    const { data: location, error: locError } = await supabaseAdmin
      .from('locations')
      .select('ghl_location_id, ghl_api_key, name')
      .eq('id', locId)
      .single()

    if (locError || !location?.ghl_api_key) {
      return res.status(400).json({ error: 'GHL not configured for this location' })
    }

    // Fetch appointments from GHL API
    // GHL API: GET /calendars/events
    const startDate = start_date || new Date().toISOString().split('T')[0]
    const endDateVal = end_date || startDate

    // First, find the "Gym Tour" calendar ID
    const calendarsRes = await fetch(
      'https://services.leadconnectorhq.com/calendars/?locationId=' + location.ghl_location_id,
      {
        headers: {
          'Authorization': 'Bearer ' + location.ghl_api_key,
          'Version': '2021-04-15',
        },
      }
    )

    if (!calendarsRes.ok) {
      const errText = await calendarsRes.text()
      console.error('GHL calendars error:', calendarsRes.status, errText)
      return res.status(502).json({ error: 'Failed to fetch GHL calendars' })
    }

    const calendarsData = await calendarsRes.json()
    const tourCalendar = (calendarsData.calendars || []).find(
      c => c.name && c.name.toLowerCase().includes('gym tour')
    )

    if (!tourCalendar) {
      return res.json({ tours: [], location: location.name, message: 'No Gym Tour calendar found' })
    }

    // Fetch events — use Pacific time boundaries (UTC-7)
    // Render runs in UTC, so we offset to Pacific: midnight PDT = 07:00 UTC
    const startTime = new Date(startDate + 'T07:00:00Z').getTime()
    const endTime = new Date(endDateVal + 'T06:59:59Z').getTime() + 24 * 60 * 60 * 1000

    const eventsRes = await fetch(
      'https://services.leadconnectorhq.com/calendars/events?locationId=' + location.ghl_location_id +
      '&calendarId=' + tourCalendar.id +
      '&startTime=' + startTime +
      '&endTime=' + endTime,
      {
        headers: {
          'Authorization': 'Bearer ' + location.ghl_api_key,
          'Version': '2021-04-15',
        },
      }
    )

    if (!eventsRes.ok) {
      const errText = await eventsRes.text()
      console.error('GHL events error:', eventsRes.status, errText)
      return res.status(502).json({ error: 'Failed to fetch GHL events' })
    }

    const eventsData = await eventsRes.json()
    const events = eventsData.events || []

    // GHL's /calendars/events does NOT return the contact's name/email/phone —
    // only a contactId and a generic appointment `title` (e.g. "West Coast
    // Strength Gym Tour"). Resolve the real person from contactId so staff can
    // see who is coming in. Fetch unique contacts in parallel (a week view is a
    // small handful of tours), with a graceful fallback to the title.
    const uniqueContactIds = [...new Set(events.map(e => e.contactId).filter(Boolean))]
    const contactsById = {}
    await Promise.all(uniqueContactIds.map(async (contactId) => {
      try {
        const cRes = await fetch(
          'https://services.leadconnectorhq.com/contacts/' + contactId,
          {
            headers: {
              'Authorization': 'Bearer ' + location.ghl_api_key,
              'Version': '2021-04-15',
            },
          }
        )
        if (!cRes.ok) return
        const cData = await cRes.json()
        const c = cData.contact || cData
        const fullName = [c.firstName, c.lastName].filter(Boolean).join(' ').trim()
        contactsById[contactId] = {
          name: fullName || c.name || c.contactName || '',
          email: c.email || '',
          phone: c.phone || '',
        }
      } catch (err) {
        // Leave this contact unresolved; the tour falls back to the title.
        console.error('GHL contact fetch error for', contactId, err.message)
      }
    }))

    // Map to a clean format
    const tours = events.map(event => {
      const contact = contactsById[event.contactId] || {}
      return {
        id: event.id,
        title: event.title || 'Tour',
        contact_name: contact.name || event.contactName || event.title || '',
        contact_email: contact.email || event.contactEmail || '',
        contact_phone: contact.phone || event.contactPhone || '',
        contact_id: event.contactId || '',
        start_time: event.startTime || event.start,
        end_time: event.endTime || event.end,
        status: event.status || event.appointmentStatus || 'confirmed',
        notes: event.notes || '',
        assigned_to: event.assignedUserId || '',
      }
    })

    // Sort by start time
    tours.sort((a, b) => new Date(a.start_time) - new Date(b.start_time))

    res.json({ tours, location: location.name, calendar_id: tourCalendar.id })
  } catch (err) {
    console.error('Tours error:', err.message)
    res.status(500).json({ error: 'Failed to fetch tours' })
  }
})

module.exports = router
