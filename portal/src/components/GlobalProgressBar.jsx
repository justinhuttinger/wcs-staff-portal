import { useEffect, useRef, useState } from 'react'
import { onPendingChange } from '../lib/api'

// Thin top-of-viewport progress bar that animates while any api() request
// is in flight. NProgress-style: width grows quickly to ~80%, then trickles
// toward 95% asymptotically, finishes to 100% when the last request
// resolves, then fades out and resets.
//
// Mounted once in App.jsx so it shows on every screen.
export default function GlobalProgressBar() {
  const [progress, setProgress] = useState(0) // 0..1
  const [visible, setVisible] = useState(false)
  const pendingRef = useRef(0)
  const tickRef = useRef(null)
  const fadeRef = useRef(null)

  useEffect(() => {
    const unsubscribe = onPendingChange((count) => {
      const wasPending = pendingRef.current > 0
      const nowPending = count > 0
      pendingRef.current = count

      if (nowPending && !wasPending) {
        // First in-flight request — start the bar.
        if (fadeRef.current) { clearTimeout(fadeRef.current); fadeRef.current = null }
        setVisible(true)
        setProgress(0.05)
        startTrickle()
      } else if (!nowPending && wasPending) {
        // All requests finished — race the bar to 100% then fade.
        stopTrickle()
        setProgress(1)
        fadeRef.current = setTimeout(() => {
          setVisible(false)
          setProgress(0)
        }, 350)
      }
    })

    return () => {
      unsubscribe()
      stopTrickle()
      if (fadeRef.current) clearTimeout(fadeRef.current)
    }
  }, [])

  function startTrickle() {
    if (tickRef.current) clearInterval(tickRef.current)
    tickRef.current = setInterval(() => {
      setProgress(p => {
        if (p >= 0.95) return p
        // Decelerate as we approach 95%.
        const remaining = 0.95 - p
        return p + Math.max(0.005, remaining * 0.08)
      })
    }, 200)
  }
  function stopTrickle() {
    if (tickRef.current) { clearInterval(tickRef.current); tickRef.current = null }
  }

  return (
    <div
      aria-hidden="true"
      style={{
        position: 'fixed',
        top: 0,
        left: 0,
        height: '3px',
        width: `${Math.round(progress * 100)}%`,
        background: 'var(--color-wcs-red, #c01818)',
        boxShadow: '0 0 10px rgba(192, 24, 24, 0.5)',
        transition: visible ? 'width 200ms ease-out, opacity 300ms ease-out' : 'width 0ms, opacity 300ms ease-out',
        opacity: visible ? 1 : 0,
        zIndex: 9999,
        pointerEvents: 'none',
      }}
    />
  )
}
