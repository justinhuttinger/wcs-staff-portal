import { useEffect, useState } from 'react'
import { publicTour } from '../lib/api'

/**
 * "This person already trains here" -- and a way to act on it.
 *
 * A tour recorded against an active member inflates every conversion number it
 * lands in. Shown when staff OPEN a card, not when they save it: a warning that
 * arrives after the save is no use, the number is already wrong.
 *
 * The warning on its own was not enough. Nothing in either app had ever sent
 * status: 'cancelled', so the ONLY way to clear a card was to complete it as a
 * tour -- which is exactly the thing being warned about. Telling staff they are
 * about to do the wrong thing while leaving it as their only option is a nag,
 * not a control. So the banner carries the alternative.
 *
 * It still does not block. Members really do get toured: bringing a guest, being
 * walked round by a new trainer, or testing the kiosk. Refusing the save would
 * leave staff standing with somebody and no way to record what happened, which
 * is how people end up working around the tool.
 *
 * A cancelled member gets no banner. That tour is a win-back and counts.
 */
export default function MemberBanner({ token, intakeId, onDismissed }) {
  const [active, setActive] = useState(false)
  const [confirming, setConfirming] = useState(false)
  const [working, setWorking] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    let live = true
    publicTour.abcStatus(token, intakeId)
      .then(r => { if (live) setActive(!!r.isActiveMember) })
      .catch(() => {})   // never block a check-in on this
    return () => { live = false }
  }, [token, intakeId])

  if (!active) return null

  async function remove() {
    setWorking(true); setError('')
    try {
      await publicTour.dismiss(token, intakeId)
      onDismissed?.(intakeId)
    } catch (e) {
      setError(e.message || 'Could not remove the card')
      setWorking(false)
    }
  }

  return (
    <div className="mb-3 rounded-xl border border-amber-300 bg-amber-50 px-3 py-3">
      <p className="text-sm font-semibold text-amber-900">Already an active member</p>
      <p className="text-xs text-amber-800 mt-0.5">
        Saving an outcome counts them as a new tour. If they were not actually
        toured, take the card off the queue instead.
      </p>

      {!confirming ? (
        <button
          type="button"
          onClick={() => setConfirming(true)}
          className="mt-2 px-3 py-2 rounded-xl border border-amber-400 bg-surface text-sm font-medium text-amber-900 active:scale-[0.99]"
        >
          Not a tour — remove card
        </button>
      ) : (
        <div className="mt-2 flex flex-wrap items-center gap-2">
          {/* Two taps, because this deletes the card and a busy desk mis-taps. */}
          <span className="text-xs text-amber-900">Remove without recording a tour?</span>
          <button
            type="button" disabled={working} onClick={remove}
            className="px-3 py-2 rounded-xl bg-amber-600 text-white text-sm font-semibold disabled:opacity-50"
          >
            {working ? 'Removing…' : 'Yes, remove'}
          </button>
          <button
            type="button" disabled={working} onClick={() => setConfirming(false)}
            className="px-3 py-2 rounded-xl border border-amber-400 text-sm text-amber-900"
          >
            Keep
          </button>
        </div>
      )}

      {error && <p className="text-xs text-wcs-red mt-1">{error}</p>}
    </div>
  )
}
