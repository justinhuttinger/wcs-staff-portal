// Swatch tables for the appearance previews, shared by the profile page and the
// admin panel.
//
// Each swatch is HARDCODED, not read from live tokens. That is deliberate: all
// four themes have to show side by side no matter which one is currently
// applied, so a preview cannot resolve `var(--color-surface)`. It also means a
// second copy of this table would drift silently, which is why there is one.

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
    // red: null means "fill from the user's live accent selection".
    swatch: {
      bg: '#0b0b0d', surface: '#131418', ink: '#f2f3f5', red: null,
      radius: '8px', font: "'Inter', sans-serif", upper: false, dark: true,
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

export const LAYOUT_OPTIONS = [
  { key: 'spotlight', label: 'Spotlight', hint: 'Wide panels. Best under 12 destinations.' },
  { key: 'grid', label: 'Grid', hint: 'Square tiles. Best for tablet and front desk.' },
  { key: 'rows', label: 'Rows', hint: 'Dense list. Best for 20+ destinations.' },
]

export const DENSITY_OPTIONS = [
  { key: 'comfortable', label: 'Comfortable' },
  { key: 'compact', label: 'Compact' },
]
