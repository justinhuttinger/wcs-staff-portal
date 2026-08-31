import { useState, useEffect, useRef } from 'react'
import { initials } from '../lib/initials'

/**
 * The signed-in person's own menu: Profile and Sign Out.
 *
 * `variant` picks the button treatment, because the control sits on three
 * different grounds: over a full-bleed photo ('photo'), on the plain surface
 * when there is no photo ('plain'), and inside the Press nav ('press'), which
 * styles its own controls from index.css rather than Tailwind utilities.
 */
export default function UserMenu({ name, onProfile, onSignOut, variant = 'plain' }) {
  const [open, setOpen] = useState(false)
  const ref = useRef(null)

  useEffect(() => {
    if (!open) return
    function onDown(e) {
      if (ref.current && !ref.current.contains(e.target)) setOpen(false)
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

      {open && (
        <div
          role="menu"
          className="absolute right-0 top-full mt-2 z-50 min-w-44 rounded-lg border border-border bg-surface shadow-lg overflow-hidden"
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
        </div>
      )}
    </div>
  )
}
