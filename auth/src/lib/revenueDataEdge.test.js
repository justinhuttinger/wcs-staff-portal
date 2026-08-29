const test = require('node:test')
const assert = require('node:assert')
const { latestRevenueDay, clampToRevenueEdge, edgeNote } = require('./revenueDataEdge')

test('a window ending after the edge is pulled back to it', () => {
  const c = clampToRevenueEdge('2026-08-01', '2026-08-28', '2026-08-27')
  assert.equal(c.end, '2026-08-27')
  assert.equal(c.start, '2026-08-01')   // the start never moves
  assert.equal(c.clamped, true)
})

test('a window already inside the data is left alone', () => {
  const c = clampToRevenueEdge('2026-07-01', '2026-07-31', '2026-08-27')
  assert.deepEqual([c.start, c.end], ['2026-07-01', '2026-07-31'])
  assert.equal(c.clamped, false)
  assert.equal(edgeNote(c), null)
})

test('a window ending exactly on the edge is not clamped', () => {
  const c = clampToRevenueEdge('2026-08-01', '2026-08-27', '2026-08-27')
  assert.equal(c.clamped, false)
  assert.equal(c.end, '2026-08-27')
})

test('the end is never pushed forward to reach the edge', () => {
  // Extending a window would invent data the reader did not ask for.
  const c = clampToRevenueEdge('2026-06-01', '2026-06-30', '2026-08-27')
  assert.equal(c.end, '2026-06-30')
})

test('a window entirely past the edge is reported empty, not rewritten', () => {
  // Pulling `end` back here would make end < start and silently show a
  // different period than the one asked for.
  const c = clampToRevenueEdge('2026-09-01', '2026-09-30', '2026-08-27')
  assert.equal(c.empty, true)
  assert.equal(c.clamped, false)
  assert.deepEqual([c.start, c.end], ['2026-09-01', '2026-09-30'])
  assert.match(edgeNote(c), /nothing to show yet/)
})

test('with no edge known nothing is changed and nothing is claimed', () => {
  const c = clampToRevenueEdge('2026-08-01', '2026-08-28', null)
  assert.equal(c.clamped, false)
  assert.equal(c.end, '2026-08-28')
  assert.equal(edgeNote(c), null)
})

test('the note names the edge so the number can be checked', () => {
  const c = clampToRevenueEdge('2026-08-01', '2026-08-28', '2026-08-27')
  c.requestedEnd = '2026-08-28'
  const note = edgeNote(c)
  assert.match(note, /runs to 2026-08-27/)
  assert.match(note, /rather than at 2026-08-28/)
  assert.match(note, /understate/)
})

test('the edge is read from the data and cached, not assumed to be yesterday', () => {
  // Hardcoding "one day back" produces the exact bug this exists to prevent the
  // moment the import falls two days behind.
  let calls = 0
  const cache = new Map()
  const wrap = async (key, ttl, producer) => {
    if (cache.has(key)) return cache.get(key)
    const v = await producer()
    cache.set(key, v)
    return v
  }
  const supabase = {
    from() { return this },
    select() { return this },
    order() { return this },
    limit() { return this },
    maybeSingle() { calls += 1; return Promise.resolve({ data: { payment_date: '2026-08-25' } }) },
  }

  // Sequential: this asserts the value is CACHED between reports, not that the
  // cache dedupes two simultaneous misses, which is the cache's business.
  return latestRevenueDay(supabase, wrap)
    .then(a => {
      assert.equal(a, '2026-08-25')
      return latestRevenueDay(supabase, wrap)
    })
    .then(b => {
      assert.equal(b, '2026-08-25')
      assert.equal(calls, 1, 'the lookup is cached across reports')
    })
})

test('an empty revenue table yields null rather than a fabricated date', () => {
  const wrap = async (k, t, p) => p()
  const supabase = {
    from() { return this },
    select() { return this },
    order() { return this },
    limit() { return this },
    maybeSingle() { return Promise.resolve({ data: null }) },
  }
  return latestRevenueDay(supabase, wrap).then(v => assert.equal(v, null))
})
