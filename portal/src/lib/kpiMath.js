// Pure, framework-free helpers for the KPIs report. No React, no fetch — kept
// separate so the math can be unit-tested with `node --test`.

// Percentage as a rounded integer. Returns null (not 0) when the denominator is
// missing or zero, so callers can render "n/a" instead of a misleading 0%.
export function pct(num, den) {
  if (!den || den <= 0) return null
  return Math.round((Number(num) || 0) / den * 100)
}

// Compares an actual value to a goal. Returns null if either is missing.
// opts.lowerIsBetter (default false) flips which side is "good".
// opts.unit (default '%') is appended to the gap text.
export function gapInfo(actual, goal, opts = {}) {
  const { lowerIsBetter = false, unit = '%' } = opts
  if (actual == null || goal == null || goal === '' || Number.isNaN(Number(goal))) {
    return null
  }
  const g = Number(goal)
  const diff = actual - g
  if (diff === 0) return { diff: 0, tone: 'above', text: 'Goal met' }
  if (!lowerIsBetter) {
    if (diff > 0) return { diff, tone: 'above', text: `+${diff}${unit} above goal` }
    return { diff, tone: 'below', text: `${diff}${unit} below goal` }
  }
  if (diff < 0) return { diff, tone: 'above', text: `${Math.abs(diff)}${unit} under goal` }
  return { diff, tone: 'below', text: `${diff}${unit} over goal` }
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

// Builds one bucket per calendar month overlapping [start, end], inclusive of
// both endpoints' months. start/end are LOCAL Date objects. Returns [] when
// start's month is after end's month. Each bucket: { key, label, start, end }.
// When the span crosses a calendar year, January labels include the year so
// months stay distinguishable on the axis.
export function monthRangesBetween(start, end) {
  const out = []
  const startsAfter =
    start.getFullYear() > end.getFullYear() ||
    (start.getFullYear() === end.getFullYear() && start.getMonth() > end.getMonth())
  if (startsAfter) return out
  const multiYear = start.getFullYear() !== end.getFullYear()
  let y = start.getFullYear()
  let m = start.getMonth()
  while (y < end.getFullYear() || (y === end.getFullYear() && m <= end.getMonth())) {
    const s = new Date(y, m, 1)
    const e = new Date(y, m + 1, 0)
    const short = s.toLocaleString('en-US', { month: 'short' })
    out.push({
      key: `${y}-${String(m + 1).padStart(2, '0')}`,
      label: multiYear && m === 0 ? `${short} '${String(y).slice(-2)}` : short,
      start: fmtLocal(s),
      end: fmtLocal(e),
    })
    m++
    if (m > 11) { m = 0; y++ }
  }
  return out
}

// Median of a numeric array. Returns null for empty input.
export function median(nums) {
  const xs = (nums || []).filter(n => n != null).slice().sort((a, b) => a - b)
  if (xs.length === 0) return null
  const mid = Math.floor(xs.length / 2)
  return xs.length % 2 ? xs[mid] : (xs[mid - 1] + xs[mid]) / 2
}

// Arithmetic mean of a numeric array (rounded). Returns null for empty input.
export function mean(nums) {
  const xs = (nums || []).filter(n => n != null)
  if (xs.length === 0) return null
  return Math.round(xs.reduce((a, b) => a + b, 0) / xs.length)
}

// Compact duration label for minute counts. null -> 'n/a'.
export function formatMinutes(min) {
  if (min == null) return 'n/a'
  const m = Math.round(min)
  if (m < 60) return `${m}m`
  return `${Math.floor(m / 60)}h ${m % 60}m`
}
