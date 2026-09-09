import { useEffect, useRef, useState } from 'react'

// Pull down at the top of a scroller to reload what is in it.
//
// WHY THE LISTENERS ARE NATIVE AND NOT REACT'S. touchmove has to be able to
// call preventDefault, both to stop the page rubber-banding under the finger
// and to stop the browser's OWN pull-to-refresh — which on an installed PWA
// reloads the whole app and drops you back at the top of the report you were
// reading. React attaches touch listeners passively at the root, where
// preventDefault does nothing, so these are bound to the element directly with
// { passive: false }.
//
// The gesture only starts when the scroller is already AT THE TOP. Anywhere
// else a downward drag is an ordinary scroll and must stay one.

/** How far the finger must travel before letting go triggers a refresh. */
const THRESHOLD = 72
/** The indicator stops moving here however far the finger goes. */
const MAX_PULL = 110
/**
 * Fraction of finger travel the indicator actually moves.
 *
 * The drag gets heavier as it goes, which is what makes a pull feel like it has
 * a mechanism behind it rather than a value being assigned to a transform.
 */
const RESISTANCE = 0.5

/**
 * @param onRefresh  async () => void. Falsy disables the gesture entirely, so a
 *                   screen that has nothing to reload is not silently swallowing
 *                   drags.
 * @returns { ref, pull, refreshing, armed }
 */
export function usePullToRefresh(onRefresh) {
  const ref = useRef(null)
  const [pull, setPull] = useState(0)
  const [refreshing, setRefreshing] = useState(false)

  // The handlers below are bound once and read live values through this, so the
  // listeners never need rebinding mid-gesture.
  // `pull` is mirrored here because the release handler needs to read how far
  // the finger got, and it is bound once — it would otherwise close over the
  // value from bind time. Kept in a ref rather than read inside a state updater:
  // an updater must be pure, and React is free to run it twice, which would
  // fire the refresh twice.
  const state = useRef({ startY: 0, tracking: false, refreshing: false, pull: 0, onRefresh })
  state.current.onRefresh = onRefresh
  state.current.refreshing = refreshing

  const setPullBoth = (v) => { state.current.pull = v; setPull(v) }

  useEffect(() => {
    const el = ref.current
    if (!el || !onRefresh) return

    const onTouchStart = (e) => {
      // Only from a standing start at the top, and only for a single finger:
      // a pinch-zoom on a wide table must not be read as a pull.
      if (el.scrollTop > 0 || e.touches.length !== 1 || state.current.refreshing) return
      state.current.startY = e.touches[0].clientY
      state.current.tracking = true
    }

    const onTouchMove = (e) => {
      if (!state.current.tracking) return
      const dy = e.touches[0].clientY - state.current.startY

      // Dragging back up, or the scroller has moved off the top under us:
      // hand the gesture back to the browser rather than half-owning it.
      if (dy <= 0 || el.scrollTop > 0) {
        state.current.tracking = false
        setPullBoth(0)
        return
      }

      // Owned from here on, so the page cannot rubber-band and the browser's
      // own refresh cannot fire.
      e.preventDefault()
      setPullBoth(Math.min(MAX_PULL, dy * RESISTANCE))
    }

    const finish = () => {
      if (!state.current.tracking) return
      state.current.tracking = false

      if (state.current.pull < THRESHOLD) {
        setPullBoth(0)
        return
      }

      // Held open at the threshold while the work runs, so the spinner has
      // somewhere to sit and the content does not snap back and then reload.
      setPullBoth(THRESHOLD)
      setRefreshing(true)
      state.current.refreshing = true
      Promise.resolve()
        .then(() => state.current.onRefresh?.())
        .catch(() => {})
        .finally(() => {
          state.current.refreshing = false
          setRefreshing(false)
          setPullBoth(0)
        })
    }

    el.addEventListener('touchstart', onTouchStart, { passive: true })
    el.addEventListener('touchmove', onTouchMove, { passive: false })
    el.addEventListener('touchend', finish, { passive: true })
    el.addEventListener('touchcancel', finish, { passive: true })
    return () => {
      el.removeEventListener('touchstart', onTouchStart)
      el.removeEventListener('touchmove', onTouchMove)
      el.removeEventListener('touchend', finish)
      el.removeEventListener('touchcancel', finish)
    }
  }, [onRefresh])

  return { ref, pull, refreshing, armed: pull >= THRESHOLD }
}

export const PULL_THRESHOLD = THRESHOLD
