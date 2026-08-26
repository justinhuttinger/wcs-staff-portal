const test = require('node:test')
const assert = require('node:assert')

// createClient() is happy with undefined env vars, but be explicit so this file
// never depends on a developer's local .env.
const {
  buildReport, displayName, personKey, isExcludedType, ageOn, ageGroupKey, digits10, isNewSale,
} = require('../lib/salespersonPerformance')

const MILWAUKIE = '31601'
const SALEM = '30935'

function member(over = {}) {
  return {
    id: over.id || Math.random().toString(36).slice(2),
    club_number: MILWAUKIE,
    sales_person_name: 'Katie  Castlio',
    sign_date: '2026-07-10',
    // since_date >= sign_date marks a genuinely new member; see isNewSale.
    since_date: '2026-07-10',
    membership_type: 'SINGLE',
    agreement_entry_source: 'ABC',
    gender: 'F',
    birth_date: '1990-01-01',
    payment_frequency: 'Monthly',
    agreement_payment_method: 'EFT',
    agreement_term: 'Open',
    is_primary_member: true,
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
  gender: null, paymentTerm: null, paymentMethod: null,
  memberRelationship: null, ageGroup: null,
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
  assert.equal(displayName('Katie  Castlio'), 'Katie Castlio')
  assert.equal(displayName('DANIEL  JENSEN'), 'DANIEL JENSEN')
  assert.equal(displayName(''), 'Unknown')
})

test('a sale and a booking by the same person land on one row', () => {
  const { rows } = buildReport([member()], [dayOne()], new Map(), NO_FILTERS)
  assert.equal(rows.length, 1)
  assert.equal(rows[0].salesperson, 'Katie Castlio')
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
  const katie = rows.find(r => r.salesperson === 'Katie Castlio')
  const lisa = rows.find(r => r.salesperson === 'Lisa Ashy')
  const matt = rows.find(r => r.salesperson === 'Matt Turnquist')
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
  assert.equal(rows[0].salesperson, 'Ryan Harris')
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
  // A zero here would read as "no tours given", which is a claim we cannot
  // make. null lets the UI render an explicit N/A.
  assert.equal(rows[0].toursGiven, null)
  assert.equal(rows[0].tourConversionRate, null)
  assert.equal(summary.toursGiven, null)
})

test('% on ACH counts EFT over units with a known payment method', () => {
  // Mirrors Katie Castlio's real July mix: EFT 64, Credit Card 14, Cash 17,
  // Statement 8. Cash and Statement do not draft but still count against her —
  // the question is what share of new members are on ACH.
  const members = [
    ...Array.from({ length: 64 }, (_, i) => member({ id: 'e' + i, agreement_payment_method: 'EFT' })),
    ...Array.from({ length: 14 }, (_, i) => member({ id: 'c' + i, agreement_payment_method: 'Credit Card' })),
    ...Array.from({ length: 17 }, (_, i) => member({ id: 'h' + i, agreement_payment_method: 'Cash' })),
    ...Array.from({ length: 8 }, (_, i) => member({ id: 's' + i, agreement_payment_method: 'Statement' })),
  ]
  const { rows, summary } = buildReport(members, [], new Map(), NO_FILTERS)
  assert.equal(rows[0].newMemberUnits, 103)
  assert.equal(rows[0].achUnits, 64)
  assert.equal(rows[0].achKnownUnits, 103)
  assert.equal(rows[0].pctOnAch, 62.1)
  assert.equal(summary.pctOnAch, 62.1)
  assert.deepEqual(rows[0].paymentMix, { EFT: 64, 'Credit Card': 14, Cash: 17, Statement: 8 })
})

test('a window with no payment method on file shows N/A, not 0%', () => {
  // This is the state between migration 123 and the backfill finishing. A 0%
  // would read as "nobody is on ACH" — a claim the data does not support.
  const members = [
    member({ id: 'a', agreement_payment_method: null }),
    member({ id: 'b', agreement_payment_method: null }),
  ]
  const { rows, summary } = buildReport(members, [], new Map(), NO_FILTERS)
  assert.equal(rows[0].achKnownUnits, 0)
  assert.equal(rows[0].pctOnAch, null)
  assert.equal(summary.pctOnAch, null)
})

test('a partial backfill scores against known rows, not all rows', () => {
  // 1 EFT + 1 Credit Card known, 8 not yet backfilled. 50%, not 10%.
  const members = [
    member({ id: 'a', agreement_payment_method: 'EFT' }),
    member({ id: 'b', agreement_payment_method: 'Credit Card' }),
    ...Array.from({ length: 8 }, (_, i) => member({ id: 'n' + i, agreement_payment_method: null })),
  ]
  const { rows } = buildReport(members, [], new Map(), NO_FILTERS)
  assert.equal(rows[0].newMemberUnits, 10)
  assert.equal(rows[0].pctOnAch, 50)
})

