'use strict'

// Default training splits keyed by days/week. Each entry is the per-day focus.
const DEFAULT_SPLITS = {
  1: ['Full Body'],
  2: ['Upper Body', 'Lower Body'],
  3: ['Push', 'Pull', 'Legs'],
  4: ['Upper Body', 'Lower Body', 'Upper Body', 'Lower Body'],
  5: ['Push', 'Pull', 'Legs', 'Upper Body', 'Lower Body'],
  6: ['Push', 'Pull', 'Legs', 'Push', 'Pull', 'Legs'],
  7: ['Push', 'Pull', 'Legs', 'Upper Body', 'Lower Body', 'Full Body', 'Conditioning'],
}

function parseDays(daysPerWeek) {
  const n = parseInt(daysPerWeek, 10)
  if (Number.isNaN(n)) return 4          // default
  return Math.min(7, Math.max(1, n))     // clamp 1..7
}

// Build [{ day, focus }] for the program. Trainer dayNFocus fields override defaults.
function resolveDayFocuses(formData = {}) {
  const days = parseDays(formData.daysPerWeek)
  const defaults = DEFAULT_SPLITS[days]
  const out = []
  for (let day = 1; day <= days; day++) {
    const override = (formData[`day${day}Focus`] || '').trim()
    out.push({ day, focus: override || defaults[day - 1] })
  }
  return out
}

module.exports = { resolveDayFocuses, DEFAULT_SPLITS }
