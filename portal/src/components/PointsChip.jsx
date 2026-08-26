import { useState, useEffect } from 'react'
import { getLeaderboard } from '../lib/api'

// The staff member's leaderboard points, as a nav control.
//
// Press drops the classic board's banner strip, which is where rank and points
// used to sit. Rather than restore a strip that fought the single-column
// layout, the number lives in the bar — visible from every tab instead of only
// the board, and it opens the Leaderboard when clicked.
//
// Same audience as the strip it replaces: below corporate. The caller decides
// (see App), matching Quick Actions.
//
// This is the only leaderboard read under Press — ToolGrid skips its own fetch
// there, since the score card it feeds is hidden.

export default function PointsChip({ location, onOpen }) {
  const [data, setData] = useState(null)

  useEffect(() => {
    const slug = (location || 'salem').toLowerCase()
    let live = true
    getLeaderboard({ location_slug: slug })
      .then(res => { if (live) setData(res) })
      .catch(() => {})
    return () => { live = false }
  }, [location])

  // Nothing until it loads. A chip that appears a beat late is better than one
  // that shows a zero and then corrects itself to the real number.
  if (!data) return null

  const points = data.user_points || 0
  const rank = data.user_rank
  const total = data.total_staff || (data.rankings || []).length

  return (
    <button
      type="button"
      onClick={onOpen}
      className="press-points"
      title={rank ? `You are ${rank} of ${total} at this club` : 'See the leaderboard'}
    >
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" aria-hidden="true">
        <path strokeLinecap="round" strokeLinejoin="round" d="M16.5 18.75h-9m9 0a3 3 0 0 1 3 3h-15a3 3 0 0 1 3-3m9 0v-4.5A3.375 3.375 0 0 0 13.125 10.875h-2.25A3.375 3.375 0 0 0 7.5 14.25v4.5m6-15V3.375c0-.621-.504-1.125-1.125-1.125h-.75a1.125 1.125 0 0 0-1.125 1.125V3.75m3 0h-3" />
      </svg>
      <span className="press-points__n">{points.toLocaleString()}</span>
      <span className="press-points__unit">pts</span>
    </button>
  )
}
