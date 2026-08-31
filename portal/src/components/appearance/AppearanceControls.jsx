import { THEME_OPTIONS, LAYOUT_OPTIONS, DENSITY_OPTIONS } from './themeOptions'
import ThemePreview from './ThemePreview'

function Segmented({ value, options, onChange }) {
  return (
    <div className="inline-flex rounded-lg border border-border overflow-hidden">
      {options.map(o => (
        <button
          key={o.key}
          onClick={() => onChange(o.key)}
          title={o.hint}
          className={`px-3 py-1.5 text-xs font-semibold transition-colors ${
            value === o.key
              ? 'bg-wcs-red text-white'
              : 'bg-surface text-text-muted hover:text-text-primary'
          }`}
        >
          {o.label}
        </button>
      ))}
    </div>
  )
}

/**
 * The theme / layout / density / accent pickers, with no opinion about where
 * the prefs come from or go. The profile page and the admin panel both render
 * this; only their onPatch differs.
 */
export default function AppearanceControls({ prefs, onPatch }) {
  const activeLayout = LAYOUT_OPTIONS.find(l => l.key === prefs.layout)

  return (
    <>
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {THEME_OPTIONS.map((opt) => {
          const active = prefs.theme === opt.key
          return (
            <button
              key={opt.key}
              onClick={() => onPatch({ theme: opt.key })}
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

      {/* Layout, density and accent only mean anything under Spotlight. They
          stay saved when you switch away, so coming back restores your setup. */}
      {prefs.theme === 'spotlight' && (
        <div className="mt-6 pt-6 border-t border-border space-y-5">
          <div>
            <p className="text-xs font-semibold uppercase tracking-wide text-text-muted mb-2">Layout</p>
            <Segmented
              value={prefs.layout}
              options={LAYOUT_OPTIONS}
              onChange={(layout) => onPatch({ layout })}
            />
            {activeLayout && <p className="text-xs text-text-muted mt-2">{activeLayout.hint}</p>}
          </div>

          <div>
            <p className="text-xs font-semibold uppercase tracking-wide text-text-muted mb-2">Density</p>
            <Segmented
              value={prefs.density}
              options={DENSITY_OPTIONS}
              onChange={(density) => onPatch({ density })}
            />
          </div>
        </div>
      )}
    </>
  )
}
