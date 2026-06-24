const { Router } = require('express')
const authenticate = require('../middleware/auth')
const { requireRole, canSeeAllLocations } = require('../middleware/role')
const { supabaseAdmin } = require('../services/supabase')
const { buildMtdMonthWindows } = require('../services/revenueMtdWindows')
const { capRevenueEndDate } = require('../services/revenueEndCap')
const { parseLocationSlugParam, intersectWithAllowed } = require('../utils/locationSlug')

const LOCATION_LABELS = {
  salem: 'Salem',
  keizer: 'Keizer',
  eugene: 'Eugene',
  springfield: 'Springfield',
  clackamas: 'Clackamas',
  medford: 'Medford',
  milwaukie: 'Milwaukie',
}

const router = Router()

// Resolve the location_slug filter the caller is allowed to use. Accepts
// single-slug, comma-separated multi-slug, or 'all'.
// - Returns null if caller may see all clubs AND requested all/empty.
// - Returns an array of one-or-more slug strings otherwise.
// - Silent-narrows overreaching managers down to their allowed set.
async function resolveLocationFilter(req) {
  const role = req.staff?.role
  const parsed = parseLocationSlugParam(req.query.location_slug)
  if (parsed.invalid) {
    const err = new Error(`Unknown location_slug: ${parsed.invalid}`)
    err.status = 400
    throw err
  }

  if (canSeeAllLocations(role)) {
    return parsed.all ? null : parsed.slugs
  }

  // Manager / lead: lock to their allowed locations.
  const allowedIds = req.staff?.location_ids || []
  if (allowedIds.length === 0) return [] // No access at all → empty result
  const { data: allowedLocs } = await supabaseAdmin
    .from('locations')
    .select('name')
    .in('id', allowedIds)
  const allowedSlugs = (allowedLocs || []).map(l =>
    l.name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '')
  )
  const narrowed = intersectWithAllowed(parsed, allowedSlugs, { silentNarrow: true })
  return narrowed.slugs
}

const iso = d => d.toISOString().slice(0, 10)

function priorEquivalentPeriod(start, end) {
  const s = new Date(start + 'T00:00:00Z')
  const e = new Date(end + 'T00:00:00Z')
  const lengthDays = Math.round((e - s) / 86400000) + 1
  const prevEnd = new Date(s)
  prevEnd.setUTCDate(prevEnd.getUTCDate() - 1)
  const prevStart = new Date(prevEnd)
  prevStart.setUTCDate(prevStart.getUTCDate() - (lengthDays - 1))
  return { start: iso(prevStart), end: iso(prevEnd) }
}

function shiftByMonths(start, end, months) {
  const s = new Date(start + 'T00:00:00Z')
  const e = new Date(end + 'T00:00:00Z')
  s.setUTCMonth(s.getUTCMonth() - months)
  e.setUTCMonth(e.getUTCMonth() - months)
  return { start: iso(s), end: iso(e) }
}

function shiftByYears(start, end, years) {
  const s = new Date(start + 'T00:00:00Z')
  const e = new Date(end + 'T00:00:00Z')
  s.setUTCFullYear(s.getUTCFullYear() - years)
  e.setUTCFullYear(e.getUTCFullYear() - years)
  return { start: iso(s), end: iso(e) }
}

