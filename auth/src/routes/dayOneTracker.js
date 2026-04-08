const { Router } = require('express')
const { supabaseAdmin } = require('../services/supabase')
const authenticate = require('../middleware/auth')
const { requireRole, ROLE_HIERARCHY } = require('../middleware/role')
const { getLocationBySlug } = require('../config/ghlLocations')
const { ghlFetch } = require('../services/ghlClient')

const router = Router()
router.use(authenticate)
router.use(requireRole('personal_trainer'))

// Cache calendar IDs per location (Day One calendar group)
const calendarCache = {}

async function getDayOneCalendarIds(locationId, apiKey) {
  const cacheKey = locationId
  if (calendarCache[cacheKey]) return calendarCache[cacheKey]

  const data = await ghlFetch('/calendars/', apiKey, {
    params: { locationId },
  })

  const calendars = data.calendars || []
  const dayOneCalendars = calendars.filter(cal => {
    const name = (cal.name || '').toLowerCase()
    const group = (cal.groupName || cal.group || '').toLowerCase()
    return name.includes('day one') || group.includes('day one')
  })

  const ids = dayOneCalendars.map(c => c.id)
  if (ids.length > 0) calendarCache[cacheKey] = ids
  return ids
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
    const calendarIds = await getDayOneCalendarIds(location.id, location.apiKey)
    if (calendarIds.length === 0) {
      return res.json({ appointments: [] })
    }

    const now = new Date()
    const startTime = start_date
      ? new Date(start_date + 'T00:00:00.000Z').toISOString()
      : new Date(now.getFullYear(), now.getMonth(), 1).toISOString()
    const endTime = end_date
      ? new Date(end_date + 'T23:59:59.999Z').toISOString()
      : new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59).toISOString()

    let allEvents = []
    for (const calId of calendarIds) {
      const data = await ghlFetch('/calendars/events', location.apiKey, {
        params: {
          locationId: location.id,
          calendarId: calId,
          startTime,
          endTime,
        },
      })
      allEvents.push(...(data.events || []))
    }

    // Role check: managers see all, others see only their own
    const userLevel = ROLE_HIERARCHY.indexOf(req.staff.role)
    const managerLevel = ROLE_HIERARCHY.indexOf('manager')
    const isManager = userLevel >= managerLevel
    const userEmail = req.staff.email?.toLowerCase()

    if (!isManager) {
      allEvents = allEvents.filter(evt => {
        const assignedEmail = (evt.assignedUserId || evt.selectedUser || evt.calendarOwnerEmail || '').toLowerCase()
        const userEmail2 = (evt.user?.email || '').toLowerCase()
        return assignedEmail === userEmail || userEmail2 === userEmail
      })
    }

    // Fetch contact custom fields from synced data
    const contactIds = [...new Set(allEvents.map(e => e.contactId).filter(Boolean))]
    let contactFields = {}
    if (contactIds.length > 0) {
      const { data: contacts } = await supabaseAdmin
        .from('ghl_contacts_report')
        .select('id, day_one_status, day_one_sale, show_or_no_show')
        .in('id', contactIds)
      if (contacts) {
        for (const c of contacts) {
          contactFields[c.id] = c
        }
      }
    }

    const appointments = allEvents
      .map(evt => {
        const cf = contactFields[evt.contactId] || {}
        return {
          id: evt.id,
          contact_id: evt.contactId || null,
          contact_name: [evt.firstName, evt.lastName].filter(Boolean).join(' ') || evt.title || 'Unknown',
          contact_email: evt.email || null,
          appointment_time: evt.startTime || evt.start || null,
          end_time: evt.endTime || evt.end || null,
          assigned_user: evt.selectedUser || evt.assignedUserId || null,
          assigned_user_name: evt.userName || evt.user?.name || null,
          calendar_name: evt.calendarName || null,
          status: evt.appointmentStatus || evt.status || 'confirmed',
          day_one_status: cf.day_one_status || null,
          day_one_sale: cf.day_one_sale || null,
          show_or_no_show: cf.show_or_no_show || null,
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

    res.json({ success: true, fields_updated: customFields.length })
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
