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
// GHL custom field dates are stored as midnight UTC but displayed on the client
// in Pacific time (UTC-7 PDT). Without offset, a date shown as "April 11" in
// the UI (stored as April 12 00:00 UTC) falls outside an April 11 UTC filter.
// Adding 7 hours aligns the filter with the displayed Pacific-time dates.
// ---------------------------------------------------------------------------
// Dynamic Pacific timezone offset (handles PDT/PST automatically)
function getPacificOffsetMs(date) {
  // Use Intl to determine if a date is in PDT or PST
  const jan = new Date(date.getFullYear(), 0, 1)
  const jul = new Date(date.getFullYear(), 6, 1)
  const stdOffset = Math.max(jan.getTimezoneOffset(), jul.getTimezoneOffset())
  // For server in UTC: Pacific Standard = UTC-8, Pacific Daylight = UTC-7
  // Check if the date is in DST by comparing formatted hour
  const formatter = new Intl.DateTimeFormat('en-US', { timeZone: 'America/Los_Angeles', hour: 'numeric', hour12: false })
  const utcHour = date.getUTCHours()
  const pacificHour = parseInt(formatter.format(date), 10)
  const diff = (utcHour - pacificHour + 24) % 24
  return diff * 3600000
}

function dateToMs(dateStr, endOfDay = false) {
  if (!dateStr) return null
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) return null
  const d = endOfDay ? new Date(dateStr + 'T23:59:59.999Z') : new Date(dateStr + 'T00:00:00.000Z')
  if (isNaN(d.getTime())) return null
  return (d.getTime() + getPacificOffsetMs(d)).toString()
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
// Club number → location slug mapping
const CLUB_SLUG_MAP = {
  '30935': 'salem', '31599': 'keizer', '7655': 'eugene',
  '31598': 'springfield', '31600': 'clackamas', '31601': 'milwaukie', '32073': 'medford',
}
const SLUG_CLUB_MAP = Object.fromEntries(Object.entries(CLUB_SLUG_MAP).map(([k, v]) => [v, k]))

// Membership types to skip (not real members)
const SKIP_TYPES = ['CHILDCARE', 'Club Access', 'Event Access', 'NON-MEMBER', 'NLPT ONLY', 'PT ONLY', 'SWIM ONLY']

