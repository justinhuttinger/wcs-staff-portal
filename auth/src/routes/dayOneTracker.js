const { Router } = require('express')
const { supabaseAdmin } = require('../services/supabase')
const authenticate = require('../middleware/auth')
const { requireRole, ROLE_HIERARCHY } = require('../middleware/role')
const { getLocationBySlug } = require('../config/ghlLocations')
const { ghlFetch } = require('../services/ghlClient')

const router = Router()
router.use(authenticate)
router.use(requireRole('personal_trainer'))

const CAL_VERSION = '2021-04-15'

// Cache: location -> { calendarIds, groupId }
const calendarCache = {}

async function getDayOneCalendarInfo(locationId, apiKey) {
  if (calendarCache[locationId]) return calendarCache[locationId]

  // List all calendars at this location
  const data = await ghlFetch('/calendars/', apiKey, {
    params: { locationId },
    version: CAL_VERSION,
  })

  const calendars = data.calendars || []
  console.log(`[DayOneTracker] Found ${calendars.length} calendars for ${locationId}`)

  // Find calendars whose name or groupId relates to "Day One"
  // First, find any calendar with "day one" in its name
  const dayOneCalendars = calendars.filter(cal => {
    const name = (cal.name || '').toLowerCase()
    return name.includes('day one') || name.includes('dayone') || name.includes('day 1')
  })

  if (dayOneCalendars.length > 0) {
    // If they share a groupId, we can use that for filtering events
    const groupId = dayOneCalendars[0].groupId || null
    const result = {
      calendarIds: dayOneCalendars.map(c => c.id),
      groupId,
    }
    calendarCache[locationId] = result
    console.log(`[DayOneTracker] Day One calendars: ${result.calendarIds.length}, groupId: ${groupId}`)
    return result
  }

  // Fallback: log all calendar names for debugging
  console.log(`[DayOneTracker] No Day One calendars found. Available:`, calendars.map(c => c.name))
  return { calendarIds: [], groupId: null }
}

