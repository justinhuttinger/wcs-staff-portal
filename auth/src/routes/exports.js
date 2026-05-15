const { Router } = require('express')
const authenticate = require('../middleware/auth')
const { requireRole } = require('../middleware/role')
const { buildRoster } = require('../services/abcEmployeeRoster')

const router = Router()
router.use(authenticate)
router.use(requireRole('admin'))

// GET /admin/exports/abc-employee-roster.xlsx
// Builds the multi-tab roster workbook and streams it back as a file
// download. The browser will save it as abc-employee-roster.xlsx.
//
// Query params:
//   active-only=1      Skip employees ABC has flagged inactive.
//   clubs=salem,keizer Limit to a subset of clubs by slug.
router.get('/abc-employee-roster.xlsx', async (req, res) => {
  try {
    const activeOnly = req.query['active-only'] === '1' || req.query['active-only'] === 'true'
    const clubsArg = req.query.clubs
    const clubSlugs = typeof clubsArg === 'string' && clubsArg.length
      ? clubsArg.split(',').map(s => s.trim()).filter(Boolean)
      : null

    const { buffer, totals } = await buildRoster({ activeOnly, clubSlugs })

    console.log('[exports] abc-employee-roster:', JSON.stringify(totals))

    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')
    res.setHeader('Content-Disposition', 'attachment; filename="abc-employee-roster.xlsx"')
    res.setHeader('Content-Length', buffer.length)
    res.send(buffer)
  } catch (err) {
    console.error('[exports] abc-employee-roster failed:', err.message)
    res.status(500).json({ error: err.message })
  }
})

module.exports = router
