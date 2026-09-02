// auth/src/lib/tourDay.test.js
const { test } = require('node:test')
const assert = require('node:assert')
const { tourDayStart, isLive } = require('./tourDay')

// Pacific is UTC-7 in summer (PDT) and UTC-8 in winter (PST), so 4am local is
// 11:00Z or 12:00Z depending on the date. Both are pinned: a fixed offset would
// silently move the cutoff by an hour twice a year.

test('summer: the day starts at 4am PDT, which is 11:00Z', () => {
  // 2026-09-02 18:00Z = 11am PDT, a normal afternoon.
  const start = tourDayStart(new Date('2026-09-02T18:00:00Z'))
  assert.equal(start.toISOString(), '2026-09-02T11:00:00.000Z')
})

test('winter: the day starts at 4am PST, which is 12:00Z', () => {
  // 2026-01-15 20:00Z = noon PST.
  const start = tourDayStart(new Date('2026-01-15T20:00:00Z'))
  assert.equal(start.toISOString(), '2026-01-15T12:00:00.000Z')
})

test('before 4am we are still working last night, so the day has not rolled', () => {
  // 2026-09-03 09:00Z = 2am PDT. A tour given at 9:58pm must still be on the
  // queue while the desk is closing up.
  const start = tourDayStart(new Date('2026-09-03T09:00:00Z'))
  assert.equal(start.toISOString(), '2026-09-02T11:00:00.000Z')
})

test('at exactly 4am the day rolls', () => {
  const start = tourDayStart(new Date('2026-09-03T11:00:00Z'))
  assert.equal(start.toISOString(), '2026-09-03T11:00:00.000Z')
})

test('a late-evening check-in stays live past midnight', () => {
  const now = new Date('2026-09-03T08:30:00Z')          // 1:30am PDT
  const checkedIn = new Date('2026-09-03T04:58:00Z')    // 9:58pm PDT, same shift
  assert.equal(isLive(checkedIn, now), true)
})

test('yesterday morning is not live this afternoon', () => {
  const now = new Date('2026-09-02T18:00:00Z')
  const yesterday = new Date('2026-09-01T17:00:00Z')
  assert.equal(isLive(yesterday, now), false)
})

test('this morning is live this evening', () => {
  const now = new Date('2026-09-02T23:00:00Z')          // 4pm PDT
  const thisMorning = new Date('2026-09-02T16:00:00Z')  // 9am PDT
  assert.equal(isLive(thisMorning, now), true)
})

test('the real stale rows are correctly judged dead', () => {
  // Salem's oldest ready card, against the day it was found.
  assert.equal(isLive(new Date('2026-08-25T19:26:44Z'), new Date('2026-09-02T18:00:00Z')), false)
})

test('an unparseable timestamp is not live rather than throwing', () => {
  assert.equal(isLive('not a date', new Date('2026-09-02T18:00:00Z')), false)
  assert.equal(isLive(null, new Date('2026-09-02T18:00:00Z')), false)
})

test('the boundary is exclusive of the instant before it', () => {
  const now = new Date('2026-09-02T18:00:00Z')
  assert.equal(isLive(new Date('2026-09-02T11:00:00Z'), now), true)
  assert.equal(isLive(new Date('2026-09-02T10:59:59Z'), now), false)
})
