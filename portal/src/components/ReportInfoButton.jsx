import { useEffect, useRef, useState } from 'react'

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
export default function ReportInfoButton({ info }) {
  const [open, setOpen] = useState(false)
  const popoverRef = useRef(null)
  const buttonRef = useRef(null)

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

  if (!info) return null

  return (
    <span className="relative inline-block">
      <button
        ref={buttonRef}
        type="button"
        onClick={() => setOpen(v => !v)}
        aria-label="About this report"
        aria-expanded={open}
        className="inline-flex items-center justify-center w-6 h-6 rounded-full border border-border bg-bg text-text-muted hover:text-text-primary hover:border-text-muted transition-colors"
      >
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="w-3.5 h-3.5">
          <path strokeLinecap="round" strokeLinejoin="round" d="M11.25 11.25l.041-.02a.75.75 0 0 1 1.063.852l-.708 2.836a.75.75 0 0 0 1.063.853l.041-.021M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0Zm-9-3.75h.008v.008H12V8.25Z" />
        </svg>
      </button>

      {open && (
        <div
          ref={popoverRef}
          role="dialog"
          aria-label={info.title || 'About this report'}
          className="absolute right-0 top-8 z-30 w-80 bg-surface border border-border rounded-xl shadow-lg p-4 text-left"
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
      )}
    </span>
  )
}
