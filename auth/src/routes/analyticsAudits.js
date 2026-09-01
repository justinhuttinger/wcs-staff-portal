const { Router } = require('express')
const authenticate = require('../middleware/auth')
const { requireRole } = require('../middleware/role')
const { supabaseAdmin } = require('../services/supabase')
const { fetchAll } = require('../lib/supabaseFetchAll')
const { wrapSWR } = require('../services/memoryCache')
const { buildAudits } = require('../lib/auditsAnalytics')
const { monthToDate, priorLabel, windowLabel } = require('../lib/snapshotWindow')
const { CLUBS, CLUB_BY_SLUG } = require('../lib/salespersonPerformance')

// ---------------------------------------------------------------------------
// Audits — Analytics (corporate+)
//
// QA submissions from operandio_qa_reports. 173 rows all time, so the whole
// table is fetched and filtered in the builder rather than queried per window:
// staleness is a question about the last audit EVER, and a windowed query
// reports "no audit in the last month" and "no audit in two years" identically.
//
// COVERAGE IS THE REPORT, NOT THE SCORE. Scores sit in a narrow 74-97% band at
// sample sizes of one to seven, where ranking is mostly noise. What the data
// shows is who is not being audited: with the Admin toggles applied, four
// department/club pairs have never been audited and all four are Milwaukie.
//
// THE ADMIN TOGGLES ARE LOAD-BEARING. audit_off_<department>_<slug> = '1' marks
// a pair that does not apply, and Salem's Childcare and Group X audits are
// switched off deliberately. Treating those as gaps would invent work and bury
// the pairs that genuinely are not being done.
// ---------------------------------------------------------------------------

const router = Router()
router.use(authenticate)
router.use(requireRole('corporate'))

const FRESH_MS = 10 * 60 * 1000
const STALE_MS = 60 * 60 * 1000

/**
 * The `audit_off_` settings from app_config, as a flat map.
 *
 * Matched on 'audit%' and narrowed in JS rather than on 'audit\_off\_%'. An
 * underscore is a single-character wildcard in LIKE, so the pattern needs
 * escaping, and an escape that does not survive intact matches NOTHING — every
 * toggle would silently be ignored and switched-off audits would reappear as
 * gaps. Filtering here removes that failure mode.
 */
async function loadAuditToggles() {
  const rows = await fetchAll(
    supabaseAdmin.from('app_config').select('key, value').like('key', 'audit%')
  )
  return Object.fromEntries(
    (rows || [])
      .filter(r => typeof r.key === 'string' && r.key.startsWith('audit_off_'))
      .map(r => [r.key, r.value])
  )
}

router.get('/', async (req, res) => {
  try {
    const mtd = monthToDate()
    const isDate = v => /^\d{4}-\d{2}-\d{2}$/.test(String(v || ''))
    const start = isDate(req.query.start) ? String(req.query.start) : mtd.start
    const end = isDate(req.query.end) ? String(req.query.end) : mtd.end
    if (start > end) return res.status(400).json({ error: 'start must not be after end' })

    const clubsParam = String(req.query.clubs || 'all')
    const slugs = clubsParam === 'all'
      ? CLUBS.map(c => c.slug)
      : clubsParam.split(',').map(s => s.trim().toLowerCase()).filter(s => CLUB_BY_SLUG[s])
    if (slugs.length === 0) return res.status(400).json({ error: 'no valid clubs requested' })

    const cacheKey = ['analytics:audits', start, end, slugs.slice().sort().join('+')].join('|')

    const payload = await wrapSWR(cacheKey, FRESH_MS, STALE_MS, async () => {
      const [rows, toggles] = await Promise.all([
        // The WHOLE table, deliberately — see the header. It is 173 rows.
        fetchAll(supabaseAdmin
          .from('operandio_qa_reports')
          .select('id, department, location_slug, submitted_date, score_pct, job_name, report_url, source')
          .order('submitted_date', { ascending: false })),
        loadAuditToggles(),
      ])
      return { rows, toggles }
    })

    const built = buildAudits(payload.rows, {
      start, end,
      clubs: slugs,
      toggles: payload.toggles,
      today: new Date().toISOString().slice(0, 10),
    })

    res.json({
      ...built,
      meta: {
        start, end,
        windowLabel: windowLabel(start, end),
        comparisonLabel: priorLabel(start, end),
        clubs: slugs,
        anchoredOn: isDate(req.query.start) ? 'request' : 'month to date',
      },
    })
  } catch (err) {
    console.error('[analytics/audits] error:', err.message)
    res.status(500).json({ error: 'Failed to build audits' })
  }
})

module.exports = router
