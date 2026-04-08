const { Router } = require('express')
const { supabaseAdmin } = require('../services/supabase')
const authenticate = require('../middleware/auth')
const { requireRole } = require('../middleware/role')

const router = Router()
router.use(authenticate)
router.use(requireRole('lead'))

// ---------------------------------------------------------------------------
// Helper: resolve location filter from query params
// Returns { column, value } or null (no filter = all locations)
// ---------------------------------------------------------------------------
async function resolveLocationFilter(query) {
  const { location_id, location_slug } = query

  if (location_slug && location_slug !== 'all') {
    return { column: 'location_slug', value: location_slug }
  }

  if (location_id) {
    const { data } = await supabaseAdmin
      .from('locations')
      .select('ghl_location_id')
      .eq('id', location_id)
      .single()
    if (data?.ghl_location_id) {
      return { column: 'location_id', value: data.ghl_location_id }
    }
  }

  return null // no filter = all locations
}

// ---------------------------------------------------------------------------
// Helper: convert YYYY-MM-DD date strings to millisecond timestamp strings
// ---------------------------------------------------------------------------
function dateToMs(dateStr, endOfDay = false) {
  if (!dateStr) return null
  const d = endOfDay ? new Date(dateStr + 'T23:59:59.999Z') : new Date(dateStr + 'T00:00:00.000Z')
  return d.getTime().toString()
}

// ---------------------------------------------------------------------------
// Helper: apply location filter to a Supabase query
// ---------------------------------------------------------------------------
function applyLocationFilter(q, locationFilter) {
  if (!locationFilter) return q
  return q.eq(locationFilter.column, locationFilter.value)
}

// ---------------------------------------------------------------------------
// Helper: apply ms timestamp range filter to a Supabase query
// ---------------------------------------------------------------------------
function applyDateRange(q, column, startMs, endMs) {
  if (startMs) q = q.gte(column, startMs)
  if (endMs) q = q.lte(column, endMs)
  return q
}

// ---------------------------------------------------------------------------
// Helper: get most frequent value in an array (returns null for empty)
// ---------------------------------------------------------------------------
function mostFrequent(arr) {
  if (!arr || arr.length === 0) return null
  const freq = {}
  for (const v of arr) {
    if (v) freq[v] = (freq[v] || 0) + 1
  }
  let best = null
  let bestCount = 0
  for (const [v, c] of Object.entries(freq)) {
    if (c > bestCount) { best = v; bestCount = c }
  }
  return best
}

