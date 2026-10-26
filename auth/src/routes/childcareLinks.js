// Admin -> Childcare Kiosk: list and regenerate each club's two login-free
// childcare links (the check-in form, and a read-only "who is in the room"
// view). Same shape as groupXAttendanceLinks.js.
const { Router } = require('express')
const crypto = require('crypto')
const { supabaseAdmin } = require('../services/supabase')
const authenticate = require('../middleware/auth')
const { requireRole } = require('../middleware/role')
const { CLUBS, isKnownClubNumber } = require('../lib/groupXClubs')

const router = Router()
router.use(authenticate)
router.use(requireRole('admin'))

// ?kind= picks which link to (re)generate.
const KIND_COLUMN = { form: 'public_token', view: 'view_token' }

function newToken() {
  return crypto.randomBytes(24).toString('base64url')
}

router.get('/', async (req, res) => {
  try {
    const { data, error } = await supabaseAdmin
      .from('childcare_checkin_links')
      .select('club_number, public_token, view_token, active')
    if (error) throw new Error(error.message)
    const byClub = new Map((data || []).map(r => [r.club_number, r]))
    res.json({
      links: CLUBS.map(c => ({
        club_number: c.clubNumber,
        name: c.name,
        form_token: byClub.get(c.clubNumber)?.public_token || null,
        view_token: byClub.get(c.clubNumber)?.view_token || null,
      })),
    })
  } catch (err) {
    console.error('[childcare-links] list failed:', err.message)
    res.status(500).json({ error: 'Failed to load childcare links' })
  }
})

// Also creates the club's row the first time either of its links is made.
// Only the requested link is minted; the other stays null until asked for.
router.post('/:clubNumber/regenerate', async (req, res) => {
  if (!isKnownClubNumber(req.params.clubNumber)) {
    return res.status(400).json({ error: 'unknown club_number' })
  }
  const column = KIND_COLUMN[req.query.kind || 'form']
  if (!column) return res.status(400).json({ error: 'kind must be form or view' })
  try {
    const clubNumber = req.params.clubNumber
    const token = newToken()
    const now = new Date().toISOString()
    const { data: existing, error: readErr } = await supabaseAdmin
      .from('childcare_checkin_links')
      .select('club_number')
      .eq('club_number', clubNumber)
      .maybeSingle()
    if (readErr) throw new Error(readErr.message)

    const { error } = existing
      ? await supabaseAdmin
        .from('childcare_checkin_links')
        .update({ [column]: token, updated_at: now })
        .eq('club_number', clubNumber)
      : await supabaseAdmin
        .from('childcare_checkin_links')
        .insert({ club_number: clubNumber, [column]: token, updated_at: now })
    if (error) throw new Error(error.message)
    res.json({ token })
  } catch (err) {
    console.error('[childcare-links] regenerate failed:', err.message)
    res.status(500).json({ error: 'Failed to regenerate' })
  }
})

module.exports = router