// ---------------------------------------------------------------------------
// GET /reports/salesperson-stats
// Query params: start_date, end_date, location_id, location_slug
// ---------------------------------------------------------------------------
// ---------------------------------------------------------------------------
// GET /reports/membership  (combined membership + salesperson stats)
// Uses ABC data for sales counts, GHL for day_one/VIP/same_day enrichment
// ---------------------------------------------------------------------------
router.get('/membership', async (req, res) => {
  const { start_date, end_date } = req.query

  try {
    const locationFilter = await resolveLocationFilter(req.query)

    const startMs = dateToMs(start_date, false)
    const endMs   = dateToMs(end_date, true)
    const startISO = start_date ? start_date + 'T00:00:00.000Z' : null
    const endISO   = end_date ? end_date + 'T23:59:59.999Z' : null

    // --- 1. ABC members with since_date in range (source of truth for sales) ---
    let abcQuery = supabaseAdmin
      .from('abc_members')
      .select('member_id, first_name, last_name, email, membership_type, since_date, sales_person_name, club_number, is_active')
      .eq('is_active', true)
    if (start_date) abcQuery = abcQuery.gte('since_date', start_date)
    if (end_date) abcQuery = abcQuery.lte('since_date', end_date)

    // Filter by location via club_number
    let clubNumber = null
    if (locationFilter) {
      const slug = locationFilter.column === 'location_slug' ? locationFilter.value : null
      if (slug && SLUG_CLUB_MAP[slug]) {
        clubNumber = SLUG_CLUB_MAP[slug]
        abcQuery = abcQuery.eq('club_number', clubNumber)
      }
    }

    // Paginate past 1000 limit
    const abcMembers = []
    let abcFrom = 0
    while (true) {
      const { data: page, error: abcErr } = await abcQuery.range(abcFrom, abcFrom + 999)
      if (abcErr) return res.status(500).json({ error: 'Failed to fetch ABC members', detail: abcErr.message })
      if (!page || page.length === 0) break
      abcMembers.push(...page)
      if (page.length < 1000) break
      abcFrom += 1000
    }

    // Filter out non-member types
    const filteredMembers = abcMembers.filter(m => !SKIP_TYPES.includes(m.membership_type))

    // --- 2. GHL enrichment: look up day_one_booked, vip_count, same_day_sale by email ---
    const emails = [...new Set(filteredMembers.map(m => m.email).filter(Boolean))]
    const ghlByEmail = {}

    // Batch email lookups in chunks
    for (let i = 0; i < emails.length; i += 50) {
      const chunk = emails.slice(i, i + 50)
      const { data: ghlRows } = await supabaseAdmin
        .from('ghl_contacts_report')
        .select('email, day_one_booked, vip_count, same_day_sale')
        .in('email', chunk)

      for (const g of (ghlRows || [])) {
        if (g.email) ghlByEmail[g.email.toLowerCase()] = g
      }
    }

    // --- 3. Day Ones booked in range (from GHL, by booking_team_member) ---
    let dayOneQ = supabaseAdmin
      .from('ghl_contacts_report')
      .select('day_one_booking_team_member, day_one_booked, day_one_booking_date, location_slug')
      .eq('day_one_booked', 'Yes')
      .not('day_one_booking_date', 'is', null)
    dayOneQ = applyLocationFilter(dayOneQ, locationFilter)
    dayOneQ = applyDateRange(dayOneQ, 'day_one_booking_date', startMs, endMs)

    const { data: dayOneData } = await dayOneQ
    const dayOnes = dayOneData || []
    const totalDayOneBooked = dayOnes.length

    const dayOneByPerson = {}
    for (const d of dayOnes) {
      const person = d.day_one_booking_team_member || 'Unassigned'
      dayOneByPerson[person] = (dayOneByPerson[person] || 0) + 1
    }

    // --- 4. VIPs in range ---
    let vipQuery = supabaseAdmin
      .from('ghl_contacts_v2')
      .select('id, tags', { count: 'exact', head: false })
      .contains('tags', ['vip'])
    if (startISO) vipQuery = vipQuery.gte('created_at_ghl', startISO)
    if (endISO) vipQuery = vipQuery.lte('created_at_ghl', endISO)
    if (locationFilter && locationFilter.column === 'location_slug') {
      const { data: loc } = await supabaseAdmin
        .from('ghl_locations').select('id')
        .ilike('name', '%' + locationFilter.value + '%').limit(1).maybeSingle()
      if (loc) vipQuery = vipQuery.eq('location_id', loc.id)
    } else if (locationFilter && locationFilter.column === 'location_id') {
      vipQuery = vipQuery.eq('location_id', locationFilter.value)
    }
    const { count: totalVips } = await vipQuery

    // --- 5. Trial conversion from opportunities ---
    let oppLocationId = null
    if (locationFilter) {
      if (locationFilter.column === 'location_id') {
        oppLocationId = locationFilter.value
      } else if (locationFilter.column === 'location_slug') {
        const { data: loc } = await supabaseAdmin
          .from('ghl_locations').select('id')
          .ilike('name', '%' + locationFilter.value + '%').limit(1).maybeSingle()
        if (loc) oppLocationId = loc.id
      }
    }

    let oppQuery = supabaseAdmin
      .from('ghl_opportunities_v2')
      .select('id, status, stage_id, pipeline_id, ghl_pipeline_stages(name)')
    if (oppLocationId) oppQuery = oppQuery.eq('location_id', oppLocationId)
    if (start_date) oppQuery = oppQuery.gte('created_at_ghl', startISO)
    if (end_date) oppQuery = oppQuery.lte('created_at_ghl', endISO)

    const { data: opps, error: oppsError } = await oppQuery
    if (oppsError) return res.status(500).json({ error: 'Failed to fetch trial data', detail: oppsError.message })

    let trialStarted = 0
    let trialWon = 0
    for (const opp of (opps || [])) {
      const stageName = opp.ghl_pipeline_stages?.name || ''
      if (stageName === 'Trial Started') {
        trialStarted++
        if (opp.status === 'won') trialWon++
      }
    }

    // --- 6. Aggregate by salesperson + by date ---
    const byDate = {}
    const bySalesperson = {}

    for (const m of filteredMembers) {
      // by_date chart
      if (m.since_date) {
        const dateKey = m.since_date
        if (!byDate[dateKey]) byDate[dateKey] = { memberships: 0, vips: 0, day_ones: 0 }
        byDate[dateKey].memberships++
      }

      // GHL enrichment for this member
      const ghl = m.email ? ghlByEmail[m.email.toLowerCase()] : null
      const isDayOneBooked = ghl?.day_one_booked === 'Yes'
      const vipCount = ghl?.vip_count ? parseInt(ghl.vip_count) || 0 : 0
      const isSameDaySale = ghl?.same_day_sale === 'Sale'

      // by_salesperson
      const sp = m.sales_person_name || 'Unassigned'
      if (!bySalesperson[sp]) {
        bySalesperson[sp] = { total_sales: 0, vips: 0, day_one_booked: 0, same_day_sale: 0, members: [] }
      }
      bySalesperson[sp].total_sales++
      if (vipCount > 0) bySalesperson[sp].vips += vipCount
      if (isSameDaySale) bySalesperson[sp].same_day_sale++

      // Per-member detail for drill-down
      bySalesperson[sp].members.push({
        name: `${m.first_name || ''} ${m.last_name || ''}`.trim(),
        email: m.email,
        membership_type: m.membership_type,
        since_date: m.since_date,
        day_one_booked: isDayOneBooked,
        vip_count: vipCount,
        same_day_sale: isSameDaySale,
      })
    }

    // Add day one booking dates to the chart
    for (const d of dayOnes) {
      if (d.day_one_booking_date) {
        const dt = new Date(parseInt(d.day_one_booking_date, 10))
        const dateKey = dt.toISOString().slice(0, 10)
        if (!byDate[dateKey]) byDate[dateKey] = { memberships: 0, vips: 0, day_ones: 0 }
        byDate[dateKey].day_ones++
      }
    }

    // Merge day one counts into salesperson data
    for (const [person, count] of Object.entries(dayOneByPerson)) {
      if (!bySalesperson[person]) {
        bySalesperson[person] = { total_sales: 0, vips: 0, day_one_booked: 0, same_day_sale: 0, members: [] }
      }
      bySalesperson[person].day_one_booked = count
    }

    const byDateArr = Object.entries(byDate)
      .map(([date, vals]) => ({ date, ...vals }))
      .sort((a, b) => a.date.localeCompare(b.date))

    const conversionRate = trialStarted > 0 ? Math.round((trialWon / trialStarted) * 100) : 0

    // Build contacts array (backward compatible with existing frontend)
    const contacts = filteredMembers.map(m => {
      const ghl = m.email ? ghlByEmail[m.email.toLowerCase()] : null
      return {
        first_name: m.first_name,
        last_name: m.last_name,
        full_name: `${m.first_name || ''} ${m.last_name || ''}`.trim(),
        email: m.email,
        membership_type: m.membership_type,
        member_sign_date: m.since_date,
        sale_team_member: m.sales_person_name,
        day_one_booked: ghl?.day_one_booked || null,
        same_day_sale: ghl?.same_day_sale || null,
        location_slug: CLUB_SLUG_MAP[m.club_number] || null,
      }
    })

    res.json({
      total_memberships: filteredMembers.length,
      trial_conversion: { trial_started: trialStarted, won: trialWon, rate: conversionRate },
      total_day_one_booked: totalDayOneBooked,
      total_vips: totalVips || 0,
      by_date: byDateArr,
      by_salesperson: bySalesperson,
      contacts,
    })
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

// Keep /salesperson-stats as alias — redirects to membership endpoint
router.get('/salesperson-stats', (req, res) => {
  const qs = req.url.includes('?') ? req.url.substring(req.url.indexOf('?')) : ''
  res.redirect(307, '/reports/membership' + qs)
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
        'id, first_name, last_name, full_name, email, phone, tags,' +
        'day_one_booked, day_one_booking_date, day_one_booking_team_member,' +
        'day_one_date, day_one_status, day_one_sale, day_one_trainer,' +
        'show_or_no_show, pt_sale_type, pt_value, pt_sign_date, why_no_sale,' +
        'location_name, location_slug'
      )
      .not('day_one_booked', 'is', null)
      .neq('day_one_booked', '')

    q = applyLocationFilter(q, locationFilter)
    q = applyDateRange(q, 'day_one_date', startMs, endMs)

    const { data, error } = await q.order('day_one_date', { ascending: false })
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

    // --- Memberships from ABC (source of truth) ---
    let clubNumber = null
    if (locationFilter) {
      const slug = locationFilter.column === 'location_slug' ? locationFilter.value : null
      if (slug && SLUG_CLUB_MAP[slug]) clubNumber = SLUG_CLUB_MAP[slug]
    }

    let abcQuery = supabaseAdmin
      .from('abc_members')
      .select('email, membership_type')
      .eq('is_active', true)
    if (start_date) abcQuery = abcQuery.gte('since_date', start_date)
    if (end_date) abcQuery = abcQuery.lte('since_date', end_date)
    if (clubNumber) abcQuery = abcQuery.eq('club_number', clubNumber)

    const abcMembers = []
    let abcFrom = 0
    while (true) {
      const { data: page } = await abcQuery.range(abcFrom, abcFrom + 999)
      if (!page || page.length === 0) break
      abcMembers.push(...page)
      if (page.length < 1000) break
      abcFrom += 1000
    }
    const filteredMembers = abcMembers.filter(m => !SKIP_TYPES.includes(m.membership_type))

    // GHL enrichment for same_day_sale
    const emails = [...new Set(filteredMembers.map(m => m.email).filter(Boolean))]
    const ghlByEmail = {}
    for (let i = 0; i < emails.length; i += 50) {
      const chunk = emails.slice(i, i + 50)
      const { data: ghlRows } = await supabaseAdmin
        .from('ghl_contacts_report')
        .select('email, same_day_sale, day_one_booked')
        .in('email', chunk)
      for (const g of (ghlRows || [])) {
        if (g.email) ghlByEmail[g.email.toLowerCase()] = g
      }
    }

    let totalSameDaySales = 0
    for (const m of filteredMembers) {
      const ghl = m.email ? ghlByEmail[m.email.toLowerCase()] : null
      if (ghl?.same_day_sale === 'Sale') totalSameDaySales++
    }

    // --- VIPs: contacts created in date range with "vip" tag ---
    let vipQuery = supabaseAdmin
      .from('ghl_contacts_v2')
      .select('id, tags', { count: 'exact', head: false })
      .contains('tags', ['vip'])
    if (startISO) vipQuery = vipQuery.gte('created_at_ghl', startISO)
    if (endISO) vipQuery = vipQuery.lte('created_at_ghl', endISO)
    if (locationFilter && locationFilter.column === 'location_slug') {
      const { data: loc } = await supabaseAdmin
        .from('ghl_locations').select('id')
        .ilike('name', '%' + locationFilter.value + '%').limit(1).maybeSingle()
      if (loc) vipQuery = vipQuery.eq('location_id', loc.id)
    } else if (locationFilter && locationFilter.column === 'location_id') {
      vipQuery = vipQuery.eq('location_id', locationFilter.value)
    }
    const { count: totalVips } = await vipQuery

    // --- Day Ones from GHL ---
    let dayOneQ = supabaseAdmin
      .from('ghl_contacts_report')
      .select('day_one_booked, day_one_status, day_one_sale, day_one_booking_date, location_slug')
      .eq('day_one_booked', 'Yes')
      .not('day_one_booking_date', 'is', null)
    dayOneQ = applyLocationFilter(dayOneQ, locationFilter)
    dayOneQ = applyDateRange(dayOneQ, 'day_one_booking_date', startMs, endMs)

    const { data: dayOneContacts, error: dayOneErr } = await dayOneQ
    if (dayOneErr) return res.status(500).json({ error: 'Failed to fetch day one data', detail: dayOneErr.message })

    const dayOnes = dayOneContacts || []
    const totalDayOnesBooked = dayOnes.length

    const dayOneBookedCounts = { 'Yes': totalDayOnesBooked }
    // Count "No" from ABC members who don't have day one booked in GHL
    const memberNoBooking = filteredMembers.filter(m => {
      const ghl = m.email ? ghlByEmail[m.email.toLowerCase()] : null
      return ghl?.day_one_booked !== 'Yes'
    }).length
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
      total_memberships: filteredMembers.length,
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
