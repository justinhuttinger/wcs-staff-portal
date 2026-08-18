import { useState } from 'react'
import { ACCENTS, getPrefs, setPrefs } from '../../lib/theme'

// Each preview renders in its OWN hardcoded colors (not the live tokens) so all
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
  {
    key: 'spotlight',
    name: 'Spotlight',
    desc: 'Dark board with search on top.',
    // Accent is filled in live from the current selection so the card shows
    // what the user is actually about to get.
    swatch: {
      bg: '#0b0b0d', surface: '#131418', ink: '#f2f3f5', red: null,
      radius: '8px', font: "'Inter', sans-serif", upper: false, dark: true,
    },
  },
]

const LAYOUTS = [
  { key: 'spotlight', label: 'Spotlight', hint: 'Wide panels. Best under 12 destinations.' },
  { key: 'grid', label: 'Grid', hint: 'Square tiles. Best for tablet and front desk.' },
  { key: 'rows', label: 'Rows', hint: 'Dense list. Best for 20+ destinations.' },
]

const DENSITIES = [
  { key: 'comfortable', label: 'Comfortable' },
  { key: 'compact', label: 'Compact' },
]

function Preview({ s, accent }) {
  const red = s.red || accent.hex
  // On a user-chosen accent the label color comes from the accent's stored ink.
  const redInk = s.red ? '#fff' : accent.ink
  const line = s.dark ? 'rgb(255 255 255 / 0.10)' : 'rgb(0 0 0 / 0.10)'
  return (
    <div
      className="p-4"
      style={{ background: s.bg, borderRadius: s.radius, border: `1px solid ${line}` }}
    >
      <div
        className="p-3"
        style={{ background: s.surface, borderRadius: s.radius, border: `1px solid ${line}` }}
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
              background: red, color: redInk, fontSize: '11px', fontWeight: 700,
              padding: '5px 12px', borderRadius: s.radius,
              textTransform: s.upper ? 'uppercase' : 'none',
            }}
          >
            Primary
          </span>
          <span
            style={{
              background: 'transparent', color: s.ink, fontSize: '11px', fontWeight: 600,
              padding: '5px 12px', borderRadius: s.radius, border: `1px solid ${line}`,
            }}
          >
            Secondary
          </span>
        </div>
      </div>
    </div>
  )
}

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

export default function AppearanceAdmin() {
  const [prefs, setLocalPrefs] = useState(getPrefs)

  const patch = (p) => setLocalPrefs(setPrefs(p)) // persist + apply to <html> live

  const accent = ACCENTS.find(a => a.key === prefs.accent) || ACCENTS[0]
  const activeLayout = LAYOUTS.find(l => l.key === prefs.layout)

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

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        {OPTIONS.map((opt) => {
          const active = prefs.theme === opt.key
          return (
            <button
              key={opt.key}
              onClick={() => patch({ theme: opt.key })}
              className={`text-left rounded-xl border-2 p-3 transition-colors ${
                active ? 'border-wcs-red' : 'border-border hover:border-wcs-red/40'
              }`}
            >
              <Preview s={opt.swatch} accent={accent} />
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
              options={LAYOUTS}
              onChange={(layout) => patch({ layout })}
            />
            {activeLayout && <p className="text-xs text-text-muted mt-2">{activeLayout.hint}</p>}
          </div>

          <div>
            <p className="text-xs font-semibold uppercase tracking-wide text-text-muted mb-2">Density</p>
            <Segmented
              value={prefs.density}
              options={DENSITIES}
              onChange={(density) => patch({ density })}
            />
          </div>

          <div>
            <p className="text-xs font-semibold uppercase tracking-wide text-text-muted mb-2">Accent</p>
            <div className="flex flex-wrap items-center gap-2">
              {ACCENTS.map(a => {
                const active = prefs.accent === a.key
                return (
                  <button
                    key={a.key}
                    onClick={() => patch({ accent: a.key })}
                    title={`${a.label} — ${a.contrast}:1 against the dark surface`}
                    aria-label={a.label}
                    aria-pressed={active}
                    className={`w-8 h-8 rounded-full border-2 transition-transform ${
                      active ? 'scale-110' : 'hover:scale-105'
                    }`}
                    style={{ background: a.hex, borderColor: active ? a.ink : 'transparent' }}
                  >
                    {active && (
                      <svg viewBox="0 0 24 24" fill="none" stroke={a.ink} strokeWidth="3" className="w-3.5 h-3.5 mx-auto">
                        <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                      </svg>
                    )}
                  </button>
                )
              })}
            </div>
            <p className="text-xs text-text-muted mt-2">
              Every accent is checked for contrast against the dark surface. The
              background stays dark — only the accent changes.
            </p>
          </div>
        </div>
      )}
    </div>
  )
}
