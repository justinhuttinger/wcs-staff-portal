const test = require('node:test')
const assert = require('node:assert/strict')

const { capRevenueEndDate, pacificYesterday } = require('../src/services/revenueEndCap')

// Fixed "now": 2026-06-24 12:00 PDT (19:00 UTC). Pacific today = 2026-06-24.
const NOON_PDT = new Date('2026-06-24T19:00:00Z')

test('pacificYesterday returns the Pacific calendar day before today', () => {
  assert.equal(pacificYesterday(NOON_PDT), '2026-06-23')
})

test('pacificYesterday respects Pacific timezone in the early-UTC window', () => {
  // 2026-06-24 05:00 UTC is still 2026-06-23 22:00 in Pacific (PDT -7),
  // so "today" is the 23rd and yesterday is the 22nd.
  assert.equal(pacificYesterday(new Date('2026-06-24T05:00:00Z')), '2026-06-22')
})

test('caps an end date of today down to yesterday', () => {
  assert.equal(capRevenueEndDate('2026-06-24', NOON_PDT), '2026-06-23')
})

test('caps a future end date down to yesterday', () => {
  assert.equal(capRevenueEndDate('2026-07-15', NOON_PDT), '2026-06-23')
})

test('leaves yesterday unchanged', () => {
  assert.equal(capRevenueEndDate('2026-06-23', NOON_PDT), '2026-06-23')
})

test('leaves a past end date (e.g. a completed prior month) unchanged', () => {
  assert.equal(capRevenueEndDate('2026-05-31', NOON_PDT), '2026-05-31')
})
