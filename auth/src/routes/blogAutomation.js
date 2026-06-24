// auth/src/routes/blogAutomation.js
const { Router } = require('express')
const authenticate = require('../middleware/auth')
const { requireRole } = require('../middleware/role')
const jobs = require('../services/blogAutomation/jobs')
const wp = require('../services/blogAutomation/wordpress')
const { enabledLocations } = require('../services/blogAutomation/config')
const { runForLocation } = require('../services/blogAutomation')

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

module.exports = router
