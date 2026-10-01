const test = require('node:test')
const assert = require('node:assert/strict')
const { runCheckinMilestonesForClub, abcOk } = require('./checkinMilestonesJob')

// Minimal chainable stand-in for the Supabase client. Each table (or rpc
// name) returns canned rows; .range() slices with PostgREST's 1000-row cap so
// pagination is exercised; inserts are recorded.
function fakeDb({ tables = {}, rpcRows = [] } = {}) {
  const inserts = []
  function builder(rows) {
    let out = rows
    let range = null
    const b = {
      select: () => b,
      eq: (col, val) => { out = out.filter(r => !(col in r) || r[col] === val); return b },
      in: (col, vals) => { out = out.filter(r => vals.includes(r[col])); return b },
      order: () => b,
      limit: n => { out = out.slice(0, n); return b },
      range: (from, to) => { range = [from, Math.min(to, from + 999)]; return b },
      maybeSingle: () => Promise.resolve({ data: out[0] || null, error: null }),
      then: (resolve, reject) => {
        const data = range ? out.slice(range[0], range[1] + 1) : out
        return Promise.resolve({ data, error: null }).then(resolve, reject)
      },
    }
    return b
  }
  return {
    inserts,
    from: name => ({
      ...builder(tables[name] || []),
      insert: row => { inserts.push({ table: name, row }); return Promise.resolve({ error: null }) },
    }),
    rpc: () => builder(rpcRows),
  }
}

const member = (id, extra = {}) => ({
  member_id: id, club_number: '30935', first_name: 'Sam', last_name: 'Lee',
  is_active: true, member_status: 'Active', membership_type: 'MONTHLY',
  sign_date: '2025-06-01', begin_date: null, since_date: null, ...extra,
})
const months = [{ club_number: '30935', month: '2025-01-01' }]
const noSleep = () => Promise.resolve()

function setup({ visits = 9, sent = [], members = [member('a1')], rpcRows, appConfig = [] } = {}) {
  return fakeDb({
    tables: { abc_member_checkin_months: months, abc_members: members, checkin_milestone_alerts: sent, app_config: appConfig },
    rpcRows: rpcRows || members.map(m => ({ member_id: m.member_id, visits })),
  })
}

test('dry run lists the member and writes nothing', async () => {
  const db = setup()
  let posts = 0
  const s = await runCheckinMilestonesForClub('30935', { dryRun: true, db, postAlert: async () => { posts++; return { ok: true } }, sleepFn: noSleep })
  assert.equal(s.backfillStart, '2025-01-01')
  assert.deepEqual(s.planned, [{ member_id: 'a1', name: 'Sam Lee', visits: 9, milestone: 10, text: 'CELEBRATE 10TH VISIT!' }])
  assert.equal(posts, 0)
  assert.equal(db.inserts.length, 0)
})

test('live run posts a show-once Green alert and logs it', async () => {
  const db = setup()
  const calls = []
  const s = await runCheckinMilestonesForClub('30935', {
    dryRun: false, db, sleepFn: noSleep,
    postAlert: async (club, id, payload) => { calls.push({ club, id, payload }); return { ok: true, data: { status: { message: 'success' } } } },
  })
  assert.deepEqual(calls, [{ club: '30935', id: 'a1', payload: { clubNumber: '30935', text: 'CELEBRATE 10TH VISIT!', color: 'Green', showOneTime: 'true', acknowledge: 'false' } }])
  assert.equal(s.posted, 1)
  assert.equal(db.inserts.length, 1)
  assert.equal(db.inserts[0].table, 'checkin_milestone_alerts')
  assert.equal(db.inserts[0].row.color, 'Green')
  assert.equal(db.inserts[0].row.milestone, 10)
})

test('already alerted for this milestone: never posted again', async () => {
  const db = setup({ sent: [{ club_number: '30935', member_id: 'a1', milestone: 10 }] })
  let posts = 0
  const s = await runCheckinMilestonesForClub('30935', { dryRun: false, db, postAlert: async () => { posts++; return { ok: true } }, sleepFn: noSleep })
  assert.equal(s.alreadySent, 1)
  assert.equal(posts, 0)
  assert.equal(db.inserts.length, 0)
})

