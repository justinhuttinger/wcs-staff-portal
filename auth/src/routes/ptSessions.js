const { Router } = require('express')
const { supabaseAdmin } = require('../services/supabase')
const authenticate = require('../middleware/auth')
const { requireRole, canSeeAllLocations } = require('../middleware/role')

const router = Router()
router.use(authenticate)
router.use(requireRole('lead'))

const SLUG_CLUB_MAP = {
  salem: '30935',
  keizer: '31599',
  eugene: '7655',
  springfield: '31598',
  clackamas: '31600',
  milwaukie: '31601',
  medford: '32073',
}

const DEFAULT_STATUSES = ['Completed', 'Canceled-Charge']
const PACIFIC_TZ = 'America/Los_Angeles'

function locSlugFromName(name) {
  return (name || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '')
}

function pacificDayBoundsToUtc(dateStr, endOfDay = false) {
  if (!dateStr) return null
  const noonUtc = new Date(dateStr + 'T12:00:00Z')
  const fmt = new Intl.DateTimeFormat('en-US', {
    timeZone: PACIFIC_TZ,
    hour: 'numeric',
    hour12: false,
  })
  const pacificHourAtNoonUtc = parseInt(fmt.format(noonUtc), 10)
  const offsetHours = 12 - pacificHourAtNoonUtc
  const baseMs = endOfDay
    ? new Date(dateStr + 'T23:59:59.999Z').getTime()
    : new Date(dateStr + 'T00:00:00.000Z').getTime()
  return new Date(baseMs + offsetHours * 3600000).toISOString()
}

function parseStatuses(raw) {
  if (!raw) return DEFAULT_STATUSES
  return String(raw).split(',').map((s) => s.trim()).filter(Boolean)
}

// Resolve which clubNumbers the request is allowed to scan.
// Returns: array of clubNumbers, or null meaning "no club filter (all)".
async function authorizeAndResolveClubs(req, location_slug) {
  const allLocations = canSeeAllLocations(req.staff.role)

  if (!allLocations) {
    if (!location_slug || location_slug === 'all') {
      const err = new Error('Specify a location_slug; you do not have access to all locations.')
      err.status = 403
      throw err
    }
    const allowedIds = req.staff.report_location_ids || []
    let allowedSlugs = []
    if (allowedIds.length > 0) {
      const { data: allowedLocs } = await supabaseAdmin
        .from('locations')
        .select('name')
        .in('id', allowedIds)
      allowedSlugs = (allowedLocs || []).map((l) => locSlugFromName(l.name))
    }
    if (!allowedSlugs.includes(location_slug)) {
      const err = new Error('Not authorized to view this location')
      err.status = 403
      throw err
    }
  }

  if (location_slug && location_slug !== 'all' && !SLUG_CLUB_MAP[location_slug]) {
    const err = new Error(`Unknown location_slug: ${location_slug}`)
    err.status = 400
    throw err
  }

  if (!location_slug || location_slug === 'all') return null
  return [SLUG_CLUB_MAP[location_slug]]
}

