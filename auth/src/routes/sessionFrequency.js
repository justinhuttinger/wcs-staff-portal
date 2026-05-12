const { Router } = require('express')
const { supabaseAdmin } = require('../services/supabase')
const authenticate = require('../middleware/auth')
const { requireRole, canSeeAllLocations } = require('../middleware/role')

// PT Session Frequency report — per-member completed-session counts for the
// current month-to-date AND the prior calendar month, with per-week averages
// so the front desk can see who is keeping their training cadence vs falling
// off. Data lives in `abc_calendar_events` (synced from ABC Financial); we
// join `abc_members` for the display names.

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
const CLUB_NAMES = {
  '30935': 'Salem',
  '31599': 'Keizer',
  '7655': 'Eugene',
  '31598': 'Springfield',
  '31600': 'Clackamas',
  '31601': 'Milwaukie',
  '32073': 'Medford',
}
const PACIFIC_TZ = 'America/Los_Angeles'

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

function locSlugFromName(name) {
  return (name || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '')
}

function pacificTodayISO() {
  const now = new Date()
  const fmt = new Intl.DateTimeFormat('en-CA', {
    timeZone: PACIFIC_TZ,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  })
  return fmt.format(now) // YYYY-MM-DD
}

function startOfMonth(iso) {
  const [y, m] = iso.split('-')
  return `${y}-${m}-01`
}

function lastMonthRange(iso) {
  const [yStr, mStr] = iso.split('-')
  const y = parseInt(yStr, 10)
  const m = parseInt(mStr, 10)
  const lmY = m === 1 ? y - 1 : y
  const lmM = m === 1 ? 12 : m - 1
  // Days in the last month: Date(year, month, 0) where month is 1-based gives
  // the last day of (month-1), so passing lmM here lands on the last day of
  // lmM itself (using UTC to dodge tz drift).
  const days = new Date(Date.UTC(lmY, lmM, 0)).getUTCDate()
  const pad = n => String(n).padStart(2, '0')
  return {
    start: `${lmY}-${pad(lmM)}-01`,
    end: `${lmY}-${pad(lmM)}-${pad(days)}`,
    days,
  }
}

// Default filter: PT-style events only. Skips Swim, Stretch, and floor-hour /
// admin / orientation entries. The user can pass `event_group=all` to disable.
function isPTEvent(name) {
  if (!name) return false
  const n = String(name).toLowerCase()
  if (n.includes('swim')) return false
  if (n.includes('stretch')) return false
  if (/workshop|floor\s*hour|^admin\b|orientation|meeting|huddle/i.test(name)) return false
  return true
}

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
      allowedSlugs = (allowedLocs || []).map(l => locSlugFromName(l.name))
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

