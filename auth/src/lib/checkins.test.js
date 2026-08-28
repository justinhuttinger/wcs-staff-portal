const test = require('node:test')
const assert = require('node:assert')
const { buildCheckins, perMember, CAPTURE_WARN_PCT } = require('./checkins')

const m = (month, slug, checkins, members) => ({
  month, slug, checkins, members_visiting: members,
})

test('visits per member divides by members who VISITED', () => {
  // Not members on file. A club that is busy with few loyal members must not
  // look the same as one that is busy with many occasional ones.
  assert.equal(perMember(1000, 100), 10)
  assert.equal(perMember(0, 100), 0)
})

test('visits per member is null rather than Infinity when nobody visited', () => {
  assert.equal(perMember(50, 0), null)
})

test('members visiting is never summed across months', () => {
  // The source counts DISTINCT members per month, so a member who came in both
  // July and August appears in both rows. Adding them would count that person
  // twice and deflate visits-per-member for every multi-month window.
  const out = buildCheckins([
    m('2026-07-01', 'salem', 10507, 1252),
    m('2026-08-01', 'salem', 8919, 1206),
  ], [], [], [])

  const salem = out.byClub.find(c => c.slug === 'salem')
  assert.equal(salem.checkins, 19426)
  assert.equal(salem.membersVisiting, 1252)          // the busiest month
  assert.notEqual(salem.membersVisiting, 1252 + 1206)
})

test('clubs are ranked by check-ins and carry their own rate', () => {
  const out = buildCheckins([
    m('2026-08-01', 'milwaukie', 10460, 2166),
    m('2026-08-01', 'salem', 8919, 1206),
  ], [], [], [])

  assert.equal(out.byClub[0].slug, 'milwaukie')
  // Milwaukie has the most visitors and the LOWEST rate; Salem the reverse.
  // Ranking by volume alone would bury that, so both travel together.
  assert.equal(out.byClub[0].visitsPerMember, 4.83)
  assert.equal(out.byClub[1].visitsPerMember, 7.4)
})

test('the trend is ordered by month, not by insertion', () => {
  const out = buildCheckins([
    m('2026-08-01', 'salem', 8919, 1206),
    m('2026-07-01', 'salem', 10507, 1252),
  ], [], [], [])
  assert.deepEqual(out.months.map(x => x.month), ['2026-07-01', '2026-08-01'])
})

// --- the data-quality gate -----------------------------------------------
//
// checkins_hourly has been losing data since May 2026. The old report drew
// volume from it and showed check-ins down 43% when they were up.

test('a short hourly feed is reported, with the number', () => {
  const out = buildCheckins(
    [m('2026-08-01', 'salem', 8919, 1206)], [], [],
    [{ month: '2026-08-01', monthly_total: 74481, hourly_total: 46313, capture: 62.2 }]
  )
  assert.equal(out.shapeReliable, false)
  assert.equal(out.latestCapture, 62.2)
  assert.match(out.notes.capture, /62\.2%/)
  // The reader is told which charts to distrust and which to believe.
  assert.match(out.notes.capture, /when members come, not how many/)
})

test('a complete hourly feed raises no warning', () => {
  const out = buildCheckins(
    [m('2026-04-01', 'salem', 10106, 1300)], [], [],
    [{ month: '2026-04-01', monthly_total: 78258, hourly_total: 78503, capture: 100.3 }]
  )
  assert.equal(out.shapeReliable, true)
  assert.equal(out.notes.capture, null)
})

test('capture exactly at the threshold is still treated as reliable', () => {
  const out = buildCheckins([], [], [],
    [{ month: '2026-05-01', monthly_total: 100, hourly_total: 90, capture: CAPTURE_WARN_PCT }])
  assert.equal(out.shapeReliable, true)
})

test('no coverage rows at all does not fabricate a warning', () => {
  // Absence of evidence is not evidence of a broken feed.
  const out = buildCheckins([m('2026-08-01', 'salem', 100, 10)], [], [], [])
  assert.equal(out.shapeReliable, true)
  assert.equal(out.notes.capture, null)
})

test('busiest hour and day come from shares, and the day is named', () => {
  const out = buildCheckins([],
    [{ hour: 5, share: 5.63 }, { hour: 17, share: 8.7 }, { hour: 9, share: 7.49 }],
    [{ dow: 0, share: 7.89 }, { dow: 1, share: 17.49 }, { dow: 3, share: 17.48 }],
    [])
  assert.equal(out.summary.busiestHour, 17)
  assert.equal(out.summary.busiestDay, 'Monday')
})

test('period change is null against a zero prior rather than Infinity', () => {
  const out = buildCheckins([m('2026-08-01', 'salem', 100, 10)], [], [], [], { priorMonthly: [] })
  assert.equal(out.summary.checkinsChange, null)
})

test('period change is computed when there is a prior', () => {
  const out = buildCheckins([m('2026-08-01', 'salem', 110, 10)], [], [], [],
    { priorMonthly: [m('2026-07-01', 'salem', 100, 10)] })
  assert.equal(out.summary.priorCheckins, 100)
  assert.equal(out.summary.checkinsChange, 10)
})
