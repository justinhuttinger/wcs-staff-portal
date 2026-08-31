// One theme's look, rendered in its own hardcoded colors so it reads correctly
// whatever theme is currently applied. `s` is a swatch from themeOptions.js.
export default function ThemePreview({ s }) {
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
