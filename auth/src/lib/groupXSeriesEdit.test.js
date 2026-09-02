const test = require('node:test')
const assert = require('node:assert')
const { seriesBelongsToClub, selectSeriesTargets, pairOccurrences } = require('./groupXSeriesEdit')

const baseSeries = {
  id: 'series-1',
  club_number: '7655',
  event_type_id: 'et-1',
  employee_id: 'emp-1',
  start_time: '06:00:00',
  weekdays: [1, 3], // Mon, Wed
  starts_on: '2026-01-01',
  ends_on: null,
  materialized_through: '2026-12-01',
  canceled_at: null,
}

// ---------------------------------------------------------------------------
// seriesBelongsToClub
// ---------------------------------------------------------------------------

test('seriesBelongsToClub: true when the club matches and the series is live', () => {
  assert.strictEqual(seriesBelongsToClub(baseSeries, '7655'), true)
})

test('seriesBelongsToClub: club numbers compare as strings, so a numeric claim still matches', () => {
  assert.strictEqual(seriesBelongsToClub(baseSeries, 7655), true)
})

test('seriesBelongsToClub: false for a mismatched club -- the cross-tenant case', () => {
  assert.strictEqual(seriesBelongsToClub(baseSeries, '9999'), false)
})

test('seriesBelongsToClub: false for a cancelled series even when the club matches', () => {
  assert.strictEqual(seriesBelongsToClub({ ...baseSeries, canceled_at: '2026-08-01T00:00:00Z' }, '7655'), false)
})

test('seriesBelongsToClub: false for a missing series', () => {
  assert.strictEqual(seriesBelongsToClub(null, '7655'), false)
})

// ---------------------------------------------------------------------------
// selectSeriesTargets
// ---------------------------------------------------------------------------

function abcEvent(overrides) {
  return {
    event_id: 'abc-1',
    event_type_id: 'et-1',
    employee_id: 'emp-1',
    event_timestamp_local: '2026-09-07 06:00:00', // a Monday
    ...overrides,
  }
}

test('selectSeriesTargets: linked rows on/after fromDate are included', () => {
  const targets = selectSeriesTargets({
    series: baseSeries,
    fromDate: '2026-09-01',
    linkedRows: [
      { abc_event_id: 'e1', event_date: '2026-09-07' },
      { abc_event_id: 'e2', event_date: '2026-08-31' }, // before fromDate -- excluded
    ],
    abcEvents: [],
  })
  assert.deepStrictEqual(targets, [{ event_id: 'e1', date: '2026-09-07' }])
})

test('selectSeriesTargets: unlinked ABC events are matched by shape and included', () => {
  const targets = selectSeriesTargets({
    series: baseSeries,
    fromDate: '2026-09-01',
    linkedRows: [],
    abcEvents: [abcEvent({ event_id: 'abc-1' })],
  })
  assert.deepStrictEqual(targets, [{ event_id: 'abc-1', date: '2026-09-07' }])
})

test('selectSeriesTargets: an ABC event that does not match the series shape is excluded', () => {
  const targets = selectSeriesTargets({
    series: baseSeries,
    fromDate: '2026-09-01',
    linkedRows: [],
    abcEvents: [abcEvent({ event_id: 'abc-1', employee_id: 'someone-else' })],
  })
  assert.deepStrictEqual(targets, [])
})

test('selectSeriesTargets: an ABC event before fromDate is excluded even if it matches', () => {
  const targets = selectSeriesTargets({
    series: baseSeries,
    fromDate: '2026-09-10',
    linkedRows: [],
    abcEvents: [abcEvent({ event_id: 'abc-1', event_timestamp_local: '2026-09-07 06:00:00' })],
  })
  assert.deepStrictEqual(targets, [])
})

test('selectSeriesTargets: de-duplicates by event id, the linked row winning over inference', () => {
  const targets = selectSeriesTargets({
    series: baseSeries,
    fromDate: '2026-09-01',
    linkedRows: [{ abc_event_id: 'abc-1', event_date: '2026-09-07' }],
    // Same id, but the shape-inferred date is wrong -- if inference won this
    // silently, a stale/incorrect date would leak into the result.
    abcEvents: [abcEvent({ event_id: 'abc-1', event_timestamp_local: '2026-09-14 06:00:00' })],
  })
  assert.deepStrictEqual(targets, [{ event_id: 'abc-1', date: '2026-09-07' }])
})

