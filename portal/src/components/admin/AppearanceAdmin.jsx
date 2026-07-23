import { useState } from 'react'
import { getTheme, setTheme } from '../../lib/theme'

// Each preview renders in its OWN hardcoded colors (not the live tokens) so both
// looks show side by side no matter which theme is currently applied.
const OPTIONS = [
  {
    key: 'classic',
    name: 'Classic',
    desc: "Today's portal look.",
    swatch: {
      bg: '#f4f5f7', surface: '#ffffff', ink: '#1a1a2e', red: '#e53e3e',
      radius: '10px', font: "'Inter', sans-serif", upper: false,
    },
  },
  {
    key: 'wp',
    name: 'WP-style',
    desc: 'Matches westcoaststrength.com.',
    swatch: {
      bg: '#f4f4f2', surface: '#ffffff', ink: '#16181d', red: '#ff0000',
      radius: '3px', font: "'WCSDisplay', 'Arial Narrow', sans-serif", upper: true,
    },
  },
]

function Preview({ s }) {
  return (
    <div
      className="p-4"
      style={{ background: s.bg, borderRadius: s.radius, border: '1px solid rgb(0 0 0 / 0.10)' }}
    >
      <div
        className="p-3"
        style={{ background: s.surface, borderRadius: s.radius, border: '1px solid rgb(0 0 0 / 0.10)' }}
      >
        <div
          style={{
            color: s.ink, fontFamily: s.font, fontWeight: 800, fontSize: '18px',
            lineHeight: 1.05, textTransform: s.upper ? 'uppercase' : 'none',
            letterSpacing: s.upper ? '0.01em' : 0,
          }}
        >
          West Coast Strength
        </div>
        <div style={{ color: s.ink, opacity: 0.6, fontSize: '12px', marginTop: '4px' }}>
          Report summary and daily numbers.
        </div>
        <div style={{ display: 'flex', gap: '8px', marginTop: '12px' }}>
          <span
            style={{
              background: s.red, color: '#fff', fontSize: '11px', fontWeight: 700,
              padding: '5px 12px', borderRadius: s.radius,
              textTransform: s.upper ? 'uppercase' : 'none',
            }}
          >
            Primary
          </span>
          <span
            style={{
              background: 'transparent', color: s.ink, fontSize: '11px', fontWeight: 600,
              padding: '5px 12px', borderRadius: s.radius, border: '1px solid rgb(0 0 0 / 0.15)',
            }}
          >
            Secondary
          </span>
        </div>
      </div>
    </div>
  )
}

export default function AppearanceAdmin() {
  const [theme, setThemeState] = useState(getTheme)

  const choose = (key) => {
    setTheme(key)          // persist + apply to <html> live
    setThemeState(key)
  }

  return (
    <div className="bg-surface rounded-xl border border-border p-6 max-w-3xl">
      <p className="text-sm text-text-muted mb-1">
        Choose how the portal looks for you. The change applies instantly and is
        remembered on this device.
      </p>
      <p className="text-xs text-text-muted mb-6">
        Admin-only for now, and saved per browser — it only affects your own view,
        not other staff.
      </p>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        {OPTIONS.map((opt) => {
          const active = theme === opt.key
          return (
            <button
              key={opt.key}
              onClick={() => choose(opt.key)}
              className={`text-left rounded-xl border-2 p-3 transition-colors ${
                active ? 'border-wcs-red' : 'border-border hover:border-wcs-red/40'
              }`}
            >
              <Preview s={opt.swatch} />
              <div className="flex items-center justify-between mt-3 px-1">
                <div>
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
    </div>
  )
}
