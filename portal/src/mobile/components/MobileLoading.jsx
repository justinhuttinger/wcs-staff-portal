import WcsLoadingMark from '../../components/WcsLoadingMark'

// The mobile loading state: EMPTY SPACE WHERE THE DATA WILL BE, with the WCS
// mark filling and draining in the middle of it.
//
// This file used to be eight hand-drawn skeletons — fake stat cards, a fake pie,
// fake list rows. They are gone on purpose. A skeleton is a drawing of content
// that does not exist yet, and mobile is where it went most wrong: a phone shows
// three cards where the skeleton drew four, so the page jumped on every load.
// Reserved blank space and one honest mark does not lie about what is coming and
// does not move when it arrives.
//
// It also brings mobile in line with desktop, which shows the same mark. The two
// surfaces looked like different products while one shimmered and the other did
// not.
//
// THE VARIANT API IS KEPT — 26 call sites pass it — but a variant now sets how
// much room to hold open rather than what to draw:
//
//   <MobileLoading variant="report" />          // tall: stats + charts
//   <MobileLoading variant="list" count={6} />  // grows with the row count
//   <MobileLoading variant="stats" />
//   <MobileLoading variant="appointments" />
//   <MobileLoading variant="ranking" />
//   <MobileLoading variant="comm-notes" />
//   <MobileLoading variant="hr-workers" />
//   <MobileLoading variant="hr-docs" />

// Shorter than the desktop equivalents: a phone viewport is ~700px tall, and
// holding 520px open for a report would push the mark off screen behind the
// header. These are sized to sit in view without scrolling.
const VARIANT_HEIGHTS = {
  stats: 200,
  'hr-docs': 240,
  ranking: 280,
  list: 280,
  'hr-workers': 300,
  appointments: 300,
  'comm-notes': 300,
  report: 380,
}

const ROW_HEIGHT = 48
const BASELINE_ROWS = 4

export default function MobileLoading({
  variant = 'list', count, className = '', label = 'Loading',
}) {
  const base = VARIANT_HEIGHTS[variant] ?? VARIANT_HEIGHTS.list
  const extra = Number.isFinite(count) ? Math.max(0, count - BASELINE_ROWS) * ROW_HEIGHT : 0

  return (
    <div
      className={`flex flex-col items-center justify-center p-4 ${className}`}
      style={{ minHeight: base + extra }}
      role="status"
      aria-live="polite"
    >
      {/* 56 rather than the desktop 64: the same optical weight against a
          narrower column. currentColor follows the theme. */}
      <WcsLoadingMark size={56} className="text-wcs-red mb-3" />
      <p className="text-sm font-semibold text-text-primary">
        <span className="wcs-dots">{label}</span>
      </p>
    </div>
  )
}
