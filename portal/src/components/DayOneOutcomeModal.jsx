import React, { useEffect } from 'react'
import DayOneOutcomeFrame from './DayOneOutcomeFrame'

/**
 * The one Day One outcome modal.
 *
 * There were three copies of this before, all copy-pasted, and fixing the
 * outcome UI meant finding all three. One of them was missed and shipped
 * unchanged. This exists so a fourth cannot appear.
 *
 * Closing works three ways because the form inside is an iframe and a stuck
 * modal over it has nowhere to go: the button, the backdrop, and Escape.
 */
export default function DayOneOutcomeModal({ appointment, onClose, onRecorded }) {
  useEffect(() => {
    function onKey(e) { if (e.key === 'Escape') onClose() }
    document.addEventListener('keydown', onKey)
    // The page behind must not scroll while this is open, or a tall form drags
    // the backdrop around under it.
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      document.removeEventListener('keydown', onKey)
      document.body.style.overflow = prev
    }
  }, [onClose])

  const name = appointment?.contact_name || 'Day One'

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/50 p-4"
      // Only a click on the backdrop itself closes. A click inside the panel
      // has a different target, and a click inside the iframe never reaches
      // this document at all, so neither can dismiss the form by accident.
      onClick={(e) => { if (e.target === e.currentTarget) onClose() }}
      role="presentation"
    >
      <div
        className="w-full max-w-xl rounded-2xl bg-surface shadow-xl"
        role="dialog"
        aria-modal="true"
        aria-label={`Day One result for ${name}`}
      >
        <div className="flex items-center justify-between gap-3 border-b border-border px-5 py-3">
          <h2 className="min-w-0 truncate text-base font-semibold text-text-primary">{name}</h2>
          <button
            onClick={onClose}
            className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg text-text-muted hover:bg-bg"
            aria-label="Close"
          >
            <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor" className="h-5 w-5">
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>
        <div className="px-5 pb-4 pt-2">
          <DayOneOutcomeFrame
            contactId={appointment?.contact_id}
            onRecorded={() => { if (onRecorded) onRecorded(); onClose() }}
          />
        </div>
      </div>
    </div>
  )
}