test('Green rejected: falls back to Blue once', async () => {
  const db = setup()
  const colors = []
  const s = await runCheckinMilestonesForClub('30935', {
    dryRun: false, db, sleepFn: noSleep,
    postAlert: async (c, id, p) => { colors.push(p.color); return p.color === 'Blue' ? { ok: true, data: {} } : { ok: false, error: 'Invalid color' } },
  })
  assert.deepEqual(colors, ['Green', 'Blue'])
  assert.equal(s.posted, 1)
  assert.equal(db.inserts[0].row.color, 'Blue')
})

test('both colours rejected: no log row, so tomorrow retries', async () => {
  const db = setup()
  const s = await runCheckinMilestonesForClub('30935', { dryRun: false, db, sleepFn: noSleep, postAlert: async () => ({ ok: false, error: 'nope' }) })
  assert.equal(s.failed, 1)
  assert.equal(s.posted, 0)
  assert.equal(db.inserts.length, 0)
})

test('totals past 1000 rows are paged', async () => {
  const members = Array.from({ length: 1500 }, (_, i) => member(`m${String(i).padStart(4, '0')}`))
  const rpcRows = members.map((m, i) => ({ member_id: m.member_id, visits: i === 1400 ? 24 : 3 }))
  const db = setup({ members, rpcRows })
  const s = await runCheckinMilestonesForClub('30935', { dryRun: true, db, sleepFn: noSleep })
  assert.equal(s.members, 1500)
  assert.deepEqual(s.planned.map(p => [p.member_id, p.milestone]), [['m1400', 25]])
})

test('no check-in history for the club: nothing planned', async () => {
  const db = fakeDb({ tables: { abc_members: [member('a1')] }, rpcRows: [{ member_id: 'a1', visits: 9 }] })
  const s = await runCheckinMilestonesForClub('30935', { dryRun: true, db, sleepFn: noSleep })
  assert.equal(s.backfillStart, null)
  assert.equal(s.planned.length, 0)
})

test('member who joined before the backfill is skipped', async () => {
  const db = setup({ members: [member('a1', { since_date: '2020-02-02' })] })
  const s = await runCheckinMilestonesForClub('30935', { dryRun: true, db, sleepFn: noSleep })
  assert.equal(s.planned.length, 0)
})

test('abcOk: a 200 with a failure in the body is a failure', () => {
  assert.equal(abcOk({ status: { message: 'Invalid value for field text' } }), false)
  assert.equal(abcOk({ status: { count: '0' } }), false)
  assert.equal(abcOk({ status: { message: 'success' } }), true)
  assert.equal(abcOk({}), true)
})

const settingsRow = (lifetime) => [{ key: 'checkin_celebration_settings', value: JSON.stringify({ lifetime, rules: [] }) }]

test('uses the admin-saved milestone list', async () => {
  const db = setup({ visits: 4, appConfig: settingsRow({ enabled: true, milestones: [5, 21], repeatEvery: 0 }) })
  const s = await runCheckinMilestonesForClub('30935', { dryRun: true, db, sleepFn: noSleep })
  assert.deepEqual(s.planned.map(p => [p.milestone, p.text]), [[5, 'CELEBRATE 5TH VISIT!']])
  const db2 = setup({ visits: 9, appConfig: settingsRow({ enabled: true, milestones: [5, 21], repeatEvery: 0 }) })
  const s2 = await runCheckinMilestonesForClub('30935', { dryRun: true, db: db2, sleepFn: noSleep })
  assert.equal(s2.planned.length, 0) // 10 is no longer a milestone
})

test('lifetime switched off in admin: nothing planned', async () => {
  const db = setup({ appConfig: settingsRow({ enabled: false, milestones: [10], repeatEvery: 0 }) })
  const s = await runCheckinMilestonesForClub('30935', { dryRun: true, db, sleepFn: noSleep })
  assert.equal(s.planned.length, 0)
})

test('unreadable settings fall back to the defaults', async () => {
  const db = setup({ appConfig: [{ key: 'checkin_celebration_settings', value: '{oops' }] })
  const s = await runCheckinMilestonesForClub('30935', { dryRun: true, db, sleepFn: noSleep })
  assert.equal(s.planned[0].milestone, 10)
})
