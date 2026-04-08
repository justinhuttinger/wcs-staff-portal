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
    // List all calendars and find the one named exactly "Day One"
    const data = await ghlFetch('/calendars/', location.apiKey, {
      params: { locationId: location.id },
      version: CAL_VERSION,
    })

    const allCalendars = data.calendars || []
    console.log('[TrainerAvail] All calendars:', allCalendars.map(c => `${c.name} (${c.id})`))

    const dayOneCalendar = allCalendars.find(cal => (cal.name || '').trim().toLowerCase() === 'day one')

    if (!dayOneCalendar) {
      return res.json({ trainers: [], calendarName: null, debug: 'No calendar named "Day One" found. Available: ' + allCalendars.map(c => c.name).join(', ') })
    }

    // Get full calendar details
    let calDetail = dayOneCalendar
    try {
      const detail = await ghlFetch(`/calendars/${dayOneCalendar.id}`, location.apiKey, { version: CAL_VERSION })
      calDetail = detail.calendar || detail
      console.log('[TrainerAvail] Calendar detail keys:', Object.keys(calDetail))
    } catch (e) {
      console.warn('[TrainerAvail] Could not fetch calendar detail:', e.message)
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

    // Log the full calendar detail to understand the structure
    console.log('[TrainerAvail] Calendar detail:', JSON.stringify(calDetail, null, 2).substring(0, 2000))

    // Extract team members — GHL uses various field names
    let teamMemberIds = []
    const teamSources = [
      calDetail.teamMembers,
      calDetail.calendarConfig?.teamMembers,
      calDetail.users,
      calDetail.assignedUsers,
      calDetail.calendarConfig?.users,
    ]
    for (const source of teamSources) {
      if (Array.isArray(source) && source.length > 0) {
        teamMemberIds = source.map(m => {
          if (typeof m === 'string') return m
          return m.userId || m.id || m.memberId || m
        })
        console.log('[TrainerAvail] Found team members from:', source === calDetail.teamMembers ? 'teamMembers' : 'other')
        break
      }
    }

    // If still empty, check if there's a single userId (personal calendar)
    if (teamMemberIds.length === 0 && calDetail.userId) {
      teamMemberIds = [calDetail.userId]
    }

    console.log('[TrainerAvail] Team member IDs:', teamMemberIds)
    console.log('[TrainerAvail] Available users:', Object.keys(userMap))

    // Build per-trainer availability
    const calSchedule = calDetail.openHours || calDetail.availabilities || calDetail.schedule || calDetail.availability || null
    console.log('[TrainerAvail] openHours:', JSON.stringify(calDetail.openHours)?.substring(0, 500))
    console.log('[TrainerAvail] availabilities:', JSON.stringify(calDetail.availabilities)?.substring(0, 500))

    // Role check
    const userLevel = ROLE_HIERARCHY.indexOf(req.staff.role)
    const isManager = userLevel >= ROLE_HIERARCHY.indexOf('manager')
    const userEmail = req.staff.email?.toLowerCase()

    const trainers = []
    for (const memberId of teamMemberIds) {
      const user = userMap[memberId]
      if (!user) continue

      // Non-managers only see themselves
      if (!isManager && user.email !== userEmail) continue

      // Try to get per-member schedule
      // In GHL, team members may have individual openHours
      let memberSchedule = calSchedule
      if (Array.isArray(calDetail.teamMembers)) {
        const memberObj = calDetail.teamMembers.find(m => (m.userId || m.id || m) === memberId)
        if (memberObj && typeof memberObj === 'object') {
          memberSchedule = memberObj.openHours || memberObj.schedule || memberObj.availability || calSchedule
        }
      }

      trainers.push({
        userId: memberId,
        name: user.name,
        email: user.email,
        schedule: memberSchedule,
      })
    }

    res.json({
      calendarId: dayOneCalendar.id,
      calendarName: dayOneCalendar.name,
      trainers,
      rawSchedule: calSchedule, // for debugging
    })
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

    res.json({ success: true, schedule: result.schedule || result })
  } catch (err) {
    console.error('[TrainerAvail] Update error:', err.message)
    res.status(500).json({ error: 'Failed to update schedule: ' + err.message })
  }
})

module.exports = router