// GET /day-one-tracker/appointments
router.get('/appointments', async (req, res) => {
  const { location_slug, start_date, end_date } = req.query

  if (!location_slug) {
    return res.status(400).json({ error: 'location_slug is required' })
  }

  const location = getLocationBySlug(location_slug)
  if (!location) {
    return res.status(400).json({ error: 'Unknown location: ' + location_slug })
  }

  try {
    const calInfo = await getDayOneCalendarInfo(location.id, location.apiKey)
    if (calInfo.calendarIds.length === 0) {
      return res.json({ appointments: [], debug: 'No Day One calendars found at this location' })
    }

    // Convert dates to epoch milliseconds (GHL expects millis)
    const now = new Date()
    const startMs = start_date
      ? new Date(start_date + 'T00:00:00.000Z').getTime()
      : new Date(now.getFullYear(), now.getMonth(), 1).getTime()
    const endMs = end_date
      ? new Date(end_date + 'T23:59:59.999Z').getTime()
      : new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59).getTime()

    let allEvents = []

    // Try groupId first (single API call), fall back to per-calendar
    if (calInfo.groupId) {
      const data = await ghlFetch('/calendars/events', location.apiKey, {
        params: {
          locationId: location.id,
          groupId: calInfo.groupId,
          startTime: startMs.toString(),
          endTime: endMs.toString(),
        },
        version: CAL_VERSION,
      })
      allEvents = data.events || []
    } else {
      for (const calId of calInfo.calendarIds) {
        const data = await ghlFetch('/calendars/events', location.apiKey, {
          params: {
            locationId: location.id,
            calendarId: calId,
            startTime: startMs.toString(),
            endTime: endMs.toString(),
          },
          version: CAL_VERSION,
        })
        allEvents.push(...(data.events || []))
      }
    }

    console.log(`[DayOneTracker] Fetched ${allEvents.length} events for ${location_slug}`)

    // Fetch GHL users for this location to resolve assignedUserId → name/email
    let userMap = {}
    try {
      const usersData = await ghlFetch('/users/', location.apiKey, {
        params: { locationId: location.id },
      })
      for (const u of (usersData.users || [])) {
        userMap[u.id] = { name: u.name || u.firstName + ' ' + u.lastName, email: (u.email || '').toLowerCase() }
      }
    } catch (e) {
      console.warn('[DayOneTracker] Could not fetch users:', e.message)
    }

    // Role check: managers see all, others see only their own
    const userLevel = ROLE_HIERARCHY.indexOf(req.staff.role)
    const managerLevel = ROLE_HIERARCHY.indexOf('manager')
    const isManager = userLevel >= managerLevel
    const userEmail = req.staff.email?.toLowerCase()

    if (!isManager) {
      allEvents = allEvents.filter(evt => {
        const assignedId = evt.assignedUserId
        const assignedUser = userMap[assignedId]
        return assignedUser?.email === userEmail
      })
    }

    // Fetch contact names + custom fields from synced data
    const contactIds = [...new Set(allEvents.map(e => e.contactId).filter(Boolean))]
    let contactData = {}
    if (contactIds.length > 0) {
      const { data: contacts } = await supabaseAdmin
        .from('ghl_contacts_v2')
        .select('id, first_name, last_name, email')
        .in('id', contactIds)
      if (contacts) {
        for (const c of contacts) contactData[c.id] = c
      }

      // Also get custom field status from report view
      const { data: cfData } = await supabaseAdmin
        .from('ghl_contacts_report')
        .select('id, day_one_status, day_one_sale, show_or_no_show')
        .in('id', contactIds)
      if (cfData) {
        for (const c of cfData) {
          if (contactData[c.id]) Object.assign(contactData[c.id], c)
          else contactData[c.id] = c
        }
      }
    }

    const appointments = allEvents
      .map(evt => {
        const contact = contactData[evt.contactId] || {}
        const assignedUser = userMap[evt.assignedUserId] || {}
        const contactName = [contact.first_name, contact.last_name].filter(Boolean).join(' ') || 'Unknown'
        return {
          id: evt.id,
          contact_id: evt.contactId || null,
          contact_name: contactName,
          appointment_time: evt.startTime || evt.start || null,
          end_time: evt.endTime || evt.end || null,
          assigned_user_id: evt.assignedUserId || null,
          assigned_user_name: assignedUser.name || null,
          assigned_user_email: assignedUser.email || null,
          status: evt.appointmentStatus || evt.status || 'confirmed',
          day_one_status: contact.day_one_status || null,
          day_one_sale: contact.day_one_sale || null,
          show_or_no_show: contact.show_or_no_show || null,
        }
      })
      .sort((a, b) => new Date(b.appointment_time) - new Date(a.appointment_time))

    res.json({ appointments })
  } catch (err) {
    console.error('[DayOneTracker] Error fetching appointments:', err.message)
    res.status(500).json({ error: 'Failed to fetch appointments: ' + err.message })
  }
})

