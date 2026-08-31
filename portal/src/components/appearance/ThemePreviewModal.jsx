import { useEffect, useRef } from 'react'
import { createPortal } from 'react-dom'
import ThemePreview from './ThemePreview'

/**
 * A large preview of one theme, opened by clicking its card in
 * AppearanceControls. The theme is only ever applied from the Apply button
 * here, never by the click that opened the modal.
 *
 * Portaled to document.body for the same reason as UserMenu.jsx and
 * LocationMultiSelect.jsx: App.jsx has the Classic header and the page
 * content div as SIBLING stacking contexts both at `relative z-10`, and the
 * content div comes later in DOM order, so it always paints over the header
 * no matter what z-index a descendant of the header carries. This exact bug
 * shipped in UserMenu.jsx and had to be hot-fixed. Rendering into body
 * escapes the page tree's stacking contexts entirely.
 *
 * z-[150]: this is a full backdrop-covering dialog, so it needs to clear
 * every other floating chrome element already in the codebase - the
 * impersonation banner (z-[100]), the account menu (z-[120]) and the Press
 * quick-actions menu (z-index: 130) - while staying below the idle/pin lock
 * overlay (z-index: 200), which must always be able to cover an open dialog
 * when the session locks.
 *
 * Dismissal is backdrop-click and Escape, not a generic "outside click"
 * listener, so there is no risk of the Apply button's own click being
 * mistaken for an outside click and swallowed: the backdrop's onClick only
 * fires for clicks on the backdrop element itself (React stops propagation
 * at the dialog panel via stopPropagation), and Apply's onClick is a normal
 * handler on a button inside that panel.
 */
export default function ThemePreviewModal({ option, active, onApply, onClose }) {
  const closeButtonRef = useRef(null)
  const mouseDownOnBackdrop = useRef(false)

  useEffect(() => {
    function onKey(e) {
      if (e.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [onClose])

  useEffect(() => {
    closeButtonRef.current?.focus()
  }, [])

  return createPortal(
    <div
      className="fixed inset-0 z-[150] flex items-center justify-center bg-black/50 p-4"
      onMouseDown={(e) => { mouseDownOnBackdrop.current = e.target === e.currentTarget }}
      onClick={(e) => {
        if (mouseDownOnBackdrop.current && e.target === e.currentTarget) onClose()
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label={`Preview of the ${option.name} theme`}
        className="w-full max-w-lg rounded-xl border border-border bg-surface shadow-lg p-6"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-4 mb-4">
          <div>
            <h2 className="text-lg font-black text-text-primary">{option.name}</h2>
            <p className="text-sm text-text-muted mt-0.5">{option.desc}</p>
          </div>
          <button
            ref={closeButtonRef}
            type="button"
            onClick={onClose}
            aria-label="Close preview"
            className="shrink-0 w-8 h-8 rounded-full flex items-center justify-center text-text-muted hover:text-text-primary hover:bg-bg transition-colors"
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="w-4 h-4">
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18 18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* The modal panel (max-w-lg) is wider than a card in the grid, so
            ThemePreview - which has no fixed width of its own and fills its
            container - already renders noticeably bigger here, making the
            "large preview" unmistakable without any extra scaling. */}
        <div className="mb-6">
          <ThemePreview s={option.swatch} />
        </div>

        <div className="flex items-center justify-end gap-2 mt-6">
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2 rounded-lg text-sm font-semibold text-text-muted hover:text-text-primary transition-colors"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={() => onApply(option.key)}
            disabled={active}
            className={`px-4 py-2 rounded-lg text-sm font-semibold transition-colors ${
              active
                ? 'bg-bg text-text-muted cursor-not-allowed border border-border'
                : 'bg-wcs-red text-white hover:bg-wcs-red/90'
            }`}
          >
            {active ? 'Already applied' : 'Apply'}
          </button>
        </div>
      </div>
    </div>,
    document.body
  )
}