async function fetchSummary(startDate, endDate, locationFilter) {
  const { data, error } = await supabaseAdmin.rpc('revenue_summary', {
    p_start_date: startDate,
    p_end_date: endDate,
    p_location_filter: locationFilter,
  })
  if (error) throw new Error(`revenue_summary RPC failed: ${error.message}`)
  const out = { total: 0, by_club: [], by_profit_center: [], by_day: [], by_membership_type: [] }
  for (const r of data || []) {
    const amount = Number(r.total_amount) || 0
    if (r.bucket === 'total') out.total = amount
    else if (r.bucket === 'by_club') out.by_club.push({ slug: r.key1, label: LOCATION_LABELS[r.key1] || r.key1, total: amount })
    else if (r.bucket === 'by_profit_center') out.by_profit_center.push({ name: r.key1, total: amount })
    else if (r.bucket === 'by_day') out.by_day.push({ date: r.key1, total: amount })
    else if (r.bucket === 'by_membership_type') out.by_membership_type.push({ code: r.key1, total: amount })
  }
  out.by_club.sort((a, b) => b.total - a.total)
  out.by_profit_center.sort((a, b) => a.name.localeCompare(b.name))
  const pcTotal = out.by_profit_center.reduce((s, p) => s + p.total, 0) || 1
  out.by_profit_center.forEach(p => { p.pct_of_total = p.total / pcTotal })
  out.by_membership_type.sort((a, b) => b.total - a.total)
  const mtTotal = out.by_membership_type.reduce((s, m) => s + m.total, 0) || 1
  out.by_membership_type.forEach(m => { m.pct_of_total = m.total / mtTotal })
  out.by_day.sort((a, b) => a.date.localeCompare(b.date))
  return out
}

// ---------------------------------------------------------------------------
// GET /reports/revenue/summary
// ---------------------------------------------------------------------------
router.get('/summary', authenticate, requireRole('manager'), async (req, res) => {
  try {
    const { start_date, end_date } = req.query
    if (!start_date || !end_date) return res.status(400).json({ error: 'start_date and end_date required' })
    // Revenue data only exists through yesterday (today's email arrives tomorrow).
    // Cap the end so MTD comparisons line up day-for-day with the prior periods.
    const effEnd = capRevenueEndDate(end_date)
    const locationFilter = await resolveLocationFilter(req)
    const priorPeriod = priorEquivalentPeriod(start_date, effEnd)
    const lastMonthPeriod = shiftByMonths(start_date, effEnd, 1)
    const lastYearPeriod = shiftByYears(start_date, effEnd, 1)
    const [current, prior, lastMonth, lastYear] = await Promise.all([
      fetchSummary(start_date, effEnd, locationFilter),
      fetchSummary(priorPeriod.start, priorPeriod.end, locationFilter),
      fetchSummary(lastMonthPeriod.start, lastMonthPeriod.end, locationFilter),
      fetchSummary(lastYearPeriod.start, lastYearPeriod.end, locationFilter),
    ])
    res.json({
      period: { start: start_date, end: effEnd },
      ...current,
      compare: { period: priorPeriod, ...prior },
      compare_last_month: { period: lastMonthPeriod, ...lastMonth },
      compare_last_year: { period: lastYearPeriod, ...lastYear },
    })
  } catch (err) {
    console.error('[revenue/summary]', err.message)
    res.status(500).json({ error: err.message })
  }
})

// ---------------------------------------------------------------------------
// GET /reports/revenue/profit-center-trend
// ---------------------------------------------------------------------------
router.get('/profit-center-trend', authenticate, requireRole('manager'), async (req, res) => {
  try {
    const { start_date, end_date, profit_center } = req.query
    if (!start_date || !end_date || !profit_center) {
      return res.status(400).json({ error: 'start_date, end_date, profit_center required' })
    }
    const locationFilter = await resolveLocationFilter(req)
    let q = supabaseAdmin
      .from('abc_revenue_transactions')
      .select('payment_date, payment_amount')
      .eq('profit_center', profit_center)
      .gte('payment_date', start_date)
      .lte('payment_date', capRevenueEndDate(end_date))
    if (locationFilter && locationFilter.length > 0) {
      q = q.in('location_slug', locationFilter)
    } else if (locationFilter && locationFilter.length === 0) {
      // No access — return empty series.
      return res.json({ series: [] })
    }
    const { data, error } = await q
    if (error) throw error
    const byDay = {}
    for (const r of data || []) {
      byDay[r.payment_date] = (byDay[r.payment_date] || 0) + Number(r.payment_amount)
    }
    const series = Object.entries(byDay)
      .map(([date, total]) => ({ date, total }))
      .sort((a, b) => a.date.localeCompare(b.date))
    res.json({ series })
  } catch (err) {
    console.error('[revenue/profit-center-trend]', err.message)
    res.status(500).json({ error: err.message })
  }
})

