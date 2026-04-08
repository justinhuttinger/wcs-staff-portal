const { Router } = require('express')
const authenticate = require('../middleware/auth')
const { requireRole, ROLE_HIERARCHY } = require('../middleware/role')
const { getLocationBySlug } = require('../config/ghlLocations')
const { ghlFetch } = require('../services/ghlClient')

const router = Router()
router.use(authenticate)
router.use(requireRole('personal_trainer'))

const CAL_VERSION = '2021-04-15'

// GET /trainer-availability
router.get('/', async (req, res) => {
  const { location_slug } = req.query

  if (!location_slug) {
    return res.status(400).json({ error: 'location_slug is required' })
  }

  const location = getLocationBySlug(location_slug)
  if (!location) {
    return res.status(400).json({ error: 'Unknown location: ' + location_slug })
  }

  try {
    // Find the "Day One" calendar
    const data = await ghlFetch('/calendars/', location.apiKey, {
      params: { locationId: location.id },
      version: CAL_VERSION,
    })

    const allCalendars = data.calendars || []
    const dayOneCalendar = allCalendars.find(cal => (cal.name || '').trim().toLowerCase() === 'day one')

    if (!dayOneCalendar) {
      return res.json({ trainers: [], calendarId: null, calendarName: null })
    }

    // Get calendar detail for team members
    let calDetail = dayOneCalendar
    try {
      const detail = await ghlFetch(`/calendars/${dayOneCalendar.id}`, location.apiKey, { version: CAL_VERSION })
      calDetail = detail.calendar || detail
    } catch (e) {
      console.warn('[TrainerAvail] Could not fetch calendar detail:', e.message)
    }

    // Get team member user IDs
    let teamMemberIds = []
    if (Array.isArray(calDetail.teamMembers)) {
      teamMemberIds = calDetail.teamMembers.map(m => typeof m === 'string' ? m : m.userId || m.id || m)
    }

    // Fetch GHL users
    let userMap = {}
    try {
      const usersData = await ghlFetch('/users/', location.apiKey, { params: { locationId: location.id } })
      for (const u of (usersData.users || [])) {
        userMap[u.id] = { id: u.id, name: u.name || [u.firstName, u.lastName].filter(Boolean).join(' '), email: (u.email || '').toLowerCase() }
      }
    } catch (e) {
      console.warn('[TrainerAvail] Could not fetch users:', e.message)
    }

    // Role check
    const userLevel = ROLE_HIERARCHY.indexOf(req.staff.role)
    const isManager = userLevel >= ROLE_HIERARCHY.indexOf('manager')
    const userEmail = req.staff.email?.toLowerCase()

    // Fetch per-user availability schedules for the Day One calendar
    const trainers = []
    for (const memberId of teamMemberIds) {
      const user = userMap[memberId]
      if (!user) continue
      if (!isManager && user.email !== userEmail) continue

      // Get this user's schedule for the Day One calendar
      let userSchedule = null
      let scheduleId = null
      try {
        const schedData = await ghlFetch('/calendars/schedules/search', location.apiKey, {
          params: {
            locationId: location.id,
            userId: memberId,
            calendarId: dayOneCalendar.id,
            limit: 10,
          },
          version: CAL_VERSION,
        })
        const schedules = schedData.schedules || []
        if (schedules.length > 0) {
          userSchedule = schedules[0]
          scheduleId = schedules[0].id
        }
      } catch (e) {
        console.warn(`[TrainerAvail] Could not fetch schedule for ${user.name}:`, e.message)
      }

      trainers.push({
        userId: memberId,
        name: user.name,
        email: user.email,
        scheduleId,
        schedule: userSchedule,
      })
    }

    res.json({
      calendarId: dayOneCalendar.id,
      calendarName: dayOneCalendar.name,
      trainers,
    })
  } catch (err) {
    console.error('[TrainerAvail] Error:', err.message)
    res.status(500).json({ error: 'Failed to fetch availability: ' + err.message })
  }
})

// PUT /trainer-availability/:scheduleId — update a user's schedule
router.put('/:scheduleId', async (req, res) => {
  const { scheduleId } = req.params
  const { location_slug, rules, timezone } = req.body

  if (!location_slug || !rules) {
    return res.status(400).json({ error: 'location_slug and rules are required' })
  }

  const location = getLocationBySlug(location_slug)
  if (!location) {
    return res.status(400).json({ error: 'Unknown location: ' + location_slug })
  }

  try {
    const result = await ghlFetch(`/calendars/schedules/${scheduleId}`, location.apiKey, {
      method: 'PUT',
      version: CAL_VERSION,
      body: {
        rules,
        timezone: timezone || 'America/Los_Angeles',
      },
    })

    res.json({ success: true, schedule: result })
  } catch (err) {
    console.error('[TrainerAvail] Update error:', err.message)
    res.status(500).json({ error: 'Failed to update schedule: ' + err.message })
  }
})

module.exports = router
