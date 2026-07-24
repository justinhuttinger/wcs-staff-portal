// auth/src/routes/kpiDigest.js
// Manual trigger + status for the weekly Operandio KPI digest. Admin-only,
// since it publishes to a shared knowledge base.
const { Router } = require('express')
const authenticate = require('../middleware/auth')
const { requireRole } = require('../middleware/role')
const { runWeekly } = require('../services/kpiDigest')
const { priorWeek } = require('../services/kpiDigest/week')
const { ENABLED_ENV } = require('../services/kpiDigest/config')

const router = Router()
router.use(authenticate)
router.use(requireRole('admin'))

router.get('/status', (req, res) => {
  res.json({
    enabled: process.env[ENABLED_ENV] === 'true',
    nextRun: 'Mondays 8:00am PT',
    nextWindow: priorWeek(),
  })
})

// Regenerate and republish now. Reports the completed prior week by default;
// pass { now: "<ISO>" } to backfill a specific week's run date.
router.post('/run', async (req, res) => {
  try {
    const now = req.body && req.body.now ? new Date(req.body.now) : new Date()
    if (Number.isNaN(now.getTime())) return res.status(400).json({ error: 'invalid `now`' })
    const result = await runWeekly({ now })
    res.status(result.status === 'published' ? 200 : 500).json({ result })
  } catch (e) { res.status(500).json({ error: e.message }) }
})

module.exports = router
