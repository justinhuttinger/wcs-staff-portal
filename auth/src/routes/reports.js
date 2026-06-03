const { Router } = require('express')
const { supabaseAdmin } = require('../services/supabase')
const authenticate = require('../middleware/auth')
const { requireRole } = require('../middleware/role')
const { getSkipList } = require('../utils/membershipSkipList')
const { countVipsByTeamMember: _countVipsByTeamMember } = require('../utils/vipsByTeamMember')
const { parseLocationSlugParam } = require('../utils/locationSlug')

const router = Router()
router.use(authenticate)
router.use(requireRole('lead'))

// ---------------------------------------------------------------------------
// Helper: resolve location filter from query params
// Returns { column, values: [...] } or null (no filter = all locations).
// Accepts location_slug as a single slug, comma-separated multi-slug, or 'all'.
// ---------------------------------------------------------------------------
async function resolveLocationFilter(query) {
  const { location_id, location_slug } = query

  const parsed = parseLocationSlugParam(location_slug)
  if (parsed.invalid) {
    const err = new Error(`Unknown location_slug: ${parsed.invalid}`)
    err.status = 400
    throw err
  }

  if (!parsed.all) {
    return { column: 'location_slug', values: parsed.slugs }
  }

  if (location_id) {
    const { data } = await supabaseAdmin
      .from('locations')
      .select('ghl_location_id')
      .eq('id', location_id)
      .single()
    if (data?.ghl_location_id) {
      return { column: 'location_id', values: [data.ghl_location_id] }
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
  if (!locationFilter || !locationFilter.values || locationFilter.values.length === 0) return q
  // Use .in() so single-slug and multi-slug both work via the same path.
  return q.in(locationFilter.column, locationFilter.values)
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

// Bound the shared helper to our supabaseAdmin client for convenience.
const countVipsByTeamMember = (opts) => _countVipsByTeamMember(supabaseAdmin, opts)

// ---------------------------------------------------------------------------
// Club number → location slug mapping
const CLUB_SLUG_MAP = {
  '30935': 'salem', '31599': 'keizer', '7655': 'eugene',
  '31598': 'springfield', '31600': 'clackamas', '31601': 'milwaukie', '32073': 'medford',
}
const SLUG_CLUB_MAP = Object.fromEntries(Object.entries(CLUB_SLUG_MAP).map(([k, v]) => [v, k]))

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

    // --- 1. ABC members with sign_date in range (source of truth for sales) ---
    let abcQuery = supabaseAdmin
      .from('abc_members')
      .select('member_id, first_name, last_name, email, membership_type, since_date, sign_date, sales_person_name, club_number, is_active')
      .eq('is_active', true)
      .not('sign_date', 'is', null)
    if (start_date) abcQuery = abcQuery.gte('sign_date', start_date)
    if (end_date) abcQuery = abcQuery.lte('sign_date', end_date)

    // Filter by location via club_number (supports multi-slug)
    let clubNumbers = []
    if (locationFilter && locationFilter.column === 'location_slug') {
      clubNumbers = locationFilter.values.map(s => SLUG_CLUB_MAP[s]).filter(Boolean)
      if (clubNumbers.length > 0) {
        abcQuery = abcQuery.in('club_number', clubNumbers)
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

    // Filter out non-member types AND renewals (since_date < sign_date means a renewal,
    // not a new sale; ABC's "New Member Sales" report excludes those, so we do too).
    const skipTypes = await getSkipList()
    const filteredMembers = abcMembers.filter(m =>
      !skipTypes.has((m.membership_type || '').toLowerCase())
      && m.since_date && m.sign_date && m.since_date >= m.sign_date
    )

    // --- 2. GHL enrichment: look up day_one_booked + same_day_sale by email ---
    const emails = [...new Set(filteredMembers.map(m => m.email).filter(Boolean))]
    const ghlByEmail = {}

    // Batch email lookups in chunks
    for (let i = 0; i < emails.length; i += 50) {
      const chunk = emails.slice(i, i + 50)
      const { data: ghlRows } = await supabaseAdmin
        .from('ghl_contacts_report')
        .select('email, day_one_booked, same_day_sale')
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

    // --- 4. VIPs in range, counted by `contact.vip_team_member` custom field ---
    const { total: totalVips, byPerson: vipsByPerson } = await countVipsByTeamMember({ startISO, endISO, locationFilter })

    // --- 5. Trial conversion from opportunities ---
    // Resolve location filter into GHL location IDs (supports multi-slug).
    let oppLocationIds = []
    if (locationFilter) {
      if (locationFilter.column === 'location_id') {
        oppLocationIds = locationFilter.values
      } else if (locationFilter.column === 'location_slug') {
        // Build an OR-ilike pattern set so one query covers all slugs.
        const orClauses = locationFilter.values.map(s => `name.ilike.%${s}%`).join(',')
        const { data: locs } = await supabaseAdmin
          .from('ghl_locations').select('id').or(orClauses)
        oppLocationIds = (locs || []).map(l => l.id)
      }
    }

    let oppQuery = supabaseAdmin
      .from('ghl_opportunities_v2')
      .select('id, status, stage_id, pipeline_id, ghl_pipeline_stages(name)')
    if (oppLocationIds.length > 0) oppQuery = oppQuery.in('location_id', oppLocationIds)
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
      if (m.sign_date) {
        const dateKey = m.sign_date
        if (!byDate[dateKey]) byDate[dateKey] = { memberships: 0, vips: 0, day_ones: 0 }
        byDate[dateKey].memberships++
      }

      // GHL enrichment for this member
      const ghl = m.email ? ghlByEmail[m.email.toLowerCase()] : null
      const isDayOneBooked = ghl?.day_one_booked === 'Yes'
      const isSameDaySale = ghl?.same_day_sale === 'Sale'

      // by_salesperson
      const sp = m.sales_person_name || 'Unassigned'
      if (!bySalesperson[sp]) {
        bySalesperson[sp] = { total_sales: 0, vips: 0, day_one_booked: 0, same_day_sale: 0, members: [] }
      }
      bySalesperson[sp].total_sales++
      if (isSameDaySale) bySalesperson[sp].same_day_sale++

      // Per-member detail for drill-down
      bySalesperson[sp].members.push({
        name: `${m.first_name || ''} ${m.last_name || ''}`.trim(),
        email: m.email,
        membership_type: m.membership_type,
        since_date: m.sign_date || m.since_date,
        day_one_booked: isDayOneBooked,
        same_day_sale: isSameDaySale,
      })
    }

    // Attribute VIPs to each salesperson via the vip_team_member field.
    // Match by case-insensitive trimmed name so "John Smith" and "john smith" align.
    const lowerSpKeys = Object.fromEntries(Object.keys(bySalesperson).map(k => [k.toLowerCase().trim(), k]))
    for (const [name, count] of Object.entries(vipsByPerson)) {
      const key = lowerSpKeys[name.toLowerCase().trim()] || name
      if (!bySalesperson[key]) {
        bySalesperson[key] = { total_sales: 0, vips: 0, day_one_booked: 0, same_day_sale: 0, members: [] }
      }
      bySalesperson[key].vips += count
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
        member_sign_date: m.sign_date || m.since_date,
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

    // --- Memberships from ABC (source of truth, supports multi-slug) ---
    let clubNumbers2 = []
    if (locationFilter && locationFilter.column === 'location_slug') {
      clubNumbers2 = locationFilter.values.map(s => SLUG_CLUB_MAP[s]).filter(Boolean)
    }

    let abcQuery = supabaseAdmin
      .from('abc_members')
      .select('sales_person_name, email, membership_type, agreement_number, sign_date, since_date')
      .eq('is_active', true)
      .not('sign_date', 'is', null)
    if (start_date) abcQuery = abcQuery.gte('sign_date', start_date)
    if (end_date) abcQuery = abcQuery.lte('sign_date', end_date)
    if (clubNumbers2.length > 0) abcQuery = abcQuery.in('club_number', clubNumbers2)

    const abcMembers = []
    let abcFrom = 0
    while (true) {
      const { data: page } = await abcQuery.range(abcFrom, abcFrom + 999)
      if (!page || page.length === 0) break
      abcMembers.push(...page)
      if (page.length < 1000) break
      abcFrom += 1000
    }
    const skipTypes = await getSkipList()
    const filteredMembers = abcMembers.filter(m =>
      !skipTypes.has((m.membership_type || '').toLowerCase())
      && m.since_date && m.sign_date && m.since_date >= m.sign_date
    )

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

    // --- VIPs in range, counted by `contact.vip_team_member` custom field ---
    const { total: totalVips, byPerson: vipsByPerson } = await countVipsByTeamMember({ startISO, endISO, locationFilter })

    // --- Day Ones from GHL ---
    let dayOneQ = supabaseAdmin
      .from('ghl_contacts_report')
      .select('day_one_booked, day_one_status, day_one_sale, day_one_booking_date, day_one_booking_team_member, day_one_trainer, location_slug')
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

    // Count unique agreements
    const uniqueAgreements = new Set(filteredMembers.map(m => m.agreement_number).filter(Boolean)).size

    // Top 3 salespeople by leaderboard score (matches POINTS in leaderboard.js)
    const POINTS = { DAY_ONE_BOOKED: 10, MEMBERSHIP: 5, SAME_DAY_SALE: 5, VIP: 2 }
    const normalizeName = (raw) => (raw || '')
      .replace(/\s+/g, ' ').trim().toLowerCase()
      .replace(/\b\w/g, c => c.toUpperCase())

    const personStats = {}
    const ensurePerson = (k) => {
      if (!personStats[k]) personStats[k] = { memberships: 0, day_ones: 0, same_day: 0, vips: 0 }
    }

    for (const m of filteredMembers) {
      const name = normalizeName(m.sales_person_name)
      if (!name || name === 'Unassigned') continue
      ensurePerson(name)
      personStats[name].memberships++
      const ghl = m.email ? ghlByEmail[m.email.toLowerCase()] : null
      if (ghl?.same_day_sale === 'Sale') personStats[name].same_day++
    }

    for (const c of dayOnes) {
      const name = normalizeName(c.day_one_booking_team_member)
      if (!name || name === 'Unassigned') continue
      ensurePerson(name)
      personStats[name].day_ones++
    }

    // Attribute VIPs to each team member via the vip_team_member field.
    for (const [rawName, count] of Object.entries(vipsByPerson)) {
      const name = normalizeName(rawName)
      if (!name || name === 'Unassigned') continue
      ensurePerson(name)
      personStats[name].vips += count
    }

    const topSalespeople = Object.entries(personStats)
      .map(([name, s]) => ({
        name,
        count: s.day_ones * POINTS.DAY_ONE_BOOKED
          + s.memberships * POINTS.MEMBERSHIP
          + s.same_day * POINTS.SAME_DAY_SALE
          + s.vips * POINTS.VIP,
      }))
      .filter(p => p.count > 0)
      .sort((a, b) => b.count - a.count)
      .slice(0, 3)

    // Memberships by sign_date for daily bar chart
    const membershipsByDate = {}
    for (const m of filteredMembers) {
      if (!m.sign_date) continue
      membershipsByDate[m.sign_date] = (membershipsByDate[m.sign_date] || 0) + 1
    }
    const byDate = Object.entries(membershipsByDate)
      .map(([date, memberships]) => ({ date, memberships }))
      .sort((a, b) => a.date.localeCompare(b.date))

    // Sales by membership_type — both member rows and distinct agreements per type
    const salesAgreementsByType = {}
    const salesMembersByType = {}
    for (const m of filteredMembers) {
      const t = m.membership_type || 'Unknown'
      salesMembersByType[t] = (salesMembersByType[t] || 0) + 1
      if (m.agreement_number) {
        if (!salesAgreementsByType[t]) salesAgreementsByType[t] = new Set()
        salesAgreementsByType[t].add(m.agreement_number)
      }
    }
    const byMembershipType = Object.keys(salesMembersByType)
      .map(t => ({
        membership_type: t,
        members: salesMembersByType[t],
        agreements: salesAgreementsByType[t]?.size || 0,
      }))
      .sort((a, b) => b.agreements - a.agreements || b.members - a.members)

    // Top 3 trainers by Day One closes (Sale on completed day ones)
    const closesByTrainer = {}
    for (const c of dayOnes) {
      if ((c.day_one_status || '').toLowerCase() !== 'completed') continue
      if (c.day_one_sale !== 'Sale') continue
      const t = c.day_one_trainer
      if (!t) continue
      closesByTrainer[t] = (closesByTrainer[t] || 0) + 1
    }
    const topTrainers = Object.entries(closesByTrainer)
      .map(([name, count]) => ({ name, count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 3)

    // --- Active members (full club roster, ignores date range) ---
    // Same skip-list filter as sales metrics, but no sign_date / since_date constraints.
    let activeQuery = supabaseAdmin
      .from('abc_members')
      .select('agreement_number, membership_type')
      .eq('is_active', true)
    if (clubNumbers2.length > 0) activeQuery = activeQuery.in('club_number', clubNumbers2)

    const activeMembers = []
    let activeFrom = 0
    while (true) {
      const { data: page, error: actErr } = await activeQuery.range(activeFrom, activeFrom + 999)
      if (actErr) return res.status(500).json({ error: 'Failed to fetch active members', detail: actErr.message })
      if (!page || page.length === 0) break
      activeMembers.push(...page)
      if (page.length < 1000) break
      activeFrom += 1000
    }
    const activeFiltered = activeMembers.filter(m => !skipTypes.has((m.membership_type || '').toLowerCase()))

    const activeAgreementsByType = {}
    const activeMembersByType = {}
    for (const m of activeFiltered) {
      const t = m.membership_type || 'Unknown'
      activeMembersByType[t] = (activeMembersByType[t] || 0) + 1
      if (m.agreement_number) {
        if (!activeAgreementsByType[t]) activeAgreementsByType[t] = new Set()
        activeAgreementsByType[t].add(m.agreement_number)
      }
    }
    const activeByMembershipType = Object.keys(activeMembersByType)
      .map(t => ({
        membership_type: t,
        members: activeMembersByType[t],
        agreements: activeAgreementsByType[t]?.size || 0,
      }))
      .sort((a, b) => b.members - a.members)

    const activeAgreementsTotal = new Set(activeFiltered.map(m => m.agreement_number).filter(Boolean)).size

    // --- Cancels in period (for Net Change card) ---
    // Counts members whose status changed to Cancelled/Expired/Return For Collection
    // within the date range. Same skip-list filter as sales.
    let cancelsInPeriodMembers = 0
    let cancelsInPeriodAgreements = 0
    if (start_date && end_date) {
      let cancelsQuery = supabaseAdmin
        .from('abc_members')
        .select('membership_type, agreement_number')
        .in('member_status', ['Cancelled', 'Expired', 'Return For Collection'])
        .gte('member_status_date', start_date)
        .lte('member_status_date', end_date)
      if (clubNumbers2.length > 0) cancelsQuery = cancelsQuery.in('club_number', clubNumbers2)

      const cancelRows = []
      let cFrom = 0
      while (true) {
        const { data: page } = await cancelsQuery.range(cFrom, cFrom + 999)
        if (!page || page.length === 0) break
        cancelRows.push(...page)
        if (page.length < 1000) break
        cFrom += 1000
      }
      const cancelFiltered = cancelRows.filter(m => !skipTypes.has((m.membership_type || '').toLowerCase()))
      cancelsInPeriodMembers = cancelFiltered.length
      cancelsInPeriodAgreements = new Set(cancelFiltered.map(m => m.agreement_number).filter(Boolean)).size
    }

    res.json({
      total_memberships: filteredMembers.length,
      total_agreements: uniqueAgreements,
      total_vips: totalVips || 0,
      total_same_day_sales: totalSameDaySales,
      total_day_ones_booked: totalDayOnesBooked,
      day_one_booked: dayOneBookedCounts,
      day_one_status: dayOneStatusCounts,
      day_one_sale: dayOneSaleCounts,
      top_salespeople: topSalespeople,
      top_trainers: topTrainers,
      by_date: byDate,
      by_membership_type: byMembershipType,
      active_members_total: activeFiltered.length,
      active_agreements_total: activeAgreementsTotal,
      active_by_membership_type: activeByMembershipType,
      cancels_members: cancelsInPeriodMembers,
      cancels_agreements: cancelsInPeriodAgreements,
      net_change_members: filteredMembers.length - cancelsInPeriodMembers,
      net_change_agreements: uniqueAgreements - cancelsInPeriodAgreements,
    })
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

// ---------------------------------------------------------------------------
// GET /reports/cancels
// Counts cancellations (member_status_date in range) by status, type, club.
// Includes a "scheduled" Pending Cancel queue.
// ---------------------------------------------------------------------------
router.get('/cancels', async (req, res) => {
  const { start_date, end_date } = req.query

  try {
    const locationFilter = await resolveLocationFilter(req.query)
    let clubNumbersC = []
    if (locationFilter && locationFilter.column === 'location_slug') {
      clubNumbersC = locationFilter.values.map(s => SLUG_CLUB_MAP[s]).filter(Boolean)
    }

    const skipTypes = await getSkipList()

    // 1. Cancels with member_status_date in range (supports multi-slug)
    let cancelsQuery = supabaseAdmin
      .from('abc_members')
      .select('first_name, last_name, email, membership_type, agreement_number, member_status, member_status_date, sales_person_name, sign_date, since_date')
      .in('member_status', ['Cancelled', 'Expired', 'Return For Collection'])
    if (start_date) cancelsQuery = cancelsQuery.gte('member_status_date', start_date)
    if (end_date) cancelsQuery = cancelsQuery.lte('member_status_date', end_date)
    if (clubNumbersC.length > 0) cancelsQuery = cancelsQuery.in('club_number', clubNumbersC)

    const cancelRows = []
    let cFrom = 0
    while (true) {
      const { data: page, error } = await cancelsQuery.range(cFrom, cFrom + 999)
      if (error) return res.status(500).json({ error: 'Failed to fetch cancels', detail: error.message })
      if (!page || page.length === 0) break
      cancelRows.push(...page)
      if (page.length < 1000) break
      cFrom += 1000
    }
    const cancelFiltered = cancelRows.filter(m => !skipTypes.has((m.membership_type || '').toLowerCase()))

    const totalMembers = cancelFiltered.length
    const totalAgreements = new Set(cancelFiltered.map(m => m.agreement_number).filter(Boolean)).size

    // By status
    const byStatusCounts = {}
    for (const m of cancelFiltered) {
      const s = m.member_status || 'Unknown'
      byStatusCounts[s] = (byStatusCounts[s] || 0) + 1
    }

    // By membership type (members + agreements per type)
    const cancelAgreementsByType = {}
    const cancelMembersByType = {}
    for (const m of cancelFiltered) {
      const t = m.membership_type || 'Unknown'
      cancelMembersByType[t] = (cancelMembersByType[t] || 0) + 1
      if (m.agreement_number) {
        if (!cancelAgreementsByType[t]) cancelAgreementsByType[t] = new Set()
        cancelAgreementsByType[t].add(m.agreement_number)
      }
    }
    const byMembershipType = Object.keys(cancelMembersByType)
      .map(t => ({
        membership_type: t,
        members: cancelMembersByType[t],
        agreements: cancelAgreementsByType[t]?.size || 0,
      }))
      .sort((a, b) => b.agreements - a.agreements || b.members - a.members)

    // Daily cancels for the bar chart
    const cancelsByDate = {}
    for (const m of cancelFiltered) {
      if (!m.member_status_date) continue
      cancelsByDate[m.member_status_date] = (cancelsByDate[m.member_status_date] || 0) + 1
    }
    const byDate = Object.entries(cancelsByDate)
      .map(([date, memberships]) => ({ date, memberships }))
      .sort((a, b) => a.date.localeCompare(b.date))

    // 2. Pending Cancel queue (still active, scheduled for future cancel)
    let pendingQuery = supabaseAdmin
      .from('abc_members')
      .select('first_name, last_name, email, membership_type, agreement_number, member_status_date, sales_person_name')
      .eq('member_status', 'Pending Cancel')
      .eq('is_active', true)
    if (clubNumbersC.length > 0) pendingQuery = pendingQuery.in('club_number', clubNumbersC)

    const pendingRows = []
    let pFrom = 0
    while (true) {
      const { data: page } = await pendingQuery.range(pFrom, pFrom + 999)
      if (!page || page.length === 0) break
      pendingRows.push(...page)
      if (page.length < 1000) break
      pFrom += 1000
    }
    const pendingFiltered = pendingRows
      .filter(m => !skipTypes.has((m.membership_type || '').toLowerCase()))
      .sort((a, b) => (a.member_status_date || '').localeCompare(b.member_status_date || ''))

    // 3. Click2Save aggregations: cancel reasons, save count, save options.
    // Sourced from click2save_events_expanded + click2save_offers views.
    // Filtered by occurred_at within [start_date, end_date+1day) so the full
    // end-day is inclusive against the timestamptz column.
    const c2sStart = start_date ? `${start_date}T00:00:00Z` : null
    const c2sEnd = end_date ? `${end_date}T23:59:59.999Z` : null

    let c2sCancelReasons = []
    let c2sSaveCount = 0
    let c2sSaveOptions = []
    let c2sError = null

    try {
      // Cancel reasons (CANCEL events)
      let reasonsQuery = supabaseAdmin
        .from('click2save_events_expanded')
        .select('cancel_reason, cancel_code')
        .eq('request_type', 'CANCEL')
      if (c2sStart) reasonsQuery = reasonsQuery.gte('occurred_at', c2sStart)
      if (c2sEnd) reasonsQuery = reasonsQuery.lte('occurred_at', c2sEnd)
      if (clubNumbersC.length > 0) reasonsQuery = reasonsQuery.in('club_code', clubNumbersC)
      const { data: reasonRows, error: reasonsErr } = await reasonsQuery
      if (reasonsErr) throw reasonsErr
      const reasonCounts = {}
      for (const r of reasonRows || []) {
        const key = r.cancel_reason || r.cancel_code || 'Unspecified'
        reasonCounts[key] = (reasonCounts[key] || 0) + 1
      }
      c2sCancelReasons = Object.entries(reasonCounts)
        .map(([reason, count]) => ({ reason, count }))
        .sort((a, b) => b.count - a.count)

      // Save count (OFFER events)
      let savesQuery = supabaseAdmin
        .from('click2save_events_expanded')
        .select('request_id', { count: 'exact', head: true })
        .eq('request_type', 'OFFER')
      if (c2sStart) savesQuery = savesQuery.gte('occurred_at', c2sStart)
      if (c2sEnd) savesQuery = savesQuery.lte('occurred_at', c2sEnd)
      if (clubNumbersC.length > 0) savesQuery = savesQuery.in('club_code', clubNumbersC)
      const { count: saveCount, error: savesErr } = await savesQuery
      if (savesErr) throw savesErr
      c2sSaveCount = saveCount || 0

      // Save options (offer subtypes within OFFER events).
      // click2save_offers exposes received_at; same-day-or-next-day from occurred_at.
      let offersQuery = supabaseAdmin
        .from('click2save_offers')
        .select('offer_subtype')
      if (c2sStart) offersQuery = offersQuery.gte('received_at', c2sStart)
      if (c2sEnd) offersQuery = offersQuery.lte('received_at', c2sEnd)
      if (clubNumbersC.length > 0) offersQuery = offersQuery.in('club_code', clubNumbersC)
      const { data: offerRows, error: offersErr } = await offersQuery
      if (offersErr) throw offersErr
      const offerCounts = {}
      for (const o of offerRows || []) {
        const key = o.offer_subtype || 'Unknown'
        offerCounts[key] = (offerCounts[key] || 0) + 1
      }
      c2sSaveOptions = Object.entries(offerCounts)
        .map(([subtype, count]) => ({ subtype, count }))
        .sort((a, b) => b.count - a.count)
    } catch (err) {
      // Don't fail the whole report if Click2Save data is unavailable —
      // surface the error in the response so the UI can show a soft warning.
      console.error('[reports/cancels] click2save aggregation failed:', err.message)
      c2sError = err.message
    }

    res.json({
      total_members: totalMembers,
      total_agreements: totalAgreements,
      by_status: byStatusCounts,
      by_membership_type: byMembershipType,
      by_date: byDate,
      pending_cancel_count: pendingFiltered.length,
      pending_cancel_agreements: new Set(pendingFiltered.map(m => m.agreement_number).filter(Boolean)).size,
      pending_cancels: pendingFiltered.slice(0, 200).map(m => ({
        name: [m.first_name, m.last_name].filter(Boolean).join(' '),
        email: m.email,
        membership_type: m.membership_type,
        agreement_number: m.agreement_number,
        scheduled_date: m.member_status_date,
        sales_person_name: m.sales_person_name,
      })),
      // Click2Save additions (null/empty when no data or feature unavailable)
      c2s_cancel_reasons: c2sCancelReasons,
      c2s_save_count: c2sSaveCount,
      c2s_save_options: c2sSaveOptions,
      c2s_error: c2sError,
    })
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

// ---------------------------------------------------------------------------
// GET /reports/speed-to-lead
// Query params: start_date, end_date, location_slug
// Reports median + mean minutes from opportunity creation to first human contact.
// ---------------------------------------------------------------------------
router.get('/speed-to-lead', async (req, res) => {
  const { start_date, end_date } = req.query

  try {
    const locationFilter = await resolveLocationFilter(req.query)

    // ISO bounds for the TIMESTAMPTZ column opportunity_created_at
    const startISO = start_date ? start_date + 'T00:00:00.000Z' : null
    const endISO   = end_date ? end_date + 'T23:59:59.999Z' : null

    // Resolve location filter to GHL location IDs (ghl_first_contact only has location_id).
    // Mirrors the same slug→id resolution used in /membership for ghl_opportunities_v2.
    let locationIds = []
    if (locationFilter) {
      if (locationFilter.column === 'location_id') {
        locationIds = locationFilter.values
      } else if (locationFilter.column === 'location_slug') {
        const orClauses = locationFilter.values.map(s => `name.ilike.%${s}%`).join(',')
        const { data: locs } = await supabaseAdmin
          .from('ghl_locations').select('id').or(orClauses)
        locationIds = (locs || []).map(l => l.id)
      }
    }

    let q = supabaseAdmin
      .from('ghl_first_contact')
      .select('opportunity_id, opportunity_created_at, first_human_contact_at, location_id')

    if (locationIds.length > 0) q = q.in('location_id', locationIds)
    if (startISO) q = q.gte('opportunity_created_at', startISO)
    if (endISO)   q = q.lte('opportunity_created_at', endISO)

    const { data, error } = await q
    if (error) return res.status(500).json({ error: 'Failed to fetch speed-to-lead data', detail: error.message })

    const rows = data || []

    // Resolve the set of "New Lead" stage ids (the entry stage, position 0).
    const { data: stageRows } = await supabaseAdmin
      .from('ghl_pipeline_stages').select('id').ilike('name', 'New Lead')
    const newLeadStageIds = new Set((stageRows || []).map(s => s.id))

    // Fetch the opportunities' current stage + timestamps so we can keep only
    // genuine New-Lead entrants (currently at New Lead, OR moved since creation —
    // since New Lead is the first stage, anything that progressed started there).
    // Opps created directly at a later stage (never moved) are excluded.
    const oppIds = rows.map(r => r.opportunity_id)
    const oppById = new Map()
    for (let i = 0; i < oppIds.length; i += 500) {
      const chunk = oppIds.slice(i, i + 500)
      const { data: opps } = await supabaseAdmin
        .from('ghl_opportunities_v2')
        .select('id, stage_id, created_at_ghl, last_stage_change_at, updated_at_ghl')
        .in('id', chunk)
      for (const o of (opps || [])) oppById.set(o.id, o)
    }

    const MOVED_EPSILON_MS = 2000 // tolerance so created==lastChange isn't "moved"
    function isNewLead(opp) {
      if (!opp) return false
      if (newLeadStageIds.has(opp.stage_id)) return true
      // Prefer last_stage_change_at; fall back to updated_at_ghl until a full opp
      // sync populates the precise column.
      const movedRef = opp.last_stage_change_at || opp.updated_at_ghl
      if (movedRef && opp.created_at_ghl) {
        return (new Date(movedRef).getTime() - new Date(opp.created_at_ghl).getTime()) > MOVED_EPSILON_MS
      }
      return false
    }

    let contactedCount = 0
    let uncontactedCount = 0
    let excludedNotNewLead = 0
    const minutes = []

    for (const row of rows) {
      const opp = oppById.get(row.opportunity_id)
      if (!isNewLead(opp)) { excludedNotNewLead++; continue }
      if (row.first_human_contact_at == null) { uncontactedCount++; continue }
      const created = new Date(row.opportunity_created_at).getTime()
      const contacted = new Date(row.first_human_contact_at).getTime()
      const mins = (contacted - created) / 60000
      if (mins < 0) { excludedNotNewLead++; continue } // contact before creation — not a fresh lead
      contactedCount++
      minutes.push(mins)
    }

    let medianMinutes = null
    let meanMinutes = null
    if (minutes.length > 0) {
      const sum = minutes.reduce((acc, v) => acc + v, 0)
      meanMinutes = Math.round(sum / minutes.length)
      const sorted = [...minutes].sort((a, b) => a - b)
      const mid = Math.floor(sorted.length / 2)
      medianMinutes = sorted.length % 2 === 1
        ? Math.round(sorted[mid])
        : Math.round((sorted[mid - 1] + sorted[mid]) / 2)
    }

    res.json({
      // Only genuine New-Lead entrants are counted; opps created directly at a
      // later stage are excluded (excluded_not_new_lead). Counts reflect opps the
      // compute step has processed (rows in ghl_first_contact). median is headline.
      median_minutes: medianMinutes,
      mean_minutes: meanMinutes,
      contacted_count: contactedCount,
      uncontacted_count: uncontactedCount,
      excluded_not_new_lead: excludedNotNewLead,
      total_opportunities: rows.length,
    })
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

// ---------------------------------------------------------------------------
// GET /reports/speed-to-lead/audit
// Per-lead breakdown behind the Speed to Lead median — INCLUDING skipped rows
// (with a reason) so the data can be vetted. Query: start_date, end_date,
// location_slug, limit (default 1000).
// ---------------------------------------------------------------------------
router.get('/speed-to-lead/audit', async (req, res) => {
  const { start_date, end_date } = req.query
  const limit = Math.min(parseInt(req.query.limit || '1000', 10) || 1000, 5000)
  try {
    const locationFilter = await resolveLocationFilter(req.query)
    const startISO = start_date ? start_date + 'T00:00:00.000Z' : null
    const endISO = end_date ? end_date + 'T23:59:59.999Z' : null

    let locationIds = []
    if (locationFilter) {
      if (locationFilter.column === 'location_id') {
        locationIds = locationFilter.values
      } else if (locationFilter.column === 'location_slug') {
        const orClauses = locationFilter.values.map(s => `name.ilike.%${s}%`).join(',')
        const { data: locs } = await supabaseAdmin.from('ghl_locations').select('id').or(orClauses)
        locationIds = (locs || []).map(l => l.id)
      }
    }

    let q = supabaseAdmin
      .from('ghl_first_contact')
      .select('opportunity_id, contact_id, location_id, opportunity_created_at, first_human_contact_at, first_contact_kind')
      .order('opportunity_created_at', { ascending: false })
      .limit(limit)
    if (locationIds.length > 0) q = q.in('location_id', locationIds)
    if (startISO) q = q.gte('opportunity_created_at', startISO)
    if (endISO) q = q.lte('opportunity_created_at', endISO)

    const { data, error } = await q
    if (error) return res.status(500).json({ error: 'Failed to fetch audit', detail: error.message })
    const rows = data || []

    // New Lead stage ids
    const { data: stageRows } = await supabaseAdmin
      .from('ghl_pipeline_stages').select('id').ilike('name', 'New Lead')
    const newLeadStageIds = new Set((stageRows || []).map(s => s.id))

    // Batch-fetch opps, contacts, locations for the rows.
    const oppIds = [...new Set(rows.map(r => r.opportunity_id))]
    const contactIds = [...new Set(rows.map(r => r.contact_id).filter(Boolean))]
    const locIds = [...new Set(rows.map(r => r.location_id).filter(Boolean))]
    const oppById = new Map(), contactById = new Map(), clubById = new Map()
    for (let i = 0; i < oppIds.length; i += 500) {
      const { data: opps } = await supabaseAdmin
        .from('ghl_opportunities_v2')
        .select('id, stage_id, created_at_ghl, last_stage_change_at, updated_at_ghl')
        .in('id', oppIds.slice(i, i + 500))
      for (const o of (opps || [])) oppById.set(o.id, o)
    }
    for (let i = 0; i < contactIds.length; i += 500) {
      const { data: cs } = await supabaseAdmin
        .from('ghl_contacts_v2')
        .select('id, full_name, first_name, last_name')
        .in('id', contactIds.slice(i, i + 500))
      for (const c of (cs || [])) contactById.set(c.id, c)
    }
    if (locIds.length) {
      const { data: locs } = await supabaseAdmin.from('ghl_locations').select('id, name').in('id', locIds)
      for (const l of (locs || [])) clubById.set(l.id, l.name)
    }

    const MOVED_EPSILON_MS = 2000
    function isNewLead(opp) {
      if (!opp) return false
      if (newLeadStageIds.has(opp.stage_id)) return true
      const movedRef = opp.last_stage_change_at || opp.updated_at_ghl
      if (movedRef && opp.created_at_ghl) {
        return (new Date(movedRef).getTime() - new Date(opp.created_at_ghl).getTime()) > MOVED_EPSILON_MS
      }
      return false
    }

    const out = rows.map(r => {
      const opp = oppById.get(r.opportunity_id)
      const c = contactById.get(r.contact_id)
      const name = (c && (c.full_name || `${c.first_name || ''} ${c.last_name || ''}`.trim())) || '(unknown)'
      let included = false, reason, speed_minutes = null
      if (!isNewLead(opp)) {
        reason = 'not_new_lead'
      } else if (r.first_human_contact_at == null) {
        reason = 'no_human_contact'
      } else {
        const mins = (new Date(r.first_human_contact_at) - new Date(r.opportunity_created_at)) / 60000
        if (mins < 0) { reason = 'contact_before_create' }
        else { included = true; reason = 'counted'; speed_minutes = Math.round(mins) }
      }
      return {
        contact_name: name,
        club: clubById.get(r.location_id) || r.location_id,
        opportunity_created_at: r.opportunity_created_at,
        first_human_contact_at: r.first_human_contact_at,
        first_contact_kind: r.first_contact_kind,
        speed_minutes,
        included,
        reason,
      }
    })

    res.json({ rows: out, returned: out.length, truncated: rows.length >= limit })
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

module.exports = router
