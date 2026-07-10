// auth/src/routes/changelog.js
// Per-user "What's New" read state — the highest changelog entry id a staff
// member has seen. Any authenticated user; the entry content itself lives in the
// frontend (config/changelog.js), this only tracks how far each person has read.
const { Router } = require('express')
const { supabaseAdmin } = require('../services/supabase')
const authenticate = require('../middleware/auth')

const router = Router()
router.use(authenticate)

// GET /changelog/seen — this user's last-seen entry id (0 if never).
router.get('/seen', async (req, res) => {
  try {
    const { data, error } = await supabaseAdmin
      .from('staff_changelog_seen').select('last_seen_id')
      .eq('staff_id', req.staff.id).maybeSingle()
    if (error) throw error
    res.json({ last_seen_id: data?.last_seen_id || 0 })
  } catch (err) {
    console.error('[changelog] seen read failed:', err.message)
    res.status(500).json({ error: 'seen read failed' })
  }
})

// POST /changelog/seen { last_seen_id } — advance this user's read marker. Only
// ever moves forward, so a stale client can't un-read newer entries.
router.post('/seen', async (req, res) => {
  try {
    const id = parseInt(req.body.last_seen_id, 10)
    if (!Number.isFinite(id) || id < 0) return res.status(400).json({ error: 'last_seen_id must be a non-negative integer' })
    const { data: existing } = await supabaseAdmin
      .from('staff_changelog_seen').select('last_seen_id')
      .eq('staff_id', req.staff.id).maybeSingle()
    const next = Math.max(id, existing?.last_seen_id || 0)
    const { error } = await supabaseAdmin
      .from('staff_changelog_seen')
      .upsert({ staff_id: req.staff.id, last_seen_id: next, updated_at: new Date().toISOString() }, { onConflict: 'staff_id' })
    if (error) throw error
    res.json({ last_seen_id: next })
  } catch (err) {
    console.error('[changelog] seen write failed:', err.message)
    res.status(500).json({ error: 'seen write failed' })
  }
})

module.exports = router
