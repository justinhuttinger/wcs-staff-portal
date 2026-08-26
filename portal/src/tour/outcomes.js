/**
 * The tour outcomes, shared by both front ends.
 *
 * There are two: the standalone iPad app at /tour.html and the Tour Check-In
 * tool inside the portal. They had been drifting -- Custom Pass existed in one
 * and not the other -- because each carried its own copy of this list. It lives
 * here now so a new outcome cannot land in only half the places staff use.
 */

export const VIP_PASS = 'Started VIP Pass'
export const CUSTOM_PASS = 'Custom Pass'
export const OUTCOMES = ['Membership Sale', 'Started Trial', VIP_PASS, 'Only Tour', CUSTOM_PASS]

// Outcomes that hand out gym access, and for how long. A trial and a VIP pass
// are just fixed-length versions of a custom pass, so they take the same route:
// the expiration and visit allowance go to ABC and the desk gets the alert.
// Keeping the lengths here means changing "a trial is 7 days" is a one-line
// change rather than something staff have to remember to type.
export const PASS_DAYS = {
  'Started Trial': 7,
  [VIP_PASS]: 14,
}

export const grantsAPass = outcome => outcome === CUSTOM_PASS || outcome in PASS_DAYS

/**
 * How many days the chosen outcome hands out, or an error to show instead.
 *
 * Bounded at 90: a pass longer than that is somebody fat-fingering an extra
 * digit, and it writes a real expiration date into ABC.
 */
export function passDaysFor(outcome, customDays) {
  if (!grantsAPass(outcome)) return { days: null }
  const n = outcome === CUSTOM_PASS ? Number(customDays) : PASS_DAYS[outcome]
  if (!Number.isInteger(n) || n < 1 || n > 90) {
    return { days: null, error: 'Enter between 1 and 90 days for the pass.' }
  }
  return { days: n }
}
