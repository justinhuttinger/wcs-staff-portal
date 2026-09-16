// Admin -> Group X -> Attendance links: list and regenerate each club's
// login-free attendance link. Same shape as tourAdmin.js.
const { Router } = require('express')
const crypto = require('crypto')
const { supabaseAdmin } = require('../services/supabase')
const authenticate = require('../middleware/auth')
const { requireRole } = require('../middleware/role')
const { CLUBS, isKnownClubNumber } = require('../lib/groupXClubs')

const router = Router()
router.use(authenticate)
router.use(requireRole('admin'))

function newToken() {
  return crypto.randomBytes(24).toString('base64url')
}

router.get('/', async (req, res) => {
  try {
    const { data, error } = await supabaseAdmin
      .from('group_x_attendance_links')
      .select('club_number, public_token, active')
    if (error) throw new Error(error.message)
    const byClub = new Map((data || []).map(r => [r.club_number, r]))
    res.json({
      links: CLUBS.map(c => ({
        club_number: c.clubNumber,
        name: c.name,
        public_token: byClub.get(c.clubNumber)?.public_token || null,
      })),
    })
  } catch (err) {
    console.error('[gx-attendance-links] list failed:', err.message)
    res.status(500).json({ error: 'Failed to load attendance links' })
  }
})

// Also mints the first token for a club that has no row yet. The token is in
// the upsert either way, so the NOT NULL column is always satisfied.
router.post('/:clubNumber/regenerate', async (req, res) => {
  if (!isKnownClubNumber(req.params.clubNumber)) {
    return res.status(400).json({ error: 'unknown club_number' })
  }
  try {
    const token = newToken()
    const { error } = await supabaseAdmin
      .from('group_x_attendance_links')
      .upsert(
        { club_number: req.params.clubNumber, public_token: token, updated_at: new Date().toISOString() },
        { onConflict: 'club_number' }
      )
    if (error) throw new Error(error.message)
    res.json({ public_token: token })
  } catch (err) {
    console.error('[gx-attendance-links] regenerate failed:', err.message)
    res.status(500).json({ error: 'Failed to regenerate' })
  }
})

module.exports = router
