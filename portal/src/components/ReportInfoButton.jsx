import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'

// Info icon shown next to a report title. Click to open a small popover that
// explains how the report's filtering works in plain English. Click outside
// or press Escape to close.
//
// Usage:
//   <ReportInfoButton info={{ title, sections: [...], notes: [...] }} />
//
// info shape:
//   {
//     title:   string — usually the report name, optional (defaults to "About this report")
//     sections: [{ heading, body }]  // body can be string or array of strings (rendered as paragraphs)
//     notes:    string[]              // optional bullet list at the bottom for caveats / gotchas
//   }
//
// portal: render the popover into document.body at a fixed position under the
// icon instead of absolutely inside the trigger. Needed when the trigger sits
// inside an overflow-hidden container (e.g. the KPI list rows) or a stacking
// context that would trap/clip an absolutely-positioned popover. Scrolling or
// resizing closes a portal popover (its anchor moves out from under it).
const POPOVER_W = 320 // matches w-80

export default function ReportInfoButton({ info, portal = false }) {
  const [open, setOpen] = useState(false)
  const [pos, setPos] = useState(null)
  const popoverRef = useRef(null)
  const buttonRef = useRef(null)

  function toggleOpen() {
    if (!open && portal && buttonRef.current) {
      const r = buttonRef.current.getBoundingClientRect()
      // Fit vertically: open downward when there's room, otherwise flip above
      // the icon. Either way cap the height to the available space and let the
      // popover scroll internally, so content near the viewport edge is never
      // cut off (the page behind can't be scrolled while the popover is open —
      // scrolling closes it).
      const spaceBelow = window.innerHeight - r.bottom - 16
      const spaceAbove = r.top - 16
      const openUp = spaceBelow < 240 && spaceAbove > spaceBelow
      setPos({
        left: Math.max(8, Math.min(r.left, window.innerWidth - POPOVER_W - 8)),
        ...(openUp
          ? { bottom: window.innerHeight - r.top + 8, maxHeight: spaceAbove }
          : { top: r.bottom + 8, maxHeight: spaceBelow }),
      })
    }
    setOpen(v => !v)
  }

  useEffect(() => {
    if (!open) return
    function onClickOutside(e) {
      if (popoverRef.current && !popoverRef.current.contains(e.target) && buttonRef.current && !buttonRef.current.contains(e.target)) {
        setOpen(false)
      }
    }
    function onEsc(e) {
      if (e.key === 'Escape') setOpen(false)
    }
    document.addEventListener('mousedown', onClickOutside)
    document.addEventListener('keydown', onEsc)
    return () => {
      document.removeEventListener('mousedown', onClickOutside)
      document.removeEventListener('keydown', onEsc)
    }
  }, [open])

  // A portal popover is anchored to a snapshot of the icon's viewport position,
  // so any scroll/resize invalidates it — close rather than drift. Scrolls that
  // originate INSIDE the popover (its own overflow scrollbar) must not close it.
  useEffect(() => {
    if (!open || !portal) return
    const close = (e) => {
      if (e.target instanceof Node && popoverRef.current && popoverRef.current.contains(e.target)) return
      setOpen(false)
    }
    window.addEventListener('scroll', close, true)
    window.addEventListener('resize', close)
    return () => {
      window.removeEventListener('scroll', close, true)
      window.removeEventListener('resize', close)
    }
  }, [open, portal])

  if (!info) return null

  const popover = open && (
    <div
      ref={popoverRef}
      role="dialog"
      aria-label={info.title || 'About this report'}
      style={portal && pos ? pos : undefined}
      className={`${portal ? 'fixed z-[60] overflow-y-auto' : 'absolute right-0 top-8 z-30'} w-80 bg-surface border border-border rounded-xl shadow-lg p-4 text-left`}
    >
      <div className="flex items-start justify-between gap-2 mb-3">
        <h3 className="text-sm font-semibold text-text-primary">
          {info.title || 'About this report'}
        </h3>
        <button
          type="button"
          onClick={() => setOpen(false)}
          aria-label="Close"
          className="text-text-muted hover:text-text-primary -mt-1 -mr-1 p-1"
        >
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="w-4 h-4">
            <path strokeLinecap="round" strokeLinejoin="round" d="M6 18 18 6M6 6l12 12" />
          </svg>
        </button>
      </div>

      <div className="space-y-3 text-xs text-text-muted leading-relaxed">
        {(info.sections || []).map((section, i) => (
          <div key={i}>
            {section.heading && (
              <p className="text-text-primary font-medium mb-1">{section.heading}</p>
            )}
            {Array.isArray(section.body) ? (
              section.body.map((p, j) => <p key={j} className="mb-1 last:mb-0">{p}</p>)
            ) : (
              <p>{section.body}</p>
            )}
          </div>
        ))}

        {info.notes && info.notes.length > 0 && (
          <div className="pt-1 border-t border-border">
            <p className="text-text-primary font-medium mb-1">Good to know</p>
            <ul className="list-disc list-inside space-y-0.5">
              {info.notes.map((note, i) => <li key={i}>{note}</li>)}
            </ul>
          </div>
        )}
      </div>
    </div>
  )

  return (
    <span className="relative inline-block">
      <button
        ref={buttonRef}
        type="button"
        onClick={toggleOpen}
        aria-label="About this report"
        aria-expanded={open}
        className="inline-flex items-center justify-center w-6 h-6 rounded-full border border-border bg-bg text-text-muted hover:text-text-primary hover:border-text-muted transition-colors"
      >
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="w-3.5 h-3.5">
          <path strokeLinecap="round" strokeLinejoin="round" d="M11.25 11.25l.041-.02a.75.75 0 0 1 1.063.852l-.708 2.836a.75.75 0 0 0 1.063.853l.041-.021M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0Zm-9-3.75h.008v.008H12V8.25Z" />
        </svg>
      </button>

      {portal ? (open && createPortal(popover, document.body)) : popover}
    </span>
  )
}