test('selectSeriesTargets: results are sorted by date', () => {
  const targets = selectSeriesTargets({
    series: baseSeries,
    fromDate: '2026-09-01',
    linkedRows: [
      { abc_event_id: 'e2', event_date: '2026-09-14' },
      { abc_event_id: 'e1', event_date: '2026-09-07' },
    ],
    abcEvents: [],
  })
  assert.deepStrictEqual(targets.map(t => t.event_id), ['e1', 'e2'])
})

// ---------------------------------------------------------------------------
// pairOccurrences
// ---------------------------------------------------------------------------

test('pairOccurrences: a date on both sides pairs old with new', () => {
  const targets = [{ event_id: 'old-1', date: '2026-09-07' }]
  const occurrences = [{ date: '2026-09-07', timestamp_local: '2026-09-07 07:00:00' }]
  const { paired, createOnly, cancelOnly } = pairOccurrences(targets, occurrences)
  assert.deepStrictEqual(paired, [{ old: targets[0], occ: occurrences[0] }])
  assert.deepStrictEqual(createOnly, [])
  assert.deepStrictEqual(cancelOnly, [])
})

test('pairOccurrences: a new date with no old target is create-only (a weekday added)', () => {
  const occurrences = [{ date: '2026-09-09', timestamp_local: '2026-09-09 07:00:00' }]
  const { paired, createOnly, cancelOnly } = pairOccurrences([], occurrences)
  assert.deepStrictEqual(paired, [])
  assert.deepStrictEqual(createOnly, occurrences)
  assert.deepStrictEqual(cancelOnly, [])
})

test('pairOccurrences: an old date with no new match is cancel-only (a weekday removed)', () => {
  const targets = [{ event_id: 'old-1', date: '2026-09-09' }]
  const { paired, createOnly, cancelOnly } = pairOccurrences(targets, [])
  assert.deepStrictEqual(paired, [])
  assert.deepStrictEqual(createOnly, [])
  assert.deepStrictEqual(cancelOnly, targets)
})

test('pairOccurrences: a mix of matched, added and removed weekdays partitions correctly', () => {
  const targets = [
    { event_id: 'old-mon', date: '2026-09-07' },
    { event_id: 'old-wed', date: '2026-09-09' },
  ]
  const occurrences = [
    { date: '2026-09-07', timestamp_local: '2026-09-07 07:00:00' }, // kept, edited
    { date: '2026-09-11', timestamp_local: '2026-09-11 07:00:00' }, // added
  ]
  const { paired, createOnly, cancelOnly } = pairOccurrences(targets, occurrences)
  assert.deepStrictEqual(paired, [{ old: targets[0], occ: occurrences[0] }])
  assert.deepStrictEqual(createOnly, [occurrences[1]])
  assert.deepStrictEqual(cancelOnly, [targets[1]])
})

test('pairOccurrences: duplicate old targets on the same date only pair the first, the rest fall to cancelOnly', () => {
  const targets = [
    { event_id: 'old-a', date: '2026-09-07' },
    { event_id: 'old-b', date: '2026-09-07' },
  ]
  const occurrences = [{ date: '2026-09-07', timestamp_local: '2026-09-07 07:00:00' }]
  const { paired, cancelOnly } = pairOccurrences(targets, occurrences)
  assert.deepStrictEqual(paired, [{ old: targets[0], occ: occurrences[0] }])
  assert.deepStrictEqual(cancelOnly, [targets[1]])
})

test('pairOccurrences: nothing on either side is a no-op', () => {
  const { paired, createOnly, cancelOnly } = pairOccurrences([], [])
  assert.deepStrictEqual(paired, [])
  assert.deepStrictEqual(createOnly, [])
  assert.deepStrictEqual(cancelOnly, [])
})
