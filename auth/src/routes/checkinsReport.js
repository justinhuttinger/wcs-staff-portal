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
const CLUB_SLUG_MAP = Object.fromEntries(
  Object.entries(SLUG_CLUB_MAP).map(([slug, club]) => [club, slug])
)

const PACIFIC_TZ = 'America/Los_Angeles'
const HOURS = Array.from({ length: 24 }, (_, h) => h)
const DOW_NAMES = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']

const PACIFIC_FMT = new Intl.DateTimeFormat('en-US', {
  timeZone: PACIFIC_TZ,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  hour12: false,
  weekday: 'short',
})

function toPacificParts(utcDate) {
  const parts = PACIFIC_FMT.formatToParts(utcDate)
  const lookup = {}
  for (const p of parts) lookup[p.type] = p.value
  const hour = parseInt(lookup.hour, 10) % 24
  return {
    date: `${lookup.year}-${lookup.month}-${lookup.day}`,
    hour,
    dow: DOW_NAMES.indexOf(lookup.weekday),
  }
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

function locSlugFromName(name) {
  return (name || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '')
}

router.get('/', async (req, res) => {
  try {
    const { start_date, end_date, location_slug } = req.query

    if (!start_date || !end_date) {
      return res.status(400).json({ error: 'start_date and end_date are required (YYYY-MM-DD)' })
    }

    // ---------------------------------------------------------------------
    // Authorize location access
    //   - canSeeAllLocations roles (marketing/corporate/admin/director) may
    //     pass any slug or 'all'
    //   - everyone else MUST request a single location they're assigned to
    //     (intersected with can_view_reports !== false)
    // ---------------------------------------------------------------------
    const allLocations = canSeeAllLocations(req.staff.role)

    if (!allLocations) {
      if (!location_slug || location_slug === 'all') {
        return res.status(403).json({
          error: 'Specify a location_slug; you do not have access to all locations.',
        })
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
        return res.status(403).json({ error: 'Not authorized to view this location' })
      }
    }

    if (location_slug && location_slug !== 'all' && !SLUG_CLUB_MAP[location_slug]) {
      return res.status(400).json({ error: `Unknown location_slug: ${location_slug}` })
    }

    // ---------------------------------------------------------------------
    // Fetch
    // ---------------------------------------------------------------------
    const startUtcIso = pacificDayBoundsToUtc(start_date, false)
    const endUtcIso = pacificDayBoundsToUtc(end_date, true)

    let q = supabaseAdmin
      .from('checkins_hourly')
      .select('club_number, hour_start, total_checkins, unique_members')
      .gte('hour_start', startUtcIso)
      .lte('hour_start', endUtcIso)

    if (location_slug && location_slug !== 'all') {
      q = q.eq('club_number', SLUG_CLUB_MAP[location_slug])
    }

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

    // ---------------------------------------------------------------------
    // Aggregate
    // ---------------------------------------------------------------------
    const byDateCheckins = new Map()
    const byDateMembers = new Map()
    const byDow = Array(7).fill(0)
    const byHour = Array(24).fill(0)
    const heatmap = Array.from({ length: 7 }, () => Array(24).fill(0))
    const heatmapCounts = Array.from({ length: 7 }, () => Array(24).fill(0))
    const byLocation = new Map()
    let totalCheckins = 0
    let totalMemberHours = 0 // sum of unique_members across buckets ("member-hours of presence")
    const distinctDates = new Set()
    let bucketsWithData = 0

    for (const r of rows) {
      const d = new Date(r.hour_start)
      const { date, hour, dow } = toPacificParts(d)
      const n = r.total_checkins || 0
      const m = r.unique_members || 0

      totalCheckins += n
      totalMemberHours += m
      byDateCheckins.set(date, (byDateCheckins.get(date) || 0) + n)
      byDateMembers.set(date, (byDateMembers.get(date) || 0) + m)
      byDow[dow] += n
      byHour[hour] += n
      heatmap[dow][hour] += n
      heatmapCounts[dow][hour] += 1
      if (n > 0 || m > 0) {
        distinctDates.add(date)
        bucketsWithData += 1
      }

      const slug = CLUB_SLUG_MAP[r.club_number]
      if (slug) byLocation.set(slug, (byLocation.get(slug) || 0) + n)
    }

    // Day series
    const daySeries = []
    {
      const start = new Date(start_date + 'T00:00:00Z')
      const end = new Date(end_date + 'T00:00:00Z')
      const cur = new Date(start)
      while (cur <= end) {
        const d = cur.toISOString().slice(0, 10)
        daySeries.push({
          date: d,
          count: byDateCheckins.get(d) || 0,
          members: byDateMembers.get(d) || 0,
        })
        cur.setUTCDate(cur.getUTCDate() + 1)
      }
    }

    const heatmapAvg = heatmap.map((row, i) =>
      row.map((sum, j) => (heatmapCounts[i][j] ? sum / heatmapCounts[i][j] : 0))
    )

    const hourTotals = HOURS.map((h) => {
      const sum = byHour[h]
      let occ = 0
      for (let dow = 0; dow < 7; dow++) occ += heatmapCounts[dow][h]
      const avg = occ ? sum / occ : 0
      return { hour: h, total: sum, avg }
    })
    const hoursWithData = hourTotals.filter((x) => x.total > 0)
    const popularHours = [...hoursWithData].sort((a, b) => b.avg - a.avg).slice(0, 5)
    const unpopularHours = [...hoursWithData].sort((a, b) => a.avg - b.avg).slice(0, 5)

    const dowTotals = DOW_NAMES.map((name, i) => ({ dow: name, total: byDow[i] }))
    const peakDay = [...daySeries].sort((a, b) => b.count - a.count)[0] || null
    const avgPerOpenDay = distinctDates.size
      ? Math.round(totalCheckins / distinctDates.size)
      : 0
    const peakHour = hoursWithData.length
      ? [...hoursWithData].sort((a, b) => b.avg - a.avg)[0]
      : null

    const avgMembersPerActiveHour = bucketsWithData
      ? +(totalMemberHours / bucketsWithData).toFixed(1)
      : 0
    const visitsPerMemberHour = totalMemberHours
      ? +(totalCheckins / totalMemberHours).toFixed(2)
      : 0

    const locationBreakdown =
      !location_slug || location_slug === 'all'
        ? [...byLocation.entries()]
            .map(([slug, total]) => ({ slug, total }))
            .sort((a, b) => b.total - a.total)
        : []

    res.json({
      summary: {
        total_checkins: totalCheckins,
        member_hours: totalMemberHours,
        avg_per_open_day: avgPerOpenDay,
        avg_members_per_active_hour: avgMembersPerActiveHour,
        visits_per_member_hour: visitsPerMemberHour,
        peak_day: peakDay,
        peak_hour: peakHour,
        days_with_data: distinctDates.size,
      },
      by_date: daySeries,
      by_dow: dowTotals,
      heatmap: heatmapAvg,
      heatmap_totals: heatmap,
      popular_hours: popularHours,
      unpopular_hours: unpopularHours,
      by_location: locationBreakdown,
      range: { start_date, end_date },
    })
  } catch (err) {
    console.error('[checkins-report] error:', err)
    res.status(500).json({ error: err.message })
  }
})

module.exports = router
