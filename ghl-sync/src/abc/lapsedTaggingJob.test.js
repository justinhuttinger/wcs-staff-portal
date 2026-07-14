const test = require('node:test')
const assert = require('node:assert')
const { runLapsedTaggingForLocation } = require('./lapsedTaggingJob')

const LOCATION = { id: 'loc_1', apiKey: 'test-key', name: 'TestClub', slug: 'testclub', clubNumber: '99999' }
const FIELD_DEFS = [{ id: 'fld_member_id', field_key: 'contact.abc_member_id' }]

// Fixed "now": 2026-07-14 12:00 PT
const NOW = new Date('2026-07-14T19:00:00Z')

function baseMembers() {
  return [
    { // eligible, lapsed 43 days -> lapsed-30d, matched contact has no lapsed tag yet
      member_id: 'M1', club_number: '99999', email: 'm1@example.com', primary_phone: '5035551001',
      mobile_phone: null, first_name: 'One', last_name: 'Lapsed', is_active: true, member_status: 'Active',
      membership_type: 'SINGLE', last_check_in_timestamp: '2026-06-01', sign_date: '2025-01-01',
      begin_date: null, since_date: null,
    },
    { // eligible, checked in yesterday -> tier null, matched contact currently holds lapsed-10d
      member_id: 'M2', club_number: '99999', email: 'm2@example.com', primary_phone: '5035551002',
      mobile_phone: null, first_name: 'Two', last_name: 'Recent', is_active: true, member_status: 'Active',
      membership_type: 'SINGLE', last_check_in_timestamp: '2026-07-13', sign_date: '2025-01-01',
      begin_date: null, since_date: null,
    },
    { // excluded membership type (CORP is in SEED_EXCLUDED_TYPES) -> must be skipped entirely
      member_id: 'M3', club_number: '99999', email: 'm3@example.com', primary_phone: '5035551003',
      mobile_phone: null, first_name: 'Three', last_name: 'Corp', is_active: true, member_status: 'Active',
      membership_type: 'CORP', last_check_in_timestamp: '2026-01-01', sign_date: '2025-01-01',
      begin_date: null, since_date: null,
    },
    { // eligible, lapsed, but no matching GHL contact
      member_id: 'M4', club_number: '99999', email: 'unknown@example.com', primary_phone: '5035559999',
      mobile_phone: null, first_name: 'Four', last_name: 'NoMatch', is_active: true, member_status: 'Active',
      membership_type: 'SINGLE', last_check_in_timestamp: '2026-05-01', sign_date: '2025-01-01',
      begin_date: null, since_date: null,
    },
  ]
}

function baseContacts() {
  return [
    {
      id: 'ghl_1', email: 'm1@example.com', phone: '+15035551001', first_name: 'One', last_name: 'Lapsed',
      tags: ['sale'], custom_fields: { fld_member_id: 'M1' },
    },
    {
      id: 'ghl_2', email: 'm2@example.com', phone: '+15035551002', first_name: 'Two', last_name: 'Recent',
      tags: ['sale', 'lapsed-10d'], custom_fields: { fld_member_id: 'M2' },
    },
  ]
}

function makeFakeDb({ members, contacts, fieldDefs, appConfigValue } = {}) {
  const inserted = { abc_sync_run_log: [] }
  const tables = {
    abc_members: members || [],
    ghl_contacts_v2: contacts || [],
    ghl_custom_field_defs: fieldDefs || [],
  }
  const db = {
    from(table) {
      if (table === 'app_config') {
        const builder = {
          select() { return builder },
          eq() { return builder },
          maybeSingle() {
            return Promise.resolve({
              data: appConfigValue === undefined ? null : { value: appConfigValue },
              error: null,
            })
          },
        }
        return builder
      }
      if (table === 'abc_sync_run_log') {
        return {
          insert(rows) {
            inserted.abc_sync_run_log.push(...rows)
            return Promise.resolve({ error: null })
          },
        }
      }
      const rows = tables[table] || []
      const builder = {
        _from: null,
        _to: null,
        select() { return builder },
        eq() { return builder },
        gte() { return builder },
        limit() { return builder },
        range(from, to) { builder._from = from; builder._to = to; return builder },
        then(resolve, reject) {
          const data = builder._from == null ? rows : rows.slice(builder._from, builder._to + 1)
          return Promise.resolve({ data, error: null }).then(resolve, reject)
        },
      }
      return builder
    },
  }
  return { db, inserted }
}

