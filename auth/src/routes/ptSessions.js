const { Router } = require('express')
const { supabaseAdmin } = require('../services/supabase')
const authenticate = require('../middleware/auth')
const { requireRole, canSeeAllLocations } = require('../middleware/role')
const { wrapSWR } = require('../services/memoryCache')

// Phase 2 perf: cache the per-(range, location, status, group) payload across users.
const PT_SESSIONS_FRESH_MS = 2 * 60 * 1000
const PT_SESSIONS_STALE_MS = 15 * 60 * 1000

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

// Map raw ABC event names to a small set of canonical types. Raw event_name
// stays in abc_calendar_events; this function only runs at report time.
function normalizeEventType(name) {
  if (!name) return 'Other'
  const n = String(name).toLowerCase()

  // Specific overrides first — these win over the family rules below.
  if (n.includes('train with your trainer')) return 'MISC'
  if (/small\s*group|\bsgt\b/i.test(name)) return 'Small Group'
  if (n.includes('consult')) return 'Consult'

  // Stretch — split by duration if present, default to Stretch 60.
  if (n.includes('stretch')) {
    if (/\b30\b|30\s*min/i.test(name)) return 'Stretch 30'
    if (/\b60\b|60\s*min/i.test(name)) return 'Stretch 60'
    return 'Stretch 60'
  }

  // Swim
  if (n.includes('swim')) return 'Swim'

  // PT60 / PT30 family — match "PT 60MIN", "PT60", "PT60 NFW", "PT 60 NFW",
  // "PT 60min" (no word boundary after the digits). The negative lookahead
  // (?!\d) prevents matching "PT 600".
  if (/(^|\s|-)pt\s*-?\s*60(?!\d)/i.test(name)) return 'PT60'
  if (/(^|\s|-)pt\s*-?\s*30(?!\d)/i.test(name)) return 'PT30'

  // Partner — Partner Training defaults to Partner60; Partner with explicit
  // 30 in the name maps to Partner30.
  if (n.includes('partner')) {
    if (/\b30\b|30\s*min/i.test(name)) return 'Partner30'
    return 'Partner60'
  }

  // Floor-hour family
  if (/workshop|floor\s*hour|^admin\b|orientation|meeting|huddle/i.test(name)) return 'Floor Hour'

  // Anything unmatched is MISC (still visible under the PT filter).
  return 'MISC'
}

// Fixed column order for the pivot. Types not listed here fall to the end
// alphabetically.
const COLUMN_ORDER = [
  'PT60',
  'PT30',
  'Partner60',
  'Partner30',
  'Consult',
  'Floor Hour',
  'Stretch 30',
  'Stretch 60',
  'Swim',
  'Small Group',
  'MISC',
]

function orderEventTypes(types) {
  const present = new Set(types)
  const inOrder = COLUMN_ORDER.filter((t) => present.has(t))
  const extras = types.filter((t) => !COLUMN_ORDER.includes(t)).sort()
  return [...inOrder, ...extras]
}

// Event-group filter for the top filter bar.
//   - 'all'     -> no filter
//   - 'pt'      -> EXCLUDE Swim and Stretch (everything else stays)
//   - 'swim'    -> only Swim
//   - 'stretch' -> Stretch 30 + Stretch 60
const EVENT_GROUPS = {
  pt:      { mode: 'exclude', types: new Set(['Swim', 'Stretch 30', 'Stretch 60']) },
  swim:    { mode: 'include', types: new Set(['Swim']) },
  stretch: { mode: 'include', types: new Set(['Stretch 30', 'Stretch 60']) },
}

function passesEventGroup(group, normalizedType) {
  if (!group) return true
  if (group.mode === 'include') return group.types.has(normalizedType)
  if (group.mode === 'exclude') return !group.types.has(normalizedType)
  return true
}

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
    const eventGroup = String(req.query.event_group || 'all').toLowerCase()
    if (eventGroup !== 'all' && !EVENT_GROUPS[eventGroup]) {
      return res.status(400).json({ error: `Unknown event_group: ${eventGroup}. Valid: all, pt, swim, stretch.` })
    }
    const groupFilter = EVENT_GROUPS[eventGroup] || null
    // Run authorization BEFORE the cache lookup — throws 403 for unauthorized
    // callers, so they never reach a cached payload.
    const clubs = await authorizeAndResolveClubs(req, location_slug)

    const slugKey = !location_slug || location_slug === 'all' ? 'all' : location_slug
    const statusKey = [...statuses].sort().join(',')
    const cacheKey = `reports:pt-sessions:${start_date}:${end_date}:${slugKey}:${eventGroup}:${statusKey}`
    const payload = await wrapSWR(
      cacheKey,
      PT_SESSIONS_FRESH_MS,
      PT_SESSIONS_STALE_MS,
      async () => {
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
          const normalizedType = normalizeEventType(row.event_name)
          if (!passesEventGroup(groupFilter, normalizedType)) continue

          const tid = row.employee_id || 'unassigned'
          const tname = `${row.employee_first_name || ''} ${row.employee_last_name || ''}`.trim() || 'Unbooked'
          const ev = normalizedType
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
        const eventTypes = orderEventTypes([...eventTypeTotals.keys()])

        const total = totalCompleted + totalCanceled
        return {
          summary: {
            total_sessions: total,
            completed: totalCompleted,
            canceled_charge: totalCanceled,
            attendance_rate: total > 0 ? totalCompleted / total : 0,
          },
          trainers: trainersArr,
          event_types: eventTypes,
        }
      }
    )

    res.json(payload)
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
    const eventGroup = String(req.query.event_group || 'all').toLowerCase()
    if (eventGroup !== 'all' && !EVENT_GROUPS[eventGroup]) {
      return res.status(400).json({ error: `Unknown event_group: ${eventGroup}. Valid: all, pt, swim, stretch.` })
    }
    const groupFilter = EVENT_GROUPS[eventGroup] || null
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

    const sessions = (data || [])
      .map((r) => {
        const normalizedType = normalizeEventType(r.event_name)
        return {
          event_id: r.event_id,
          event_timestamp: r.event_timestamp,
          event_timestamp_local: r.event_timestamp_local,
          event_name: r.event_name,
          event_type: normalizedType,
          status: r.status,
          duration_minutes: r.duration_minutes,
          member_id: r.member_id,
          member_name: `${r.member_first_name || ''} ${r.member_last_name || ''}`.trim() || null,
          attended_status: r.attended_status,
          location_name: r.location_name,
        }
      })
      .filter((s) => passesEventGroup(groupFilter, s.event_type))
    res.json({ sessions })
  } catch (err) {
    res.status(err.status || 500).json({ error: err.message })
  }
})

module.exports = router
