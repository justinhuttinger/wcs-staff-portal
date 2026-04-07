const { Router } = require('express')
const { supabaseAdmin } = require('../services/supabase')
const authenticate = require('../middleware/auth')
const { requireRole, ROLE_HIERARCHY } = require('../middleware/role')

const router = Router()

router.use(authenticate)

// GET /appointments — get appointments for current user (or all at location for managers)
router.get('/', async (req, res) => {
  try {
    const userLevel = ROLE_HIERARCHY.indexOf(req.staff.role)
    const managerLevel = ROLE_HIERARCHY.indexOf('manager')
    const isManager = userLevel >= managerLevel

    let query = supabaseAdmin
      .from('appointments')
      .select('id, staff_id, staff_email, contact_name, contact_id, ghl_appointment_id, appointment_type, appointment_time, form_url, status, sale_result, completed_at, location_id, created_at')
      .order('appointment_time', { ascending: false })

    if (isManager) {
      // Managers see all appointments at their locations
      if (req.query.location_id) {
        query = query.eq('location_id', req.query.location_id)
      } else {
        query = query.in('location_id', req.staff.location_ids)
      }

      // Optional trainer filter
      if (req.query.staff_id) {
        query = query.eq('staff_id', req.query.staff_id)
      }
    } else {
      // Regular staff see only their own
      query = query.eq('staff_id', req.staff.id)
    }

    // Status filter
    if (req.query.status) {
      query = query.eq('status', req.query.status)
    }

    const { data, error } = await query
    if (error) return res.status(500).json({ error: 'Failed to fetch appointments' })

    res.json({ appointments: data })
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch appointments' })
  }
})

module.exports = router
