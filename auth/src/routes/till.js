// auth/src/routes/till.js
// Till / cash reconciliation. Manager+ (cash variance is sensitive).
const { Router } = require('express')
const { supabaseAdmin } = require('../services/supabase')
const authenticate = require('../middleware/auth')
const { requireRole, canSeeAllLocations } = require('../middleware/role')
const { parseLocationSlugParam, SLUG_CLUB_MAP, intersectWithAllowed } = require('../utils/locationSlug')
const { reconcileDay } = require('../lib/tillReconcile')
const { aggregateCashByDay } = require('../lib/tillCashMovements')

const CLUB_TO_SLUG = Object.fromEntries(Object.entries(SLUG_CLUB_MAP).map(([s, c]) => [c, s]))
const router = Router()
router.use(authenticate)
router.use(requireRole('manager'))

// Convert a location name to a slug (same as payroll/checkinsReport).
function locSlugFromName(name) {
  return (name || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '')
}

// Parse YYYY-MM-DD as a wide UTC window that safely covers any Pacific day in the
// range regardless of DST offset. We widen by one calendar day on each side; the
// aggregateCashByDay call buckets precisely by pacificDate, and the per-row date
// filter below trims any spill to exactly [from, to].
function utcWindow(fromStr, toStr) {
  // Shift start back 1 day and end forward 1 day to cover both UTC-8 and UTC-7.
  const fromDate = new Date(`${fromStr}T00:00:00-08:00`)
  fromDate.setUTCDate(fromDate.getUTCDate() - 1)
  const toDate = new Date(`${toStr}T23:59:59-07:00`)
  toDate.setUTCDate(toDate.getUTCDate() + 1)
  return { from: fromDate, to: toDate }
}

router.get('/reconciliation', async (req, res) => {
  try {
    const parsed = parseLocationSlugParam(req.query.location_slug)
    if (parsed.invalid) return res.status(400).json({ error: `Unknown location: ${parsed.invalid}` })
    const from = String(req.query.from || '').slice(0, 10)
    const to = String(req.query.to || '').slice(0, 10)
    if (!/^\d{4}-\d{2}-\d{2}$/.test(from) || !/^\d{4}-\d{2}-\d{2}$/.test(to))
      return res.status(400).json({ error: 'from and to (YYYY-MM-DD) are required' })

    // FIX 5: cap to 366 days to prevent runaway queries.
    const spanDays = (new Date(to) - new Date(from)) / 86400000
    if (spanDays > 366)
      return res.status(400).json({ error: 'Date range too large (max 366 days).' })

    // FIX 1: manager-scoped location narrowing (mirrors payroll.js pattern).
    let slugs = parsed.slugs
    if (!canSeeAllLocations(req.staff.role)) {
      if (parsed.all)
        return res.status(403).json({ error: 'Specify a location_slug; you do not have access to all locations.' })
      const allowedIds = req.staff.report_location_ids || []
      let allowedSlugs = []
      if (allowedIds.length > 0) {
        const { data: allowedLocs } = await supabaseAdmin
          .from('locations').select('name').in('id', allowedIds)
        allowedSlugs = (allowedLocs || []).map(l => locSlugFromName(l.name))
      }
      const narrowed = intersectWithAllowed(parsed, allowedSlugs)
      if (narrowed.invalid)
        return res.status(403).json({ error: `Not authorized to view this location: ${narrowed.invalid}` })
      slugs = narrowed.slugs
    }

    const clubs = slugs.map(s => SLUG_CLUB_MAP[s]).filter(Boolean)
    const { from: fromUtc, to: toUtc } = utcWindow(from, to)

    // Settings (float + drop UPC sentinel) per club.
    const { data: settings } = await supabaseAdmin
      .from('till_settings').select('club_number, standard_float, drop_upc')
      .in('club_number', clubs)
    const settingByClub = new Map((settings || []).map(s => [s.club_number, s]))

    // Counts per club/day (open/close). Tolerate the table not existing yet.
    let counts = []
    try {
      const { data } = await supabaseAdmin
        .from('till_counts')
        .select('club_number, business_date, count_type, counted_amount, employee_name')
        .in('club_number', clubs).gte('business_date', from).lte('business_date', to)
      counts = data || []
    } catch { counts = [] }
    const countKey = (club, date, type) => `${club}|${date}|${type}`
    const countMap = new Map(counts.map(c => [countKey(c.club_number, c.business_date, c.count_type), c]))

    const rows = []
    for (const club of clubs) {
      const setting = settingByClub.get(club) || { standard_float: 100, drop_upc: 'XXXCASHDROPXXX' }
      const byDay = await aggregateCashByDay(supabaseAdmin, {
        clubNumber: club, fromUtc, toUtc, dropUpc: setting.drop_upc,
      })
      // Union of days that have cash activity OR a count submission.
      const days = new Set(byDay.keys())
      counts.filter(c => c.club_number === club).forEach(c => days.add(c.business_date))
      for (const date of [...days].sort()) {
        // FIX 2: trim days that fell outside the requested range due to the wide
        // UTC window (the window is intentionally wider than the range for DST safety).
        if (date < from || date > to) continue
        const cash = byDay.get(date) || { cashSales: 0, cashRefunds: 0, cashDrops: 0 }
        const open = countMap.get(countKey(club, date, 'open'))
        const close = countMap.get(countKey(club, date, 'close'))
        const rec = reconcileDay({
          standardFloat: Number(setting.standard_float),
          openingCount: open ? Number(open.counted_amount) : null,
          closingCount: close ? Number(close.counted_amount) : null,
          cashSales: cash.cashSales, cashRefunds: cash.cashRefunds, cashDrops: cash.cashDrops,
        })
        rows.push({
          club_number: club, location_slug: CLUB_TO_SLUG[club], business_date: date,
          cashSales: Math.round(cash.cashSales * 100) / 100,
          cashRefunds: Math.round(cash.cashRefunds * 100) / 100,
          cashDrops: Math.round(cash.cashDrops * 100) / 100,
          ...rec,
          openBy: open?.employee_name || null, closeBy: close?.employee_name || null,
        })
      }
    }
    res.json({ rows })
  } catch (err) {
    console.error('[till] reconciliation failed:', err.message)
    res.status(500).json({ error: 'reconciliation failed' })
  }
})

module.exports = router
