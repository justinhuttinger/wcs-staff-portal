const test = require('node:test')
const assert = require('node:assert')

// createClient() is happy with undefined env vars, but be explicit so this file
// never depends on a developer's local .env.
const {
  buildReport, displayName, personKey, isExcludedType, ageOn, ageGroupKey, digits10,
} = require('../lib/salespersonPerformance')

const MILWAUKIE = '31601'
const SALEM = '30935'

function member(over = {}) {
  return {
    id: over.id || Math.random().toString(36).slice(2),
    club_number: MILWAUKIE,
    sales_person_name: 'Katie  Castlio',
    sign_date: '2026-07-10',
    membership_type: 'SINGLE',
    agreement_entry_source: 'ABC',
    gender: 'F',
    birth_date: '1990-01-01',
    payment_frequency: 'Monthly',
    next_due_amount: 60,
    down_payment: 0,
    email: null,
    primary_phone: null,
    mobile_phone: null,
    first_name: 'Jane',
    last_name: 'Doe',
    ...over,
  }
}

function dayOne(over = {}) {
  return {
    id: over.id || Math.random().toString(36).slice(2),
    location_slug: 'milwaukie',
    ghl_contact_id: null,
    booked_by_name: 'Katie Castlio',
    booked_at: '2026-07-10T18:30:00Z',
    contact_email: null,
    contact_name: null,
    ...over,
  }
}

const NO_FILTERS = {
  exclusion: 'include', joinSource: null, membershipType: null,
  gender: null, paymentTerm: null, ageGroup: null,
}

// Mirrors abc_membership_skip_list, the shared list the other membership
// reports exclude by. Lowercased, as getSkipList() returns it.
const SKIP_LIST = new Set([
  'childcare', 'club access', 'corp', 'corporate business', 'event access',
  'nlpt only', 'non-member', 'pt only', 'swim only',
])

test('name helpers normalize ABC and Day One spellings to one key', () => {
  // ABC writes a doubled space; the Day One table writes a single one.
  assert.equal(personKey('Katie  Castlio'), 'katie castlio')
  assert.equal(personKey('Katie Castlio'), 'katie castlio')
  assert.equal(displayName('Katie  Castlio'), 'Castlio, Katie')
  assert.equal(displayName('DANIEL  JENSEN'), 'JENSEN, DANIEL')
  assert.equal(displayName(''), 'Unknown')
})

test('a sale and a booking by the same person land on one row', () => {
  const { rows } = buildReport([member()], [dayOne()], new Map(), NO_FILTERS)
  assert.equal(rows.length, 1)
  assert.equal(rows[0].salesperson, 'Castlio, Katie')
  assert.equal(rows[0].newMemberUnits, 1)
  assert.equal(rows[0].dayOneBookCount, 1)
  assert.equal(rows[0].club, 'East Side Athletic Club')
})

test('units count every member, minors included', () => {
  const members = [
    member({ id: 'a', birth_date: '1985-05-05' }),
    member({ id: 'b', birth_date: '2015-05-05' }), // child on the family plan
    member({ id: 'c', birth_date: '1988-05-05' }),
  ]
  const { rows, summary } = buildReport(members, [], new Map(), NO_FILTERS)
  assert.equal(rows[0].newMemberUnits, 3)
  assert.equal(summary.newMemberUnits, 3)
})

test('exclusion uses the shared skip list and is case-insensitive', () => {
  assert.equal(isExcludedType('CHILDCARE', SKIP_LIST), true)
  // ABC's casing is inconsistent, so the compare must be case-insensitive.
  assert.equal(isExcludedType('Club Access', SKIP_LIST), true)
  assert.equal(isExcludedType('club access', SKIP_LIST), true)
  assert.equal(isExcludedType('SINGLE', SKIP_LIST), false)
  assert.equal(isExcludedType(null, SKIP_LIST), false)
})

