const { Router } = require('express')
const authenticate = require('../middleware/auth')
const { requireReportAccess } = require('../middleware/role')
const { resolveScopedSlugs } = require('../services/locationScope')
const { NAME_TO_CLUB } = require('../config/clubMap')
const { loadReport } = require('../services/npsReport')

const router = Router()
router.use(authenticate)
// Tier gate, not the roles grid: the grid controls tile visibility only.
router.use(requireReportAccess('manager', ['nps']))

const EMPTY = { byClub: [], byMetric: [], overall: {}, responseRates: [], comments: [] }

function parseList(value) {
  if (!value) return []
  return String(value).split(',').map(s => s.trim()).filter(Boolean)
}

// GET /reports/nps?start=&end=&location_slug=&surveys=&combine=
router.get('/', async (req, res) => {
  try {
    const { start, end, surveys, combine } = req.query
    if (!start || !end) {
      return res.status(400).json({ error: 'start and end are required (YYYY-MM-DD)' })
    }

    // Scoping goes through the shared helper rather than being rebuilt here.
    // It returns a sentinel slug for a restricted user with no assigned clubs
    // instead of falling through to "no filter", which is the bug that once
    // leaked every club's numbers to a scope that resolved to zero.
    const scope = await resolveScopedSlugs(req)

    let clubNumbers = []
    if (!scope.all) {
      clubNumbers = scope.slugs.map(s => NAME_TO_CLUB[s]).filter(Boolean)
      // The sentinel maps to no club number, so an unscoped user lands here
      // and gets an empty report rather than everything.
      if (clubNumbers.length === 0) return res.json(EMPTY)
    }

    const report = await loadReport({
      startDate: start,
      endDate: end,
      clubNumbers,
      surveyIds: parseList(surveys),
      combineSources: combine === 'true',
    })

    res.json(report)
  } catch (err) {
    if (err.status === 400) return res.status(400).json({ error: err.message })
    console.error('[npsReport] failed:', err.message)
    res.status(500).json({ error: 'Failed to build the feedback report' })
  }
})

module.exports = router
