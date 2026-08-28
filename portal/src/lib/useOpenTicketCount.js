import { useState, useEffect } from 'react'
import { ticketing } from './api'

// How many tickets are waiting on the person looking at the bar — the number
// behind the count on the pinned Tickets tab.
//
// "Waiting on you" means two different things depending on who you are, and
// the API already draws that line, so this hook only has to pick a side:
//   - a handler (and every admin, who handles all types) gets the open tickets
//     of the types they handle: their queue.
//   - everyone else gets the open tickets they submitted themselves: the
//     things they are still waiting on.
// GET /ticketing/summary scopes itself exactly that way, so ?handling=1 vs not
// is the whole decision. can-handle is asked once; only the count polls.
//
// Only `open` counts. in_progress is already being worked and does not need
// anyone prodded about it, and it matches what the board calls "New".

const POLL_MS = 120000

/**
 * @param {boolean} enabled  false parks the hook entirely (no theme, no user).
 * @param {any} refreshKey   change it to force an immediate re-read — App
 *                           passes the Tickets view's open/closed state, so
 *                           coming back from working a ticket lands on a
 *                           fresh number rather than a stale one.
 * @returns {number|null}    null until the first read lands.
 */
export function useOpenTicketCount(enabled, refreshKey) {
  const [handling, setHandling] = useState(null) // null = not asked yet
  const [count, setCount] = useState(null)

  useEffect(() => {
    if (!enabled) return
    let live = true
    ticketing.canHandle()
      .then(r => { if (live) setHandling(!!r.any) })
      .catch(() => { if (live) setHandling(false) })
    return () => { live = false }
  }, [enabled])

  useEffect(() => {
    if (!enabled || handling === null) return
    let live = true
    const load = () => ticketing.summary(handling)
      // A failed poll keeps the last good number rather than blanking the
      // badge: a dropped request is not the same as an empty queue.
      .then(r => { if (live) setCount(r?.counts?.open ?? 0) })
      .catch(() => {})
    load()
    const timer = setInterval(load, POLL_MS)
    // A portal tab sits open all day. Re-read on return so the count is right
    // as soon as it is looked at, instead of up to POLL_MS stale.
    const onVisible = () => { if (document.visibilityState === 'visible') load() }
    document.addEventListener('visibilitychange', onVisible)
    return () => {
      live = false
      clearInterval(timer)
      document.removeEventListener('visibilitychange', onVisible)
    }
  }, [enabled, handling, refreshKey])

  return count
}
