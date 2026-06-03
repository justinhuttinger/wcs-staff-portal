// Pure, framework-free helpers for the KPIs report. No React, no fetch — kept
// separate so the math can be unit-tested with `node --test`.

// Percentage as a rounded integer. Returns null (not 0) when the denominator is
// missing or zero, so callers can render "n/a" instead of a misleading 0%.
export function pct(num, den) {
  if (!den || den <= 0) return null
  return Math.round((Number(num) || 0) / den * 100)
}

// Compares an actual percentage to a goal. Returns null if either is missing.
// diff is actual - goal. tone is 'above' when actual >= goal, else 'below'.
export function gapInfo(actual, goal) {
  if (actual == null || goal == null || goal === '' || Number.isNaN(Number(goal))) {
    return null
  }
  const g = Number(goal)
  const diff = actual - g
  if (diff === 0) return { diff: 0, tone: 'above', text: 'Goal met' }
  if (diff > 0) return { diff, tone: 'above', text: `+${diff}% above goal` }
  return { diff, tone: 'below', text: `${diff}% below goal` }
}

// Looks at the last two non-null points and reports whether the metric is
// getting closer to ('toward') or further from ('away') the goal, or 'flat'.
// Returns null when there aren't two real points or no goal is set.
export function trendDirection(points, goal) {
  if (goal == null || goal === '' || Number.isNaN(Number(goal))) return null
  const real = (points || []).filter(p => p && p.value != null)
  if (real.length < 2) return null
  const g = Number(goal)
  const prev = Math.abs(real[real.length - 2].value - g)
  const cur = Math.abs(real[real.length - 1].value - g)
  if (cur < prev) return 'toward'
  if (cur > prev) return 'away'
  return 'flat'
}

function fmtLocal(d) {
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

// Builds `count` month buckets ending with the month of `refDate` (inclusive).
// Dates are LOCAL (not UTC) to match the rest of the app's Pacific date
// handling. Each bucket: { key, label, start, end } with YYYY-MM-DD strings.
export function monthRanges(refDate, count) {
  const out = []
  for (let i = count - 1; i >= 0; i--) {
    const start = new Date(refDate.getFullYear(), refDate.getMonth() - i, 1)
    const end = new Date(refDate.getFullYear(), refDate.getMonth() - i + 1, 0)
    out.push({
      key: `${start.getFullYear()}-${String(start.getMonth() + 1).padStart(2, '0')}`,
      label: start.toLocaleString('en-US', { month: 'short' }),
      start: fmtLocal(start),
      end: fmtLocal(end),
    })
  }
  return out
}