test('excluding skip-list types is the default; include opts back in', () => {
  const members = [
    member({ id: 'a', membership_type: 'SINGLE' }),
    member({ id: 'b', membership_type: 'PT ONLY' }),
    member({ id: 'c', membership_type: 'CHILDCARE' }),
    member({ id: 'd', membership_type: 'Club Access' }),
  ]
  const excluded = buildReport(members, [], new Map(), { ...NO_FILTERS, exclusion: 'exclude' }, SKIP_LIST)
  assert.equal(excluded.rows[0].newMemberUnits, 1)

  const included = buildReport(members, [], new Map(), { ...NO_FILTERS, exclusion: 'include' }, SKIP_LIST)
  assert.equal(included.rows[0].newMemberUnits, 4)
})

test('% of club total is scoped per club, not company-wide', () => {
  const members = [
    member({ id: 'a', sales_person_name: 'Katie  Castlio' }),
    member({ id: 'b', sales_person_name: 'Katie  Castlio' }),
    member({ id: 'c', sales_person_name: 'Lisa  Ashy' }),
    member({ id: 'd', club_number: SALEM, sales_person_name: 'Matt  Turnquist' }),
  ]
  const { rows } = buildReport(members, [], new Map(), NO_FILTERS)
  const katie = rows.find(r => r.salesperson === 'Castlio, Katie')
  const lisa = rows.find(r => r.salesperson === 'Ashy, Lisa')
  const matt = rows.find(r => r.salesperson === 'Turnquist, Matt')
  assert.equal(katie.pctOfClubTotal, 66.7)
  assert.equal(lisa.pctOfClubTotal, 33.3)
  // Salem's only seller owns all of Salem, even though she sold 1 of 4 overall.
  assert.equal(matt.pctOfClubTotal, 100)
})

test('book on join date requires the booking date to equal the sign date', () => {
  const m = member({ id: 'm1', sign_date: '2026-07-10', email: 'jane@example.com' })
  const contacts = new Map([['c1', { id: 'c1', email: 'jane@example.com', phone: null, first_name: 'Jane', last_name: 'Doe' }]])

  const sameDay = buildReport([m], [dayOne({ ghl_contact_id: 'c1', booked_at: '2026-07-10T18:30:00Z' })], contacts, NO_FILTERS)
  assert.equal(sameDay.rows[0].bookOnJoinDateCount, 1)
  assert.equal(sameDay.rows[0].bookOnJoinDatePct, 100)

  const laterDay = buildReport([m], [dayOne({ ghl_contact_id: 'c1', booked_at: '2026-07-12T18:30:00Z' })], contacts, NO_FILTERS)
  assert.equal(laterDay.rows[0].dayOneBookCount, 1)
  assert.equal(laterDay.rows[0].bookOnJoinDateCount, 0)
})

test('members are matched by phone and by name when email is missing', () => {
  const byPhone = member({ id: 'p1', email: null, mobile_phone: '(503) 555-0147', sign_date: '2026-07-10' })
  const contacts = new Map([['c1', { id: 'c1', email: null, phone: '+15035550147', first_name: 'Nope', last_name: 'Nope' }]])
  const r1 = buildReport([byPhone], [dayOne({ ghl_contact_id: 'c1' })], contacts, NO_FILTERS)
  assert.equal(r1.rows[0].bookOnJoinDateCount, 1)

  const byName = member({ id: 'n1', email: null, mobile_phone: null, first_name: 'Jane', last_name: 'Doe', sign_date: '2026-07-10' })
  const contacts2 = new Map([['c2', { id: 'c2', email: null, phone: null, first_name: 'Jane', last_name: 'Doe' }]])
  const r2 = buildReport([byName], [dayOne({ ghl_contact_id: 'c2' })], contacts2, NO_FILTERS)
  assert.equal(r2.rows[0].bookOnJoinDateCount, 1)
})

