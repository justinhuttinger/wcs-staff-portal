// auth/src/routes/childcare.js
// Childcare headcount report. Admin-only: `admin` is the top tier, so this is
// a hard gate rather than something the roles grid can widen.
const { Router } = require('express')
const authenticate = require('../middleware/auth')
const { requireReportAccess } = require('../middleware/role')
const { resolveScopedSlugs } = require('../services/locationScope')
const { loadReport, EMPTY } = require('../services/childcare')
const { REPORT_KEY } = require('../services/childcare/config')

const router = Router()
router.use(authenticate)
// Tier gate, not the roles grid: the grid controls tile visibility only.
router.use(requireReportAccess('admin', [REPORT_KEY]))

// GET /reports/childcare?start=&end=&location_slug=
router.get('/', async (req, res) => {
  try {
    const start = String(req.query.start || '')
    const end = String(req.query.end || '')
    if (!/^\d{4}-\d{2}-\d{2}$/.test(start) || !/^\d{4}-\d{2}-\d{2}$/.test(end)) {
      return res.status(400).json({ error: 'start and end are required (YYYY-MM-DD)' })
    }
    if (start > end) return res.status(400).json({ error: 'start must be on or before end' })

    // Scoping goes through the shared helper. It returns a sentinel slug for a
    // restricted user with no assigned clubs rather than falling through to
    // "no filter", which is the bug that once leaked every club's numbers.
    const scope = await resolveScopedSlugs(req)
    let slugs = null
    if (!scope.all) {
      slugs = scope.slugs
      if (!slugs || slugs.length === 0) return res.json(EMPTY)
    }

    res.json(await loadReport({ start, end, slugs }))
  } catch (err) {
    res.status(err.status || 500).json({ error: err.message })
  }
})

module.exports = router
