import { useEffect, useState } from 'react'
import { publicTour } from '../lib/api'

/**
 * "This person already trains here."
 *
 * Shown when staff open a card, not when they save it. A tour recorded against
 * an active member inflates every conversion number it lands in, and a warning
 * that arrives after the save is no use -- by then the number is already wrong.
 *
 * It warns rather than blocks. Members really do come through: bringing a guest,
 * being walked round by a new trainer, or testing the kiosk. Refusing the save
 * would leave staff standing with somebody and no way to record what happened,
 * which is how people end up working around the tool.
 *
 * A cancelled member gets no banner. That tour is a win-back and should be
 * recorded like any other.
 */
export default function MemberBanner({ token, intakeId }) {
  const [active, setActive] = useState(false)

  useEffect(() => {
    let live = true
    publicTour.abcStatus(token, intakeId)
      .then(r => { if (live) setActive(!!r.isActiveMember) })
      .catch(() => {})   // never block a check-in on this
    return () => { live = false }
  }, [token, intakeId])

  if (!active) return null

  return (
    <div className="mb-3 rounded-xl border border-amber-300 bg-amber-50 px-3 py-2">
      <p className="text-sm font-semibold text-amber-900">Already an active member</p>
      <p className="text-xs text-amber-800 mt-0.5">
        Recording this as a tour will count them as new business. Complete it only
        if they really were toured.
      </p>
    </div>
  )
}
