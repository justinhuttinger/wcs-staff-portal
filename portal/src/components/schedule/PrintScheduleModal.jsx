import { useState, useEffect, useCallback, useMemo } from 'react'
import { createPortal } from 'react-dom'
import { startOfPrintWeek, buildPrintWeek, printWeekLabel } from '../../lib/printWeek'
import PrintScheduleSheet from './PrintScheduleSheet'
import PrintScheduleStyles from './PrintScheduleStyles'

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

// Print a Monday-Sunday schedule for a chosen week.
//
// The week is chosen rather than taken from the calendar behind it, because
// the sheet is normally printed AHEAD -- next week's grid, run off on Friday
// in preparation. Defaults to next week for that reason; "This week" is one
// click away when someone is reprinting a sheet that got torn down.
//
// `fetchWeek(startISO, endISO)` is supplied by the caller so this component
// does not need to know whether it is talking to Group X (ABC-backed) or to a
// facility (portal-backed). Both hand back the same event shape.
export default function PrintScheduleModal({
  title, clubName, fetchWeek, requireInstructor = true, showEndTime = false, onClose,
}) {
  const [monday, setMonday] = useState(() => addDays(startOfPrintWeek(new Date()), 7))
  const [orientation, setOrientation] = useState('landscape')
  const [events, setEvents] = useState([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(null)

  const thisMonday = useMemo(() => startOfPrintWeek(new Date()), [])
  const isThisWeek = toISO(monday) === toISO(thisMonday)
  const isNextWeek = toISO(monday) === toISO(addDays(thisMonday, 7))

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      setEvents(await fetchWeek(toISO(monday), toISO(addDays(monday, 6))) || [])
    } catch (e) {
      setError(e.message)
      setEvents([])
    } finally {
      setLoading(false)
    }
  }, [fetchWeek, monday])

  useEffect(() => { load() }, [load])

  const week = useMemo(
    () => buildPrintWeek(monday, events, { requireInstructor, showEndTime }),
    [monday, events, requireInstructor, showEndTime],
  )

  const total = week.reduce((n, d) => n + d.events.length, 0)

  // The @page rule carrying the orientation has to be in the document before
  // the dialog opens, so print on the next frame after any orientation change
  // has been committed. Same reason PTSessionsReport waits before printing.
  function print() {
    setTimeout(() => window.print(), 60)
  }

  const stepClass = 'px-3 py-1.5 text-sm rounded-lg border border-border text-text-primary hover:bg-bg'

  const sheet = (
    <PrintScheduleSheet
      week={week}
      title={title}
      clubName={clubName}
      orientation={orientation}
      logoSrc="/wcs-logo.png"
    />
  )

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4" onClick={onClose}>
      <PrintScheduleStyles orientation={orientation} />
      {/* The printed copy is portalled to <body> so it escapes this modal
          entirely. Left in place it would sit inside the preview's
          `transform: scale()`, and a transform makes a containing block --
          which silently turns the sheet's `position: absolute; top: 0` into
          "top of the scaled preview" rather than "top of the page". */}
      {createPortal(sheet, document.body)}
      <div
        className="bg-surface rounded-xl border border-border shadow-2xl max-w-5xl w-full max-h-[92vh] flex flex-col"
        onClick={e => e.stopPropagation()}
      >
        <div className="px-5 py-4 border-b border-border flex items-center justify-between shrink-0">
          <h3 className="font-semibold text-text-primary">Print {title.toLowerCase()}</h3>
          <button type="button" onClick={onClose}
            className="text-text-muted hover:text-text-primary text-xl leading-none">&times;</button>
        </div>

        <div className="px-5 py-4 border-b border-border space-y-3 shrink-0">
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
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <span className="text-xs font-medium text-text-muted w-20">Layout</span>
            {[
              ['landscape', 'Landscape', 'Seven columns across'],
              ['portrait', 'Portrait', 'A row per day'],
            ].map(([key, label, hint]) => (
              <button key={key} type="button" onClick={() => setOrientation(key)}
                title={hint}
                className={`px-3 py-1.5 text-sm rounded-lg border transition ${
                  orientation === key
                    ? 'bg-wcs-red text-white border-wcs-red font-medium'
                    : 'border-border text-text-primary hover:bg-bg'
                }`}>
                {label}
              </button>
            ))}
            <div className="ml-auto flex items-center gap-3">
              {loading && <span className="text-xs text-text-muted">Loading...</span>}
              {!loading && (
                <span className="text-xs text-text-muted">
                  {total === 0 ? 'Nothing scheduled this week' : `${total} on the sheet`}
                </span>
              )}
              <button type="button" onClick={print} disabled={loading || total === 0}
                className="px-4 py-2 text-sm rounded-lg bg-wcs-red text-white font-medium hover:bg-wcs-red-hover disabled:opacity-50">
                Print
              </button>
            </div>
          </div>

          <div className="rounded-lg border border-border bg-bg px-3 py-2 text-xs text-text-muted">
            The sheet prints Monday to Sunday with no dates on it, so it stays
            good on the wall for as long as the pattern holds. Pick the week
            above to choose which schedule gets printed.
          </div>
        </div>

        {error && (
          <div className="mx-5 mt-4 rounded-lg border border-red-300 bg-surface p-3 text-sm text-red-900 shrink-0">
            {error}
          </div>
        )}

        {/* The preview is the sheet itself, scaled down. Not a mock-up of it:
            printing something the user has not seen is how you find out about
            a broken layout via a wasted ream of paper. */}
        <div className="flex-1 overflow-auto bg-bg p-5">
          <div className="ps-preview mx-auto w-fit origin-top shadow-lg"
            style={{ transform: `scale(${orientation === 'portrait' ? 0.62 : 0.58})` }}>
            {sheet}
          </div>
        </div>
      </div>
    </div>
  )
}
