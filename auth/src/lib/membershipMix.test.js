const test = require('node:test')
const assert = require('node:assert')
const {
  buildMembershipMix, segmentFor, isPaidInFull, ageOn, MAX_SEGMENTS, OTHER, UNKNOWN,
} = require('./membershipMix')

const AS_OF = '2026-08-25'

function member(over = {}) {
  return {
    club_number: '31598',
    membership_type: 'SINGLE',
    gender: 'F',
    birth_date: '1990-06-15',
    agreement_term: 'Open',
    agreement_payment_method: 'EFT',
    agreement_entry_source: 'ABC',
    sales_person_name: 'Katie  Castlio',
    is_primary_member: true,
    ...over,
  }
}

const NAMES = { 31598: 'Springfield', 31599: 'Keizer' }
const opts = (over = {}) => ({ asOf: AS_OF, clubNameFor: n => NAMES[n] || n, ...over })

test('age is taken as of the report date, not today', () => {
  assert.equal(ageOn('1990-06-15', '2026-08-25'), 36)
  // Birthday still to come that year.
  assert.equal(ageOn('1990-12-15', '2026-08-25'), 35)
  assert.equal(ageOn(null, AS_OF), null)
})

test('each breakdown resolves its own segment', () => {
  const m = member()
  assert.equal(segmentFor(m, 'membership_type', AS_OF), 'SINGLE')
  assert.equal(segmentFor(m, 'gender', AS_OF), 'F')
  assert.equal(segmentFor(m, 'age_group', AS_OF), '35-44')
  assert.equal(segmentFor(m, 'generation', AS_OF), 'Millennial')
  assert.equal(segmentFor(m, 'payment_term', AS_OF), 'Open')
  assert.equal(segmentFor(m, 'payment_method', AS_OF), 'EFT')
  assert.equal(segmentFor(m, 'join_source', AS_OF), 'ABC')
  assert.equal(segmentFor(m, 'relationship', AS_OF), 'Primary')
  // ABC's doubled inner space must not create a second Katie Castlio.
  assert.equal(segmentFor(m, 'salesperson', AS_OF), 'Katie Castlio')
})

test('generations land on the right side of their boundaries', () => {
  const gen = (y) => segmentFor(member({ birth_date: `${y}-06-01` }), 'generation', AS_OF)
  assert.equal(gen(2013), 'Gen Alpha')
  assert.equal(gen(2012), 'Gen Z')
  assert.equal(gen(1997), 'Gen Z')
  assert.equal(gen(1996), 'Millennial')
  assert.equal(gen(1981), 'Millennial')
  assert.equal(gen(1980), 'Gen X')
  assert.equal(gen(1965), 'Gen X')
  assert.equal(gen(1964), 'Boomer')
  assert.equal(gen(1946), 'Boomer')
  assert.equal(gen(1945), 'Silent')
  assert.equal(segmentFor(member({ birth_date: null }), 'generation', AS_OF), UNKNOWN)
})

test('check-in bands separate never-visited from not-known', () => {
  const m = member()
  assert.equal(segmentFor(m, 'checkin_frequency', AS_OF, 0), 'Never')
  assert.equal(segmentFor(m, 'checkin_frequency', AS_OF, 0.4), 'Under 1 / mo')
  assert.equal(segmentFor(m, 'checkin_frequency', AS_OF, 2.5), '1-3 / mo')
  assert.equal(segmentFor(m, 'checkin_frequency', AS_OF, 9), '8-11 / mo')
  assert.equal(segmentFor(m, 'checkin_frequency', AS_OF, 30), '12+ / mo')
  // No history held is not the same claim as never came in.
  assert.equal(segmentFor(m, 'checkin_frequency', AS_OF, undefined), UNKNOWN)
})

test('paid in full is the cash terms, everything else recurs', () => {
  assert.equal(isPaidInFull(member({ agreement_term: 'Cash' })), true)
  assert.equal(isPaidInFull(member({ agreement_term: 'Cash Open' })), true)
  assert.equal(isPaidInFull(member({ agreement_term: 'Open' })), false)
  assert.equal(isPaidInFull(member({ agreement_term: 'Installment' })), false)
  assert.equal(isPaidInFull(member({ agreement_term: null })), false)
})

