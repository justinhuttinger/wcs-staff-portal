// Pure aggregation over group_x_class_attendance rows.
//
// Two rules that come from how WCS reads reports:
//  * A bucket with no logged sessions is omitted entirely. We never render a
//    row stating a class or instructor had nothing.
//  * fill_rate is null, not 0 and not a guess, when no row in the bucket knows
//    its capacity. A dash is honest; a fabricated percentage is not.
const WEEKDAY_LABELS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']

// Bucket edges are half-open [from, to) and cover the full 24 hours.
const TIME_BUCKETS = [
  { key: 'Early (before 5a)', from: 0, to: 5 },
  { key: 'Morning (5a-11a)', from: 5, to: 11 },
  { key: 'Midday (11a-4p)', from: 11, to: 16 },
  { key: 'Evening (4p-9p)', from: 16, to: 21 },
  { key: 'Late (9p+)', from: 21, to: 24 },
]

function round2(n) {
  return Math.round(n * 100) / 100
}

function hourOf(row) {
  return parseInt(String(row.event_timestamp_local || '').slice(11, 13), 10)
}

function bucketBy(rows, keyFn) {
  const groups = new Map()
  for (const row of rows) {
    const key = keyFn(row)
    if (key === null || key === undefined || key === '') continue
    if (!groups.has(key)) groups.set(key, [])
    groups.get(key).push(row)
  }

  return [...groups.entries()]
    .map(([key, rs]) => {
      const sessions = rs.length
      const total = rs.reduce((n, r) => n + (r.headcount || 0), 0)
      // Fill rate only counts sessions whose capacity we actually know, so a
      // few unknown-capacity sessions cannot drag the percentage down.
      const withCap = rs.filter(r => r.max_attendees > 0)
      const capacity = withCap.reduce((n, r) => n + r.max_attendees, 0)
      const attendedWithCap = withCap.reduce((n, r) => n + (r.headcount || 0), 0)
      return {
        key,
        sessions,
        total_attendees: total,
        avg_headcount: round2(total / sessions),
        fill_rate: capacity > 0 ? Math.round((attendedWithCap / capacity) * 10000) / 10000 : null,
        sessions_with_capacity: withCap.length,
      }
    })
    .sort((a, b) => b.avg_headcount - a.avg_headcount || a.key.localeCompare(b.key))
}

function aggregate(rows) {
  // A null headcount means "not logged", which is not a session. Guard for null
  // explicitly: Number(null) is 0, so a Number.isFinite check alone would count
  // an unlogged class as a real session with nobody in it.
  const list = (rows || []).filter(
    r => r && r.headcount !== null && r.headcount !== undefined && Number.isFinite(Number(r.headcount)),
  )
  const sessions = list.length
  const total = list.reduce((n, r) => n + (r.headcount || 0), 0)

  return {
    by_class: bucketBy(list, r => r.class_name),
    by_instructor: bucketBy(list, r => r.instructor_name),
    by_weekday: bucketBy(list, r => {
      const d = String(r.event_timestamp_local || '').slice(0, 10)
      if (!/^\d{4}-\d{2}-\d{2}$/.test(d)) return null
      return WEEKDAY_LABELS[new Date(d + 'T00:00:00Z').getUTCDay()]
    }),
    by_time_bucket: bucketBy(list, r => {
      const h = hourOf(r)
      if (!Number.isInteger(h)) return null
      return (TIME_BUCKETS.find(b => h >= b.from && h < b.to) || {}).key || null
    }),
    totals: {
      sessions,
      total_attendees: total,
      avg_headcount: sessions ? round2(total / sessions) : 0,
    },
  }
}

module.exports = { aggregate, bucketBy, TIME_BUCKETS, WEEKDAY_LABELS }
