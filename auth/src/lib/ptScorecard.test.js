const test = require('node:test')
const assert = require('node:assert')
const { buildScorecard, normalizeGoals, goalCount, pct, DEFAULT_GOAL_PCT } = require('./ptScorecard')

const NAMES = { 31598: 'Springfield', 31599: 'Keizer' }
const opts = (over = {}) => ({ clubNameFor: n => NAMES[n] || n, ...over })

function row(over = {}) {
  return {
    club_number: '31598',
    new_members: 100, pt_on_join: 2, pif_on_join: 1,
    book_count: 50, book_on_join: 10,
    set_to_date: 40, set_incl_future: 45,
    show_count: 30, close_count: 9,
    pt_revenue: 20000, new_eft_draft: 4000, cancelled_eft_draft: 1500, new_pif_revenue: 6000,
    ...over,
  }
}

test('goals default to 50 and are clamped to a sane range', () => {
  assert.deepEqual(normalizeGoals({}), { book: 50, show: 50, close: 50 })
  assert.equal(DEFAULT_GOAL_PCT, 50)
  assert.deepEqual(normalizeGoals({ book: 70, show: 50, close: 30 }), { book: 70, show: 50, close: 30 })
  // Out of range or nonsense must not poison every derived column.
  assert.equal(normalizeGoals({ book: 250 }).book, 100)
  assert.equal(normalizeGoals({ book: -10 }).book, 0)
  assert.equal(normalizeGoals({ book: 'abc' }).book, 50)
  assert.equal(normalizeGoals({ book: null }).book, 50)
})

test('goal counts reproduce the source dashboard exactly', () => {
  // Book Goal 312 = 445 new members x 70%
  assert.equal(goalCount(445, 70), 312)
  // Show Goal 40 = 81 sets x 50%
  assert.equal(goalCount(81, 50), 40)
  // Close Goal 23 = 76 shows x 30%
  assert.equal(goalCount(76, 30), 23)
})

test('a goal against an empty denominator is unknown, not zero', () => {
  assert.equal(goalCount(0, 50), null)
  const { clubs } = buildScorecard([row({ new_members: 0, set_to_date: 0, show_count: 0, close_count: 0 })], opts())
  assert.equal(clubs[0].bookGoal, null)
  assert.equal(clubs[0].bookDiff, null)
  assert.equal(clubs[0].showGoal, null)
  assert.equal(clubs[0].closeGoal, null)
})

test('each goal uses the same denominator as its own rate', () => {
  const { clubs } = buildScorecard([row()], opts({ goals: { book: 70, show: 50, close: 30 } }))
  const c = clubs[0]
  assert.equal(c.bookGoal, 70)   // 100 new members x 70%
  assert.equal(c.showGoal, 20)   // 40 sets x 50%
  assert.equal(c.closeGoal, 9)   // 30 shows x 30%
})

test('diffs are actual minus goal, and go negative when short', () => {
  const { clubs } = buildScorecard([row()], opts({ goals: { book: 70, show: 50, close: 30 } }))
  const c = clubs[0]
  assert.equal(c.bookDiff, -20)  // 50 booked against a goal of 70
  assert.equal(c.showDiff, 10)   // 30 shown against a goal of 20
  assert.equal(c.closeDiff, 0)   // 9 closed against a goal of 9
})

test('rates use the funnel denominators, not the member count throughout', () => {
  const { clubs } = buildScorecard([row()], opts())
  const c = clubs[0]
  assert.equal(c.bookPct, 50)    // 50 of 100 new members
  assert.equal(c.showPct, 75)    // 30 of 40 sets
  assert.equal(c.closePct, 30)   // 9 of 30 shows
  assert.equal(c.bookOnJoinPct, 10)
  assert.equal(c.ptOnJoinPct, 2)
  assert.equal(c.pifOnJoinPct, 1)
})

test('a rate with no denominator is null rather than zero', () => {
  const { clubs } = buildScorecard([row({ set_to_date: 0, show_count: 0, close_count: 0 })], opts())
  // No sets means no show rate — reporting 0% would claim nobody turned up.
  assert.equal(clubs[0].showPct, null)
  assert.equal(clubs[0].closePct, null)
})

test('net EFT draft is new minus cancelled and can go negative', () => {
  const { clubs } = buildScorecard([row({ new_eft_draft: 1000, cancelled_eft_draft: 2500 })], opts())
  assert.equal(clubs[0].netEftDraft, -1500)
})

test('Overall pools the counts instead of averaging the club rates', () => {
  // A tiny club at 100% and a large one at 10% must not average to 55%.
  const rows = [
    row({ club_number: '31598', new_members: 100, book_count: 10 }),
    row({ club_number: '31599', new_members: 2, book_count: 2 }),
  ]
  const { overall } = buildScorecard(rows, opts())
  assert.equal(overall.newMembers, 102)
  assert.equal(overall.bookCount, 12)
  assert.equal(overall.bookPct, 11.8)   // 12/102, not (10% + 100%)/2
  assert.equal(overall.club, 'Overall')
})

test('Overall goals are taken against the pooled denominators', () => {
  const rows = [
    row({ club_number: '31598', new_members: 100, set_to_date: 40, show_count: 30, close_count: 9 }),
    row({ club_number: '31599', new_members: 50, set_to_date: 20, show_count: 10, close_count: 1 }),
  ]
  const { overall } = buildScorecard(rows, opts({ goals: { book: 50, show: 50, close: 50 } }))
  assert.equal(overall.bookGoal, 75)   // 150 x 50%
  assert.equal(overall.showGoal, 30)   // 60 sets x 50%
  assert.equal(overall.closeGoal, 20)  // 40 shows x 50%
})

test('clubs are ordered by size and named', () => {
  const rows = [
    row({ club_number: '31599', new_members: 10 }),
    row({ club_number: '31598', new_members: 90 }),
  ]
  const { clubs } = buildScorecard(rows, opts())
  assert.deepEqual(clubs.map(c => c.club), ['Springfield', 'Keizer'])
})

test('no rows yields an empty Overall rather than throwing', () => {
  const { overall, clubs } = buildScorecard([], opts())
  assert.deepEqual(clubs, [])
  assert.equal(overall.newMembers, 0)
  assert.equal(overall.bookPct, null)
  assert.equal(overall.bookGoal, null)
})