test('rows split by club and every row sums to 100%', () => {
  const members = [
    member({ club_number: '31598', membership_type: 'SINGLE' }),
    member({ club_number: '31598', membership_type: 'FAMILY' }),
    member({ club_number: '31598', membership_type: 'FAMILY' }),
    member({ club_number: '31599', membership_type: 'SINGLE' }),
  ]
  const { rows } = buildMembershipMix(members, opts())
  const springfield = rows.find(r => r.label === 'Springfield')
  assert.equal(springfield.total, 3)
  assert.equal(springfield.segments.find(s => s.name === 'FAMILY').pct, 66.7)
  assert.equal(springfield.segments.find(s => s.name === 'SINGLE').pct, 33.3)
  for (const row of rows) {
    const sum = row.segments.reduce((a, s) => a + s.count, 0)
    assert.equal(sum, row.total)
  }
})

test('rows are ordered by size, largest first', () => {
  const members = [
    ...Array.from({ length: 5 }, (_, i) => member({ club_number: '31599', membership_type: 'S' + i })),
    member({ club_number: '31598' }),
  ]
  const { rows } = buildMembershipMix(members, opts())
  assert.equal(rows[0].label, 'Keizer')
  assert.equal(rows[0].total, 5)
})

test('segments past the cap fold into Other', () => {
  // Twelve distinct types, so four must fold.
  const members = []
  for (let i = 0; i < 12; i++) {
    for (let n = 0; n <= i; n++) members.push(member({ membership_type: 'T' + String(i).padStart(2, '0') }))
  }
  const { rows, segments, foldedSegments } = buildMembershipMix(members, opts())
  assert.equal(segments.filter(s => s !== OTHER && s !== UNKNOWN).length, MAX_SEGMENTS)
  assert.ok(segments.includes(OTHER))
  assert.equal(foldedSegments, 4)
  // Folding must not lose anybody.
  assert.equal(rows[0].segments.reduce((a, s) => a + s.count, 0), rows[0].total)
})

test('a segment keeps the same identity in every row', () => {
  // Springfield is mostly FAMILY, Keizer mostly SINGLE. A per-row top-N would
  // rank them differently and repaint the colours club by club.
  const members = [
    ...Array.from({ length: 9 }, () => member({ club_number: '31598', membership_type: 'FAMILY' })),
    member({ club_number: '31598', membership_type: 'SINGLE' }),
    ...Array.from({ length: 9 }, () => member({ club_number: '31599', membership_type: 'SINGLE' })),
    member({ club_number: '31599', membership_type: 'FAMILY' }),
  ]
  const { rows } = buildMembershipMix(members, opts())
  const order = rows.map(r => r.segments.map(s => s.name).join('|'))
  assert.equal(order[0], order[1])
})

test('unknown is its own segment and never folds into Other', () => {
  const members = [
    member({ gender: null }),
    member({ gender: 'F' }),
    member({ gender: 'M' }),
  ]
  const { rows, segments } = buildMembershipMix(members, opts({ breakdown: 'gender' }))
  assert.ok(segments.includes(UNKNOWN))
  assert.equal(segments[segments.length - 1], UNKNOWN)
  assert.equal(rows[0].segments.find(s => s.name === UNKNOWN).count, 1)
})

test('the summary splits relationship and payment plan', () => {
  const members = [
    member({ is_primary_member: true, agreement_term: 'Open' }),
    member({ is_primary_member: false, agreement_term: 'Open' }),
    member({ is_primary_member: null, agreement_term: 'Cash' }),
  ]
  const { summary } = buildMembershipMix(members, opts())
  assert.equal(summary.total, 3)
  assert.equal(summary.primary, 1)
  assert.equal(summary.secondary, 1)
  // Not quietly counted as primary.
  assert.equal(summary.relationshipUnknown, 1)
  assert.equal(summary.paidInFull, 1)
  assert.equal(summary.recurring, 2)
})

test('view by regroups without changing the totals', () => {
  const members = [
    member({ club_number: '31598', membership_type: 'SINGLE' }),
    member({ club_number: '31599', membership_type: 'SINGLE' }),
    member({ club_number: '31599', membership_type: 'FAMILY' }),
  ]
  const byClub = buildMembershipMix(members, opts())
  const byType = buildMembershipMix(members, opts({ viewBy: 'membership_type' }))
  assert.equal(byClub.summary.total, byType.summary.total)
  assert.deepEqual(byType.rows.map(r => r.label).sort(), ['FAMILY', 'SINGLE'])
  // An unknown viewBy or breakdown falls back rather than throwing.
  assert.equal(buildMembershipMix(members, opts({ viewBy: 'nope' })).viewBy, 'club')
  assert.equal(buildMembershipMix(members, opts({ breakdown: 'nope' })).breakdown, 'membership_type')
})

test('no members yields empty rather than throwing', () => {
  const out = buildMembershipMix([], opts())
  assert.deepEqual(out.rows, [])
  assert.equal(out.summary.total, 0)
})
