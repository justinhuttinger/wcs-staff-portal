/**
 * /reports/daily-snapshot — one-day view across schedule + sales.
 *
 * Single endpoint that returns all panels for the requested date. The server
 * decides which panels are applicable based on whether the date is past,
 * today, or future (Pacific time) and returns `null` for inapplicable
 * panels so the UI can render placeholders.
 *
 * Spec: docs/superpowers/specs/2026-05-14-daily-snapshot-and-marketing-reorg-design.md
 */

const { Router } = require('express')
const authenticate = require('../middleware/auth')
const { requireRole, resolveRole } = require('../middleware/role')
const { supabaseAdmin } = require('../services/supabase')
const { LOCATIONS, getLocationBySlug } = require('../config/ghlLocations')
const { ghlFetch } = require('../services/ghlClient')
const { parseLocationSlugParam, intersectWithAllowed } = require('../utils/locationSlug')
const { getSkipList } = require('../utils/membershipSkipList')

const router = Router()
router.use(authenticate)
router.use(requireRole('manager'))

const CAL_VERSION = '2021-04-15'
const PT_PROFIT_CENTERS = ['PERSONAL TRAINING', 'TRAINING']

// In-process cache: calendars per location (1h) and GHL users per location
// (10m). Trainer-name resolution lives in the users cache.
const cache = {}
const CAL_TTL = 60 * 60 * 1000
const USERS_TTL = 10 * 60 * 1000

async function getDayOneCalendars(loc) {
  const cached = cache[`d1:${loc.id}`]
  if (cached && Date.now() - cached.ts < CAL_TTL) return cached.value
  const data = await ghlFetch('/calendars/', loc.apiKey, {
    params: { locationId: loc.id },
    version: CAL_VERSION,
  })
  const calendars = data.calendars || []
  const dayOnes = calendars.filter(c => {
    const name = (c.name || '').toLowerCase()
    return name.includes('day one') || name.includes('dayone') || name.includes('day 1')
  })
  const value = {
    calendarIds: dayOnes.map(c => c.id),
    groupId: dayOnes[0]?.groupId || null,
  }
  cache[`d1:${loc.id}`] = { value, ts: Date.now() }
  return value
}

async function getTourCalendars(loc) {
  const cached = cache[`tour:${loc.id}`]
  if (cached && Date.now() - cached.ts < CAL_TTL) return cached.value
  const data = await ghlFetch('/calendars/', loc.apiKey, {
    params: { locationId: loc.id },
    version: CAL_VERSION,
  })
  const calendars = data.calendars || []
  const tours = calendars.filter(c => (c.name || '').toLowerCase().includes('tour'))
  const value = {
    calendarIds: tours.map(c => c.id),
    groupId: tours[0]?.groupId || null,
  }
  cache[`tour:${loc.id}`] = { value, ts: Date.now() }
  return value
}

// Returns Map(userId -> { name, email }) for a location, cached 10 minutes.
async function getUserMap(loc) {
  const cached = cache[`users:${loc.id}`]
  if (cached && Date.now() - cached.ts < USERS_TTL) return cached.value
  const map = new Map()
  try {
    const data = await ghlFetch('/users/', loc.apiKey, {
      params: { locationId: loc.id },
    })
    for (const u of (data.users || [])) {
      const name = u.name || `${u.firstName || ''} ${u.lastName || ''}`.trim() || u.email || ''
      map.set(u.id, { name, email: (u.email || '').toLowerCase() })
    }
  } catch (err) {
    console.warn(`[daily-snapshot ${loc.slug}] users fetch failed:`, err.message)
  }
  cache[`users:${loc.id}`] = { value: map, ts: Date.now() }
  return map
}

function ptDayBoundsMs(dateStr) {
  // Local 00:00 PT — using a fixed -08:00 base. Accepts up to 1h jitter at
  // DST boundaries (acceptable for "what happened today" reporting).
  const start = new Date(`${dateStr}T00:00:00-08:00`).getTime()
  const end = start + 24 * 60 * 60 * 1000
  return { start, end }
}

function todayInPacificISO() {
  const now = new Date()
  const pt = new Date(now.toLocaleString('en-US', { timeZone: 'America/Los_Angeles' }))
  const y = pt.getFullYear()
  const m = String(pt.getMonth() + 1).padStart(2, '0')
  const d = String(pt.getDate()).padStart(2, '0')
  return `${y}-${m}-${d}`
}

function classifyMode(dateStr) {
  const today = todayInPacificISO()
  if (dateStr < today) return 'past'
  if (dateStr > today) return 'future'
  return 'today'
}

