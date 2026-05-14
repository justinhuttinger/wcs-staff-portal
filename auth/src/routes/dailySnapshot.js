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

const router = Router()
router.use(authenticate)
router.use(requireRole('manager'))

const CAL_VERSION = '2021-04-15'
const PT_PROFIT_CENTERS = ['PERSONAL TRAINING', 'TRAINING']

// In-process cache of (locationId -> day-one calendar ids/groupId, tours
// calendar id). TTL 1h — same convention as dayOneTracker.
const calCache = {}
const CAL_TTL = 60 * 60 * 1000

async function getDayOneCalendars(loc) {
  const cached = calCache[`d1:${loc.id}`]
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
  calCache[`d1:${loc.id}`] = { value, ts: Date.now() }
  return value
}

async function getTourCalendars(loc) {
  const cached = calCache[`tour:${loc.id}`]
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
  calCache[`tour:${loc.id}`] = { value, ts: Date.now() }
  return value
}

// Pacific-local midnight + +1 day, returned as epoch ms for GHL `startTime` /
// `endTime` params (which expect millis). For the SQL `payment_date` filter
// we use the bare YYYY-MM-DD string since `payment_date` is a `date` column.
function ptDayBoundsMs(dateStr) {
  // Local 00:00 PT — handle both PST (-08:00) and PDT (-07:00) by relying on
  // the Date parser. JS does not natively know PT, so we approximate using
  // a fixed -08:00 base for PST/PDT span and accept up to 1h jitter at DST
  // boundaries (acceptable for "what happened today" reporting).
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

// Returns array of allowed location objects for this caller, honoring their
// role's location scoping. `requestedSlug` of null/'all' means "every allowed
// location". For corporate/marketing/admin that's every configured location;
// for manager/lead it's only their staff_locations.
async function resolveLocations(req, requestedSlug) {
  const role = resolveRole(req.staff?.role)
  const wantsAll = !requestedSlug || requestedSlug === 'all'
  const canSeeAll = role === 'corporate' || role === 'admin' || role === 'marketing'

  if (canSeeAll) {
    if (wantsAll) return LOCATIONS
    const match = LOCATIONS.find(l => l.slug === requestedSlug)
    return match ? [match] : []
  }

  // Manager / lead: scope to their assigned locations.
  const allowedIds = req.staff?.location_ids || []
  if (allowedIds.length === 0) return []
  const { data: rows } = await supabaseAdmin
    .from('locations')
    .select('name')
    .in('id', allowedIds)
  const allowedSlugs = (rows || []).map(r => r.name.toLowerCase())
  const allowedLocs = LOCATIONS.filter(l => allowedSlugs.includes(l.slug))
  if (wantsAll) return allowedLocs
  return allowedLocs.filter(l => l.slug === requestedSlug)
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

// Map a GHL appointment to a slim row for the UI. The `result` field is best-
// effort: GHL sets `appointmentStatus` to 'confirmed' / 'showed' / 'noshow' /
// 'cancelled' etc. We only surface this for past dates; future dates show
// 'scheduled'.
function slimEvent(evt, locationName, mode) {
  const status = (evt.appointmentStatus || '').toLowerCase()
  let result = null
  if (mode === 'past') {
    if (status === 'noshow' || status === 'no_show' || status === 'cancelled') result = 'no_sale'
    else if (status === 'showed' || status === 'confirmed') result = null // unknown sale outcome from calendar alone
  }
  return {
    name: evt.title || evt.contactName || 'Appointment',
    location: locationName,
    time: evt.startTime || null,
    status: status || null,
    result,
  }
}

// ---- Panel computations ---------------------------------------------------

async function computeSchedulePanels(locations, dateStr, mode) {
  const { start, end } = ptDayBoundsMs(dateStr)
  const dayOne = []
  const tours = []
  await Promise.all(locations.flatMap(loc => [
    (async () => {
      try {
        const calInfo = await getDayOneCalendars(loc)
        const events = await fetchEventsForCalendars(loc, calInfo, start, end)
        for (const evt of events) dayOne.push(slimEvent(evt, loc.name, mode))
      } catch (err) {
        console.warn(`[daily-snapshot ${loc.slug}] day-one fetch failed:`, err.message)
      }
    })(),
    (async () => {
      try {
        const calInfo = await getTourCalendars(loc)
        const events = await fetchEventsForCalendars(loc, calInfo, start, end)
        for (const evt of events) tours.push(slimEvent(evt, loc.name, mode))
      } catch (err) {
        console.warn(`[daily-snapshot ${loc.slug}] tours fetch failed:`, err.message)
      }
    })(),
  ]))

  return {
    day_one: {
      scheduled: dayOne.length,
      no_show: dayOne.filter(e => e.result === 'no_sale').length,
      names: dayOne
        .sort((a, b) => (a.time || '').localeCompare(b.time || ''))
        .slice(0, 100),
    },
    tours: {
      scheduled: tours.length,
      no_show: tours.filter(e => e.result === 'no_sale').length,
      names: tours
        .sort((a, b) => (a.time || '').localeCompare(b.time || ''))
        .slice(0, 100),
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

async function computeMembershipSalesPanel(locationSlugs, dateStr) {
  // A "new membership sale" = a member whose FIRST-ever payment_date in
  // abc_revenue_transactions is exactly `dateStr`. We count distinct
  // member_number rows that satisfy that.
  let firstPayments = supabaseAdmin
    .from('abc_revenue_transactions')
    .select('member_number, payment_date')
    .not('member_number', 'is', null)
    .lte('payment_date', dateStr)
  if (locationSlugs) firstPayments = firstPayments.in('location_slug', locationSlugs)

  // Pull all rows up to the date for the relevant locations and bucket in
  // JS — Supabase JS doesn't expose a clean MIN-per-group syntax. For the
  // single-day grain this is acceptable; if it grows hot we can move to an
  // RPC.
  const { data, error } = await firstPayments.limit(100000)
  if (error) throw error

  const firstByMember = new Map()
  for (const row of data || []) {
    const m = row.member_number
    if (!m) continue
    const cur = firstByMember.get(m)
    if (!cur || row.payment_date < cur) firstByMember.set(m, row.payment_date)
  }
  let count = 0
  for (const [, first] of firstByMember) {
    if (first === dateStr) count++
  }
  return { count }
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

    // Reject silly far-future / far-past requests.
    const dayMs = 24 * 60 * 60 * 1000
    const reqMs = new Date(dateStr + 'T00:00:00Z').getTime()
    const nowMs = Date.now()
    if (Math.abs(reqMs - nowMs) > 366 * dayMs) {
      return res.status(400).json({ error: 'date out of range' })
    }

    const mode = classifyMode(dateStr)
    const requestedSlug = (req.query.location || '').toLowerCase().trim() || null
    const locations = await resolveLocations(req, requestedSlug)
    const locationSlugs = locations.length === LOCATIONS.length ? null : locations.map(l => l.slug)

    const panel_errors = {}

    // Always-on panels: day_one + tours via GHL.
    let schedule = { day_one: { scheduled: 0, no_show: 0, names: [] }, tours: { scheduled: 0, no_show: 0, names: [] } }
    try {
      schedule = await computeSchedulePanels(locations, dateStr, mode)
    } catch (err) {
      console.error('[daily-snapshot] schedule error:', err.message)
      panel_errors.schedule = err.message
    }

    // Past-only panels: revenue, membership sales, PT new sales.
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
        membership_sales = await computeMembershipSalesPanel(locationSlugs, dateStr)
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
      location_slug: requestedSlug === 'all' ? null : requestedSlug,
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
