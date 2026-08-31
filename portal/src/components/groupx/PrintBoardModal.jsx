import { useState, useMemo } from 'react'
import { startOfPrintWeek, printWeekLabel } from '../../lib/printWeek'

// Print the class schedule by printing THE BOARD.
//
// This used to be a hand-built sheet in components/schedule that copied the
// board's look: same palette, same hash, same name and length pill. Copying is
// how two renderings of one schedule drift, and it drifted -- the sheet was a
// list where the board is a time grid, so a 6am and a 10am class printed as
// neighbours. Every fix had to be made twice and the second one was always
// approximate.
//
// So there is no sheet any more. The button opens the real board with
// ?print=1, which renders it and calls window.print() on itself. Identical by
// construction: there is nothing left to keep in sync, and anything that
// changes on the wall changes on the paper in the same commit.
//
// The board lives on the auth API, not the portal, so the URL comes from
// VITE_API_URL exactly as BoardLinks builds it.
const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:3001'

function addDays(d, n) {
  const out = new Date(d)
  out.setDate(out.getDate() + n)
  return out
}

function toISO(d) {
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

function boardUrl(slug, startISO, forPrint) {
  return `${API_URL}/public/group-x/board?club=${encodeURIComponent(slug)}`
    + `&start=${encodeURIComponent(startISO)}${forPrint ? '&print=1' : ''}`
}

export default function PrintBoardModal({ club, onClose }) {
  // Defaults to next week: the sheet is normally run off on a Friday for the
  // week ahead. "This week" is one click away for a reprint.
  const [monday, setMonday] = useState(() => addDays(startOfPrintWeek(new Date()), 7))

  const thisMonday = useMemo(() => startOfPrintWeek(new Date()), [])
  const startISO = toISO(monday)
  const isThisWeek = startISO === toISO(thisMonday)
  const isNextWeek = startISO === toISO(addDays(thisMonday, 7))

  function print() {
    // A popup rather than an iframe: the board is on another origin, so the
    // portal cannot reach into the frame to call print() on it. Opening the
    // page and letting it print ITSELF is the only route that does not need
    // same-origin access, and it is a direct result of a click so no blocker
    // trips on it.
    const w = window.open(boardUrl(club.slug, startISO, true), '_blank', 'noopener,width=1280,height=860')
    if (!w) {
      // Popups blocked. Say so rather than leaving a dead button -- the
      // window.open return value is the only signal we get.
      window.alert('Allow pop-ups for the portal to print the board.')
    }
  }

  const stepClass = 'px-3 py-1.5 text-sm rounded-lg border border-border text-text-primary hover:bg-bg'

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4" onClick={onClose}>
      <div
        className="bg-surface rounded-xl border border-border shadow-2xl max-w-5xl w-full max-h-[92vh] flex flex-col"
        onClick={e => e.stopPropagation()}
      >
        <div className="px-5 py-4 border-b border-border flex items-center justify-between shrink-0">
          <h3 className="font-semibold text-text-primary">Print the class board</h3>
          <button type="button" onClick={onClose}
            className="text-text-muted hover:text-text-primary text-xl leading-none">&times;</button>
        </div>

        <div className="px-5 py-4 border-b border-border shrink-0 space-y-3">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-xs font-medium text-text-muted w-20">Week</span>
            <button type="button" className={stepClass} onClick={() => setMonday(addDays(monday, -7))}>Prev</button>
            <button type="button" className={stepClass} onClick={() => setMonday(thisMonday)}>This week</button>
            <button type="button" className={stepClass} onClick={() => setMonday(addDays(thisMonday, 7))}>Next week</button>
            <button type="button" className={stepClass} onClick={() => setMonday(addDays(monday, 7))}>Next</button>
            <span className="text-sm font-medium text-text-primary ml-1">
              {printWeekLabel(monday)}
              {isThisWeek && <span className="text-text-muted font-normal"> (this week)</span>}
              {isNextWeek && <span className="text-text-muted font-normal"> (next week)</span>}
            </span>
            <button type="button" onClick={print}
              className="ml-auto px-4 py-2 text-sm rounded-lg bg-wcs-red text-white font-medium hover:bg-wcs-red-hover">
              Print
            </button>
          </div>

          {/* Landscape and the missing headers/footers are handled by the
              board's own @page rule. Background graphics is the one setting
              CSS cannot force, so it is the only one worth mentioning. */}
          <div className="rounded-lg border border-border bg-bg px-3 py-2 text-xs text-text-muted">
            This prints the same board that runs on the club TVs, so the sheet
            and the wall always match. Turn on <strong>Background graphics</strong>{' '}
            in the print dialog so the colours come out; everything else is set
            for you.
          </div>
        </div>

        {/* The preview is the board itself in an iframe, not a mock-up of it.
            Cross-origin is fine for display; only scripting is blocked, and
            printing is handled by the page in its own window. */}
        <div className="flex-1 overflow-auto bg-bg p-5">
          <iframe
            key={`${club.slug}-${startISO}`}
            src={boardUrl(club.slug, startISO, false)}
            title={`${club.name} class board preview`}
            className="w-full bg-white rounded-lg border border-border shadow-lg"
            style={{ height: '640px' }}
          />
        </div>
      </div>
    </div>
  )
}
