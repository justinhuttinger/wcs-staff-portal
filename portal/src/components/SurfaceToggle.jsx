// Reports ⇄ Analytics.
//
// Analytics used to be its own tile on the board, which put two reporting
// destinations on the home screen and left a reader to guess which one held the
// report they wanted. It is now reached from inside Reporting, and this is the
// control that moves between them — the same component on both sides, so the
// two halves cannot drift into looking like different things.
//
// It renders NOTHING when there is nowhere to go. Below corporate there is no
// Analytics to offer, and a dead half of a toggle is worse than no toggle:
// it advertises a surface and then refuses it.

export default function SurfaceToggle({ active, onReports, onAnalytics }) {
  // Gated on where you would be GOING. With nowhere to go the control is not
  // rendered at all.
  const other = active === 'reports' ? onAnalytics : onReports
  if (!other) return null

  const Half = ({ side, label, onClick }) => {
    const on = active === side
    return (
      <button
        type="button"
        onClick={onClick}
        aria-current={on ? 'page' : undefined}
        // The active half still fires. On Reporting it is the old title button,
        // which jumped back to the default report, and swallowing that click
        // would have removed a behaviour while only meaning to add one.
        className={`px-3 py-1.5 text-xs font-semibold rounded-lg transition-colors ${
          on
            ? 'bg-wcs-red text-white'
            : 'text-text-muted hover:text-text-primary cursor-pointer'
        }`}
      >
        {label}
      </button>
    )
  }

  return (
    <div
      className="inline-flex items-center gap-0.5 p-0.5 rounded-xl bg-bg border border-border"
      role="group"
      aria-label="Reports or Analytics"
    >
      <Half side="reports" label="Reports" onClick={onReports} />
      <Half side="analytics" label="Analytics" onClick={onAnalytics} />
    </div>
  )
}
