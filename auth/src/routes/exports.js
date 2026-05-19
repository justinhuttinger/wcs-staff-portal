const { Router } = require('express')
const authenticate = require('../middleware/auth')
const { requireRole } = require('../middleware/role')
const { buildRoster } = require('../services/abcEmployeeRoster')
const { parseLocationSlugParam, SLUG_CLUB_MAP } = require('../utils/locationSlug')
const { gatherTrends12mo } = require('../services/trends12mo')
const { buildTrendsWorkbook } = require('../services/trends12moExcel')

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

// ---------------------------------------------------------------------------
// GET /admin/exports/trends-12mo.xlsx
// 12-month trends Excel report. Streams the workbook as a download.
//
// Query params:
//   location_slug  Comma-separated slug list, 'all', or omitted (= all clubs).
//   end_month      YYYY-MM (default = current month). Range covers the
//                  trailing 12 months ending at this month inclusive.
// ---------------------------------------------------------------------------
router.get('/trends-12mo.xlsx', async (req, res) => {
  try {
    const parsed = parseLocationSlugParam(req.query.location_slug)
    if (parsed.invalid) {
      return res.status(400).json({ error: `Unknown location_slug: ${parsed.invalid}` })
    }
    const locationSlugs = parsed.all ? null : parsed.slugs
    const clubNumbers = locationSlugs
      ? locationSlugs.map(s => SLUG_CLUB_MAP[s]).filter(Boolean)
      : null

    let endMonth = (req.query.end_month || '').trim()
    if (!endMonth) {
      const now = new Date()
      endMonth = `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, '0')}`
    }
    if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(endMonth)) {
      return res.status(400).json({ error: 'end_month must be YYYY-MM' })
    }

    const t0 = Date.now()
    const data = await gatherTrends12mo({ clubNumbers, locationSlugs, endMonth })
    const tGather = Date.now() - t0

    const buffer = await buildTrendsWorkbook(data)
    const tBuild = Date.now() - t0 - tGather

    console.log('[exports] trends-12mo:', JSON.stringify({
      end_month: endMonth,
      locations: locationSlugs || 'all',
      gather_ms: tGather,
      build_ms: tBuild,
      bytes: buffer.length,
    }))

    const filename = `WCS-Trends-12mo-${endMonth}.xlsx`
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`)
    res.setHeader('Content-Length', buffer.length)
    res.send(buffer)
  } catch (err) {
    console.error('[exports] trends-12mo failed:', err.message, err.stack)
    res.status(500).json({ error: err.message })
  }
})

module.exports = router
