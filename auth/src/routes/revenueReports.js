const { Router } = require('express')
const authenticate = require('../middleware/auth')
const { requireRole, canSeeAllLocations } = require('../middleware/role')
const { supabaseAdmin } = require('../services/supabase')

const router = Router()

// Resolve the location_slug filter the caller is allowed to use.
// - Returns null if caller may see all clubs (corporate/admin/marketing) AND
//   either passed no slug or slug='all'.
// - Returns ['<slug>'] for a single-club view.
// - Returns the caller's allowed slug set if they tried to overreach (silent narrow).
async function resolveLocationFilter(req) {
  const requestedRaw = (req.query.location_slug || '').trim()
  const requested = requestedRaw === '' || requestedRaw === 'all' ? null : requestedRaw
  const role = req.staff?.role

  if (canSeeAllLocations(role)) {
    return requested ? [requested] : null
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
  if (requested && allowedSlugs.includes(requested)) return [requested]
  // Silent narrow: caller asked for something they can't have, OR no slug → give all their slugs.
  return allowedSlugs
}

function priorEquivalentPeriod(start, end) {
  const s = new Date(start + 'T00:00:00Z')
  const e = new Date(end + 'T00:00:00Z')
  const lengthDays = Math.round((e - s) / 86400000) + 1
  const prevEnd = new Date(s)
  prevEnd.setUTCDate(prevEnd.getUTCDate() - 1)
  const prevStart = new Date(prevEnd)
  prevStart.setUTCDate(prevStart.getUTCDate() - (lengthDays - 1))
  const iso = d => d.toISOString().slice(0, 10)
  return { start: iso(prevStart), end: iso(prevEnd) }
}

async function fetchSummary(startDate, endDate, locationFilter) {
  const { data, error } = await supabaseAdmin.rpc('revenue_summary', {
    p_start_date: startDate,
    p_end_date: endDate,
    p_location_filter: locationFilter,
  })
  if (error) throw new Error(`revenue_summary RPC failed: ${error.message}`)
  const out = { total: 0, by_club: [], by_profit_center: [], by_day: [] }
  for (const r of data || []) {
    const amount = Number(r.total_amount) || 0
    if (r.bucket === 'total') out.total = amount
    else if (r.bucket === 'by_club') out.by_club.push({ slug: r.key1, total: amount })
    else if (r.bucket === 'by_profit_center') out.by_profit_center.push({ name: r.key1, total: amount })
    else if (r.bucket === 'by_day') out.by_day.push({ date: r.key1, total: amount })
  }
  out.by_club.sort((a, b) => b.total - a.total)
  out.by_profit_center.sort((a, b) => b.total - a.total)
  const pcTotal = out.by_profit_center.reduce((s, p) => s + p.total, 0) || 1
  out.by_profit_center.forEach(p => { p.pct_of_total = p.total / pcTotal })
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
    const locationFilter = await resolveLocationFilter(req)
    const compare = priorEquivalentPeriod(start_date, end_date)
    const [current, prior] = await Promise.all([
      fetchSummary(start_date, end_date, locationFilter),
      fetchSummary(compare.start, compare.end, locationFilter),
    ])
    res.json({
      period: { start: start_date, end: end_date },
      ...current,
      compare: { period: compare, ...prior },
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
      .lte('payment_date', end_date)
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
