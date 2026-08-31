import { useRef, useState } from 'react'
import { THEME_OPTIONS } from './themeOptions'
import ThemePreview from './ThemePreview'
import ThemePreviewModal from './ThemePreviewModal'

/**
 * The theme picker, with no opinion about where the prefs come from or go.
 * The profile page and the admin panel both render this; only their onPatch
 * differs.
 *
 * Clicking a card does NOT apply the theme. It opens a large preview modal,
 * and the theme is only ever changed from the Apply button inside that
 * modal (see Justin's ask: a popup showing what each theme looks like,
 * opened by clicking the card).
 */
export default function AppearanceControls({ prefs, onPatch }) {
  const [previewKey, setPreviewKey] = useState(null)
  const cardRefs = useRef({})

  const previewOption = THEME_OPTIONS.find(o => o.key === previewKey) || null

  function closePreview() {
    setPreviewKey(null)
    // Return focus to the card that opened the modal.
    cardRefs.current[previewKey]?.focus()
  }

  function applyTheme(key) {
    onPatch({ theme: key })
    setPreviewKey(null)
    cardRefs.current[key]?.focus()
  }

  return (
    <>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        {THEME_OPTIONS.map((opt) => {
          const active = prefs.theme === opt.key
          return (
            <button
              key={opt.key}
              ref={(el) => { cardRefs.current[opt.key] = el }}
              type="button"
              onClick={() => setPreviewKey(opt.key)}
              className={`text-left rounded-xl border-2 p-3 transition-colors ${
                active ? 'border-wcs-red' : 'border-border hover:border-wcs-red/40'
              }`}
            >
              <ThemePreview s={opt.swatch} />
              <div className="flex items-center justify-between gap-2 mt-3 px-1">
                <div className="min-w-0">
                  <div className="text-sm font-bold text-text-primary">{opt.name}</div>
                  <div className="text-xs text-text-muted">{opt.desc}</div>
                </div>
                <span
                  className={`shrink-0 flex items-center justify-center w-5 h-5 rounded-full border-2 ${
                    active ? 'bg-wcs-red border-wcs-red' : 'border-border'
                  }`}
                >
                  {active && (
                    <svg viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="3" className="w-3 h-3">
                      <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                    </svg>
                  )}
                </span>
              </div>
            </button>
          )
        })}
      </div>

      {previewOption && (
        <ThemePreviewModal
          option={previewOption}
          active={prefs.theme === previewOption.key}
          onApply={applyTheme}
          onClose={closePreview}
        />
      )}
    </>
  )
}
