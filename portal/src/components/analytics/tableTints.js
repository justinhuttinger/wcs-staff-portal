// Shared cell tints for the Analytics tables.
//
// EVERY CLASS BELOW IS WRITTEN OUT IN FULL, ON PURPOSE. Tailwind extracts class
// names by scanning source text, so a class assembled from a template literal
// —  `bg-[color-mix(in_srgb,${color}_${pct}%,...)]`  — is never generated, and
// the tint silently does nothing. An earlier version of this file did exactly
// that and appeared to work only because a legend elsewhere happened to contain
// the same literals; editing that legend would have removed the table's colour.
//
// Every tint is OPAQUE. These tables have a sticky header and a sticky first
// column with other columns scrolling underneath, and a translucent cell lets
// that scrolling content show through.
//
// The colour is mixed from the theme's own tokens rather than chosen from two
// named backgrounds, because bg-bg and bg-surface are BOTH #ffffff under the
// press theme — a bg-bg/bg-surface stripe renders as no stripe at all. Mixing
// also inverts correctly in dark mode, where the ink is light, with no second
// set of classes.

export const ZEBRA_TINT = 'bg-[color-mix(in_srgb,var(--color-text-primary)_6%,var(--color-surface))]'

/** Alternating column stripe, so a number is easy to trace back to its header. */
export const zebra = (i) => (i % 2 === 0 ? ZEBRA_TINT : 'bg-surface')

/** Row hover. Opaque for the same reason — a translucent hover punches a hole in the sticky column. */
export const HOVER_TINT = 'group-hover:bg-[color-mix(in_srgb,var(--color-wcs-red)_8%,var(--color-surface))]'

export const DIFF_TINTS = {
  strongGood: 'bg-[color-mix(in_srgb,#008300_26%,var(--color-surface))]',
  good: 'bg-[color-mix(in_srgb,#008300_11%,var(--color-surface))]',
  neutral: '',
  bad: 'bg-[color-mix(in_srgb,var(--color-wcs-red)_11%,var(--color-surface))]',
  strongBad: 'bg-[color-mix(in_srgb,var(--color-wcs-red)_26%,var(--color-surface))]',
}

// A miss is graded against the SIZE OF THE GOAL, not a flat number of people.
// Being 20 short of a goal of 240 is a rounding error; being 20 short of a goal
// of 25 is a collapse, and a fixed threshold would paint them identically.
export const DIFF_STRONG_RATIO = 0.25

/**
 * Background for an "actual minus goal" cell.
 *
 * @param diff  actual - goal; positive is the good direction on every column
 *              this is used for
 * @param goal  the goal it was measured against, for scale
 *
 * Returns '' where there is nothing to judge: exactly on target is neither an
 * achievement nor a miss.
 */
export function diffTint(diff, goal) {
  if (diff === null || diff === undefined) return ''
  if (diff === 0) return DIFF_TINTS.neutral
  // No goal means no scale, so direction is all that can honestly be shown.
  if (!goal) return diff > 0 ? DIFF_TINTS.good : DIFF_TINTS.bad
  const ratio = diff / goal
  if (ratio >= DIFF_STRONG_RATIO) return DIFF_TINTS.strongGood
  if (ratio > 0) return DIFF_TINTS.good
  if (ratio > -DIFF_STRONG_RATIO) return DIFF_TINTS.bad
  return DIFF_TINTS.strongBad
}