function parseDateParam(value) {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null
  const d = new Date(value + 'T00:00:00Z')
  if (isNaN(d.getTime())) return null
  return value
}

async function resolveLocations(req, requestedSlug) {
  const role = resolveRole(req.staff?.role)
  const parsed = parseLocationSlugParam(requestedSlug)
  if (parsed.invalid) {
    const err = new Error(`Unknown location: ${parsed.invalid}`)
    err.status = 400
    throw err
  }
  const canSeeAll = role === 'corporate' || role === 'admin' || role === 'marketing'

  if (canSeeAll) {
    if (parsed.all) return LOCATIONS
    const set = new Set(parsed.slugs)
    return LOCATIONS.filter(l => set.has(l.slug))
  }

  const allowedIds = req.staff?.location_ids || []
  if (allowedIds.length === 0) return []
  const { data: rows } = await supabaseAdmin
    .from('locations')
    .select('name')
    .in('id', allowedIds)
  const allowedSlugs = (rows || []).map(r => r.name.toLowerCase())
  const allowedLocs = LOCATIONS.filter(l => allowedSlugs.includes(l.slug))
  if (parsed.all) return allowedLocs
  const narrowed = intersectWithAllowed(parsed, allowedSlugs, { silentNarrow: true })
  const wanted = new Set(narrowed.slugs)
  return allowedLocs.filter(l => wanted.has(l.slug))
}

// ---- GHL helpers ----------------------------------------------------------

async function fetchEventsForCalendars(loc, calInfo, startMs, endMs) {
  if (!calInfo.calendarIds.length) return []
  const events = []
  if (calInfo.groupId) {
    const data = await ghlFetch('/calendars/events', loc.apiKey, {
      params: {
        locationId: loc.id,
        groupId: calInfo.groupId,
        startTime: String(startMs),
        endTime: String(endMs),
      },
      version: CAL_VERSION,
    })
    events.push(...(data.events || []))
  } else {
    for (const calId of calInfo.calendarIds) {
      const data = await ghlFetch('/calendars/events', loc.apiKey, {
        params: {
          locationId: loc.id,
          calendarId: calId,
          startTime: String(startMs),
          endTime: String(endMs),
        },
        version: CAL_VERSION,
      })
      events.push(...(data.events || []))
    }
  }
  return events
}

// Trim a GHL event to the slim row the UI consumes. `userMap` resolves
// `assignedUserId` → trainer name. `localStatusByApptId` (built once per
// request) carries `status` + `sale_result` from the local `appointments`
// table for past day-one events.
function slimEvent(evt, locationName, mode, userMap, localStatusByApptId) {
  const status = (evt.appointmentStatus || '').toLowerCase()
  const trainer = (evt.assignedUserId && userMap?.get(evt.assignedUserId)?.name) || null

  const local = localStatusByApptId?.get(evt.id) || null
  const localStatus = local?.status || null     // 'pending' | 'completed'
  const saleResult = local?.sale_result || null // present when the day-one form was submitted
  const markedComplete = localStatus === 'completed'

  // Best-effort "no-show" signal for the panel summary count.
  let result = null
  if (mode === 'past') {
    if (status === 'noshow' || status === 'no_show' || status === 'cancelled') result = 'no_sale'
  }

  return {
    id: evt.id,
    name: evt.title || evt.contactName || 'Appointment',
    location: locationName,
    time: evt.startTime || null,
    status: status || null,
    trainer,
    marked_complete: markedComplete,
    sale_result: saleResult,
    result,
  }
}

// ---- Panel computations ---------------------------------------------------

async function fetchLocalAppointmentStatusMap(ghlIds) {
  if (!ghlIds.length) return new Map()
  const { data, error } = await supabaseAdmin
    .from('appointments')
    .select('ghl_appointment_id, status, sale_result, completed_at')
    .in('ghl_appointment_id', ghlIds)
  if (error) {
    console.warn('[daily-snapshot] appointment-status lookup failed:', error.message)
    return new Map()
  }
  const m = new Map()
  for (const row of data || []) {
    if (row.ghl_appointment_id) m.set(row.ghl_appointment_id, row)
  }
  return m
}

