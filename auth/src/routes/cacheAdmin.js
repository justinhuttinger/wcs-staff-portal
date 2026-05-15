const { Router } = require('express')
const authenticate = require('../middleware/auth')
const { requireRole } = require('../middleware/role')
const { getStats, resetStats } = require('../services/memoryCache')
const cacheWarmer = require('../services/cacheWarmer')

const router = Router()
router.use(authenticate)
router.use(requireRole('admin'))

// GET /admin/cache/stats — in-memory cache hit/miss counters and current size.
router.get('/stats', (req, res) => {
  res.json({
    cache: getStats(),
    warmer: {
      registered: cacheWarmer._tasks.map(t => t.name),
      businessHours: cacheWarmer.isPacificBusinessHours(),
    },
  })
})

// POST /admin/cache/stats/reset — zero out the counters (size + inflight stay).
router.post('/stats/reset', (req, res) => {
  resetStats()
  res.json({ ok: true, cache: getStats() })
})

// POST /admin/cache/warm — manually trigger a warmup cycle (force=true bypasses
// the business-hours gate). Useful for debugging or pre-warming after deploy.
router.post('/warm', async (req, res) => {
  try {
    const result = await cacheWarmer.runCycle({ force: true })
    res.json(result)
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

module.exports = router
