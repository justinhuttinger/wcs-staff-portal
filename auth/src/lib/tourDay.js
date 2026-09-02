// auth/src/lib/tourDay.js
//
// When does a tour card stop being live?
//
// A card means "this person is at the front desk now". Tomorrow it means
// nothing, but the queue had no expiry at all, so Salem accumulated eight days
// of stale cards and five real arrivals were buried under twenty-two dead ones.
// Staff stopped trusting the list, which is why 2 of 27 tours were ever worked.
//
// The cutoff is the start of the current business day rather than a rolling
// window: a card from 9am and a card from 8pm are both "today" and should
// disappear together, when the club closes and the day is over.
//
// The boundary is 4am Pacific, not midnight. A club closing at 10pm still has
// somebody checking in at 9:58, and a queue that wipes itself while the last
// tour of the night is being given would be worse than one that never wipes.

const CLUB_TZ = 'America/Los_Angeles'

// Late enough that no club is still open, early enough that nobody has arrived.
const DAY_STARTS_AT_HOUR = 4

/**
 * The wall-clock offset of a timezone at a given instant, in minutes.
 * Derived rather than hardcoded so this stays correct across DST: Pacific is
 * -8 for part of the year and -7 for the rest, and a fixed offset would move
 * the cutoff by an hour twice a year.
 */
function offsetMinutes(date, timeZone) {
  // 'en-US' with a fixed format gives parts we can reassemble as if UTC; the
  // difference from the real instant is the offset.
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hour12: false,
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
  }).formatToParts(date)

  const get = type => Number(parts.find(p => p.type === type).value)
  // Intl renders midnight as hour 24 in some environments.
  const hour = get('hour') % 24

  const asUtc = Date.UTC(get('year'), get('month') - 1, get('day'), hour, get('minute'), get('second'))
  return (asUtc - Math.floor(date.getTime() / 1000) * 1000) / 60000
}

/**
 * The instant the current tour day began: 4am club-local, today, or yesterday
 * when it is not yet 4am.
 *
 * @param {Date} [now]
 * @returns {Date}
 */
function tourDayStart(now = new Date()) {
  const offset = offsetMinutes(now, CLUB_TZ)

  // Shift into club-local wall time so the date parts are the club's, then read
  // the local calendar day.
  const local = new Date(now.getTime() + offset * 60000)
  const y = local.getUTCFullYear()
  const m = local.getUTCMonth()
  const d = local.getUTCDate()
  const localHour = local.getUTCHours()

  // Before 4am we are still working yesterday's queue.
  const dayOffset = localHour < DAY_STARTS_AT_HOUR ? -1 : 0

  // Build 4am local as an instant. The offset is recomputed at the candidate
  // moment because a DST change can fall between now and the boundary.
  const naive = Date.UTC(y, m, d + dayOffset, DAY_STARTS_AT_HOUR, 0, 0)
  const guess = new Date(naive - offset * 60000)
  const guessOffset = offsetMinutes(guess, CLUB_TZ)
  return guessOffset === offset ? guess : new Date(naive - guessOffset * 60000)
}

/** Is this check-in still part of the live queue? */
function isLive(receivedAt, now = new Date()) {
  const at = receivedAt instanceof Date ? receivedAt : new Date(receivedAt)
  if (Number.isNaN(at.getTime())) return false
  return at.getTime() >= tourDayStart(now).getTime()
}

module.exports = { tourDayStart, isLive, CLUB_TZ, DAY_STARTS_AT_HOUR }
