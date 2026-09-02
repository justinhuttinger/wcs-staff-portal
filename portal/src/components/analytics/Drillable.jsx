import { useState } from 'react'
import RecordsModal from './RecordsModal'

// ---------------------------------------------------------------------------
// Makes one figure clickable.
//
// Wraps a stat card, a table cell, anything: clicking it opens the rows that
// were counted, fetched with the filters already on screen.
//
// NOTHING BECOMES CLICKABLE BY ACCIDENT. Each call site names the record set
// and the filter, because only the call site knows which population its number
// came from — Day Ones Booked counts by BOOKING date while Day Ones on Calendar
// counts by appointment date, and a wrapper that guessed would open the wrong
// list under the right number, which is worse than no list at all.
//
// A figure with nothing behind it (a rate with no denominator, a stat the
// report left null) renders plain, so a dead click is impossible.
// ---------------------------------------------------------------------------

export default function Drillable({
  set, params, title, disabled = false, className = '', children,
}) {
  const [open, setOpen] = useState(false)

  if (!set || disabled) return children

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        title={`See the ${title || 'records'} behind this`}
        // text-left because these wrap cards, which are not centred text; the
        // ring is the only affordance a card gets, so it has to be visible on
        // both keyboard focus and hover.
        className={`w-full text-left rounded-xl cursor-pointer transition-shadow hover:ring-2 hover:ring-wcs-red/30 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-wcs-red ${className}`}
      >
        {children}
      </button>
      <RecordsModal
        open={open}
        onClose={() => setOpen(false)}
        title={title || 'Records'}
        set={set}
        params={params}
      />
    </>
  )
}
