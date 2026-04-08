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
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) return null
  const d = endOfDay ? new Date(dateStr + 'T23:59:59.999Z') : new Date(dateStr + 'T00:00:00.000Z')
  if (isNaN(d.getTime())) return null
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

    // --- Separate query for day ones by booking date + booking team member ---
    let dayOneQ = supabaseAdmin
      .from('ghl_contacts_report')
      .select('day_one_booking_team_member, day_one_booked, day_one_booking_date, location_slug')
      .eq('day_one_booked', 'Yes')
      .not('day_one_booking_date', 'is', null)
    dayOneQ = applyLocationFilter(dayOneQ, locationFilter)
    dayOneQ = applyDateRange(dayOneQ, 'day_one_booking_date', startMs, endMs)

    const { data: dayOneData } = await dayOneQ
    const dayOnes = dayOneData || []

    // Count day ones by booking team member
    const dayOneByPerson = {}
    for (const d of dayOnes) {
      const person = d.day_one_booking_team_member || 'Unassigned'
      dayOneByPerson[person] = (dayOneByPerson[person] || 0) + 1
    }

    const bySalesperson = {}
    for (const c of contacts) {
      const sp = c.sale_team_member || 'Unassigned'
      if (!bySalesperson[sp]) {
        bySalesperson[sp] = { total_sales: 0, vips: 0, day_one_booked: 0, same_day_sale: 0 }
      }
      bySalesperson[sp].total_sales++
      const hasVipTag = Array.isArray(c.tags) && c.tags.includes('vip')
      if (hasVipTag) bySalesperson[sp].vips++
      if (c.same_day_sale === 'Sale') bySalesperson[sp].same_day_sale++
    }

    // Merge day one counts (from booking team member query) into salesperson data
    for (const [person, count] of Object.entries(dayOneByPerson)) {
      if (!bySalesperson[person]) {
        bySalesperson[person] = { total_sales: 0, vips: 0, day_one_booked: 0, same_day_sale: 0 }
      }
      bySalesperson[person].day_one_booked = count
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
    // Resolve location_slug to ghl_location_id for opportunities table
    let oppLocationId = null
    if (locationFilter) {
      if (locationFilter.column === 'location_id') {
        oppLocationId = locationFilter.value
      } else if (locationFilter.column === 'location_slug') {
        const { data: loc } = await supabaseAdmin
          .from('ghl_locations')
          .select('id')
          .ilike('name', '%' + locationFilter.value + '%')
          .limit(1)
          .maybeSingle()
        if (loc) oppLocationId = loc.id
      }
    }

    let oppQuery = supabaseAdmin
      .from('ghl_opportunities_v2')
      .select('id, status, stage_id, pipeline_id, ghl_pipeline_stages(name)')

    if (oppLocationId) oppQuery = oppQuery.eq('location_id', oppLocationId)
    // created_at_ghl is TIMESTAMPTZ, not ms — use ISO strings for filtering
    if (start_date) oppQuery = oppQuery.gte('created_at_ghl', start_date + 'T00:00:00.000Z')
    if (end_date) oppQuery = oppQuery.lte('created_at_ghl', end_date + 'T23:59:59.999Z')

    const { data: opps, error: oppsError } = await oppQuery
    if (oppsError) return res.status(500).json({ error: 'Failed to fetch trial data', detail: oppsError.message })

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
      const hasVipTag = Array.isArray(c.tags) && c.tags.includes('vip')
      if (hasVipTag) bySalesperson[sp].vips++
      if (c.day_one_booked === 'Yes') bySalesperson[sp].day_one_booked++

      // totals
      if (c.day_one_booked === 'Yes') totalDayOneBooked++
      if (hasVipTag) totalVips++
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
// GET /reports/club-health
// Query params: start_date, end_date, location_id, location_slug
// ---------------------------------------------------------------------------
router.get('/club-health', async (req, res) => {
  const { start_date, end_date } = req.query

  try {
    const locationFilter = await resolveLocationFilter(req.query)

    const startMs = dateToMs(start_date, false)
    const endMs   = dateToMs(end_date, true)
    // ISO dates for TIMESTAMPTZ columns
    const startISO = start_date ? start_date + 'T00:00:00.000Z' : null
    const endISO   = end_date ? end_date + 'T23:59:59.999Z' : null

    // --- VIPs: contacts created in date range with "vip" tag ---
    // created_at_ghl is TIMESTAMPTZ on ghl_contacts_v2, need to go through base table
    let vipQuery = supabaseAdmin
      .from('ghl_contacts_v2')
      .select('id, tags', { count: 'exact', head: false })
      .contains('tags', ['vip'])
    if (startISO) vipQuery = vipQuery.gte('created_at_ghl', startISO)
    if (endISO) vipQuery = vipQuery.lte('created_at_ghl', endISO)
    if (locationFilter && locationFilter.column === 'location_slug') {
      // Resolve slug to location_id for base table
      const { data: loc } = await supabaseAdmin
        .from('ghl_locations')
        .select('id')
        .ilike('name', '%' + locationFilter.value + '%')
        .limit(1)
        .maybeSingle()
      if (loc) vipQuery = vipQuery.eq('location_id', loc.id)
    } else if (locationFilter && locationFilter.column === 'location_id') {
      vipQuery = vipQuery.eq('location_id', locationFilter.value)
    }
    const { count: totalVips } = await vipQuery

    // --- Day One + Same Day Sale + Pie Charts: from ghl_contacts_report ---
    // Query contacts with member_sign_date in range for same_day_sale
    // AND contacts with day_one_booking_date in range for day one stats
    // Use a broad query: get contacts that have EITHER member_sign_date or day_one_booked
    let memberQ = supabaseAdmin
      .from('ghl_contacts_report')
      .select(
        'tags, day_one_booked, day_one_status, day_one_sale,' +
        'same_day_sale, member_sign_date, day_one_booking_date, location_slug'
      )
      .not('member_sign_date', 'is', null)
    memberQ = applyLocationFilter(memberQ, locationFilter)
    memberQ = applyDateRange(memberQ, 'member_sign_date', startMs, endMs)

    const { data: memberContacts, error: memberErr } = await memberQ
    if (memberErr) return res.status(500).json({ error: 'Failed to fetch club health data', detail: memberErr.message })

    // Separate query for day one booked contacts (by booking date, not member sign date)
    let dayOneQ = supabaseAdmin
      .from('ghl_contacts_report')
      .select(
        'day_one_booked, day_one_status, day_one_sale, day_one_booking_date, location_slug'
      )
      .eq('day_one_booked', 'Yes')
      .not('day_one_booking_date', 'is', null)
    dayOneQ = applyLocationFilter(dayOneQ, locationFilter)
    dayOneQ = applyDateRange(dayOneQ, 'day_one_booking_date', startMs, endMs)

    const { data: dayOneContacts, error: dayOneErr } = await dayOneQ
    if (dayOneErr) return res.status(500).json({ error: 'Failed to fetch day one data', detail: dayOneErr.message })

    const members = memberContacts || []
    const dayOnes = dayOneContacts || []

    // Same day sales from member contacts
    let totalSameDaySales = 0
    for (const c of members) {
      if (c.same_day_sale === 'Sale') totalSameDaySales++
    }

    // Day One stats from day one query
    const totalDayOnesBooked = dayOnes.length

    const dayOneBookedCounts = { 'Yes': totalDayOnesBooked }
    // Count "No" from member contacts who don't have day one booked
    const memberNoBooking = members.filter(c => c.day_one_booked !== 'Yes').length
    if (memberNoBooking > 0) dayOneBookedCounts['No'] = memberNoBooking

    const dayOneStatusCounts = {}
    const dayOneSaleCounts = {}
    for (const c of dayOnes) {
      const statusVal = c.day_one_status || 'Unknown'
      dayOneStatusCounts[statusVal] = (dayOneStatusCounts[statusVal] || 0) + 1

      if ((c.day_one_status || '').toLowerCase() === 'completed') {
        const saleVal = c.day_one_sale || 'No Sale'
        dayOneSaleCounts[saleVal] = (dayOneSaleCounts[saleVal] || 0) + 1
      }
    }

    res.json({
      total_vips: totalVips || 0,
      total_same_day_sales: totalSameDaySales,
      total_day_ones_booked: totalDayOnesBooked,
      day_one_booked: dayOneBookedCounts,
      day_one_status: dayOneStatusCounts,
      day_one_sale: dayOneSaleCounts,
    })
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

module.exports = router
