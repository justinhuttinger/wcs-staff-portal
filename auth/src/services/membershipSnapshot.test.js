const test = require('node:test')
const assert = require('node:assert')
const { pacificDate, LOST_STATUSES } = require('./membershipSnapshot')

// The snapshot is dated by the CLUB's day, not the server's. A job firing at
// 11:50pm Pacific runs at 06:50 UTC the following day, and dating the row by
// UTC would file every night's membership under tomorrow.
test('the snapshot date is the Pacific day, not the UTC one', () => {
  // 06:50 UTC on the 3rd is 11:50pm Pacific on the 2nd — the moment the job
  // actually fires.
  assert.equal(pacificDate(new Date('2026-09-03T06:50:00Z')), '2026-09-02')
})

test('a mid-afternoon Pacific instant dates to that same day', () => {
  assert.equal(pacificDate(new Date('2026-09-02T20:00:00Z')), '2026-09-02')
})

// Matching analytics_topline_window exactly is the whole point: a snapshot that
// counted a different population would not be comparable with the live report
// it is meant to replace for past dates.
test('a lost membership is the report own three statuses', () => {
  assert.deepEqual(LOST_STATUSES, ['Cancelled', 'Expired', 'Return For Collection'])
})
