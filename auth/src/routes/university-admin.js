// WCS University — admin enrollment API (staff JWT, admin role).
//
// Mounted at /university/admin behind UNIVERSITY_ENROLL_ENABLED so it ships dark
// until the University GHL token (GHL_UNIVERSITY_*) is configured. Powers the
// admin "University Enrollment" screen: list GHL users across sub-accounts, then
// enroll one (grant University access + restricted permissions + 5 practice
// contacts). See services/university/{ghlUsers,enroll,seedContacts}.js.

const { Router } = require('express')
const authenticate = require('../middleware/auth')
const { requireRole } = require('../middleware/role')
const { supabaseAdmin } = require('../services/supabase')
const { getUniversityLocation } = require('../config/ghlLocations')
const { listAllUsers } = require('../services/university/ghlUsers')
const { enrollUser } = require('../services/university/enroll')

const router = Router()
router.use(authenticate)
router.use(requireRole('admin'))

// GET /university/admin/users — all GHL users across readable sub-accounts,
// merged with their portal enrollment status (so the UI can badge "Enrolled").
router.get('/users', async (req, res) => {
  try {
    if (!getUniversityLocation()) {
      return res.status(503).json({ error: 'University GHL location is not configured (GHL_UNIVERSITY_LOCATION_ID + GHL_UNIVERSITY_API_KEY)' })
    }
    const [users, enrollRes] = await Promise.all([
      listAllUsers(),
      supabaseAdmin.from('university_enrollments').select('ghl_user_id, status, created_contacts'),
    ])
    const byUser = new Map((enrollRes.data || []).map(e => [e.ghl_user_id, e]))
    res.json({
      users: users.map(u => {
        const e = byUser.get(u.id)
        return {
          ...u,
          enrollment_status: e?.status || null,
          contacts_created: e ? (e.created_contacts || []).length : 0,
        }
      }),
    })
  } catch (err) {
    console.error('[university/admin] users list error:', err.message)
    res.status(500).json({ error: err.message })
  }
})

// POST /university/admin/enroll  { user_id, email?, name? }
router.post('/enroll', async (req, res) => {
  try {
    const userId = req.body?.user_id || req.body?.userId
    if (!userId) return res.status(400).json({ error: 'user_id is required' })
    const enrollment = await enrollUser({
      userId,
      email: req.body?.email || null,
      name: req.body?.name || null,
      enrolledBy: req.staff?.email || req.staff?.id || null,
    })
    const code = enrollment.status === 'failed' ? 502 : 200
    res.status(code).json({ enrollment })
  } catch (err) {
    console.error('[university/admin] enroll error:', err.message)
    res.status(500).json({ error: err.message })
  }
})

// GET /university/admin/enrollments — audit list, newest first.
router.get('/enrollments', async (req, res) => {
  try {
    const { data, error } = await supabaseAdmin
      .from('university_enrollments')
      .select('*')
      .order('created_at', { ascending: false })
      .limit(500)
    if (error) throw error
    res.json({ enrollments: data || [] })
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

module.exports = router