async function computeSchedulePanels(locations, dateStr, mode) {
  const { start, end } = ptDayBoundsMs(dateStr)
  const collected = locations.map(() => ({ dayOne: [], tours: [], userMap: null }))

  // Per-location fan-out: calendars + user map fetched in parallel.
  await Promise.all(locations.map(async (loc, i) => {
    const bucket = collected[i]
    bucket.userMap = await getUserMap(loc).catch(err => {
      console.warn(`[daily-snapshot ${loc.slug}] users:`, err.message)
      return new Map()
    })
    await Promise.all([
      (async () => {
        try {
          const calInfo = await getDayOneCalendars(loc)
          const events = await fetchEventsForCalendars(loc, calInfo, start, end)
          bucket.dayOne = events
        } catch (err) {
          console.warn(`[daily-snapshot ${loc.slug}] day-one fetch failed:`, err.message)
        }
      })(),
      (async () => {
        try {
          const calInfo = await getTourCalendars(loc)
          const events = await fetchEventsForCalendars(loc, calInfo, start, end)
          bucket.tours = events
        } catch (err) {
          console.warn(`[daily-snapshot ${loc.slug}] tours fetch failed:`, err.message)
        }
      })(),
    ])
  }))

  // For past day-ones, cross-reference the local appointments table for
  // completion status + sale_result.
  const allDayOneEvents = collected.flatMap(b => b.dayOne)
  const allTourEvents = collected.flatMap(b => b.tours)
  let localStatusMap = new Map()
  if (mode === 'past' || mode === 'today') {
    const ids = allDayOneEvents.map(e => e.id).filter(Boolean)
    localStatusMap = await fetchLocalAppointmentStatusMap(ids)
  }

  const dayOneSlim = []
  const tourSlim = []
  collected.forEach((bucket, i) => {
    const loc = locations[i]
    for (const evt of bucket.dayOne) {
      dayOneSlim.push(slimEvent(evt, loc.name, mode, bucket.userMap, localStatusMap))
    }
    for (const evt of bucket.tours) {
      tourSlim.push(slimEvent(evt, loc.name, mode, bucket.userMap, null))
    }
  })

  const sortByTime = (a, b) => (a.time || '').localeCompare(b.time || '')
  dayOneSlim.sort(sortByTime)
  tourSlim.sort(sortByTime)

  return {
    day_one: {
      scheduled: dayOneSlim.length,
      no_show: dayOneSlim.filter(e => e.result === 'no_sale').length,
      completed: dayOneSlim.filter(e => e.marked_complete).length,
      names: dayOneSlim.slice(0, 200),
    },
    tours: {
      scheduled: tourSlim.length,
      no_show: tourSlim.filter(e => e.result === 'no_sale').length,
      names: tourSlim.slice(0, 200),
    },
  }
}

async function computeRevenuePanel(locationSlugs, dateStr) {
  let query = supabaseAdmin
    .from('abc_revenue_transactions')
    .select('profit_center, total_amount')
    .eq('payment_date', dateStr)
  if (locationSlugs) query = query.in('location_slug', locationSlugs)
  const { data, error } = await query
  if (error) throw error

  const byCenter = new Map()
  let total = 0
  for (const row of data || []) {
    const center = row.profit_center || '(uncategorized)'
    const amt = Number(row.total_amount) || 0
    byCenter.set(center, (byCenter.get(center) || 0) + amt)
    total += amt
  }
  const by_profit_center = Array.from(byCenter.entries())
    .map(([profit_center, amount]) => ({ profit_center, amount: Math.round(amount * 100) / 100 }))
    .sort((a, b) => b.amount - a.amount)
  return { by_profit_center, total: Math.round(total * 100) / 100 }
}

// Returns { count, members: [...], top_salespeople: [...] } for the given
// date. "Member sign-up" = `abc_members.sign_date = dateStr` (not the first
// payment_date, which lags the actual signing).
async function computeMembershipSalesPanel(locations, dateStr, dayOneEventsForXref) {
  const clubNumbers = locations.map(l => l.clubCode)
  let query = supabaseAdmin
    .from('abc_members')
    .select('member_id, first_name, last_name, email, club_number, membership_type, sales_person_name, sign_date')
    .eq('sign_date', dateStr)
  if (clubNumbers.length > 0 && clubNumbers.length < LOCATIONS.length) {
    query = query.in('club_number', clubNumbers)
  }
  const { data, error } = await query.limit(2000)
  if (error) throw error

  // Drop excluded membership types (Corporate Business, PT-only, etc.) so the
  // snapshot's sale count matches the other reports.
  const skipTypes = await getSkipList()
  const realMembers = (data || []).filter(r => !skipTypes.has((r.membership_type || '').toLowerCase()))

  // Build a name index from same-day day-one events to flag "booked a Day One".
  const dayOneNames = new Set()
  for (const evt of dayOneEventsForXref || []) {
    const n = (evt.name || '').trim().toLowerCase()
    if (n) dayOneNames.add(n)
  }
  function looksLikeDayOne(first, last) {
    if (!first && !last) return false
    const candidates = [
      `${first || ''} ${last || ''}`.trim().toLowerCase(),
      `${last || ''}, ${first || ''}`.toLowerCase(),
      (first || '').toLowerCase(),
    ].filter(Boolean)
    for (const c of candidates) {
      if (dayOneNames.has(c)) return true
      for (const evt of dayOneNames) {
        if (evt.includes(c)) return true
      }
    }
    return false
  }

  const clubToLocation = new Map(LOCATIONS.map(l => [l.clubCode, l.name]))

  const members = realMembers.map(row => ({
    member_id: row.member_id,
    first_name: row.first_name,
    last_name: row.last_name,
    email: row.email,
    location: clubToLocation.get(row.club_number) || row.club_number,
    membership_type: row.membership_type,
    sales_person: row.sales_person_name || null,
    booked_day_one: looksLikeDayOne(row.first_name, row.last_name),
  }))
  members.sort((a, b) => (a.last_name || '').localeCompare(b.last_name || ''))

  const bySalesperson = new Map()
  for (const m of members) {
    const key = m.sales_person || '(unassigned)'
    bySalesperson.set(key, (bySalesperson.get(key) || 0) + 1)
  }
  const top_salespeople = Array.from(bySalesperson.entries())
    .map(([name, count]) => ({ name, count }))
    .sort((a, b) => b.count - a.count)

  return { count: members.length, members, top_salespeople }
}

