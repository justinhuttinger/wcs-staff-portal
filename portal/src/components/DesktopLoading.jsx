// The desktop loading state: EMPTY SPACE WHERE THE DATA WILL BE, with the WCS
// mark filling and draining in the middle of it.
//
// It used to be a shimmering skeleton per variant — fake stat cards, fake bars,
// a fake pie. Those were replaced deliberately. A skeleton is a drawing of
// content that does not exist yet, and on a report whose real shape depends on
// the data (how many clubs, how many trainers, whether a panel renders at all)
// the drawing was usually wrong, so the page jumped when the real thing landed.
// Reserved blank space plus one honest "working on it" mark does not lie about
// what is coming and does not move when it arrives.
//
// THE VARIANT API IS KEPT. Fifty call sites pass `variant` and some pass
// `count`, and they still mean something: they set how much room to hold open,
// so a stat strip does not reserve a full report's height and a long report does
// not collapse to a single line. Nothing at a call site had to change.
//
//   <DesktopLoading variant="report" />          // tall: stats + charts
//   <DesktopLoading variant="list" count={6} />  // grows with the row count
//   <DesktopLoading variant="stats" />           // one short strip
//   <DesktopLoading variant="appointments" />
//   <DesktopLoading variant="ranking" />
//   <DesktopLoading variant="card-grid" />

import WcsLoadingMark from './WcsLoadingMark'

/**
 * How much vertical room each variant holds open, in pixels.
 *
 * These are the rough real heights of what replaces them, so the mark sits
 * near where the reader is already looking and the page does not lurch when the
 * data arrives. Approximate on purpose — a per-report exact height would be a
 * second copy of the layout, which is the thing this change removed.
 */
const VARIANT_HEIGHTS = {
  stats: 180,
  ranking: 320,
  list: 320,
  appointments: 360,
  'card-grid': 360,
  report: 520,
}

// Where a `count` is given, each extra row past the variant's baseline adds
// this much, so a six-row list holds more open than a two-row one.
const ROW_HEIGHT = 56
const BASELINE_ROWS = 5

/**
 * The mark and its label, centred in whatever space it is given.
 *
 * `retrying` is surfaced rather than hidden. A request that silently retries for
 * two seconds looks identical to one that has hung, and someone told "still
 * trying" waits, where someone told nothing reloads the page.
 */
export function LoadingBrand({ label = 'Getting your report', retrying = false, size = 64 }) {
  return (
    <div className="flex flex-col items-center justify-center" role="status" aria-live="polite">
      <WcsLoadingMark size={size} className="text-wcs-red mb-3" />
      <p className="text-sm font-semibold text-text-primary">
        <span className="wcs-dots">{retrying ? 'Still working on it' : label}</span>
      </p>
      <p className="text-[11px] text-text-muted mt-0.5">
        {retrying ? 'The last attempt did not come back, trying again' : 'Pulling the numbers together'}
      </p>
    </div>
  )
}

export default function DesktopLoading({
  variant = 'list', count, className = '', branded = true, label, retrying = false,
}) {
  const base = VARIANT_HEIGHTS[variant] ?? VARIANT_HEIGHTS.list
  const extra = Number.isFinite(count) ? Math.max(0, count - BASELINE_ROWS) * ROW_HEIGHT : 0

  return (
    <div
      className={`flex items-center justify-center ${className}`}
      // minHeight, not height: a caller inside an already-short container must
      // not be forced taller than its own box allows.
      style={{ minHeight: base + extra }}
    >
      {/* branded={false} is the inline-widget case, where a logo would be too
          loud. The space is still held open — that is the whole point. */}
      {branded ? <LoadingBrand label={label} retrying={retrying} /> : (
        <WcsLoadingMark size={40} className="text-wcs-red" />
      )}
    </div>
  )
}
