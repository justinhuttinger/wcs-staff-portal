const test = require('node:test')
const assert = require('node:assert/strict')
const { tierFor, isChallengePurchase, pageReachedBeforeStart, toRow, summarize, titleCase } = require('./challengeReport')

const SEASON = { season_start: '2026-11-01', season_end: null, name_match: 'Transformation Challenge' }

function txn(over = {}) {
  return {
    _id: 't1',
    contactId: 'c1',
    contactName: 'jane  doe',
    contactEmail: 'Jane@Example.com ',
    amount: 57,
    amountRefunded: 0,
    status: 'succeeded',
    entitySourceType: 'payment_link',
    entitySourceName: 'Transformation Challenge - Challenger',
    createdAt: '2026-11-18T23:33:51.474Z',
    ...over,
  }
}

test('tier comes from the product name', () => {
  assert.equal(tierFor('Transformation Challenge - Kick Start', 25).key, 'kick_start')
  assert.equal(tierFor('Transformation Challenge - Kickstart', 25).key, 'kick_start')
  assert.equal(tierFor('Transformation Challenge - Challenger', 57).key, 'challenger')
  assert.equal(tierFor('Transformation Challenge - All In', 97).key, 'all_in')
})

test('name beats price, price is the fallback, unknown is other', () => {
  assert.equal(tierFor('Transformation Challenge - All In', 50).key, 'all_in')
  assert.equal(tierFor('Transformation Challenge', 97).key, 'all_in')
  assert.equal(tierFor('Transformation Challenge', 25).key, 'kick_start')
  assert.equal(tierFor('Transformation Challenge Participant', 60).key, 'other')
})

test('only succeeded, matching, in-season, unrefunded purchases count', () => {
  assert.equal(isChallengePurchase(txn(), SEASON), true)
  assert.equal(isChallengePurchase(txn({ status: 'failed' }), SEASON), false)
  assert.equal(isChallengePurchase(txn({ entitySourceName: 'Day Pass' }), SEASON), false)
  assert.equal(isChallengePurchase(txn({ amountRefunded: 57 }), SEASON), false)
  assert.equal(isChallengePurchase(txn({ amountRefunded: 10 }), SEASON), true)
  // Last season's sale.
  assert.equal(isChallengePurchase(txn({ createdAt: '2026-01-10T03:10:31.298Z' }), SEASON), false)
  assert.equal(isChallengePurchase(txn(), { ...SEASON, season_end: '2026-11-17' }), false)
  assert.equal(isChallengePurchase(txn(), { ...SEASON, name_match: '' }), false)
})

test('season edges are Pacific days', () => {
  // 2026-11-01 06:30Z is Oct 31 in Oregon.
  assert.equal(isChallengePurchase(txn({ createdAt: '2026-11-01T06:30:00Z' }), SEASON), false)
  assert.equal(isChallengePurchase(txn({ createdAt: '2026-11-01T08:30:00Z' }), SEASON), true)
})

test('paging stops once a page reaches before the season', () => {
  assert.equal(pageReachedBeforeStart([txn(), txn({ createdAt: '2025-12-16T21:46:40Z' })], '2026-11-01'), true)
  assert.equal(pageReachedBeforeStart([txn()], '2026-11-01'), false)
  assert.equal(pageReachedBeforeStart([], '2026-11-01'), false)
})

test('row uses the contact for phone and name, transaction for email', () => {
  const club = { slug: 'clackamas', name: 'Clackamas' }
  const row = toRow(txn(), club, { first_name: 'jane', last_name: 'doe', phone: '+15035550100' })
  assert.equal(row.name, 'Jane Doe')
  assert.equal(row.email, 'jane@example.com')
  assert.equal(row.phone, '+15035550100')
  assert.equal(row.tier_label, 'Challenger')
  assert.equal(row.club_slug, 'clackamas')
  const noContact = toRow(txn(), club, null)
  assert.equal(noContact.name, 'Jane Doe')
  assert.equal(noContact.phone, '')
})

test('titleCase tidies spacing and case', () => {
  assert.equal(titleCase("  o'neil  SMITH-jones "), "O'Neil Smith-Jones")
})

test('summary counts tiers and clubs', () => {
  const club = { slug: 'keizer', name: 'Keizer' }
  const rows = [
    toRow(txn({ amount: 25, entitySourceName: 'Transformation Challenge - Kick Start' }), club, null),
    toRow(txn(), { slug: 'clackamas', name: 'Clackamas' }, null),
  ]
  const s = summarize(rows)
  assert.equal(s.total, 2)
  assert.equal(s.revenue, 82)
  assert.equal(s.tiers.kick_start.count, 1)
  assert.equal(s.tiers.challenger.count, 1)
  assert.equal(s.tiers.all_in.count, 0)
  assert.equal(s.clubs.length, 2)
})
