const { Router } = require('express')
const authenticate = require('../middleware/auth')
const { requireReportAccess } = require('../middleware/role')
const { wrapSWR } = require('../services/memoryCache')
const { supabaseAdmin } = require('../services/supabase')
const { parseLocationSlugParam, locationCacheKey } = require('../utils/locationSlug')
const { CLUBS, fetchActiveRecurringPTServices } = require('../services/abcRecurring')
const { normalizeService, computeProjections } = require('../lib/ptProjections')

const PT_PROJ_FRESH_MS = 2 * 60 * 1000
const PT_PROJ_STALE_MS = 15 * 60 * 1000
const PT_PROFIT_CENTERS = ['TRAINING', 'PERSONAL TRAINING']
// Rolling forward calendar: show each agreement's next draft out this many days,
// so the "upcoming billing" view crosses the month boundary into next month.
const HORIZON_DAYS = 45

const router = Router()
router.use(authenticate)
router.use(requireReportAccess('manager', ['pt-projections']))

function todayIso() {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}
function monthStartIso() {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-01`
}
function monthEndIso() {
  const d = new Date(); const e = new Date(d.getFullYear(), d.getMonth() + 1, 0)
  return `${e.getFullYear()}-${String(e.getMonth() + 1).padStart(2, '0')}-${String(e.getDate()).padStart(2, '0')}`
}
function addDaysIso(iso, days) {
  const d = new Date(iso + 'T00:00:00')
  d.setDate(d.getDate() + days)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

async function fetchCollected(slugs, startDate, endDate) {
  // slugs: array of allowed location slugs, or null for all clubs.
  let q = supabaseAdmin
    .from('abc_revenue_transactions')
    .select('member_number, location_slug, payment_amount')
    .in('profit_center', PT_PROFIT_CENTERS)
    .gte('payment_date', startDate)
    .lte('payment_date', endDate)
  if (slugs && slugs.length) q = q.in('location_slug', slugs)
  const rows = []
  const PAGE = 1000
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await q.range(from, from + PAGE - 1)
    if (error) throw new Error(`collected revenue query failed: ${error.message}`)
    rows.push(...(data || []))
    if (!data || data.length < PAGE) break
  }
  return rows.map(r => ({ memberNumber: String(r.member_number), location: r.location_slug, amount: Number(r.payment_amount) || 0 }))
}

async function buildPtProjectionsPayload(query) {
  const parsed = parseLocationSlugParam(query.location_slug)
  if (parsed.invalid) { const e = new Error(`Unknown location: ${parsed.invalid}`); e.status = 400; throw e }
  const targetClubs = parsed.all ? CLUBS : CLUBS.filter(c => parsed.slugs.includes(c.slug))
  const slugKey = locationCacheKey(parsed)

  const start = query.start_date || monthStartIso()
  const end = query.end_date || monthEndIso()
  const today = todayIso()
  const horizonEnd = addDaysIso(today, HORIZON_DAYS)

  const cacheKey = `reports:pt-projections:${slugKey}:${start}:${end}`
  return wrapSWR(cacheKey, PT_PROJ_FRESH_MS, PT_PROJ_STALE_MS, async () => {
    // 1. Active recurring PT services across target clubs.
    const results = await Promise.allSettled(
      targetClubs.map(async club => {
        const raw = await fetchActiveRecurringPTServices(club.clubNumber)
        return raw.map(s => normalizeService(s, club.slug))
      })
    )
    const services = []
    const errors = []
    results.forEach((r, i) => {
      if (r.status === 'fulfilled') services.push(...r.value)
      else errors.push({ club: targetClubs[i].name, error: r.reason?.message || 'Unknown error' })
    })

    // 2. Collected TRAINING revenue in window.
    const slugs = parsed.all ? null : parsed.slugs
    const collected = await fetchCollected(slugs, start, end)

    // 3. Reconcile (month) + forward calendar (rolling horizon).
    const out = computeProjections({ services, collected, windowStart: start, windowEnd: end, today, horizonEnd })
    if (errors.length) out.errors = errors
    return out
  })
}

// GET /reports/pt-projections
router.get('/', async (req, res) => {
  try {
    res.json(await buildPtProjectionsPayload(req.query))
  } catch (err) {
    console.error('[PT Projections] Error:', err.message)
    res.status(err.status || 500).json({ error: err.message })
  }
})

module.exports = router
module.exports.warmCache = buildPtProjectionsPayload