test('member relationship filters on is_primary_member', () => {
  const members = [
    member({ id: 'a', is_primary_member: true }),
    member({ id: 'b', is_primary_member: true }),
    member({ id: 'c', is_primary_member: false }),
    member({ id: 'd', is_primary_member: null }),
  ]
  assert.equal(buildReport(members, [], new Map(), { ...NO_FILTERS, memberRelationship: 'primary' }).summary.newMemberUnits, 2)
  assert.equal(buildReport(members, [], new Map(), { ...NO_FILTERS, memberRelationship: 'secondary' }).summary.newMemberUnits, 1)
  // An unknown relationship is not evidence of either one, so it is excluded
  // from both rather than lumped in with primary.
  assert.equal(buildReport(members, [], new Map(), NO_FILTERS).summary.newMemberUnits, 4)
})

test('payment term filters on agreement_term, not payment_frequency', () => {
  const members = [
    member({ id: 'a', agreement_term: 'Open', payment_frequency: 'Monthly' }),
    member({ id: 'b', agreement_term: 'Installment', payment_frequency: 'Monthly' }),
    member({ id: 'c', agreement_term: 'Cash', payment_frequency: 'Monthly' }),
  ]
  assert.equal(buildReport(members, [], new Map(), { ...NO_FILTERS, paymentTerm: 'Open' }).summary.newMemberUnits, 1)
  assert.equal(buildReport(members, [], new Map(), { ...NO_FILTERS, paymentTerm: 'Installment' }).summary.newMemberUnits, 1)
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

test('renewals are not new sales', () => {
  // Already a member in 2024, signed a new agreement in 2026 — a rewrite.
  assert.equal(isNewSale({ since_date: '2024-03-01', sign_date: '2026-07-10' }), false)
  assert.equal(isNewSale({ since_date: '2026-07-10', sign_date: '2026-07-10' }), true)
  assert.equal(isNewSale({ since_date: null, sign_date: '2026-07-10' }), false)
})

test('renewals are excluded from units, matching the Membership report', () => {
  const members = [
    member({ id: 'a' }),
    member({ id: 'b' }),
    member({ id: 'c', since_date: '2024-03-01' }), // renewal
    member({ id: 'd', since_date: null }),         // no tenure on file
  ]
  const { summary } = buildReport(members, [], new Map(), NO_FILTERS)
  assert.equal(summary.newMemberUnits, 2)
})

test('view by club collapses every salesperson at the club', () => {
  const members = [
    member({ id: 'a', sales_person_name: 'Katie  Castlio' }),
    member({ id: 'b', sales_person_name: 'Lisa  Ashy' }),
    member({ id: 'c', club_number: SALEM, sales_person_name: 'Matt  Turnquist' }),
  ]
  const { rows } = buildReport(members, [], new Map(), { ...NO_FILTERS, viewBy: 'club' })
  assert.equal(rows.length, 2)
  const esac = rows.find(r => r.club === 'East Side Athletic Club')
  assert.equal(esac.newMemberUnits, 2)
  // No single salesperson owns a club row.
  assert.equal(esac.salesperson, null)
  // Every row would be 100% of its own club, so the denominator becomes the
  // whole selection instead.
  assert.equal(esac.pctOfClubTotal, 66.7)
})

test('view by salesperson merges one person across clubs', () => {
  const members = [
    member({ id: 'a', sales_person_name: 'Katie  Castlio' }),
    member({ id: 'b', club_number: SALEM, sales_person_name: 'Katie  Castlio' }),
    member({ id: 'c', club_number: SALEM, sales_person_name: 'Matt  Turnquist' }),
  ]
  const { rows } = buildReport(members, [], new Map(), { ...NO_FILTERS, viewBy: 'salesperson' })
  assert.equal(rows.length, 2)
  const katie = rows.find(r => r.salesperson === 'Katie Castlio')
  assert.equal(katie.newMemberUnits, 2)
  // The row spans clubs, so it is not tied to one.
  assert.equal(katie.club, null)
  assert.equal(katie.pctOfClubTotal, 66.7)
})

test('club + salesperson stays the default and scopes % to the club', () => {
  const members = [
    member({ id: 'a', sales_person_name: 'Katie  Castlio' }),
    member({ id: 'b', sales_person_name: 'Lisa  Ashy' }),
    member({ id: 'c', club_number: SALEM, sales_person_name: 'Matt  Turnquist' }),
  ]
  const dflt = buildReport(members, [], new Map(), NO_FILTERS)
  assert.equal(dflt.viewBy, 'club_salesperson')
  assert.equal(dflt.rows.length, 3)
  // Salem's only seller is 100% of Salem, not 33% of the company.
  assert.equal(dflt.rows.find(r => r.salesperson === 'Matt Turnquist').pctOfClubTotal, 100)
  // An unknown viewBy falls back to the default rather than throwing.
  assert.equal(buildReport(members, [], new Map(), { ...NO_FILTERS, viewBy: 'nonsense' }).viewBy, 'club_salesperson')
})

test('day one bookings follow the same grouping as memberships', () => {
  const members = [member({ id: 'a', sales_person_name: 'Katie  Castlio' })]
  const dayOnes = [dayOne({ id: 'd1', booked_by_name: 'Katie Castlio' })]
  const byClub = buildReport(members, dayOnes, new Map(), { ...NO_FILTERS, viewBy: 'club' })
  assert.equal(byClub.rows.length, 1)
  assert.equal(byClub.rows[0].newMemberUnits, 1)
  assert.equal(byClub.rows[0].dayOneBookCount, 1)
})
