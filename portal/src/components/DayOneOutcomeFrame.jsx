import React, { useEffect, useRef, useState } from 'react'

const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:3001'

/**
 * The Day One outcome form, embedded from the API rather than reimplemented.
 *
 * WHY AN IFRAME AND NOT A REACT PORT
 * The same form is reachable two ways: a public link a trainer opens from a
 * calendar notification, and this, inside the portal. Building it twice would
 * mean two designs drifting apart and, worse, two write paths.
 *
 * That second problem was already real. The portal tracker wrote outcomes to
 * GHL custom fields ONLY, so 27 Day Ones had an outcome in GHL that
 * day_one_appointments had never heard of. Embedding the one form means there
 * is one writer, and the divergence cannot come back.
 *
 * Height comes over postMessage because an iframe cannot size itself, and a
 * percentage height inside a min-height-only parent silently collapses to
 * 150px. The frame starts at a sensible minimum so it never renders as a sliver
 * while the first message is in flight.
 */
export default function DayOneOutcomeFrame({ contactId, onRecorded }) {
  const [height, setHeight] = useState(420)
  const frameRef = useRef(null)

  useEffect(() => {
    function onMessage(e) {
      // The API is a different origin, so trust is established by shape and by
      // checking the message came from this frame, not by naming a target.
      if (!e.data || typeof e.data !== 'object') return
      if (frameRef.current && e.source !== frameRef.current.contentWindow) return

      if (e.data.type === 'day-one-outcome-height') {
        const h = Number(e.data.height)
        if (Number.isFinite(h) && h > 0) setHeight(Math.min(Math.max(h, 260), 2000))
      }
      if (e.data.type === 'day-one-outcome-recorded' && onRecorded) {
        onRecorded()
      }
    }
    window.addEventListener('message', onMessage)
    return () => window.removeEventListener('message', onMessage)
  }, [onRecorded])

  if (!contactId) {
    return (
      <p className="text-sm text-text-muted">
        This Day One has no linked contact, so the outcome form cannot be opened.
      </p>
    )
  }

  const src = `${API_URL}/day-one/outcome?embed=1&c=${encodeURIComponent(contactId)}`

  return (
    <iframe
      ref={frameRef}
      src={src}
      title="Day One outcome"
      // An explicit pixel height, never a percentage: see the note above.
      style={{ width: '100%', height: `${height}px`, border: 0, display: 'block' }}
      sandbox="allow-scripts allow-forms allow-same-origin"
    />
  )
}
