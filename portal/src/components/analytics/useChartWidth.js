import { useEffect, useRef, useState } from 'react'

/**
 * Measure an element's width so a chart can draw at 1:1 with the screen.
 *
 * An SVG with a fixed viewBox and a fluid width does NOT map the pointer
 * linearly across the element. preserveAspectRatio defaults to "xMidYMid meet",
 * which scales the drawing to fit and centres the remainder — so a 900-unit
 * viewBox inside a 1100px box is painted 900px wide with 100px of dead space
 * either side. Mapping clientX across the full element width then lands the
 * crosshair up to 100px away from the cursor, and the chart visibly fails to
 * fill its container.
 *
 * Setting the viewBox width to the measured width makes the scale exactly 1, so
 * the drawing fills the box, text is not stretched, and `clientX - left` is the
 * viewBox x with no conversion.
 *
 * Measures the CONTENT box, not the border box. getBoundingClientRect()
 * returns the border box, so attaching this to a padded element sized the
 * chart to the padding as well and the drawing overflowed its own container by
 * exactly the horizontal padding. Club Activity Trends did that with a p-3
 * card and leaked 26px past the card edge.
 *
 * Returns [ref, width]. Width is null until first measurement; render a
 * placeholder rather than guessing, or the first paint will be at the wrong
 * scale and jump.
 */
export function useChartWidth(fallback = null) {
  const ref = useRef(null)
  const [width, setWidth] = useState(fallback)

  useEffect(() => {
    const el = ref.current
    if (!el) return

    const measure = () => {
      // clientWidth excludes border and scrollbar but includes padding, so
      // take the padding back off to land on the content box.
      const cs = getComputedStyle(el)
      const pad = (parseFloat(cs.paddingLeft) || 0) + (parseFloat(cs.paddingRight) || 0)
      const w = Math.max(0, el.clientWidth - pad)
      // Sub-pixel widths churn state on every scroll in some browsers.
      setWidth(prev => (prev !== null && Math.abs(prev - w) < 1 ? prev : w))
    }
    measure()

    if (typeof ResizeObserver === 'undefined') {
      window.addEventListener('resize', measure)
      return () => window.removeEventListener('resize', measure)
    }
    const ro = new ResizeObserver(measure)
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  return [ref, width]
}
