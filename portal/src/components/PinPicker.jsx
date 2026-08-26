import { useEffect } from 'react'
import { createPortal } from 'react-dom'
import { MAX_PINNED } from '../lib/pinnedTabs'

// The "+" picker behind the Press nav's pinned tabs.
//
// Rendered through a portal to <body> rather than inside the nav: the nav is
// position:sticky, which creates a stacking context, so a panel rendered inside
// it can never escape the nav's own bounds.
//
// The catalog it is handed is already filtered to what this user may reach, so
// nothing here re-checks a role — see PINNABLE in App.jsx.

export default function PinPicker({ catalog, pinned, onToggle, onClose }) {
  // Escape closes, matching every other dismissible surface in the portal.
  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  const apps = catalog.filter(c => c.kind === 'app')
  const tools = catalog.filter(c => c.kind === 'tool')
  const full = pinned.length >= MAX_PINNED

  const row = (item) => {
    const on = pinned.includes(item.key)
    // When the bar is full the only useful action left is unpinning.
    const disabled = !on && full
    return (
      <button
        key={item.key}
        type="button"
        disabled={disabled}
        onClick={() => onToggle(item.key)}
        className={`press-pin-row${on ? ' is-on' : ''}`}
      >
        <span className="press-pin-row__star" aria-hidden="true">
          <svg viewBox="0 0 24 24" fill={on ? 'currentColor' : 'none'} stroke="currentColor" strokeWidth="1.6">
            <path strokeLinecap="round" strokeLinejoin="round" d="M10.788 3.21c.448-1.077 1.976-1.077 2.424 0l2.082 5.006 5.404.434c1.164.093 1.636 1.545.749 2.305l-4.117 3.527 1.257 5.273c.271 1.136-.964 2.033-1.96 1.425L12 18.354 7.373 21.18c-.996.608-2.231-.29-1.96-1.425l1.257-5.273-4.117-3.527c-.887-.76-.415-2.212.749-2.305l5.404-.434 2.082-5.005Z" />
          </svg>
        </span>
        <span className="press-pin-row__text">
          <span className="press-pin-row__label">{item.label}</span>
          {item.desc && <span className="press-pin-row__desc">{item.desc}</span>}
        </span>
      </button>
    )
  }

  return createPortal(
    <div className="press-pin-backdrop" onClick={onClose}>
      <div
        className="press-pin-panel"
        role="dialog"
        aria-label="Pin a shortcut"
        onClick={e => e.stopPropagation()}
      >
        <div className="press-pin-panel__head">
          <h3>Pin a shortcut</h3>
          <button type="button" onClick={onClose} className="press-pin-panel__close" aria-label="Close">×</button>
        </div>
        <p className="press-pin-panel__hint">
          {full
            ? `That is all ${MAX_PINNED}. Unpin one to make room.`
            : `Adds a tab to the right of Other. ${pinned.length} of ${MAX_PINNED} used.`}
        </p>

        {apps.length > 0 && (
          <>
            <p className="press-pin-panel__group">Apps · open in a new tab</p>
            <div className="press-pin-list">{apps.map(row)}</div>
          </>
        )}
        {tools.length > 0 && (
          <>
            <p className="press-pin-panel__group">Tools · open in the portal</p>
            <div className="press-pin-list">{tools.map(row)}</div>
          </>
        )}
      </div>
    </div>,
    document.body,
  )
}
