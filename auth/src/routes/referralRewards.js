const { Router } = require('express')
const { supabaseAdmin } = require('../services/supabase')
const authenticate = require('../middleware/auth')
const { requireRole } = require('../middleware/role')

const router = Router()
router.use(authenticate)
router.use(requireRole('admin'))

// GET /referral-rewards — list rewards, newest first. ?needs_review=true filters.
router.get('/', async (req, res) => {
  try {
    let query = supabaseAdmin
      .from('referral_rewards')
      .select('*')
      .order('created_at', { ascending: false })
      .limit(500)
    if (req.query.needs_review === 'true') query = query.eq('needs_review', true)
    const { data, error } = await query
    if (error) return res.status(500).json({ error: error.message })
    res.json({ rewards: data || [] })
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

// POST /referral-rewards/:id/resolve — mark a flagged reward handled.
router.post('/:id/resolve', async (req, res) => {
  try {
    const resolvedBy = req.staff?.email || req.staff?.id || 'unknown'
    const { data, error } = await supabaseAdmin
      .from('referral_rewards')
      .update({ needs_review: false, resolved_at: new Date().toISOString(), resolved_by: resolvedBy })
      .eq('id', req.params.id)
      .select()
      .single()
    if (error) return res.status(500).json({ error: error.message })
    res.json({ reward: data })
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

module.exports = router
