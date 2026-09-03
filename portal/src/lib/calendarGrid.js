// Date maths for the member calendar grid. Pure and separate because a
// Monday-first month padded to whole weeks is exactly where an off-by-one
// hides, and it cannot be seen by looking at the page.

export const at = (key) => new Date(`${key}T12:00:00Z`)

export const shiftDay = (key, days) => {
  const d = at(key)
  d.setUTCDate(d.getUTCDate() + days)
  return d.toISOString().slice(0, 10)
}

export const monthKey = (key) => key.slice(0, 7)

export const monthName = (month) => at(`${month}-01`).toLocaleDateString('en-US', {
  timeZone: 'UTC', month: 'long', year: 'numeric',
})

export const longDay = (key) => at(key).toLocaleDateString('en-US', {
  timeZone: 'UTC', weekday: 'long', month: 'long', day: 'numeric',
})

// Monday-first, matching how the member's training week is counted.
export const DOW = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']

export const stepMonth = (month, n) => {
  const d = at(`${month}-01`)
  d.setUTCMonth(d.getUTCMonth() + n)
  return d.toISOString().slice(0, 7)
}

export const monthRange = (month) => ({
  from: `${month}-01`,
  to: shiftDay(`${stepMonth(month, 1)}-01`, -1),
})

// Whole weeks covering the month, so the grid is always rectangular. Leading
// and trailing cells belong to the neighbouring months and are marked as such
// rather than left blank, because a coach clicking the 1st of next month
// should see that day, not a hole.
export function gridFor(month) {
  const first = at(`${month}-01`)
  // getUTCDay is 0 = Sunday; Monday-first means Sunday steps back six.
  const back = (first.getUTCDay() + 6) % 7
  const start = shiftDay(`${month}-01`, -back)

  const cells = []
  for (let i = 0; i < 42; i += 1) {
    const key = shiftDay(start, i)
    // Stop after the week that finishes the month; a 28-day February starting
    // on a Monday needs four rows, not six.
    if (i % 7 === 0 && i > 0 && monthKey(key) > month) break
    cells.push({ key, inMonth: monthKey(key) === month })
  }
  return cells
}