async function computePtNewSalesPanel(locationSlugs, dateStr) {
  let query = supabaseAdmin
    .from('abc_revenue_transactions')
    .select('member_number')
    .eq('payment_date', dateStr)
    .in('profit_center', PT_PROFIT_CENTERS)
    .not('member_number', 'is', null)
  if (locationSlugs) query = query.in('location_slug', locationSlugs)
  const { data, error } = await query.limit(10000)
  if (error) throw error
  const uniq = new Set((data || []).map(r => r.member_number))
  return { count: uniq.size }
}

// ---- Handler --------------------------------------------------------------

router.get('/', async (req, res) => {
  try {
    const dateStr = parseDateParam(req.query.date)
    if (!dateStr) return res.status(400).json({ error: 'invalid date (expected YYYY-MM-DD)' })

    const dayMs = 24 * 60 * 60 * 1000
    const reqMs = new Date(dateStr + 'T00:00:00Z').getTime()
    const nowMs = Date.now()
    if (Math.abs(reqMs - nowMs) > 366 * dayMs) {
      return res.status(400).json({ error: 'date out of range' })
    }

    const mode = classifyMode(dateStr)
    const requestedSlug = (req.query.location || '').toLowerCase().trim() || null
    let locations
    try {
      locations = await resolveLocations(req, requestedSlug)
    } catch (err) {
      return res.status(err.status || 500).json({ error: err.message })
    }
    const locationSlugs = locations.length === LOCATIONS.length ? null : locations.map(l => l.slug)

    const panel_errors = {}

    let schedule = { day_one: { scheduled: 0, no_show: 0, completed: 0, names: [] }, tours: { scheduled: 0, no_show: 0, names: [] } }
    try {
      schedule = await computeSchedulePanels(locations, dateStr, mode)
    } catch (err) {
      console.error('[daily-snapshot] schedule error:', err.message)
      panel_errors.schedule = err.message
    }

    let revenue = null
    let membership_sales = null
    let pt_new_sales = null
    if (mode === 'past') {
      try {
        revenue = await computeRevenuePanel(locationSlugs, dateStr)
      } catch (err) {
        console.error('[daily-snapshot] revenue error:', err.message)
        panel_errors.revenue = err.message
      }
      try {
        membership_sales = await computeMembershipSalesPanel(locations, dateStr, schedule.day_one.names)
      } catch (err) {
        console.error('[daily-snapshot] membership_sales error:', err.message)
        panel_errors.membership_sales = err.message
      }
      try {
        pt_new_sales = await computePtNewSalesPanel(locationSlugs, dateStr)
      } catch (err) {
        console.error('[daily-snapshot] pt_new_sales error:', err.message)
        panel_errors.pt_new_sales = err.message
      }
    }

    res.json({
      date: dateStr,
      mode,
      location_slug: !requestedSlug || requestedSlug === 'all' ? null : requestedSlug,
      day_one: schedule.day_one,
      tours: schedule.tours,
      membership_sales,
      revenue,
      pt_new_sales,
      panel_errors: Object.keys(panel_errors).length ? panel_errors : undefined,
    })
  } catch (err) {
    console.error('[daily-snapshot] fatal:', err.message)
    res.status(500).json({ error: 'snapshot failed' })
  }
})

module.exports = router
