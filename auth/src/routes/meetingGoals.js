// auth/src/routes/meetingGoals.js
// Manual trigger + status for the weekly meeting goals articles. Admin-only,
// since it writes to a shared knowledge base.
const { Router } = require('express')
const authenticate = require('../middleware/auth')
const { requireRole } = require('../middleware/role')
const { supabaseAdmin } = require('../services/supabase')
const { runGoals } = require('../services/meetingGoals')
const { ENABLED_ENV, KINDS, WEEKS_KEPT } = require('../services/meetingGoals/config')

const router = Router()
router.use(authenticate)
router.use(requireRole('admin'))

router.get('/status', async (req, res) => {
  try {
    const { data, error } = await supabaseAdmin
      .from('operandio_goal_articles')
      .select('kind, location_slug, article_id, article_title, last_published_at, last_error')
      .order('article_title')
    if (error) throw new Error(error.message)
    res.json({
      enabled: process.env[ENABLED_ENV] === 'true',
      processes: Object.keys(KINDS),
      weeksKept: WEEKS_KEPT,
      articles: data || [],
    })
  } catch (e) { res.status(500).json({ error: e.message }) }
})

// Collect and republish. With no body, publishes only articles whose club had a
// new submission. `{ all: true }` republishes every known article;
// `{ kind, club }` forces one (use to repair an article edited by hand).
router.post('/run', async (req, res) => {
  try {
    const { kind = null, club = null, all = false } = req.body || {}
    if (kind && !Object.values(KINDS).includes(kind)) {
      return res.status(400).json({ error: `kind must be one of ${Object.values(KINDS).join(', ')}` })
    }
    if ((kind && !club) || (club && !kind)) {
      return res.status(400).json({ error: 'kind and club must be given together' })
    }
    const result = await runGoals({ kind, club, all: !!all })
    res.status(result.status === 'failed' ? 500 : 200).json({ result })
  } catch (e) { res.status(500).json({ error: e.message }) }
})

module.exports = router
