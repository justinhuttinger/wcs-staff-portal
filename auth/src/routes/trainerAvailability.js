const { Router } = require('express')
const authenticate = require('../middleware/auth')
const { requireRole, ROLE_HIERARCHY } = require('../middleware/role')
const { getLocationBySlug } = require('../config/ghlLocations')
const { ghlFetch } = require('../services/ghlClient')

const router = Router()
router.use(authenticate)
router.use(requireRole('personal_trainer'))

const CAL_VERSION = '2021-04-15'

// Cache Day One calendar info per location
const calendarCache = {}

async function getDayOneCalendars(locationId, apiKey) {
  if (calendarCache[locationId]) return calendarCache[locationId]

  const data = await ghlFetch('/calendars/', apiKey, {
    params: { locationId },
    version: CAL_VERSION,
  })

  const calendars = (data.calendars || []).filter(cal => {
    const name = (cal.name || '').toLowerCase()
    return name.includes('day one') || name.includes('dayone') || name.includes('day 1')
  })

  if (calendars.length > 0) calendarCache[locationId] = calendars
  return calendars
}

// GET /trainer-availability — get Day One calendars + schedules + team members
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
    const calendars = await getDayOneCalendars(location.id, location.apiKey)
    if (calendars.length === 0) {
      return res.json({ calendars: [], users: {} })
    }

    // Fetch GHL users to resolve IDs to names/emails
    let userMap = {}
    try {
      const usersData = await ghlFetch('/users/', location.apiKey)
      for (const u of (usersData.users || [])) {
        userMap[u.id] = { id: u.id, name: u.name || [u.firstName, u.lastName].filter(Boolean).join(' '), email: (u.email || '').toLowerCase() }
      }
    } catch (e) {
      console.warn('[TrainerAvail] Could not fetch users:', e.message)
    }

    // Role check
    const userLevel = ROLE_HIERARCHY.indexOf(req.staff.role)
    const managerLevel = ROLE_HIERARCHY.indexOf('manager')
    const isManager = userLevel >= managerLevel
    const userEmail = req.staff.email?.toLowerCase()

    // For each Day One calendar, get its schedule
    const calendarResults = []
    for (const cal of calendars) {
      // Get full calendar details (includes schedule, teamMembers)
      let calDetail = cal
      try {
        const detail = await ghlFetch(`/calendars/${cal.id}`, location.apiKey, { version: CAL_VERSION })
        calDetail = detail.calendar || detail
      } catch (e) {
        console.warn('[TrainerAvail] Could not fetch calendar detail:', e.message)
      }

      const teamMembers = calDetail.teamMembers || calDetail.users || []
      const schedule = calDetail.schedule || calDetail.availability || null

      // Filter: trainers only see calendars they're on
      if (!isManager) {
        const isOnCalendar = teamMembers.some(memberId => {
          const user = userMap[memberId]
          return user?.email === userEmail
        })
        if (!isOnCalendar) continue
      }

      calendarResults.push({
        id: cal.id,
        name: cal.name,
        teamMembers: teamMembers.map(id => userMap[id] || { id, name: 'Unknown', email: '' }),
        schedule: schedule,
      })
    }

    res.json({ calendars: calendarResults, users: userMap })
  } catch (err) {
    console.error('[TrainerAvail] Error:', err.message)
    res.status(500).json({ error: 'Failed to fetch availability: ' + err.message })
  }
})

// PUT /trainer-availability/:calendarId — update schedule
router.put('/:calendarId', async (req, res) => {
  const { calendarId } = req.params
  const { location_slug, rules, timezone } = req.body

  if (!location_slug || !rules) {
    return res.status(400).json({ error: 'location_slug and rules are required' })
  }

  const location = getLocationBySlug(location_slug)
  if (!location) {
    return res.status(400).json({ error: 'Unknown location: ' + location_slug })
  }

  try {
    const result = await ghlFetch(`/calendars/schedules/event-calendar/${calendarId}`, location.apiKey, {
      method: 'PUT',
      version: CAL_VERSION,
      body: {
        rules,
        timezone: timezone || 'America/Los_Angeles',
      },
    })

    // Clear cache so next fetch gets updated data
    delete calendarCache[location.id]

    res.json({ success: true, schedule: result.schedule || result })
  } catch (err) {
    console.error('[TrainerAvail] Update error:', err.message)
    res.status(500).json({ error: 'Failed to update schedule: ' + err.message })
  }
})

module.exports = router
