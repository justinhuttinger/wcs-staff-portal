const test = require('node:test')
const assert = require('node:assert')
const { attributeByCoverage, overlapMinutes } = require('./shiftCoverage')

const at = (h, m = 0) => new Date(Date.UTC(2026, 7, 26, h, m)).toISOString()
const shift = (name, from, to) => ({
  user: { firstName: name.split(' ')[0], lastName: name.split(' ')[1] || '' },
  startsAt: from, endsAt: to,
})
// A job open 12:00-16:00.
const win = { from: at(12), to: at(16) }

test('somebody on for the whole window is named', () => {
  const out = attributeByCoverage(win, [shift('Kyra Scoggin', at(8), at(18))])
  assert.equal(out.attributable, true)
  assert.deepEqual(out.people.map(p => p.name), ['Kyra Scoggin'])
  assert.equal(out.people[0].pct, 100)
})

test('a shift that ended before the window opened covers nothing', () => {
  // The reason the query has to widen backwards and filter here: the server
  // cannot express "ends after", so shifts like this come back and must go.
  const out = attributeByCoverage(win, [shift('Early Bird', at(4), at(11))])
  assert.equal(out.attributable, false)
  assert.equal(out.reason, 'nobody was rostered')
})

test('a minority of the window does not name anybody', () => {
  // On for one hour of four.
  const out = attributeByCoverage(win, [shift('Passing By', at(15), at(16))])
  assert.equal(out.attributable, false)
  assert.equal(out.reason, 'nobody covered a majority of the window')
  // The coverage is still reported, so a human can look at a near miss.
  assert.equal(out.people[0].pct, 25)
})

test('two people who both covered the window are both named', () => {
  // A job left undone by a pair is a fact about both of them.
  const out = attributeByCoverage(win, [
    shift('Kyra Scoggin', at(8), at(18)),
    shift('Matt Turnquist', at(11), at(17)),
  ])
  assert.equal(out.attributable, true)
  assert.equal(out.people.length, 2)
  assert.ok(out.people.every(p => p.pct === 100))
})

test('a split shift sums rather than taking the longer half', () => {
  // 12:00-13:00 and 15:00-16:00 is two hours of four: a majority only if summed.
  const out = attributeByCoverage(
    { from: at(12), to: at(16) },
    [shift('Split Sam', at(12), at(13)), shift('Split Sam', at(14), at(16))],
    { majorityPct: 50 }
  )
  assert.equal(out.people[0].minutes, 180)
  assert.equal(out.attributable, true)
})

test('a window too wide to mean anything is refused', () => {
  const wide = { from: at(0), to: new Date(Date.UTC(2026, 7, 31)).toISOString() }
  const out = attributeByCoverage(wide, [shift('Kyra Scoggin', at(0), at(23))])
  assert.equal(out.attributable, false)
  // A job open for a week implicates everyone who worked that week.
  assert.match(out.reason, /longer than 24h/)
})

test('a window that ends before it starts is unusable, not inverted', () => {
  const out = attributeByCoverage({ from: at(16), to: at(12) }, [])
  assert.equal(out.attributable, false)
  assert.equal(out.reason, 'window ends before it starts')
})

test('a missing window is refused rather than guessed at', () => {
  assert.equal(attributeByCoverage({ from: null, to: at(16) }, []).attributable, false)
  assert.equal(attributeByCoverage(null, []).attributable, false)
})

test('a shift with no named user is ignored', () => {
  const out = attributeByCoverage(win, [
    { user: null, startsAt: at(8), endsAt: at(18) },
    { user: { firstName: '', lastName: '' }, startsAt: at(8), endsAt: at(18) },
  ])
  assert.equal(out.attributable, false)
  assert.equal(out.people.length, 0)
})

test('coverage over 100% is capped', () => {
  // Two overlapping shifts for one person would otherwise read as 200%.
  const out = attributeByCoverage(win, [
    shift('Double Booked', at(12), at(16)),
    shift('Double Booked', at(12), at(16)),
  ])
  assert.equal(out.people[0].pct, 100)
})

test('the majority bar is configurable', () => {
  const quarter = [shift('Passing By', at(15), at(16))]
  assert.equal(attributeByCoverage(win, quarter, { majorityPct: 20 }).attributable, true)
  assert.equal(attributeByCoverage(win, quarter, { majorityPct: 50 }).attributable, false)
})

test('overlap is never negative', () => {
  const a = Date.UTC(2026, 7, 26, 12), b = Date.UTC(2026, 7, 26, 16)
  assert.equal(overlapMinutes(a, b, Date.UTC(2026, 7, 26, 20), Date.UTC(2026, 7, 26, 22)), 0)
})

// ---------------------------------------------------------------------------
// Batch resolution

const { resolveUntouchedJobs } = require('./shiftCoverage')

const job = (id, over = {}) => ({
  id,
  operandio_location_id: 'loc-salem',
  available_from: at(12),
  due_at: at(16),
  ...over,
})

test('one fetch per location, not one per job', async () => {
  let calls = 0
  const fetchShifts = async () => { calls++; return [shift('Kyra Scoggin', at(8), at(18))] }
  const out = await resolveUntouchedJobs([job('a'), job('b'), job('c')], fetchShifts)
  // 489 jobs must not become 489 round trips to an external API.
  assert.equal(calls, 1)
  assert.equal(out.attributed.size, 3)
  assert.deepEqual(out.attributed.get('a').map(p => p.name), ['Kyra Scoggin'])
})

test('an Operandio outage leaves jobs unattributed instead of throwing', async () => {
  const fetchShifts = async () => { throw new Error('Operandio GraphQL HTTP 503') }
  const out = await resolveUntouchedJobs([job('a'), job('b')], fetchShifts)
  // The other four checks are still worth showing.
  assert.equal(out.attributed.size, 0)
  assert.equal(out.fetchFailures, 1)
  assert.deepEqual(out.unresolved.map(u => u.reason), ['roster unavailable', 'roster unavailable'])
})

test('locations are fetched separately', async () => {
  const seen = []
  const fetchShifts = async (loc) => { seen.push(loc); return [shift('Kyra Scoggin', at(8), at(18))] }
  await resolveUntouchedJobs(
    [job('a'), job('b', { operandio_location_id: 'loc-keizer' })], fetchShifts)
  assert.deepEqual(seen.sort(), ['loc-keizer', 'loc-salem'])
})

test('a job with no location or no window is reported, not dropped', async () => {
  const fetchShifts = async () => []
  const out = await resolveUntouchedJobs([
    job('no-loc', { operandio_location_id: null }),
    job('no-window', { due_at: null }),
  ], fetchShifts)
  assert.equal(out.attributed.size, 0)
  assert.equal(out.unresolved.length, 2)
  assert.ok(out.unresolved.every(u => u.reason === 'no location or window on the job'))
})