function makeFakePut() {
  const calls = []
  const put = async (path, body, apiKey) => {
    calls.push({ path, body, apiKey })
    return { contact: { id: path.split('/').pop() } }
  }
  return { put, calls }
}

// Fake `get` — by default returns whatever tags are on the matching cached
// contact (so the live-GET refresh is a no-op vs. the cache unless a test
// overrides `tagsById` to simulate the live contact having drifted).
function makeFakeGet(contactsById, tagsById = {}) {
  const calls = []
  const get = async (path, params, apiKey) => {
    calls.push({ path, params, apiKey })
    const id = path.split('/').pop()
    const tags = Object.prototype.hasOwnProperty.call(tagsById, id)
      ? tagsById[id]
      : (contactsById.get(id)?.tags || [])
    return { contact: { id, tags } }
  }
  return { get, calls }
}

const noopSleep = async () => {}

test('runLapsedTaggingForLocation: applied run tags lapsed members, clears recovered members, skips excluded types, counts no-match', async () => {
  const contactsById = new Map(baseContacts().map(c => [c.id, c]))
  const { db, inserted } = makeFakeDb({
    members: baseMembers(),
    contacts: baseContacts(),
    fieldDefs: FIELD_DEFS,
  })
  const { put, calls } = makeFakePut()
  const { get, calls: getCalls } = makeFakeGet(contactsById)

  const summary = await runLapsedTaggingForLocation(LOCATION, {
    dryRun: false, db, now: NOW, get, put, sleepFn: noopSleep,
  })

  assert.strictEqual(summary.evaluated, 4)
  assert.strictEqual(summary.matched, 2) // M1, M2 matched; M3 excluded before matching; M4 no match
  assert.strictEqual(summary.noMatch, 1) // M4
  assert.strictEqual(summary.tagged, 1) // M1
  assert.strictEqual(summary.cleared, 1) // M2
  assert.deepStrictEqual(summary.byTier['lapsed-30d'], 1)

  // A live GET happened for both changed contacts before the write, and the
  // write reflects the (here, unchanged) freshly-fetched tags as its base.
  assert.strictEqual(getCalls.length, 2)
  assert.ok(getCalls.some(c => c.path === '/contacts/ghl_1'))
  assert.ok(getCalls.some(c => c.path === '/contacts/ghl_2'))

  // Exactly two PUT calls: one per changed contact (M1 tag add, M2 tag remove)
  assert.strictEqual(calls.length, 2)
  const m1Call = calls.find(c => c.path === '/contacts/ghl_1')
  assert.ok(m1Call, 'expected a PUT for the lapsed member contact')
  assert.deepStrictEqual(new Set(m1Call.body.tags), new Set(['sale', 'lapsed-30d']))
  assert.strictEqual(m1Call.apiKey, 'test-key')

  const m2Call = calls.find(c => c.path === '/contacts/ghl_2')
  assert.ok(m2Call, 'expected a PUT clearing the lapsed tag for the recovered member contact')
  assert.deepStrictEqual(new Set(m2Call.body.tags), new Set(['sale']))

  // No PUT for the excluded-type member's contact (there isn't one, but also
  // no attempt/log entry referencing M3 at all).
  assert.ok(!inserted.abc_sync_run_log.some(e => e.abc_member_id === 'M3'))

  // Run-log rows written and marked applied for the real (non-dry-run) writes.
  const addEntry = inserted.abc_sync_run_log.find(e => e.abc_member_id === 'M1' && e.action === 'add_tag')
  assert.ok(addEntry)
  assert.strictEqual(addEntry.applied, true)
  assert.strictEqual(addEntry.dry_run, false)
  assert.strictEqual(addEntry.detail.tag, 'lapsed-30d')

  const removeEntry = inserted.abc_sync_run_log.find(e => e.abc_member_id === 'M2' && e.action === 'remove_tag')
  assert.ok(removeEntry)
  assert.strictEqual(removeEntry.applied, true)
  assert.strictEqual(removeEntry.detail.tag, 'lapsed-10d')
})

