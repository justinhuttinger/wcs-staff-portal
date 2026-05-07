const { Router } = require('express')
const { supabaseAdmin } = require('../services/supabase')
const authenticate = require('../middleware/auth')
const { requireRole } = require('../middleware/role')

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

// Format a UTC Date as YYYY-MM-DD / hour / day-of-week in Pacific time.
// We use Intl.DateTimeFormat parts so DST is handled correctly.
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
  // hour can be "24" at midnight in some locales — normalize
  const hour = parseInt(lookup.hour, 10) % 24
  return {
    date: `${lookup.year}-${lookup.month}-${lookup.day}`,
    hour,
    dow: DOW_NAMES.indexOf(lookup.weekday),
  }
}

function pacificDayBoundsToUtc(dateStr, endOfDay = false) {
  // Convert YYYY-MM-DD (Pacific) to a UTC ISO timestamp marking that
  // Pacific day's start (00:00) or end (23:59:59.999).
  // We compute the offset by formatting a noon-UTC anchor for that date.
  if (!dateStr) return null
  const noonUtc = new Date(dateStr + 'T12:00:00Z')
  const fmt = new Intl.DateTimeFormat('en-US', {
    timeZone: PACIFIC_TZ,
    hour: 'numeric',
    hour12: false,
  })
  const pacificHourAtNoonUtc = parseInt(fmt.format(noonUtc), 10)
  // If pacific hour at noon UTC is 5, offset is UTC-7 (PDT). If 4, UTC-8 (PST).
  const offsetHours = 12 - pacificHourAtNoonUtc
  const baseMs = endOfDay
    ? new Date(dateStr + 'T23:59:59.999Z').getTime()
    : new Date(dateStr + 'T00:00:00.000Z').getTime()
  return new Date(baseMs + offsetHours * 3600000).toISOString()
}

router.get('/', async (req, res) => {
  try {
    const { start_date, end_date, location_slug } = req.query

    if (!start_date || !end_date) {
      return res.status(400).json({ error: 'start_date and end_date are required (YYYY-MM-DD)' })
    }

    const startUtcIso = pacificDayBoundsToUtc(start_date, false)
    const endUtcIso = pacificDayBoundsToUtc(end_date, true)

    let q = supabaseAdmin
      .from('checkins_hourly')
      .select('club_number, hour_start, total_checkins, unique_members')
      .gte('hour_start', startUtcIso)
      .lte('hour_start', endUtcIso)

    if (location_slug && location_slug !== 'all') {
      const club = SLUG_CLUB_MAP[location_slug]
      if (!club) return res.status(400).json({ error: `Unknown location_slug: ${location_slug}` })
      q = q.eq('club_number', club)
    }

    // Paginate (1k page size, generous cap)
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

    // -- Aggregate ----------------------------------------------------------
    const byDate = new Map() // date -> total
    const byDow = Array(7).fill(0)
    const byHour = Array(24).fill(0)
    const heatmap = Array.from({ length: 7 }, () => Array(24).fill(0))
    const heatmapCounts = Array.from({ length: 7 }, () => Array(24).fill(0))
    const byLocation = new Map() // slug -> total
    let totalCheckins = 0
    let totalMemberRows = 0 // sum of unique_members per (club, hour) — *not* deduped across hours
    const distinctDates = new Set()

    for (const r of rows) {
      const d = new Date(r.hour_start)
      const { date, hour, dow } = toPacificParts(d)
      const n = r.total_checkins || 0

      totalCheckins += n
      totalMemberRows += r.unique_members || 0
      byDate.set(date, (byDate.get(date) || 0) + n)
      byDow[dow] += n
      byHour[hour] += n
      heatmap[dow][hour] += n
      heatmapCounts[dow][hour] += 1
      distinctDates.add(date)

      const slug = CLUB_SLUG_MAP[r.club_number]
      if (slug) byLocation.set(slug, (byLocation.get(slug) || 0) + n)
    }

    // Day series, padded for missing days in range
    const daySeries = []
    {
      const start = new Date(start_date + 'T00:00:00Z')
      const end = new Date(end_date + 'T00:00:00Z')
      const cur = new Date(start)
      while (cur <= end) {
        const d = cur.toISOString().slice(0, 10)
        daySeries.push({ date: d, count: byDate.get(d) || 0 })
        cur.setUTCDate(cur.getUTCDate() + 1)
      }
    }

    // Average check-ins per (dow, hour) cell — "avg per occurrence"
    const heatmapAvg = heatmap.map((row, i) =>
      row.map((sum, j) => (heatmapCounts[i][j] ? sum / heatmapCounts[i][j] : 0))
    )

    // Hour rankings (avg per hour-of-day across the range)
    const hourTotals = HOURS.map((h) => {
      const sum = byHour[h]
      // count of distinct dates that contributed at least one bucket at this hour
      let occ = 0
      for (let dow = 0; dow < 7; dow++) occ += heatmapCounts[dow][h]
      const avg = occ ? sum / occ : 0
      return { hour: h, total: sum, avg }
    })
    const hoursWithData = hourTotals.filter((x) => x.total > 0)
    const popularHours = [...hoursWithData].sort((a, b) => b.avg - a.avg).slice(0, 5)
    const unpopularHours = [...hoursWithData].sort((a, b) => a.avg - b.avg).slice(0, 5)

    // Day-of-week summary
    const dowTotals = DOW_NAMES.map((name, i) => ({ dow: name, total: byDow[i] }))
    const peakDay = [...daySeries].sort((a, b) => b.count - a.count)[0] || null
    const avgPerOpenDay = distinctDates.size
      ? Math.round(totalCheckins / distinctDates.size)
      : 0
    const peakHour = hoursWithData.length
      ? [...hoursWithData].sort((a, b) => b.avg - a.avg)[0]
      : null

    // By location (only meaningful when location_slug=all)
    const locationBreakdown = (!location_slug || location_slug === 'all')
      ? [...byLocation.entries()]
          .map(([slug, total]) => ({ slug, total }))
          .sort((a, b) => b.total - a.total)
      : []

    res.json({
      summary: {
        total_checkins: totalCheckins,
        total_member_rows: totalMemberRows,
        avg_per_open_day: avgPerOpenDay,
        peak_day: peakDay,           // { date, count } or null
        peak_hour: peakHour,         // { hour, total, avg } or null
        days_with_data: distinctDates.size,
      },
      by_date: daySeries,            // [{ date, count }]
      by_dow: dowTotals,             // [{ dow, total }]
      heatmap: heatmapAvg,           // 7x24 grid of avg-per-occurrence
      heatmap_totals: heatmap,       // 7x24 grid of raw totals
      popular_hours: popularHours,   // top 5 by avg
      unpopular_hours: unpopularHours, // bottom 5 by avg
      by_location: locationBreakdown, // [{ slug, total }]
      range: { start_date, end_date },
    })
  } catch (err) {
    console.error('[checkins-report] error:', err)
    res.status(500).json({ error: err.message })
  }
})

module.exports = router
