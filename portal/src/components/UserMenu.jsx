import { useState, useEffect, useRef } from 'react'
import { createPortal } from 'react-dom'
import { initials } from '../lib/initials'

/**
 * The signed-in person's own menu: Profile and Sign Out.
 *
 * `variant` picks the button treatment, because the control sits on three
 * different grounds: over a full-bleed photo ('photo'), on the plain surface
 * when there is no photo ('plain'), and inside the Press nav ('press'), which
 * styles its own controls from index.css rather than Tailwind utilities.
 *
 * The panel is portaled to document.body (see LocationMultiSelect.jsx for the
 * same pattern). The Classic header and the page content div in App.jsx sit
 * as SIBLING stacking contexts with equal z-index, and content comes later in
 * DOM order, so it always paints over the header. A panel confined to the
 * header's own stacking context can never rise above that sibling no matter
 * its own z-index. Portaling escapes the header's stacking context entirely.
 */
export default function UserMenu({ name, onProfile, onSignOut, variant = 'plain' }) {
  const [open, setOpen] = useState(false)
  const ref = useRef(null)
  const panelRef = useRef(null)
  const buttonRef = useRef(null)
  const [coords, setCoords] = useState(null)

  // Position the portaled panel from the trigger's rect, right-aligned and
  // just below it. Closing on scroll (rather than repositioning) is enough
  // here: the panel is short-lived and scroll-to-reposition is unnecessary
  // complexity for a menu the user just opened to click one of two items.
  useEffect(() => {
    if (!open) return

    function place() {
      const btn = buttonRef.current
      if (!btn) return
      const r = btn.getBoundingClientRect()
      setCoords({ right: window.innerWidth - r.right, top: r.bottom + 8 })
    }

    place()
    function onScroll() { setOpen(false) }
    window.addEventListener('scroll', onScroll, true)
    window.addEventListener('resize', place)
    return () => {
      window.removeEventListener('scroll', onScroll, true)
      window.removeEventListener('resize', place)
      // Clear on close so a reopen always re-measures before painting. Without
      // this, stale coords from before the trigger moved (window resize,
      // layout reflow) would skip the invisible guard and flash the panel at
      // the old position for one frame.
      setCoords(null)
    }
  }, [open])

  useEffect(() => {
    if (!open) return
    function onDown(e) {
      // The panel is portaled to document.body, so it is no longer a DOM
      // descendant of `ref`. Testing containment against `ref` alone would
      // treat a click on Profile/Sign Out as an outside click, closing the
      // menu before the item's own onClick fires. Check both.
      const inWrapper = ref.current && ref.current.contains(e.target)
      const inPanel = panelRef.current && panelRef.current.contains(e.target)
      if (!inWrapper && !inPanel) setOpen(false)
    }
    function onKey(e) {
      if (e.key === 'Escape') setOpen(false)
    }
    document.addEventListener('mousedown', onDown)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDown)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])

  const trigger =
    variant === 'press'
      ? 'press-nav__btn'
      : variant === 'photo'
        ? 'w-8 h-8 rounded-full border border-white/30 bg-white/10 text-white/90 text-xs font-bold hover:border-white/60 transition-colors'
        : 'w-8 h-8 rounded-full border border-border bg-surface text-text-muted text-xs font-bold hover:text-wcs-red hover:border-wcs-red transition-colors'

  return (
    <div className="relative" ref={ref}>
      <button
        ref={buttonRef}
        type="button"
        onClick={() => setOpen(o => !o)}
        className={trigger}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={name ? `Account menu for ${name}` : 'Account menu'}
        title={name || 'Account'}
      >
        {variant === 'press' ? 'Account' : initials(name)}
      </button>

      {open && createPortal(
        <div
          ref={panelRef}
          role="menu"
          style={coords ? { position: 'fixed', right: coords.right, top: coords.top } : undefined}
          // Hidden until measured, so it never paints once at the wrong place
          // and jumps (see LocationMultiSelect.jsx). z-[120] must clear the
          // impersonation banner (App.jsx, z-[100]) since the user just opened
          // this menu deliberately, while staying below the Press quick-actions
          // menu (z-index: 130, index.css) and the idle/pin overlay (z-index: 200).
          className={
            'fixed z-[120] min-w-44 rounded-lg border border-border bg-surface shadow-lg overflow-hidden ' +
            (coords ? '' : 'invisible')
          }
        >
          {name && (
            <div className="px-3 py-2 border-b border-border text-xs text-text-muted truncate">{name}</div>
          )}
          <button
            type="button"
            role="menuitem"
            onClick={() => { setOpen(false); onProfile() }}
            className="w-full text-left px-3 py-2 text-sm font-semibold text-text-primary hover:bg-bg transition-colors"
          >
            Profile
          </button>
          <button
            type="button"
            role="menuitem"
            onClick={() => { setOpen(false); onSignOut() }}
            className="w-full text-left px-3 py-2 text-sm font-semibold text-text-primary hover:bg-bg transition-colors"
          >
            Sign Out
          </button>
        </div>,
        document.body
      )}
    </div>
  )
}