// POST /day-one-tracker/submit
router.post('/submit', async (req, res) => {
  const { contact_id, location_slug, show_no_show, sale_result, pt_sale_type, why_no_sale } = req.body

  if (!contact_id || !location_slug || !show_no_show) {
    return res.status(400).json({ error: 'contact_id, location_slug, and show_no_show are required' })
  }

  const location = getLocationBySlug(location_slug)
  if (!location) {
    return res.status(400).json({ error: 'Unknown location: ' + location_slug })
  }

  try {
    const { data: fieldDefs } = await supabaseAdmin
      .from('ghl_custom_field_defs')
      .select('id, field_key')
      .eq('location_id', location.id)
      .in('field_key', [
        'contact.day_one_status',
        'contact.show_or_no_show',
        'contact.day_one_sale',
        'contact.pt_sale_type',
        'contact.why_no_sale',
      ])

    if (!fieldDefs || fieldDefs.length === 0) {
      return res.status(500).json({ error: 'Custom field definitions not found for location' })
    }

    const fieldMap = {}
    for (const f of fieldDefs) {
      fieldMap[f.field_key] = f.id
    }

    const customFields = []

    if (fieldMap['contact.day_one_status']) {
      customFields.push({
        id: fieldMap['contact.day_one_status'],
        value: show_no_show === 'Show' ? 'Completed' : 'No Show',
      })
    }

    if (fieldMap['contact.show_or_no_show']) {
      customFields.push({
        id: fieldMap['contact.show_or_no_show'],
        value: show_no_show,
      })
    }

    if (show_no_show === 'Show' && sale_result && fieldMap['contact.day_one_sale']) {
      customFields.push({
        id: fieldMap['contact.day_one_sale'],
        value: sale_result,
      })
    }

    if (sale_result === 'Sale' && pt_sale_type && fieldMap['contact.pt_sale_type']) {
      customFields.push({
        id: fieldMap['contact.pt_sale_type'],
        value: pt_sale_type,
      })
    }

    if (sale_result === 'No Sale' && why_no_sale && fieldMap['contact.why_no_sale']) {
      customFields.push({
        id: fieldMap['contact.why_no_sale'],
        value: why_no_sale,
      })
    }

    await ghlFetch(`/contacts/${contact_id}`, location.apiKey, {
      method: 'PUT',
      body: { customFields },
    })

    // Re-read the contact from GHL to confirm the update took effect
    const reverseMap = {}
    for (const [key, id] of Object.entries(fieldMap)) {
      reverseMap[id] = key
    }

    let confirmedStatus = {}
    try {
      const contactData = await ghlFetch(`/contacts/${contact_id}`, location.apiKey)
      const contact = contactData.contact || contactData
      for (const cf of (contact.customFields || [])) {
        const key = reverseMap[cf.id]
        if (key === 'contact.day_one_status') confirmedStatus.day_one_status = cf.value
        if (key === 'contact.day_one_sale') confirmedStatus.day_one_sale = cf.value
        if (key === 'contact.show_or_no_show') confirmedStatus.show_or_no_show = cf.value
      }
    } catch (e) {
      console.warn('[DayOneTracker] Could not re-read contact:', e.message)
      // Fall back to what we wrote
      confirmedStatus = {
        day_one_status: show_no_show === 'Show' ? 'Completed' : 'No Show',
        day_one_sale: show_no_show === 'Show' ? sale_result : null,
        show_or_no_show: show_no_show,
      }
    }

    // Update Supabase so ghl_contacts_report view reflects change immediately
    try {
      const { data: existing } = await supabaseAdmin
        .from('ghl_contacts_v2')
        .select('custom_fields')
        .eq('id', contact_id)
        .maybeSingle()

      if (existing) {
        const merged = { ...(existing.custom_fields || {}) }
        for (const cf of customFields) {
          merged[cf.id] = cf.value
        }
        await supabaseAdmin
          .from('ghl_contacts_v2')
          .update({ custom_fields: merged })
          .eq('id', contact_id)
      }
    } catch (e) {
      console.warn('[DayOneTracker] Supabase update failed (non-critical):', e.message)
    }

    res.json({ success: true, fields_updated: customFields.length, confirmed: confirmedStatus })
  } catch (err) {
    console.error('[DayOneTracker] Error submitting:', err.message)
    res.status(500).json({ error: 'Failed to update contact: ' + err.message })
  }
})

// GET /day-one-tracker/field-options
router.get('/field-options', async (req, res) => {
  const { location_slug } = req.query

  if (!location_slug) {
    return res.status(400).json({ error: 'location_slug is required' })
  }

  const location = getLocationBySlug(location_slug)
  if (!location) {
    return res.status(400).json({ error: 'Unknown location: ' + location_slug })
  }

  try {
    const { data: fields } = await supabaseAdmin
      .from('ghl_custom_field_defs')
      .select('field_key, picklist_options')
      .eq('location_id', location.id)
      .in('field_key', ['contact.pt_sale_type', 'contact.why_no_sale'])

    const result = { pt_sale_types: [], no_sale_reasons: [] }
    for (const f of (fields || [])) {
      if (f.field_key === 'contact.pt_sale_type') {
        result.pt_sale_types = f.picklist_options || []
      } else if (f.field_key === 'contact.why_no_sale') {
        result.no_sale_reasons = f.picklist_options || []
      }
    }

    res.json(result)
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch field options: ' + err.message })
  }
})

module.exports = router