test('runLapsedTaggingForLocation: live GET is used as the write base — fresh tags differing from cache are preserved, and a fresh no-op is skipped', async () => {
  const contacts = baseContacts()
  const contactsById = new Map(contacts.map(c => [c.id, c]))
  const { db, inserted } = makeFakeDb({
    members: baseMembers(),
    contacts,
    fieldDefs: FIELD_DEFS,
  })
  const { put, calls } = makeFakePut()
  // Simulate live drift since the cache was populated:
  //  - ghl_1 (M1, cache wants lapsed-30d added) already got tagged lapsed-30d
  //    live (e.g. by a concurrent run) AND picked up an unrelated 'vip' tag —
  //    the fresh diff for lapsed-30d is a no-op, so the write must be skipped
  //    entirely, and the 'vip' tag must never be touched.
  //  - ghl_2 (M2, cache wants lapsed-10d removed) still has it live too, but
  //    also picked up 'vip' live — the write must use the fresh tag list
  //    (including 'vip') as its base, not the stale cached one.
  const { get, calls: getCalls } = makeFakeGet(contactsById, {
    ghl_1: ['sale', 'vip', 'lapsed-30d'],
    ghl_2: ['sale', 'vip', 'lapsed-10d'],
  })

  const summary = await runLapsedTaggingForLocation(LOCATION, {
    dryRun: false, db, now: NOW, get, put, sleepFn: noopSleep,
  })

  assert.strictEqual(getCalls.length, 2, 'a live GET happens for every member whose cached diff looked like a change')

  // ghl_1: fresh diff is a no-op (lapsed-30d already present live) -> no PUT
  assert.ok(!calls.some(c => c.path === '/contacts/ghl_1'), 'no write when the fresh diff is a no-op')
  assert.ok(!inserted.abc_sync_run_log.some(e => e.abc_member_id === 'M1'), 'no log row for a fresh no-op')
  assert.strictEqual(summary.tagged, 0, 'not counted as tagged since the fresh state already matched')

  // ghl_2: fresh diff still needs the tag removed, using the fresh tag list as the base
  const m2Call = calls.find(c => c.path === '/contacts/ghl_2')
  assert.ok(m2Call, 'expected a PUT for ghl_2 built off the fresh (live) tags')
  assert.deepStrictEqual(new Set(m2Call.body.tags), new Set(['sale', 'vip']))
  assert.strictEqual(summary.cleared, 1)
})

test('runLapsedTaggingForLocation: dryRun makes no PUT calls but still writes run-log rows', async () => {
  const contactsById = new Map(baseContacts().map(c => [c.id, c]))
  const { db, inserted } = makeFakeDb({
    members: baseMembers(),
    contacts: baseContacts(),
    fieldDefs: FIELD_DEFS,
  })
  const { put, calls } = makeFakePut()
  const { get, calls: getCalls } = makeFakeGet(contactsById)

  const summary = await runLapsedTaggingForLocation(LOCATION, {
    dryRun: true, db, now: NOW, get, put, sleepFn: noopSleep,
  })

  assert.strictEqual(calls.length, 0, 'dry run must never call put()')
  assert.strictEqual(getCalls.length, 0, 'dry run must never call get() either — no live GET needed for an intended-only change')
  assert.strictEqual(summary.tagged, 1)
  assert.strictEqual(summary.cleared, 1)

  assert.ok(inserted.abc_sync_run_log.length >= 2)
  for (const entry of inserted.abc_sync_run_log) {
    assert.strictEqual(entry.dry_run, true)
    assert.strictEqual(entry.applied, false)
    assert.strictEqual(entry.detail.note, 'dry_run')
  }
})

test('runLapsedTaggingForLocation: no-op members produce no log rows or PUT calls', async () => {
  const members = [
    { // already correctly tagged -> no change
      member_id: 'M5', club_number: '99999', email: 'm5@example.com', primary_phone: '5035551005',
      mobile_phone: null, first_name: 'Five', last_name: 'InSync', is_active: true, member_status: 'Active',
      membership_type: 'SINGLE', last_check_in_timestamp: '2026-06-01', sign_date: '2025-01-01',
      begin_date: null, since_date: null,
    },
  ]
  const contacts = [
    {
      id: 'ghl_5', email: 'm5@example.com', phone: '+15035551005', first_name: 'Five', last_name: 'InSync',
      tags: ['sale', 'lapsed-30d'], custom_fields: { fld_member_id: 'M5' },
    },
  ]
  const { db, inserted } = makeFakeDb({ members, contacts, fieldDefs: FIELD_DEFS })
  const { put, calls } = makeFakePut()
  const { get, calls: getCalls } = makeFakeGet(new Map(contacts.map(c => [c.id, c])))

  const summary = await runLapsedTaggingForLocation(LOCATION, {
    dryRun: false, db, now: NOW, get, put, sleepFn: noopSleep,
  })

  assert.strictEqual(summary.matched, 1)
  assert.strictEqual(summary.tagged, 0)
  assert.strictEqual(summary.cleared, 0)
  assert.strictEqual(calls.length, 0)
  assert.strictEqual(getCalls.length, 0, 'no plausible change from cache -> no live GET spent on this member')
  assert.strictEqual(inserted.abc_sync_run_log.length, 0)
})

