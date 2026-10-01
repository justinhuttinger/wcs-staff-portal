const test = require('node:test')
const assert = require('node:assert/strict')
const { pacificDay, pacificDaysBack, fetchDay, refreshCheckinDays, pruneCheckinDays } = require('./checkinDays')

test('pacificDay: the Pacific calendar day, not UTC', () => {
  // 2026-10-01 03:00 UTC is still Sep 30 in Oregon.
  assert.equal(pacificDay(new Date('2026-10-01T03:00:00Z')), '2026-09-30')
  assert.equal(pacificDay(new Date('2026-10-01T12:00:00Z')), '2026-10-01')
})

test('pacificDaysBack: today and the n-1 days before, oldest first, across a month', () => {
  assert.deepEqual(pacificDaysBack(4, new Date('2026-10-02T18:00:00Z')), ['2026-09-29', '2026-09-30', '2026-10-01', '2026-10-02'])
})

function abcPage(members, nextPage = '') {
  return { data: { status: { message: 'success', nextPage }, members } }
}
const member = (id, ...counts) => ({ memberId: id, checkInCounts: { checkInCount: counts.map(c => ({ count: String(c) })) } })

test('fetchDay: one-day Pacific range, sums counts, follows pages', async () => {
  const calls = []
  const get = async (url, opts) => {
    calls.push({ url, params: opts.params })
    return opts.params.page === 1 ? abcPage([member('a', 1, 1), member('b', 1)], '2') : abcPage([member('a', 1)])
  }
  const counts = await fetchDay('30935', '2026-09-30', { get, sleepFn: async () => {} })
  assert.deepEqual([...counts], [['a', 3], ['b', 1]])
  assert.match(calls[0].url, /\/30935\/members\/checkins\/summaries$/)
  assert.equal(calls[0].params.checkInTimestampRange, '2026-09-30 00:00:00,2026-09-30 23:59:59')
  assert.equal(calls.length, 2)
})

test('fetchDay: "No records found" is a real zero; any other empty answer throws', async () => {
  const empty = msg => async () => ({ data: { status: { message: msg }, members: [] } })
  assert.equal((await fetchDay('1', '2026-09-30', { get: empty('No records found') })).size, 0)
  await assert.rejects(fetchDay('1', '2026-09-30', { get: empty('Invalid time range') }), /Invalid time range/)
})

function fakeDb() {
  const upserts = []
  const deletes = []
  return {
    upserts, deletes,
    from: table => ({
      upsert: (rows, opts) => { upserts.push({ table, rows, opts }); return Promise.resolve({ error: null }) },
      delete: () => ({ lt: (col, val) => { deletes.push({ table, col, val }); return Promise.resolve({ error: null }) } }),
    }),
  }
}

test('refreshCheckinDays: upserts one row per member per club per day', async () => {
  const db = fakeDb()
  const get = async (url, opts) => abcPage(url.includes('/111/') ? [member('m1', 2)] : [member('m2', 1)])
  const summary = await refreshCheckinDays({
    days: 2, clubs: ['111', '222'], db, get, sleepFn: async () => {}, now: new Date('2026-09-30T18:00:00Z'),
  })
  const rows = db.upserts.flatMap(u => u.rows)
  assert.equal(db.upserts[0].table, 'abc_member_checkin_days')
  assert.equal(db.upserts[0].opts.onConflict, 'club_number,member_id,day')
  assert.deepEqual(rows.map(r => [r.club_number, r.member_id, r.day, r.checkins]), [
    ['111', 'm1', '2026-09-29', 2], ['111', 'm1', '2026-09-30', 2],
    ['222', 'm2', '2026-09-29', 1], ['222', 'm2', '2026-09-30', 1],
  ])
  assert.equal(summary.rows, 4)
  assert.equal(summary.failed.length, 0)
})

test('refreshCheckinDays: one bad club-day is reported, the rest still saved', async () => {
  const db = fakeDb()
  const get = async (url) => {
    if (url.includes('/222/')) return { data: { status: { message: 'Server busy' }, members: [] } }
    return abcPage([member('m1', 1)])
  }
  const summary = await refreshCheckinDays({ days: 1, clubs: ['111', '222'], db, get, sleepFn: async () => {}, now: new Date('2026-09-30T18:00:00Z') })
  assert.equal(summary.rows, 1)
  assert.deepEqual(summary.failed.map(f => f.club), ['222'])
})

test('pruneCheckinDays: deletes days older than the keep window', async () => {
  const db = fakeDb()
  await pruneCheckinDays({ db, keepDays: 400, now: new Date('2026-09-30T18:00:00Z') })
  assert.deepEqual(db.deletes, [{ table: 'abc_member_checkin_days', col: 'day', val: '2025-08-26' }])
})
