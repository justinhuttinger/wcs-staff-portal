import { useEffect, useState } from 'react'
import { publicTour } from '../lib/api'

/**
 * Stops an active member being recorded as a tour.
 *
 * A tour filed against somebody who already trains here inflates every
 * conversion number it lands in. This started as a warning banner above the
 * normal form, which was the wrong shape: the fastest path was still the wrong
 * one, and a busy desk works top to bottom. So the form is REPLACED. There is
 * nothing to fill in and no Save to press by mistake.
 *
 * The escape hatch is deliberately the slower path, not a missing one. Members
 * genuinely do get toured -- bringing a guest, being walked round by a new
 * trainer -- and a hard block would leave staff standing with somebody and no
 * way to record what happened, which is how people start working around a tool.
 * So "record it anyway" exists, reads as a deviation, and takes a second tap.
 *
 * Cancelled members never see this. That tour is a win-back and counts.
 */

/**
 * @returns {{checking: boolean, isMember: boolean}} -- checking stays true until
 * we know, so the form never flashes up and then vanishes underneath somebody.
 */
export function useActiveMember(token, intakeId) {
  const [state, setState] = useState({ checking: true, isMember: false })

  useEffect(() => {
    let live = true
    setState({ checking: true, isMember: false })
    publicTour.abcStatus(token, intakeId)
      .then(r => live && setState({ checking: false, isMember: !!r.isActiveMember }))
      // An unknown answer must never block a check-in: fall through to the form.
      .catch(() => live && setState({ checking: false, isMember: false }))
    return () => { live = false }
  }, [token, intakeId])

  return state
}

export function MemberCheckPending() {
  return (
    <div className="flex-1 flex items-center justify-center px-6 py-16">
      <p className="text-sm text-text-muted">Checking their membership…</p>
    </div>
  )
}

export function MemberOnlyNotice({ token, intakeId, name, onDismissed, onOverride }) {
  const [confirming, setConfirming] = useState(false)
  const [working, setWorking] = useState(false)
  const [error, setError] = useState('')

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
    <div className="flex-1 overflow-y-auto px-6 py-10 flex flex-col items-center text-center gap-5">
      <div className="w-16 h-16 rounded-full bg-amber-100 flex items-center justify-center">
        <svg viewBox="0 0 24 24" fill="none" stroke="#B45309" strokeWidth="2"
             strokeLinecap="round" strokeLinejoin="round" className="w-8 h-8" aria-hidden="true">
          <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" />
          <circle cx="12" cy="7" r="4" />
        </svg>
      </div>

      <div>
        <h3 className="text-xl font-bold text-text-primary">This is an active member</h3>
        <p className="text-sm text-text-muted mt-2 max-w-xs mx-auto">
          {name ? `${name} already trains here. ` : 'They already train here. '}
          There is no tour to record, so just close this card.
        </p>
      </div>

      {!confirming ? (
        <button
          type="button"
          onClick={() => setConfirming(true)}
          disabled={working}
          className="w-full max-w-xs py-3.5 rounded-xl bg-wcs-red text-white font-semibold active:scale-[0.99] disabled:opacity-50"
        >
          Close card
        </button>
      ) : (
        <div className="w-full max-w-xs flex flex-col gap-2">
          <p className="text-sm text-text-primary">Take them off the queue?</p>
          <button
            type="button" onClick={remove} disabled={working}
            className="w-full py-3.5 rounded-xl bg-wcs-red text-white font-semibold disabled:opacity-50"
          >
            {working ? 'Closing…' : 'Yes, close it'}
          </button>
          <button
            type="button" onClick={() => setConfirming(false)} disabled={working}
            className="w-full py-2.5 rounded-xl border border-border text-sm text-text-secondary"
          >
            Keep it open
          </button>
        </div>
      )}

      {error && <p className="text-sm text-wcs-red">{error}</p>}

      {/* Quiet on purpose. It has to exist -- members do get toured -- but it
          should never be the thing a hurried eye lands on first. */}
      <button
        type="button"
        onClick={onOverride}
        className="text-xs text-text-muted underline underline-offset-4 mt-1"
      >
        They really were toured — record it anyway
      </button>
    </div>
  )
}
