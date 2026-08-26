import { createPortal } from 'react-dom'

// The embedded booking / survey surface behind the board's action buttons and
// the Press nav's Quick Actions menu. Both open the same GHL widget, so it
// lives here rather than in either caller.
//
// Portaled to <body>: Quick Actions sits inside the Press nav, which is
// position:sticky and therefore its own stacking context — a fixed overlay
// rendered as its child could never cover the page.
//
// The iframe is flex-1 inside a parent with an explicit height, not a
// percentage height, because a percentage height inside a parent that only has
// a min-height collapses to 150px.
export default function ActionPopup({ title, url, onClose }) {
  if (!url) return null
  return createPortal(
    <div
      className="fixed inset-0 bg-black/50 flex items-center justify-center z-[120] p-6"
      onClick={onClose}
    >
      <div
        className="bg-surface rounded-2xl border border-border w-full max-w-3xl flex flex-col overflow-hidden"
        style={{ height: 'min(90vh, 900px)' }}
        onClick={e => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-5 py-3 border-b border-border shrink-0">
          <h3 className="text-base font-bold text-text-primary">{title}</h3>
          <div className="flex items-center gap-3">
            <a
              href={url}
              target="_blank"
              rel="noopener noreferrer"
              className="text-xs font-semibold text-wcs-red hover:underline"
              title="Open in a new tab"
            >
              Open in new tab ↗
            </a>
            <button
              onClick={onClose}
              className="text-text-muted hover:text-text-primary text-2xl leading-none"
              aria-label="Close"
            >
              &times;
            </button>
          </div>
        </div>
        <iframe
          src={url}
          title={title}
          className="flex-1 border-0 bg-white"
          referrerPolicy="no-referrer-when-downgrade"
        />
      </div>
    </div>,
    document.body,
  )
}