// ---------------------------------------------------------------------------
// GET /reports/salesperson-stats
// Query params: start_date, end_date, location_id, location_slug
// ---------------------------------------------------------------------------
router.get('/salesperson-stats', async (req, res) => {
  const { start_date, end_date } = req.query

  try {
    const locationFilter = await resolveLocationFilter(req.query)

    const startMs = dateToMs(start_date, false)
    const endMs   = dateToMs(end_date, true)

    let q = supabaseAdmin
      .from('ghl_contacts_report')
      .select(
        'first_name, last_name, full_name, email, phone, tags,' +
        'sale_team_member, vip_count, day_one_booked,' +
        'member_sign_date, membership_type, same_day_sale,' +
        'location_name, location_slug'
      )
      .not('member_sign_date', 'is', null)

    q = applyLocationFilter(q, locationFilter)
    q = applyDateRange(q, 'member_sign_date', startMs, endMs)

    const { data, error } = await q.order('member_sign_date', { ascending: false })
    if (error) return res.status(500).json({ error: 'Failed to fetch salesperson stats', detail: error.message })

    const contacts = data || []

    const bySalesperson = {}
    for (const c of contacts) {
      const sp = c.sale_team_member || 'Unassigned'
      if (!bySalesperson[sp]) {
        bySalesperson[sp] = { total_sales: 0, vips: 0, day_one_booked_yes: 0, day_one_booked_no: 0 }
      }
      bySalesperson[sp].total_sales++
      bySalesperson[sp].vips += (parseInt(c.vip_count, 10) || 0)
      if (c.day_one_booked === 'Yes') {
        bySalesperson[sp].day_one_booked_yes++
      } else {
        bySalesperson[sp].day_one_booked_no++
      }
    }

    res.json({
      total_contacts: contacts.length,
      by_salesperson: bySalesperson,
      contacts,
    })
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

// ---------------------------------------------------------------------------
// GET /reports/membership
// Query params: start_date, end_date, location_id, location_slug
// ---------------------------------------------------------------------------
router.get('/membership', async (req, res) => {
  const { start_date, end_date } = req.query

  try {
    const locationFilter = await resolveLocationFilter(req.query)

    const startMs = dateToMs(start_date, false)
    const endMs   = dateToMs(end_date, true)

    // --- Contacts / membership data from the enriched view ---
    let q = supabaseAdmin
      .from('ghl_contacts_report')
      .select(
        'first_name, last_name, full_name, email, phone, tags,' +
        'sale_team_member, vip_count, day_one_booked,' +
        'member_sign_date, membership_type, same_day_sale,' +
        'origin, active, location_name, location_slug'
      )
      .not('member_sign_date', 'is', null)

    q = applyLocationFilter(q, locationFilter)
    q = applyDateRange(q, 'member_sign_date', startMs, endMs)

    const { data, error } = await q.order('member_sign_date', { ascending: false })
    if (error) return res.status(500).json({ error: 'Failed to fetch membership data', detail: error.message })

    const contacts = data || []

    // --- Trial conversion from opportunities ---
    // Fetch opportunities with pipeline JOIN to find "Trial Started" stage
    let oppQuery = supabaseAdmin
      .from('ghl_opportunities_v2')
      .select('id, status, stage_id, pipeline_id, ghl_pipelines(name), ghl_pipeline_stages(name)')

    if (locationFilter) {
      // ghl_opportunities_v2 uses location_id (ghl location id)
      if (locationFilter.column === 'location_id') {
        oppQuery = oppQuery.eq('location_id', locationFilter.value)
      }
      // location_slug is not directly on ghl_opportunities_v2; skip if slug-only
    }

    const { data: opps, error: oppsError } = await oppQuery
    const opportunities = opps || []

    let trialStarted = 0
    let trialWon = 0
    for (const opp of opportunities) {
      const stageName = opp.ghl_pipeline_stages?.name || ''
      if (stageName === 'Trial Started') {
        trialStarted++
        if (opp.status === 'won') trialWon++
      }
    }

    // --- Aggregate contact stats ---
    const byDate = {}
    const bySalesperson = {}
    let totalDayOneBooked = 0
    let totalVips = 0

    for (const c of contacts) {
      // by_date: derive YYYY-MM-DD from the ms timestamp
      if (c.member_sign_date) {
        const d = new Date(parseInt(c.member_sign_date, 10))
        const dateKey = d.toISOString().slice(0, 10)
        byDate[dateKey] = (byDate[dateKey] || 0) + 1
      }

      // by_salesperson
      const sp = c.sale_team_member || 'Unassigned'
      if (!bySalesperson[sp]) bySalesperson[sp] = { memberships: 0, vips: 0, day_one_booked: 0 }
      bySalesperson[sp].memberships++
      bySalesperson[sp].vips += (parseInt(c.vip_count, 10) || 0)
      if (c.day_one_booked === 'Yes') bySalesperson[sp].day_one_booked++

      // totals
      if (c.day_one_booked === 'Yes') totalDayOneBooked++
      totalVips += (parseInt(c.vip_count, 10) || 0)
    }

    const byDateArr = Object.entries(byDate)
      .map(([date, count]) => ({ date, count }))
      .sort((a, b) => a.date.localeCompare(b.date))

    const conversionRate = trialStarted > 0 ? Math.round((trialWon / trialStarted) * 100) : 0

    res.json({
      total_memberships: contacts.length,
      trial_conversion: {
        trial_started: trialStarted,
        won: trialWon,
        rate: conversionRate,
      },
      total_day_one_booked: totalDayOneBooked,
      total_vips: totalVips,
      by_date: byDateArr,
      by_salesperson: bySalesperson,
      contacts,
    })
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

// ---------------------------------------------------------------------------
// GET /reports/pt
// Query params: start_date, end_date, location_id, location_slug
// ---------------------------------------------------------------------------
router.get('/pt', async (req, res) => {
  const { start_date, end_date } = req.query

  try {
    const locationFilter = await resolveLocationFilter(req.query)

    const startMs = dateToMs(start_date, false)
    const endMs   = dateToMs(end_date, true)

    let q = supabaseAdmin
      .from('ghl_contacts_report')
      .select(
        'first_name, last_name, full_name, email, phone, tags,' +
        'day_one_booked, day_one_booking_date, day_one_booking_team_member,' +
        'day_one_date, day_one_status, day_one_sale, day_one_trainer,' +
        'show_or_no_show, pt_sale_type, pt_value, pt_sign_date, why_no_sale,' +
        'location_name, location_slug'
      )
      .not('day_one_booked', 'is', null)
      .neq('day_one_booked', '')

    q = applyLocationFilter(q, locationFilter)
    q = applyDateRange(q, 'day_one_booking_date', startMs, endMs)

    const { data, error } = await q.order('day_one_booking_date', { ascending: false })
    if (error) return res.status(500).json({ error: 'Failed to fetch PT data', detail: error.message })

    const contacts = data || []

    // Aggregate by status
    const byStatus = {}
    const byTrainer = {}

    let totalCompleted = 0
    let totalSales = 0

    for (const c of contacts) {
      const status = c.day_one_status || 'Unknown'
      byStatus[status] = (byStatus[status] || 0) + 1
      if (status === 'Completed') totalCompleted++

      const trainer = c.day_one_trainer || 'Unassigned'
      if (!byTrainer[trainer]) {
        byTrainer[trainer] = {
          total: 0,
          scheduled: 0,
          completed: 0,
          no_show: 0,
          sales: 0,
          no_sales: 0,
          _ptSaleTypes: [],
          _noSaleReasons: [],
          top_pt_sale_type: null,
          top_no_sale_reason: null,
        }
      }
      const t = byTrainer[trainer]
      t.total++

      const sl = status.toLowerCase()
      if (sl === 'scheduled') t.scheduled++
      else if (sl === 'completed') t.completed++
      else if (sl === 'no show' || sl === 'no-show') t.no_show++

      // Sales/no-sales only counted when status = Completed
      if (sl === 'completed') {
        if (c.day_one_sale === 'Sale') {
          t.sales++
          totalSales++
          if (c.pt_sale_type) t._ptSaleTypes.push(c.pt_sale_type)
        } else {
          t.no_sales++
          if (c.why_no_sale) t._noSaleReasons.push(c.why_no_sale)
        }
      }
    }

    // Finalize trainer top values, remove internal arrays
    for (const trainer of Object.keys(byTrainer)) {
      const t = byTrainer[trainer]
      t.top_pt_sale_type = mostFrequent(t._ptSaleTypes)
      t.top_no_sale_reason = mostFrequent(t._noSaleReasons)
      delete t._ptSaleTypes
      delete t._noSaleReasons
    }

    const total = contacts.length
    const completionRate = total > 0 ? Math.round((totalCompleted / total) * 100) : 0
    const closeRate = totalCompleted > 0 ? Math.round((totalSales / totalCompleted) * 100) : 0

    res.json({
      total_day_ones: total,
      by_status: byStatus,
      completion_rate: completionRate,
      close_rate: closeRate,
      by_trainer: byTrainer,
      contacts,
    })
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

// ---------------------------------------------------------------------------
// GET /reports/pipelines
// Query params: location_id (ghl location id), location_slug (not used for opps)
// ---------------------------------------------------------------------------
router.get('/pipelines', async (req, res) => {
  try {
    const locationFilter = await resolveLocationFilter(req.query)

    let q = supabaseAdmin
      .from('ghl_opportunities_v2')
      .select(
        'id, name, status, monetary_value, created_at_ghl,' +
        'ghl_pipelines(id, name),' +
        'ghl_pipeline_stages(id, name),' +
        'assigned_user_id'
      )

    // Opportunities use location_id (ghl location id), not location_slug
    if (locationFilter && locationFilter.column === 'location_id') {
      q = q.eq('location_id', locationFilter.value)
    }

    const { data, error } = await q.order('created_at_ghl', { ascending: false })
    if (error) return res.status(500).json({ error: 'Failed to fetch pipeline data', detail: error.message })

    const opportunities = data || []

    const byPipeline = {}
    for (const opp of opportunities) {
      const pipeName = opp.ghl_pipelines?.name || 'Unknown Pipeline'
      if (!byPipeline[pipeName]) byPipeline[pipeName] = { total: 0, stages: {} }
      byPipeline[pipeName].total++

      const stageName = opp.ghl_pipeline_stages?.name || 'Unknown Stage'
      if (!byPipeline[pipeName].stages[stageName]) byPipeline[pipeName].stages[stageName] = []
      byPipeline[pipeName].stages[stageName].push(opp)
    }

    res.json({
      total: opportunities.length,
      by_pipeline: byPipeline,
      opportunities,
    })
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

module.exports = router
