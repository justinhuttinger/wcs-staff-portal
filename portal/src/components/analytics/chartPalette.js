// The categorical palette for the Analytics charts.
//
// Lifted verbatim from Membership Mix, which validated it, so the reports agree
// on what a colour means instead of each inventing a set. Eight hues, assigned
// in FIXED ORDER and never cycled: the same position is the same hue in every
// chart, so a reader who learns the legend once keeps it.
//
// A ninth series is never a generated hue — the libs fold the tail into
// "Other", which has its own grey. Unknown has a second, lighter grey: "we
// don't know" is not a peer of the real values and must not look like one.
//
// Three of the eight sit below 3:1 against white, so the relief rule applies
// wherever they are used: print the value, and keep a table view within reach.
// Identity is never carried by colour alone.

export const PALETTE = ['#2a78d6', '#eb6834', '#1baf7a', '#eda100', '#e87ba4', '#008300', '#4a3aa7', '#e34948']
export const OTHER_COLOR = '#8a8f98'
export const UNKNOWN_COLOR = '#c2c6cc'

/**
 * Colour for a series.
 *
 * The index is the series' position in a STABLE ordering (size across the whole
 * window, computed server-side), not its rank within the month being drawn. A
 * colour that followed per-month rank would repaint the chart as the data moved
 * and make two frames of the same series incomparable.
 */
export function colorFor(name, index) {
  if (name === 'Unknown') return UNKNOWN_COLOR
  if (name === 'Other') return OTHER_COLOR
  return PALETTE[index % PALETTE.length]
}

/** Positive / negative pair for diverging measures such as net change. */
export const GOOD_COLOR = '#008300'
export const BAD_COLOR = '#e34948'

export const fmtInt = (n) =>
  (n === null || n === undefined ? 'N/A' : Math.round(Number(n)).toLocaleString())

export const fmtSigned = (n) =>
  (n === null || n === undefined ? 'N/A' : `${Number(n) > 0 ? '+' : ''}${Math.round(Number(n)).toLocaleString()}`)

export const fmtPct = (n) =>
  (n === null || n === undefined ? 'N/A' : `${Number(n).toFixed(1)}%`)

export const fmtSignedPct = (n) =>
  (n === null || n === undefined ? 'N/A' : `${Number(n) > 0 ? '+' : ''}${Number(n).toFixed(1)}%`)

/** Compact money, because these axes carry millions and a full figure is unreadable. */
export function fmtMoney(n, { compact = false } = {}) {
  if (n === null || n === undefined) return 'N/A'
  const v = Number(n)
  if (!Number.isFinite(v)) return 'N/A'
  if (!compact) return `$${Math.round(v).toLocaleString()}`
  const abs = Math.abs(v)
  const sign = v < 0 ? '-' : ''
  if (abs >= 1_000_000) return `${sign}$${(abs / 1_000_000).toFixed(abs >= 10_000_000 ? 0 : 1)}M`
  if (abs >= 1_000) return `${sign}$${(abs / 1_000).toFixed(abs >= 10_000 ? 0 : 1)}K`
  return `${sign}$${Math.round(abs)}`
}

/** "2026-07-01" -> "Jul '26". Parsed by hand: new Date() on a bare date is UTC
 *  midnight, which reports the previous month west of Greenwich. */
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
export function fmtMonth(iso) {
  const m = /^(\d{4})-(\d{2})/.exec(String(iso || ''))
  if (!m) return ''
  return `${MONTHS[Number(m[2]) - 1]} '${m[1].slice(2)}`
}
export function fmtDay(iso) {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(iso || ''))
  if (!m) return ''
  return `${MONTHS[Number(m[2]) - 1]} ${Number(m[3])}`
}
export function fmtYear(iso) {
  const m = /^(\d{4})/.exec(String(iso || ''))
  return m ? m[1] : ''
}
