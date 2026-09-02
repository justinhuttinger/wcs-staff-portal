// An empty or error state with a surface under it.
//
// WHY THIS EXISTS: Classic paints a full-bleed club photo behind every mobile
// view. Every "nothing here yet" line in the app was bare dark text laid
// straight on that photo, so the one moment a screen has nothing else on it was
// the one moment nothing could be read. Reports, the leaderboard, comm notes,
// HR, the Day One calendar — all the same shape, all the same problem.
//
// One component rather than a card pasted into each, so the treatment cannot
// drift: the Marketing Tracker had already solved its own copy differently,
// with white text and a drop shadow, which worked but made that one screen look
// like it belonged to a different app.
//
// `tone="error"` colours the message rather than changing the box: a failure
// and an absence are both nothing on screen, and the surface is what makes
// either legible.
export default function MobileEmptyState({ children, tone = 'muted', action = null }) {
  return (
    <div className="bg-surface rounded-2xl border border-border shadow-sm px-4 py-8 text-center">
      <p className={`text-sm ${tone === 'error' ? 'text-wcs-red' : 'text-text-muted'}`}>
        {children}
      </p>
      {action && <div className="mt-3">{action}</div>}
    </div>
  )
}