// ---------------------------------------------------------------------------
// GET /reports/revenue/profit-center-mtd-trend
// Returns 12 months of MTD totals for a single profit center, with each month's
// cutoff matching the day-of-month of the supplied `end_date`. So if end_date
// is 2026-05-15, every monthly bucket is "days 1–15 of that month" (capped to
// each month's last day where shorter).
// ---------------------------------------------------------------------------
router.get('/profit-center-mtd-trend', authenticate, requireRole('manager'), async (req, res) => {
  try {
    const { profit_center, end_date } = req.query
    if (!profit_center || !end_date) {
      return res.status(400).json({ error: 'profit_center and end_date required' })
    }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(end_date)) {
      return res.status(400).json({ error: 'end_date must be YYYY-MM-DD' })
    }

    const locationFilter = await resolveLocationFilter(req)
    // Cap to yesterday so the current month's MTD cutoff matches the data we have
    // and every prior month is compared at the same day-of-month.
    const months = buildMtdMonthWindows(capRevenueEndDate(end_date), 12)

    if (locationFilter && locationFilter.length === 0) {
      return res.json({ series: months.map(m => ({ ...m, mtd_total: 0 })) })
    }

    // Fetch every transaction in the union window (oldest month's start through
    // current end_date) then bucket per-month in JS, dropping rows beyond each
    // month's same-day-of-month cutoff.
    const overallStart = months[0].period_start
    const overallEnd = months[months.length - 1].period_end

    let q = supabaseAdmin
      .from('abc_revenue_transactions')
      .select('payment_date, payment_amount')
      .eq('profit_center', profit_center)
      .gte('payment_date', overallStart)
      .lte('payment_date', overallEnd)
    if (locationFilter && locationFilter.length > 0) {
      q = q.in('location_slug', locationFilter)
    }

    const rows = []
    let from = 0
    while (true) {
      const { data, error } = await q.range(from, from + 999)
      if (error) throw error
      if (!data || data.length === 0) break
      rows.push(...data)
      if (data.length < 1000) break
      from += 1000
    }

    const totalsByMonth = {}
    for (const m of months) totalsByMonth[m.month] = 0

    for (const r of rows) {
      const monthKey = String(r.payment_date).slice(0, 7) // 'YYYY-MM'
      const window = months.find(m => m.month === monthKey)
      if (!window) continue
      // Drop anything past this month's cutoff day-of-month.
      if (String(r.payment_date) > window.period_end) continue
      totalsByMonth[monthKey] += Number(r.payment_amount) || 0
    }

    const series = months.map(m => ({ ...m, mtd_total: totalsByMonth[m.month] }))
    res.json({ series })
  } catch (err) {
    console.error('[revenue/profit-center-mtd-trend]', err.message)
    res.status(500).json({ error: err.message })
  }
})

// ---------------------------------------------------------------------------
// GET /reports/revenue/imports — last N import audit rows (admin Backfill UI)
// ---------------------------------------------------------------------------
router.get('/imports', authenticate, requireRole('admin'), async (req, res) => {
  try {
    const limit = Math.min(Number(req.query.limit) || 20, 100)
    const { data, error } = await supabaseAdmin
      .from('abc_revenue_imports')
      .select('id, source, period_start, period_end, reported_total, computed_total, row_count, filename, status, error_message, created_at')
      .order('created_at', { ascending: false })
      .limit(limit)
    if (error) throw error
    res.json({ rows: data || [] })
  } catch (err) {
    console.error('[revenue/imports]', err.message)
    res.status(500).json({ error: err.message })
  }
})

module.exports = router