// GET /reports/session-frequency?location_slug=salem|all[&event_group=all|pt]
router.get('/', async (req, res) => {
  try {
    const location_slug = req.query.location_slug
    const eventGroup = String(req.query.event_group || 'pt').toLowerCase()
    const clubs = await authorizeAndResolveClubs(req, location_slug)

    const today = pacificTodayISO()
    const currentStart = startOfMonth(today)
    const currentEnd = today
    const lastMonth = lastMonthRange(today)

    const currentDayOfMonth = parseInt(today.slice(-2), 10)
    const currentWeeks = currentDayOfMonth / 7
    const lastMonthWeeks = lastMonth.days / 7

    const rangeStartIso = pacificDayBoundsToUtc(lastMonth.start, false)
    const rangeEndIso = pacificDayBoundsToUtc(currentEnd, true)

    let q = supabaseAdmin
      .from('abc_calendar_events')
      .select('club_number, member_id, employee_first_name, employee_last_name, event_name, event_timestamp')
      .gte('event_timestamp', rangeStartIso)
      .lte('event_timestamp', rangeEndIso)
      .eq('status', 'Completed')
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

    // Bucket each event into the current MTD window or the last-month window.
    // Pacific date is derived from the same noon-UTC trick as the day bounds
    // helper above so all comparisons stay timezone-consistent.
    const fmt = new Intl.DateTimeFormat('en-CA', {
      timeZone: PACIFIC_TZ,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    })

    const byMember = new Map()
    for (const r of rows) {
      if (!r.member_id) continue
      if (eventGroup === 'pt' && !isPTEvent(r.event_name)) continue
      const pacificDate = fmt.format(new Date(r.event_timestamp))
      const inCurrent = pacificDate >= currentStart && pacificDate <= currentEnd
      const inLast = pacificDate >= lastMonth.start && pacificDate <= lastMonth.end
      if (!inCurrent && !inLast) continue
      const key = `${r.club_number}:${r.member_id}`
      let m = byMember.get(key)
      if (!m) {
        m = {
          club_number: r.club_number,
          member_id: r.member_id,
          currentSessions: 0,
          lastMonthSessions: 0,
          latestTs: null,
          latestTrainer: null,
        }
        byMember.set(key, m)
      }
      if (inCurrent) m.currentSessions++
      if (inLast) m.lastMonthSessions++
      const trainer = `${r.employee_first_name || ''} ${r.employee_last_name || ''}`.trim()
      if (trainer && (!m.latestTs || r.event_timestamp > m.latestTs)) {
        m.latestTs = r.event_timestamp
        m.latestTrainer = trainer
      }
    }

    // Pull display names from abc_members in chunks of 500. The table is keyed
    // by (club_number, member_id) so we group requests by club.
    const byClubMembers = new Map() // club_number -> Set<member_id>
    for (const m of byMember.values()) {
      if (!byClubMembers.has(m.club_number)) byClubMembers.set(m.club_number, new Set())
      byClubMembers.get(m.club_number).add(m.member_id)
    }
    const nameMap = new Map() // key: `${club_number}:${member_id}` -> name
    for (const [club, set] of byClubMembers) {
      const ids = [...set]
      for (let i = 0; i < ids.length; i += 500) {
        const chunk = ids.slice(i, i + 500)
        const { data: members, error } = await supabaseAdmin
          .from('abc_members')
          .select('member_id, first_name, last_name')
          .eq('club_number', club)
          .in('member_id', chunk)
        if (error) throw new Error(error.message)
        for (const mm of (members || [])) {
          const name = `${mm.first_name || ''} ${mm.last_name || ''}`.trim() || mm.member_id
          nameMap.set(`${club}:${mm.member_id}`, name)
        }
      }
    }

    const responseRows = []
    for (const m of byMember.values()) {
      responseRows.push({
        clubNumber: m.club_number,
        clubName: CLUB_NAMES[m.club_number] || m.club_number,
        memberId: m.member_id,
        memberName: nameMap.get(`${m.club_number}:${m.member_id}`) || m.member_id,
        serviceEmployee: m.latestTrainer || '',
        currentSessions: m.currentSessions,
        lastMonthSessions: m.lastMonthSessions,
        currentPerWeek: currentWeeks > 0 ? m.currentSessions / currentWeeks : 0,
        lastMonthPerWeek: lastMonthWeeks > 0 ? m.lastMonthSessions / lastMonthWeeks : 0,
      })
    }

    responseRows.sort((a, b) => {
      if (b.currentSessions !== a.currentSessions) return b.currentSessions - a.currentSessions
      if (b.lastMonthSessions !== a.lastMonthSessions) return b.lastMonthSessions - a.lastMonthSessions
      return (a.memberName || '').localeCompare(b.memberName || '')
    })

    const currentTotal = responseRows.reduce((s, r) => s + r.currentSessions, 0)
    const lastMonthTotal = responseRows.reduce((s, r) => s + r.lastMonthSessions, 0)
    const activeCurrent = responseRows.filter(r => r.currentSessions > 0).length

    res.json({
      period: {
        current_start: currentStart,
        current_end: currentEnd,
        current_weeks: currentWeeks,
        last_month_start: lastMonth.start,
        last_month_end: lastMonth.end,
        last_month_weeks: lastMonthWeeks,
      },
      rows: responseRows,
      summary: {
        active_members_current: activeCurrent,
        current_total: currentTotal,
        last_month_total: lastMonthTotal,
        current_per_week_avg: currentWeeks > 0 ? currentTotal / currentWeeks : 0,
        last_month_per_week_avg: lastMonthWeeks > 0 ? lastMonthTotal / lastMonthWeeks : 0,
      },
    })
  } catch (err) {
    console.error('[Session Frequency] Error:', err.message)
    res.status(err.status || 500).json({ error: err.message })
  }
})

module.exports = router
