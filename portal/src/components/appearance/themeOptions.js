// Swatch table for the appearance previews, shared by the profile page and
// the admin panel.
//
// Each swatch is HARDCODED, not read from live tokens. That is deliberate:
// both themes have to show side by side no matter which one is currently
// applied, so a preview cannot resolve `var(--color-surface)`. It also means
// a second copy of this table would drift silently, which is why there is
// one.

export const THEME_OPTIONS = [
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
    key: 'press',
    name: 'Press',
    desc: 'The website look, with a top nav.',
    swatch: {
      bg: '#ffffff', surface: '#ffffff', ink: '#16181d', red: '#ff0000',
      radius: '3px', font: "'WCSDisplay', 'Arial Narrow', sans-serif", upper: true,
    },
  },
]
