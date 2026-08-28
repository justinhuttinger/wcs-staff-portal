// Pure shaping for Analytics > Check-ins. No I/O; the route fetches.
//
// VOLUME AND SHAPE COME FROM DIFFERENT TABLES AND MUST NOT BE MIXED.
//
//   abc_member_checkin_months   volume. Trustworthy.
//   checkins_hourly             hour of day and weekday. Missing ~40% since May.
//
// The old Check-ins report drew everything from the hourly table and so
// reported check-ins DOWN 43% since January. They are UP: 77,080 in January
// against 86,230 in July. What it was actually plotting was its own ingestion
// failure, and the tell was that all six established clubs fell by the same 43%
// in the same quarter.
//
// Hour and weekday still come from the hourly feed because its SHAPE survived —
// April against August, the share of visits by hour drifts at most 1.8 points
// and under 0.5 almost everywhere. So those charts carry shares and never
// counts: enough to answer "when are we busy", not enough to answer "how busy".

const DOW_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']

// Below this, the hour-of-day and weekday charts stop being decoration on a
// known problem and start being a misleading picture in their own right.
const CAPTURE_WARN_PCT = 90

function num(v) {
  if (v === null || v === undefined) return 0
  const n = Number(v)
  return Number.isFinite(n) ? n : 0
}

function round(v, dp = 1) {
  const f = 10 ** dp
  return Math.round(v * f) / f
}

/** Visits per member who actually visited — never per member on file. */
function perMember(checkins, members) {
  if (!members) return null
  return round(checkins / members, 2)
}

function pctChange(now, before) {
  if (before === null || before === undefined || before === 0) return null
  return round(((now - before) / before) * 100, 1)
}

/**
 * @param monthly   analytics_checkins_monthly rows (month, slug, checkins, ...)
 * @param hours     analytics_checkins_by_hour rows
 * @param dow       analytics_checkins_by_dow rows
 * @param coverage  analytics_checkins_coverage rows
 * @param opts      { priorMonthly }
 */
function buildCheckins(monthly, hours, dow, coverage, opts = {}) {
  const rows = monthly || []

  // --- per club ------------------------------------------------------------
  const byClubMap = new Map()
  for (const r of rows) {
    const cur = byClubMap.get(r.slug) || { slug: r.slug, checkins: 0, membersVisiting: 0 }
    cur.checkins += num(r.checkins)
    // Members visiting is a DISTINCT count per month, so summing across months
    // would count a member who came in both months twice. The club figure takes
    // the busiest month rather than a sum that means nothing.
    cur.membersVisiting = Math.max(cur.membersVisiting, num(r.members_visiting))
    byClubMap.set(r.slug, cur)
  }
  const byClub = [...byClubMap.values()]
    .map(c => ({ ...c, visitsPerMember: perMember(c.checkins, c.membersVisiting) }))
    .sort((a, b) => b.checkins - a.checkins)

  // --- per month, for the trend -------------------------------------------
  const byMonthMap = new Map()
  for (const r of rows) {
    const key = String(r.month).slice(0, 10)
    const cur = byMonthMap.get(key) || { month: key, checkins: 0, membersVisiting: 0, clubs: {} }
    cur.checkins += num(r.checkins)
    cur.membersVisiting = Math.max(cur.membersVisiting, num(r.members_visiting))
    cur.clubs[r.slug] = num(r.checkins)
    byMonthMap.set(key, cur)
  }
  const months = [...byMonthMap.values()]
    .map(m => ({ ...m, visitsPerMember: perMember(m.checkins, m.membersVisiting) }))
    .sort((a, b) => a.month.localeCompare(b.month))

  const totalCheckins = byClub.reduce((a, c) => a + c.checkins, 0)
  const peakMembers = byClub.reduce((a, c) => a + c.membersVisiting, 0)

  const priorRows = opts.priorMonthly || null
  const priorTotal = priorRows
    ? priorRows.reduce((a, r) => a + num(r.checkins), 0)
    : null

  // --- shape ---------------------------------------------------------------
  const hourRows = (hours || []).map(h => ({
    hour: num(h.hour),
    share: num(h.share),
  }))
  const busiestHour = hourRows.reduce(
    (best, h) => (best === null || h.share > best.share ? h : best), null
  )

  const dowRows = (dow || []).map(d => ({
    dow: num(d.dow),
    label: DOW_NAMES[num(d.dow)] || String(d.dow),
    share: num(d.share),
  }))
  const busiestDay = dowRows.reduce(
    (best, d) => (best === null || d.share > best.share ? d : best), null
  )

  // --- how much of the hourly feed actually arrived ------------------------
  const cov = (coverage || [])
    .map(c => ({
      month: String(c.month).slice(0, 10),
      monthlyTotal: num(c.monthly_total),
      hourlyTotal: num(c.hourly_total),
      capture: c.capture === null || c.capture === undefined ? null : num(c.capture),
    }))
    .sort((a, b) => a.month.localeCompare(b.month))

  const latestCapture = cov.length ? cov[cov.length - 1].capture : null
  const shapeReliable = latestCapture === null || latestCapture >= CAPTURE_WARN_PCT

  return {
    summary: {
      checkins: totalCheckins,
      membersVisiting: peakMembers,
      visitsPerMember: perMember(totalCheckins, peakMembers),
      priorCheckins: priorTotal,
      checkinsChange: pctChange(totalCheckins, priorTotal),
      busiestHour: busiestHour ? busiestHour.hour : null,
      busiestDay: busiestDay ? busiestDay.label : null,
    },
    months,
    byClub,
    hours: hourRows,
    dow: dowRows,
    coverage: cov,
    shapeReliable,
    latestCapture,
    notes: {
      // Stated on the report whenever the feed is short, with the number, so a
      // reader can judge the charts rather than trust them.
      capture: shapeReliable ? null
        : `Timing charts are drawn from the hourly feed, which captured ${latestCapture}% of check-ins last month. ` +
          'Totals and trends come from a separate monthly source and are complete. ' +
          'Use the timing charts for when members come, not how many.',
    },
  }
}

module.exports = { buildCheckins, DOW_NAMES, CAPTURE_WARN_PCT, perMember }
