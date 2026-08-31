// One class-colour palette, two renderings.
//
// A class keeps its colour everywhere it appears: the on-screen week grid, the
// wall board, and now the printed sheet. Hashing the class NAME rather than the
// event type id means the same class is the same colour at every club, and a
// rename is the only thing that can move it.
//
// The screen wants Tailwind utility classes; the printed sheet is deliberately
// plain CSS (it renders onto white paper, not onto the portal's theme), so it
// wants literal hex. Keeping both in one file is what stops them drifting --
// the grid and the sheet must agree or the printout is a different schedule to
// look at.
//
// Red is absent on purpose: it belongs to the WCS accent.

// Tailwind classes for the screen. Index-aligned with PRINT_COLORS below.
export const CLASS_COLORS = [
  'bg-sky-600 border-sky-700 text-white',
  'bg-emerald-600 border-emerald-700 text-white',
  'bg-violet-600 border-violet-700 text-white',
  'bg-amber-600 border-amber-700 text-white',
  'bg-indigo-600 border-indigo-700 text-white',
  'bg-teal-600 border-teal-700 text-white',
]

// The same six, as the hex Tailwind resolves them to. -600 fill, -700 edge.
const PRINT_COLORS = [
  { bg: '#0284c7', border: '#0369a1' }, // sky
  { bg: '#059669', border: '#047857' }, // emerald
  { bg: '#7c3aed', border: '#6d28d9' }, // violet
  { bg: '#d97706', border: '#b45309' }, // amber
  { bg: '#4f46e5', border: '#4338ca' }, // indigo
  { bg: '#0d9488', border: '#0f766e' }, // teal
]

// Shared hash. Must stay identical to the board's, or a class changes colour
// between the wall and the screen.
function colorIndex(className) {
  const s = String(className || '')
  let h = 0
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0
  return h % CLASS_COLORS.length
}

export function colorFor(className) {
  return CLASS_COLORS[colorIndex(className)]
}

export function printColorFor(className) {
  return PRINT_COLORS[colorIndex(className)]
}