test('runLapsedTaggingForLocation: blank sign_date falls through to begin_date (not treated as null)', async () => {
  const members = [
    { // sign_date is an empty string (not null/undefined) -> must fall through
      // to begin_date, same as auth's resolveActivityDate. begin_date is far
      // enough in the past to land in lapsed-30d if used, but never used as
      // the days-since input directly here — only as the join-date fallback
      // for daysSince() when last_check_in_timestamp is also absent.
      member_id: 'M6', club_number: '99999', email: 'm6@example.com', primary_phone: '5035551006',
      mobile_phone: null, first_name: 'Six', last_name: 'BlankSign', is_active: true, member_status: 'Active',
      membership_type: 'SINGLE', last_check_in_timestamp: null, sign_date: '',
      begin_date: '2025-01-01', since_date: null,
    },
  ]
  const contacts = [
    {
      id: 'ghl_6', email: 'm6@example.com', phone: '+15035551006', first_name: 'Six', last_name: 'BlankSign',
      tags: ['sale'], custom_fields: { fld_member_id: 'M6' },
    },
  ]
  const { db, inserted } = makeFakeDb({ members, contacts, fieldDefs: FIELD_DEFS })
  const { put, calls } = makeFakePut()
  const { get, calls: getCalls } = makeFakeGet(new Map(contacts.map(c => [c.id, c])))

  const summary = await runLapsedTaggingForLocation(LOCATION, {
    dryRun: false, db, now: NOW, get, put, sleepFn: noopSleep,
  })

  // If sign_date's blank string were kept (instead of falling through to
  // begin_date), daysSince would receive join=null and the member would be
  // treated as non-lapsed (tier null, no tag change, no PUT). Asserting a
  // tag write here proves begin_date was actually used.
  assert.strictEqual(summary.matched, 1)
  assert.strictEqual(summary.tagged, 1)
  assert.strictEqual(calls.length, 1)
  const m6Call = calls.find(c => c.path === '/contacts/ghl_6')
  assert.ok(m6Call, 'expected a PUT tagging the member off the begin_date fallback')
  assert.deepStrictEqual(new Set(m6Call.body.tags), new Set(['sale', 'lapsed-30d']))
  assert.ok(inserted.abc_sync_run_log.some(e => e.abc_member_id === 'M6'))
})

test('runLapsedTaggingForLocation: pagination — reads all rows across multiple pages for both abc_members and ghl_contacts_v2', async () => {
  const TOTAL = 1200 // > Supabase's 1000-row default page, forces 2 pages each
  const members = []
  const contacts = []
  for (let i = 0; i < TOTAL; i++) {
    const id = `P${i}`
    members.push({
      member_id: id, club_number: '99999', email: `${id.toLowerCase()}@example.com`,
      primary_phone: null, mobile_phone: null, first_name: 'Page', last_name: `Member${i}`,
      is_active: true, member_status: 'Active', membership_type: 'SINGLE',
      // Checked in yesterday relative to NOW -> tier null, no tag change -> no PUT/GET noise.
      last_check_in_timestamp: '2026-07-13', sign_date: '2025-01-01', begin_date: null, since_date: null,
    })
    contacts.push({
      id: `ghl_${id}`, email: `${id.toLowerCase()}@example.com`, phone: null,
      first_name: 'Page', last_name: `Member${i}`, tags: [], custom_fields: { fld_member_id: id },
    })
  }

  const { db } = makeFakeDb({ members, contacts, fieldDefs: FIELD_DEFS })
  const { put } = makeFakePut()
  const { get } = makeFakeGet(new Map(contacts.map(c => [c.id, c])))

  const summary = await runLapsedTaggingForLocation(LOCATION, {
    dryRun: false, db, now: NOW, get, put, sleepFn: noopSleep,
  })

  // All 1200 members must have been fetched (not truncated to 1000) and all
  // 1200 must have matched a contact — which is only possible if the
  // ghl_contacts_v2 page beyond row 1000 was fetched too, since contactIndex
  // is built from the full `contacts` array.
  assert.strictEqual(summary.evaluated, TOTAL)
  assert.strictEqual(summary.matched, TOTAL)
  assert.strictEqual(summary.noMatch, 0)
})
