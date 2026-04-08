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

    // Map to a clean format
    const tours = (eventsData.events || []).map(event => ({
      id: event.id,
      title: event.title || event.contactName || 'Tour',
      contact_name: event.contactName || event.title || '',
      contact_email: event.contactEmail || '',
      contact_phone: event.contactPhone || '',
      start_time: event.startTime || event.start,
      end_time: event.endTime || event.end,
      status: event.status || event.appointmentStatus || 'confirmed',
      notes: event.notes || '',
      assigned_to: event.assignedUserId || '',
    }))

    // Sort by start time
    tours.sort((a, b) => new Date(a.start_time) - new Date(b.start_time))

    res.json({ tours, location: location.name, calendar_id: tourCalendar.id })
  } catch (err) {
    console.error('Tours error:', err.message)
    res.status(500).json({ error: 'Failed to fetch tours' })
  }
})

module.exports = router
