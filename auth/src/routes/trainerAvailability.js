const { Router } = require('express')
const crypto = require('crypto')
const authenticate = require('../middleware/auth')
const { requireRole, resolveRole, ROLE_HIERARCHY } = require('../middleware/role')
const { getLocationBySlug } = require('../config/ghlLocations')
const { ghlFetch } = require('../services/ghlClient')
const { CONFIG_SCALAR_KEYS, buildPriorityUpdateBody } = require('./trainerAvailabilityHelpers')

const router = Router()
router.use(authenticate)
router.use(requireRole('lead'))

const CAL_VERSION = '2021-04-15'
const PRIORITY_VALUES = [0, 0.5, 1]

function hashRules(rules) {
  return crypto.createHash('sha256').update(JSON.stringify(rules || [])).digest('hex')
}

async function fetchUserScheduleHash(locationId, apiKey, userId, calendarId) {
  try {
    const params = { locationId, userId, limit: 10 }
    if (calendarId) params.calendarId = calendarId
    const data = await ghlFetch('/calendars/schedules/search', apiKey, { params, version: CAL_VERSION })
    const schedules = data.schedules || []
    const first = schedules[0]
    if (!first) return { scheduleId: null, hash: null }
    return { scheduleId: first.id, hash: hashRules(first.rules || first.openHours || []) }
  } catch (e) {
    return { scheduleId: null, hash: null, error: e.message }
  }
}

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

    // Get team member entries (preserve full member object so priority/isPrimary/locationConfigurations are visible)
    const teamMembers = Array.isArray(calDetail.teamMembers) ? calDetail.teamMembers : []
    const memberByUserId = {}
    for (const m of teamMembers) {
      const userId = typeof m === 'string' ? m : m.userId || m.id
      if (!userId) continue
      memberByUserId[userId] = typeof m === 'string' ? { userId } : m
    }
    const teamMemberIds = Object.keys(memberByUserId)

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
    const userLevel = ROLE_HIERARCHY.indexOf(resolveRole(req.staff.role))
    const isManager = userLevel >= ROLE_HIERARCHY.indexOf('manager')
    const userEmail = req.staff.email?.toLowerCase()

    // Fetch per-user availability schedules for the Day One calendar
    const trainers = []
    for (const memberId of teamMemberIds) {
      const user = userMap[memberId]
      if (!user) continue
      if (!isManager && user.email !== userEmail) continue

      // Get this user's schedule — try per-calendar first, then all schedules for user
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
        console.log(`[TrainerAvail] ${user.name}: found ${schedules.length} schedules for Day One calendar`)
        if (schedules.length > 0) {
          userSchedule = schedules[0]
          scheduleId = schedules[0].id
          console.log(`[TrainerAvail] ${user.name}: schedule ID=${scheduleId}, rules count=${(schedules[0].rules || []).length}`)
        } else {
          // Try fetching all schedules for this user (might not be linked to specific calendar)
          const allSched = await ghlFetch('/calendars/schedules/search', location.apiKey, {
            params: { locationId: location.id, userId: memberId, limit: 10 },
            version: CAL_VERSION,
          })
          const allSchedules = allSched.schedules || []
          console.log(`[TrainerAvail] ${user.name}: found ${allSchedules.length} total schedules (not calendar-specific)`)
          if (allSchedules.length > 0) {
            // Use the first schedule (likely their default availability)
            userSchedule = allSchedules[0]
            scheduleId = allSchedules[0].id
            console.log(`[TrainerAvail] ${user.name}: using schedule "${allSchedules[0].name}" ID=${scheduleId}`)
          }
        }
      } catch (e) {
        console.warn(`[TrainerAvail] Could not fetch schedule for ${user.name}:`, e.message)
      }

      const member = memberByUserId[memberId] || {}
      const priority = typeof member.priority === 'number' ? member.priority : 0.5

      trainers.push({
        userId: memberId,
        name: user.name,
        email: user.email,
        scheduleId,
        schedule: userSchedule,
        priority,
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

// PUT /trainer-availability/priority — update one trainer's round-robin priority on the Day One calendar
// Read-modify-write: re-fetches the calendar, mutates only the target user's priority, validates the
// teamMembers set is unchanged, posts the full array back, then verifies each trainer's hours rules
// hash is identical before/after so we can prove availability was untouched.
router.put('/priority', async (req, res) => {
  const { location_slug, calendarId, userId, priority } = req.body

  if (!location_slug || !calendarId || !userId) {
    return res.status(400).json({ error: 'location_slug, calendarId, and userId are required' })
  }
  if (!PRIORITY_VALUES.includes(priority)) {
    return res.status(400).json({ error: 'priority must be one of 0, 0.5, 1' })
  }

  const location = getLocationBySlug(location_slug)
  if (!location) {
    return res.status(400).json({ error: 'Unknown location: ' + location_slug })
  }

  // Trainer self-edit guard: managers+ can edit anyone, others only themselves
  const userLevel = ROLE_HIERARCHY.indexOf(resolveRole(req.staff.role))
  const isManager = userLevel >= ROLE_HIERARCHY.indexOf('manager')

  try {
    // 1. Read fresh calendar
    const detail = await ghlFetch(`/calendars/${calendarId}`, location.apiKey, { version: CAL_VERSION })
    const cal = detail.calendar || detail
    const current = Array.isArray(cal.teamMembers) ? cal.teamMembers : []

    if (current.length === 0) {
      return res.status(404).json({ error: 'Calendar has no team members' })
    }

    // Normalize current to objects (the API may return strings or objects mixed)
    const currentNorm = current.map(m => typeof m === 'string' ? { userId: m } : { ...m })
    const target = currentNorm.find(m => m.userId === userId)
    if (!target) return res.status(404).json({ error: 'User is not on this calendar' })

    // Self-edit gate (need to resolve target's email)
    if (!isManager) {
      try {
        const usersData = await ghlFetch('/users/', location.apiKey, { params: { locationId: location.id } })
        const targetUser = (usersData.users || []).find(u => u.id === userId)
        const targetEmail = (targetUser?.email || '').toLowerCase()
        const myEmail = (req.staff.email || '').toLowerCase()
        if (targetEmail !== myEmail) {
          return res.status(403).json({ error: 'You can only change your own priority' })
        }
      } catch (e) {
        return res.status(403).json({ error: 'Could not verify ownership: ' + e.message })
      }
    }

    // 2. Snapshot every trainer's schedule hash before the write (proves availability untouched)
    const beforeHashes = {}
    for (const m of currentNorm) {
      beforeHashes[m.userId] = await fetchUserScheduleHash(location.id, location.apiKey, m.userId, calendarId)
    }

    // 3. Build updated teamMembers — preserve every other field on every member
    const updated = currentNorm.map(m => m.userId === userId ? { ...m, priority } : m)

    // 4. Length + set guard — abort if anything would change beyond priority
    if (updated.length !== currentNorm.length) {
      return res.status(500).json({ error: 'team member count mismatch — aborted' })
    }
    const beforeIds = currentNorm.map(m => m.userId).sort()
    const afterIds = updated.map(m => m.userId).sort()
    if (beforeIds.length !== afterIds.length || beforeIds.some((id, i) => id !== afterIds[i])) {
      return res.status(500).json({ error: 'team member set mismatch — aborted' })
    }

    // 5. PUT — teamMembers (priority changed) + the booking-config scalars re-sent from the
    //    fresh read, so GHL doesn't reset slotDuration (and friends) to its 30-min default.
    await ghlFetch(`/calendars/${calendarId}`, location.apiKey, {
      method: 'PUT',
      version: CAL_VERSION,
      body: buildPriorityUpdateBody(cal, userId, priority),
    })

    // 6. Verify: re-read the calendar, confirm the team set, and confirm every schedule hash is identical
    const verifyDetail = await ghlFetch(`/calendars/${calendarId}`, location.apiKey, { version: CAL_VERSION })
    const verifyCal = verifyDetail.calendar || verifyDetail
    const verifyMembers = Array.isArray(verifyCal.teamMembers) ? verifyCal.teamMembers : []
    const verifyIds = verifyMembers.map(m => typeof m === 'string' ? m : m.userId).sort()
    if (verifyIds.length !== beforeIds.length || verifyIds.some((id, i) => id !== beforeIds[i])) {
      console.error('[TrainerAvail] team members changed after PUT! before=', beforeIds, 'after=', verifyIds)
      return res.status(500).json({ error: 'Verify failed: team member set changed after write' })
    }

    const afterHashes = {}
    const driftedUsers = []
    for (const m of verifyMembers) {
      const id = typeof m === 'string' ? m : m.userId
      afterHashes[id] = await fetchUserScheduleHash(location.id, location.apiKey, id, calendarId)
      const before = beforeHashes[id]
      if (before && before.hash && afterHashes[id].hash && before.hash !== afterHashes[id].hash) {
        driftedUsers.push(id)
      }
    }
    if (driftedUsers.length > 0) {
      console.error('[TrainerAvail] schedule rules drifted for users:', driftedUsers)
      return res.status(500).json({
        error: 'Availability changed unexpectedly — investigate',
        driftedUsers,
      })
    }

    // Verify the booking-config scalars survived the write (slotDuration must stay 60, etc.)
    const configDrift = []
    for (const k of CONFIG_SCALAR_KEYS) {
      if (cal[k] !== undefined && verifyCal[k] !== cal[k]) {
        configDrift.push({ field: k, before: cal[k], after: verifyCal[k] })
      }
    }
    if (configDrift.length > 0) {
      console.error('[TrainerAvail] calendar config drifted after PUT:', configDrift)
      return res.status(500).json({
        error: 'Calendar settings changed unexpectedly — investigate',
        configDrift,
      })
    }

    const updatedTarget = verifyMembers.find(m => (typeof m === 'string' ? m : m.userId) === userId) || {}
    res.json({
      success: true,
      userId,
      priority: typeof updatedTarget.priority === 'number' ? updatedTarget.priority : priority,
      teamMemberCount: verifyIds.length,
      verified: true,
    })
  } catch (err) {
    console.error('[TrainerAvail] Priority update error:', err.message)
    res.status(500).json({ error: 'Failed to update priority: ' + err.message })
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
