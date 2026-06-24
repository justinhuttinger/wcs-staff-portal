// auth/src/routes/blogAutomation.js
const { Router } = require('express')
const authenticate = require('../middleware/auth')
const { requireRole } = require('../middleware/role')
const jobs = require('../services/blogAutomation/jobs')
const wp = require('../services/blogAutomation/wordpress')
const { enabledLocations } = require('../services/blogAutomation/config')
const { runForLocation, runWeekly } = require('../services/blogAutomation')

const router = Router()
router.use(authenticate)
router.use(requireRole('corporate')) // corporate/marketing/admin

router.get('/posts', async (req, res) => {
  try {
    const posts = await jobs.listRecent({ location: req.query.location || null, limit: Math.min(Number(req.query.limit) || 50, 200) })
    res.json({ posts })
  } catch (e) { res.status(500).json({ error: e.message }) }
})

router.get('/status', async (req, res) => {
  try {
    const wpConn = await wp.testConnection()
    res.json({ wp: wpConn, locations: enabledLocations().map(l => l.key),
      enabled: process.env.BLOG_AUTOMATION_ENABLED === 'true', nextRun: 'Mondays 8:00am PT' })
  } catch (e) { res.status(500).json({ error: e.message }) }
})

router.post('/run', requireRole('admin'), async (req, res) => {
  try {
    const location = String(req.body.location || '')
    if (!location) return res.status(400).json({ error: 'location is required' })
    const publish = req.body.publish === true
    const result = await runForLocation(location, { publish })
    res.json({ result })
  } catch (e) { res.status(500).json({ error: e.message }) }
})

// Run every enabled location sequentially (same path as the weekly cron) so the
// UI never fires N concurrent requests that can OOM the instance. The run takes
// minutes, so it is fire-and-forget: returns immediately; poll /posts for results.
router.post('/run-all', requireRole('admin'), (req, res) => {
  const publish = req.body.publish === true
  runWeekly({ publish }).catch(e => console.error('[Blog] run-all failed:', e.message))
  res.json({ started: true, publish, locations: enabledLocations().map(l => l.key) })
})

module.exports = router
