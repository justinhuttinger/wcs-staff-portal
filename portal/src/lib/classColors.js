// The class-colour palette for the on-screen week grid.
//
// A class keeps its colour everywhere it appears: the on-screen week grid, the
// wall board, and now the printed sheet. Hashing the class NAME rather than the
// event type id means the same class is the same colour at every club, and a
// rename is the only thing that can move it.
//
// There used to be a hex twin of this palette for a printed sheet that imitated
// the public board. That sheet is gone: the portal's Print button now opens the
// real board, so nothing needs a second copy of these colours.
//
// Red is absent on purpose: it belongs to the WCS accent.

// Tailwind classes for the screen.
export const CLASS_COLORS = [
  'bg-sky-600 border-sky-700 text-white',
  'bg-emerald-600 border-emerald-700 text-white',
  'bg-violet-600 border-violet-700 text-white',
  'bg-amber-600 border-amber-700 text-white',
  'bg-indigo-600 border-indigo-700 text-white',
  'bg-teal-600 border-teal-700 text-white',
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