test('booking credit follows the booker, so book % can exceed 100', () => {
  // Katie sells one membership but books three Day Ones for the floor.
  const members = [member({ id: 'a', sales_person_name: 'Katie  Castlio' })]
  const dayOnes = [dayOne({ id: 'd1' }), dayOne({ id: 'd2' }), dayOne({ id: 'd3' })]
  const { rows } = buildReport(members, dayOnes, new Map(), NO_FILTERS)
  assert.equal(rows[0].newMemberUnits, 1)
  assert.equal(rows[0].dayOneBookCount, 3)
  assert.equal(rows[0].dayOneBookPct, 300)
})

test('a booker who sold nothing still gets a row, with a null book %', () => {
  const { rows } = buildReport([], [dayOne({ booked_by_name: 'Ryan Harris' })], new Map(), NO_FILTERS)
  assert.equal(rows.length, 1)
  assert.equal(rows[0].salesperson, 'Harris, Ryan')
  assert.equal(rows[0].newMemberUnits, 0)
  assert.equal(rows[0].dayOneBookCount, 1)
  // No denominator, so no percentage — not a divide-by-zero Infinity.
  assert.equal(rows[0].dayOneBookPct, null)
})

test('bookings with no booker recorded collapse into one Unknown row', () => {
  const dayOnes = [
    dayOne({ id: 'd1', booked_by_name: null }),
    dayOne({ id: 'd2', booked_by_name: '' }),
  ]
  const { rows } = buildReport([], dayOnes, new Map(), NO_FILTERS)
  assert.equal(rows.length, 1)
  assert.equal(rows[0].salesperson, 'Unknown')
  assert.equal(rows[0].dayOneBookCount, 2)
})

test('dues totals and averages come from next_due_amount', () => {
  const members = [
    member({ id: 'a', next_due_amount: 60 }),
    member({ id: 'b', next_due_amount: 40 }),
    member({ id: 'c', next_due_amount: null }),
  ]
  const { rows, summary } = buildReport(members, [], new Map(), NO_FILTERS)
  assert.equal(rows[0].totalNewDuesDraft, 100)
  // Averaged across all three units, including the one with no dues on file.
  assert.equal(rows[0].avgNewDuesDraft, 33.33)
  assert.equal(summary.totalNewDuesDraft, 100)
})

test('columns with no data source report null, never zero', () => {
  const { rows, summary } = buildReport([member()], [], new Map(), NO_FILTERS)
  // A zero here would read as "nobody is on ACH" / "no tours given", which is a
  // claim we cannot make. null lets the UI render an explicit N/A.
  assert.equal(rows[0].pctOnAch, null)
  assert.equal(rows[0].toursGiven, null)
  assert.equal(rows[0].tourConversionRate, null)
  assert.equal(summary.pctOnAch, null)
  assert.equal(summary.toursGiven, null)
})

test('filters narrow the member set', () => {
  const members = [
    member({ id: 'a', gender: 'F', agreement_entry_source: 'ABC' }),
    member({ id: 'b', gender: 'M', agreement_entry_source: 'ABC' }),
    member({ id: 'c', gender: 'F', agreement_entry_source: 'Web' }),
  ]
  assert.equal(buildReport(members, [], new Map(), { ...NO_FILTERS, gender: 'F' }).summary.newMemberUnits, 2)
  assert.equal(buildReport(members, [], new Map(), { ...NO_FILTERS, joinSource: 'Web' }).summary.newMemberUnits, 1)
})

test('age is computed as of the sign date, not today', () => {
  // Birthday falls after the sign date, so they were still 17 when they joined.
  assert.equal(ageOn('2008-09-01', '2026-07-10'), 17)
  assert.equal(ageOn('2008-06-01', '2026-07-10'), 18)
  assert.equal(ageOn(null, '2026-07-10'), null)
  assert.equal(ageGroupKey(17), 'under_18')
  assert.equal(ageGroupKey(30), '25_34')
  assert.equal(ageGroupKey(null), 'unknown')
})

test('phone normalization strips formatting and country codes', () => {
  assert.equal(digits10('(503) 555-0147'), '5035550147')
  assert.equal(digits10('+1 503 555 0147'), '5035550147')
  assert.equal(digits10('555-0147'), '')
})
