const { Router } = require('express')
const { supabaseAdmin } = require('../services/supabase')
const authenticate = require('../middleware/auth')
const { requireReportAccess, canSeeAllLocations } = require('../middleware/role')
const { parseLocationSlugParam, intersectWithAllowed } = require('../utils/locationSlug')

// PT Session Frequency report — per-member completed-session counts for the
// current month-to-date AND the prior calendar month, with per-week averages
// so the front desk can see who is keeping their training cadence vs falling
// off. Data lives in `abc_calendar_events` (synced from ABC Financial); we
// join `abc_members` for the display names.

const router = Router()
router.use(authenticate)
router.use(requireReportAccess('lead', ['session-frequency']))

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

function parseISODate(iso) {
  // YYYY-MM-DD → Date at noon UTC (avoids tz edge cases)
  return new Date(iso + 'T12:00:00Z')
}

function fmtISO(d) {
  const pad = n => String(n).padStart(2, '0')
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`
}

function daysInclusive(startIso, endIso) {
  const s = parseISODate(startIso)
  const e = parseISODate(endIso)
  return Math.round((e - s) / 86400000) + 1
}

function isFullCalendarMonth(startIso, endIso) {
  const s = parseISODate(startIso)
  const e = parseISODate(endIso)
  if (s.getUTCDate() !== 1) return false
  if (e.getUTCFullYear() !== s.getUTCFullYear()) return false
  if (e.getUTCMonth() !== s.getUTCMonth()) return false
  const lastDay = new Date(Date.UTC(s.getUTCFullYear(), s.getUTCMonth() + 1, 0)).getUTCDate()
  return e.getUTCDate() === lastDay
}

// Compute the comparison window for a given [start, end] range.
//
//   • Full calendar month (Apr 1 – Apr 30) → previous full calendar month
//     (Mar 1 – Mar 31). "last month vs the month before" mode.
//   • Month-to-date (May 1 – May 13, with May 13 before the last day of May)
//     → prior month, day 1 through the same day-of-month, capped at the prior
//     month's last day (handles Mar 31 → Feb 28). "month-to-date" mode.
//   • Otherwise → same-length window immediately abutting the start date.
//     Apr 5 – Apr 19 → Mar 21 – Apr 4.
function computeComparisonRange(startIso, endIso) {
  if (isFullCalendarMonth(startIso, endIso)) {
    const s = parseISODate(startIso)
    const prevMonth = new Date(Date.UTC(s.getUTCFullYear(), s.getUTCMonth() - 1, 1))
    const lastDay = new Date(Date.UTC(prevMonth.getUTCFullYear(), prevMonth.getUTCMonth() + 1, 0)).getUTCDate()
    const compStart = new Date(Date.UTC(prevMonth.getUTCFullYear(), prevMonth.getUTCMonth(), 1))
    const compEnd = new Date(Date.UTC(prevMonth.getUTCFullYear(), prevMonth.getUTCMonth(), lastDay))
    return { start: fmtISO(compStart), end: fmtISO(compEnd), days: lastDay, mode: 'calendar-month' }
  }
  const s = parseISODate(startIso)
  const e = parseISODate(endIso)
  if (
    s.getUTCDate() === 1 &&
    e.getUTCFullYear() === s.getUTCFullYear() &&
    e.getUTCMonth() === s.getUTCMonth()
  ) {
    const prevMonth = new Date(Date.UTC(s.getUTCFullYear(), s.getUTCMonth() - 1, 1))
    const prevMonthLastDay = new Date(Date.UTC(prevMonth.getUTCFullYear(), prevMonth.getUTCMonth() + 1, 0)).getUTCDate()
    const dayCap = Math.min(e.getUTCDate(), prevMonthLastDay)
    const compStart = new Date(Date.UTC(prevMonth.getUTCFullYear(), prevMonth.getUTCMonth(), 1))
    const compEnd = new Date(Date.UTC(prevMonth.getUTCFullYear(), prevMonth.getUTCMonth(), dayCap))
    return { start: fmtISO(compStart), end: fmtISO(compEnd), days: dayCap, mode: 'month-to-date' }
  }
  const days = daysInclusive(startIso, endIso)
  const compEnd = new Date(Date.UTC(s.getUTCFullYear(), s.getUTCMonth(), s.getUTCDate() - 1))
  const compStart = new Date(Date.UTC(compEnd.getUTCFullYear(), compEnd.getUTCMonth(), compEnd.getUTCDate() - days + 1))
  return { start: fmtISO(compStart), end: fmtISO(compEnd), days, mode: 'same-length' }
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
  const parsed = parseLocationSlugParam(location_slug)
  if (parsed.invalid) {
    const err = new Error(`Unknown location_slug: ${parsed.invalid}`)
    err.status = 400
    throw err
  }
  const allLocations = canSeeAllLocations(req.staff.role)
  if (!allLocations) {
    if (parsed.all) {
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
    const narrowed = intersectWithAllowed(parsed, allowedSlugs)
    if (narrowed.invalid) {
      const err = new Error(`Not authorized to view this location: ${narrowed.invalid}`)
      err.status = 403
      throw err
    }
  }
  if (parsed.all) return null
  return parsed.slugs.map(s => SLUG_CLUB_MAP[s])
}

// GET /reports/session-frequency?start_date=YYYY-MM-DD&end_date=YYYY-MM-DD
//   &location_slug=salem|all [&event_group=all|pt]
//
// The comparison window is computed automatically from [start_date, end_date]:
//   • full calendar month → previous calendar month
//   • otherwise          → same-length window immediately before start_date
router.get('/', async (req, res) => {
  try {
    const location_slug = req.query.location_slug
    const eventGroup = String(req.query.event_group || 'pt').toLowerCase()
    const clubs = await authorizeAndResolveClubs(req, location_slug)

    const { start_date, end_date } = req.query
    if (!start_date || !end_date) {
      return res.status(400).json({ error: 'start_date and end_date are required (YYYY-MM-DD)' })
    }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(start_date) || !/^\d{4}-\d{2}-\d{2}$/.test(end_date)) {
      return res.status(400).json({ error: 'Dates must be YYYY-MM-DD' })
    }
    if (start_date > end_date) {
      return res.status(400).json({ error: 'start_date must be on or before end_date' })
    }

    const currentStart = start_date
    const currentEnd = end_date
    const currentDays = daysInclusive(currentStart, currentEnd)
    const currentWeeks = currentDays / 7

    const prior = computeComparisonRange(currentStart, currentEnd)
    const priorWeeks = prior.days / 7

    const rangeStartIso = pacificDayBoundsToUtc(prior.start, false)
    const rangeEndIso = pacificDayBoundsToUtc(currentEnd, true)

    let q = supabaseAdmin
      .from('abc_calendar_events')
      .select('club_number, member_id, member_first_name, member_last_name, employee_first_name, employee_last_name, event_name, event_timestamp')
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
      const inPrior = pacificDate >= prior.start && pacificDate <= prior.end
      if (!inCurrent && !inPrior) continue
      const key = `${r.club_number}:${r.member_id}`
      let m = byMember.get(key)
      if (!m) {
        m = {
          club_number: r.club_number,
          member_id: r.member_id,
          memberName: null,
          currentSessions: 0,
          priorSessions: 0,
          latestTs: null,
          latestTrainer: null,
        }
        byMember.set(key, m)
      }
      if (inCurrent) m.currentSessions++
      if (inPrior) m.priorSessions++
      const trainer = `${r.employee_first_name || ''} ${r.employee_last_name || ''}`.trim()
      if (trainer && (!m.latestTs || r.event_timestamp > m.latestTs)) {
        m.latestTs = r.event_timestamp
        m.latestTrainer = trainer
      }
      // Capture the freshest non-empty member name we see on any event for this
      // (club, member). ABC events carry first/last directly; abc_members is
      // only a backup when the event row was synced before name fields were
      // populated.
      if (!m.memberName) {
        const evName = `${r.member_first_name || ''} ${r.member_last_name || ''}`.trim()
        if (evName) m.memberName = evName
      }
    }

    // For any member whose event rows didn't carry a name (older syncs may
    // have left those columns null), fall back to abc_members.
    const missingByClub = new Map()
    for (const m of byMember.values()) {
      if (!m.memberName) {
        if (!missingByClub.has(m.club_number)) missingByClub.set(m.club_number, new Set())
        missingByClub.get(m.club_number).add(m.member_id)
      }
    }
    const fallbackNameMap = new Map() // `${club}:${member_id}` -> name
    for (const [club, set] of missingByClub) {
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
          const name = `${mm.first_name || ''} ${mm.last_name || ''}`.trim()
          if (name) fallbackNameMap.set(`${club}:${mm.member_id}`, name)
        }
      }
    }

    const responseRows = []
    for (const m of byMember.values()) {
      const name = m.memberName || fallbackNameMap.get(`${m.club_number}:${m.member_id}`) || `Member ${m.member_id}`
      responseRows.push({
        clubNumber: m.club_number,
        clubName: CLUB_NAMES[m.club_number] || m.club_number,
        memberId: m.member_id,
        memberName: name,
        serviceEmployee: m.latestTrainer || '',
        currentSessions: m.currentSessions,
        priorSessions: m.priorSessions,
        currentPerWeek: currentWeeks > 0 ? m.currentSessions / currentWeeks : 0,
        priorPerWeek: priorWeeks > 0 ? m.priorSessions / priorWeeks : 0,
      })
    }

    responseRows.sort((a, b) => {
      if (b.currentSessions !== a.currentSessions) return b.currentSessions - a.currentSessions
      if (b.priorSessions !== a.priorSessions) return b.priorSessions - a.priorSessions
      return (a.memberName || '').localeCompare(b.memberName || '')
    })

    const currentTotal = responseRows.reduce((s, r) => s + r.currentSessions, 0)
    const priorTotal = responseRows.reduce((s, r) => s + r.priorSessions, 0)
    const activeCurrent = responseRows.filter(r => r.currentSessions > 0).length

    res.json({
      period: {
        current_start: currentStart,
        current_end: currentEnd,
        current_days: currentDays,
        current_weeks: currentWeeks,
        prior_start: prior.start,
        prior_end: prior.end,
        prior_days: prior.days,
        prior_weeks: priorWeeks,
        comparison_mode: prior.mode,
      },
      rows: responseRows,
      summary: {
        active_members_current: activeCurrent,
        current_total: currentTotal,
        prior_total: priorTotal,
        current_per_week_avg: currentWeeks > 0 ? currentTotal / currentWeeks : 0,
        prior_per_week_avg: priorWeeks > 0 ? priorTotal / priorWeeks : 0,
      },
    })
  } catch (err) {
    console.error('[Session Frequency] Error:', err.message)
    res.status(err.status || 500).json({ error: err.message })
  }
})

module.exports = router
