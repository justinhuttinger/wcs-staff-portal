// Which record set sits behind each snapshot stat.
//
// Shared by Club Snapshot and Daily Snapshot, which draw the same STATS list
// from the same server builder. Two copies of this map would be two chances to
// point a card at the wrong population, and the wrong list under the right
// number is worse than no list at all.
//
// NOTHING IS CLICKABLE BY ACCIDENT. A stat only appears here when there is one
// unambiguous set of rows behind it, named deliberately:
//
//   - Day Ones Booked counts on the BOOKING date, Day Ones on Calendar counts
//     on the appointment date. Same table, different cohorts, so they carry
//     different `window` values rather than sharing one.
//   - Members, Net Members, Net PT Revenue and the tour/VIP rates with no list
//     of their own are absent on purpose: a stock, or a difference between two
//     populations, has no single set of rows to show.
export const STAT_DRILLS = {
  newMembers:         { set: 'new-members', title: 'Members joined' },
  lostMembers:        { set: 'lost-members', title: 'Members lost' },
  newDues:            { set: 'new-members', title: 'Members joined' },
  pctOnAch:           { set: 'new-members', filter: 'ach', title: 'Joined on ACH' },
  avgNewDuesDraft:    { set: 'new-members', title: 'Members joined' },
  revenue:            { set: 'revenue', title: 'Revenue collected' },
  ptRevenue:          { set: 'revenue', filter: 'pt', title: 'PT revenue collected' },
  dayOneBookCount:    { set: 'day-ones', window: 'booked', title: 'Day Ones booked' },
  dayOneBookPct:      { set: 'day-ones', window: 'booked', title: 'Day Ones booked' },
  vipCount:           { set: 'vips', title: 'VIP referrals' },
  vipPct:             { set: 'vips', title: 'VIP referrals' },
  toursGiven:         { set: 'tours', title: 'Tours given' },
  sameDaySales:       { set: 'tours', title: 'Tours given' },
  tourConversionRate: { set: 'tours', title: 'Tours given' },
  dayOnes:            { set: 'day-ones', title: 'Day Ones' },
  dayOneShowRate:     { set: 'day-ones', filter: 'completed', title: 'Completed Day Ones' },
  dayOneCloseRate:    { set: 'day-ones', filter: 'sold', title: 'Day Ones sold' },
  dayOnesPending:     { set: 'day-ones-pending', title: 'Pending outcomes' },
  newPtRevenue:       { set: 'pt-sales', title: 'PT sold' },
  lostPtRevenue:      { set: 'pt-losses', title: 'Deactivations' },
}

/**
 * Is there a list worth opening behind this stat?
 *
 * A stat with no drill, no value, or an explicitly unavailable one (Daily
 * Snapshot dims revenue on a day the import has not reached) must render plain,
 * so a dead click is impossible. `unavailable` matters most: that card already
 * says "No data", and letting it open an empty modal would contradict itself.
 */
export function drillFor(stat) {
  if (!stat || stat.unavailable || !stat.value) return null
  return STAT_DRILLS[stat.key] || null
}
