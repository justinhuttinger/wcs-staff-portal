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
export const DAY_PASS = 'Day Pass'
// The fallback. The server sends each club's own list from tour_outcomes, which
// is how NLPT and Swim show at Milwaukie and Clackamas and nowhere else.
export const OUTCOMES = ['Membership Sale', 'Started Trial', VIP_PASS, DAY_PASS, 'Only Tour', CUSTOM_PASS]

// Outcomes that hand out gym access, and for how long. A trial and a VIP pass
// are just fixed-length versions of a custom pass, so they take the same route:
// the expiration and visit allowance go to ABC and the desk gets the alert.
// Keeping the lengths here means changing "a trial is 7 days" is a one-line
// change rather than something staff have to remember to type.
export const PASS_DAYS = {
  'Started Trial': 7,
  [VIP_PASS]: 14,
  // A day pass is one day. Its length is in its name, so unlike a custom pass
  // there is nothing for staff to type.
  [DAY_PASS]: 1,
}

/**
 * What an outcome hands out: { grants, fixedDays }. fixedDays null on a pass
 * means staff choose the length on the tour.
 *
 * `rules` is the club's list from the server (tour_outcomes, set in Admin ->
 * Tour Check-In), and wins whenever it is there. The built-in lengths above
 * are only for a server that has not sent any.
 */
export function passRuleFor(outcome, rules) {
  if (Array.isArray(rules) && rules.length) {
    const r = rules.find(x => x.outcome === outcome)
    if (!r || !r.grants_pass) return { grants: false, fixedDays: null }
    return { grants: true, fixedDays: r.pass_days == null ? null : Number(r.pass_days) }
  }
  if (outcome === CUSTOM_PASS) return { grants: true, fixedDays: null }
  if (outcome in PASS_DAYS) return { grants: true, fixedDays: PASS_DAYS[outcome] }
  return { grants: false, fixedDays: null }
}

export const grantsAPass = (outcome, rules) => passRuleFor(outcome, rules).grants

/**
 * How many days the chosen outcome hands out, or an error to show instead.
 *
 * Bounded at 90: a pass longer than that is somebody fat-fingering an extra
 * digit, and it writes a real expiration date into ABC.
 */
export function passDaysFor(outcome, customDays, rules) {
  const { grants, fixedDays } = passRuleFor(outcome, rules)
  if (!grants) return { days: null }
  const n = fixedDays == null ? Number(customDays) : fixedDays
  if (!Number.isInteger(n) || n < 1 || n > 90) {
    return { days: null, error: 'Enter between 1 and 90 days for the pass.' }
  }
  return { days: n }
}