// GET /reports/pt-sessions
router.get('/', async (req, res) => {
  try {
    const { start_date, end_date, location_slug } = req.query
    if (!start_date || !end_date) {
      return res.status(400).json({ error: 'start_date and end_date are required (YYYY-MM-DD)' })
    }
    const statuses = parseStatuses(req.query.status)
    const clubs = await authorizeAndResolveClubs(req, location_slug)

    const startUtcIso = pacificDayBoundsToUtc(start_date, false)
    const endUtcIso = pacificDayBoundsToUtc(end_date, true)

    let q = supabaseAdmin
      .from('abc_calendar_events')
      .select('employee_id, employee_first_name, employee_last_name, event_name, status')
      .gte('event_timestamp', startUtcIso)
      .lte('event_timestamp', endUtcIso)
      .in('status', statuses)
    if (clubs) q = q.in('club_number', clubs)

    const rows = []
    let from = 0
    while (true) {
      const { data, error } = await q.range(from, from + 999)
      if (error) throw new Error(error.message)
      if (!data || data.length === 0) break
      rows.push(...data)
      if (data.length < 1000) break
      from += 1000
    }

    const trainers = new Map()
    let totalCompleted = 0
    let totalCanceled = 0
    const eventTypeTotals = new Map()

    for (const row of rows) {
      const tid = row.employee_id || 'unassigned'
      const tname = `${row.employee_first_name || ''} ${row.employee_last_name || ''}`.trim() || 'Unbooked'
      const ev = row.event_name || 'Unknown'
      const st = row.status

      let t = trainers.get(tid)
      if (!t) {
        t = {
          employee_id: tid,
          employee_name: tname,
          total: 0,
          completed: 0,
          canceled_charge: 0,
          by_event_type: {},
        }
        trainers.set(tid, t)
      }
      t.total += 1
      if (st === 'Completed') {
        t.completed += 1
        totalCompleted += 1
      } else if (st === 'Canceled-Charge') {
        t.canceled_charge += 1
        totalCanceled += 1
      }

      const cell = t.by_event_type[ev] || { completed: 0, canceled_charge: 0 }
      if (st === 'Completed') cell.completed += 1
      else if (st === 'Canceled-Charge') cell.canceled_charge += 1
      t.by_event_type[ev] = cell

      eventTypeTotals.set(ev, (eventTypeTotals.get(ev) || 0) + 1)
    }

    const trainersArr = [...trainers.values()].sort((a, b) => b.total - a.total)
    const eventTypes = [...eventTypeTotals.entries()].sort((a, b) => b[1] - a[1]).map(([k]) => k)

    const total = totalCompleted + totalCanceled
    res.json({
      summary: {
        total_sessions: total,
        completed: totalCompleted,
        canceled_charge: totalCanceled,
        attendance_rate: total > 0 ? totalCompleted / total : 0,
      },
      trainers: trainersArr,
      event_types: eventTypes,
    })
  } catch (err) {
    res.status(err.status || 500).json({ error: err.message })
  }
})

// GET /reports/pt-sessions/trainer/:employee_id
router.get('/trainer/:employee_id', async (req, res) => {
  try {
    const { start_date, end_date, location_slug } = req.query
    if (!start_date || !end_date) {
      return res.status(400).json({ error: 'start_date and end_date are required (YYYY-MM-DD)' })
    }
    const statuses = parseStatuses(req.query.status)
    const clubs = await authorizeAndResolveClubs(req, location_slug)

    const startUtcIso = pacificDayBoundsToUtc(start_date, false)
    const endUtcIso = pacificDayBoundsToUtc(end_date, true)

    let q = supabaseAdmin
      .from('abc_calendar_events')
      .select('event_id, event_timestamp, event_timestamp_local, event_name, status, duration_minutes, member_id, member_first_name, member_last_name, attended_status, location_name')
      .eq('employee_id', req.params.employee_id)
      .gte('event_timestamp', startUtcIso)
      .lte('event_timestamp', endUtcIso)
      .in('status', statuses)
      .order('event_timestamp', { ascending: false })
      .limit(2000)
    if (clubs) q = q.in('club_number', clubs)

    const { data, error } = await q
    if (error) throw new Error(error.message)

    const sessions = (data || []).map((r) => ({
      event_id: r.event_id,
      event_timestamp: r.event_timestamp,
      event_timestamp_local: r.event_timestamp_local,
      event_name: r.event_name,
      status: r.status,
      duration_minutes: r.duration_minutes,
      member_id: r.member_id,
      member_name: `${r.member_first_name || ''} ${r.member_last_name || ''}`.trim() || null,
      attended_status: r.attended_status,
      location_name: r.location_name,
    }))
    res.json({ sessions })
  } catch (err) {
    res.status(err.status || 500).json({ error: err.message })
  }
})

module.exports = router
