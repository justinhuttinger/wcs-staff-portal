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
        select() { return builder },
        eq() { return builder },
        limit() { return builder },
        then(resolve, reject) {
          return Promise.resolve({ data: rows, error: null }).then(resolve, reject)
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

const noopSleep = async () => {}

test('runLapsedTaggingForLocation: applied run tags lapsed members, clears recovered members, skips excluded types, counts no-match', async () => {
  const { db, inserted } = makeFakeDb({
    members: baseMembers(),
    contacts: baseContacts(),
    fieldDefs: FIELD_DEFS,
  })
  const { put, calls } = makeFakePut()

  const summary = await runLapsedTaggingForLocation(LOCATION, {
    dryRun: false, db, now: NOW, put, sleepFn: noopSleep,
  })

  assert.strictEqual(summary.evaluated, 4)
  assert.strictEqual(summary.matched, 2) // M1, M2 matched; M3 excluded before matching; M4 no match
  assert.strictEqual(summary.noMatch, 1) // M4
  assert.strictEqual(summary.tagged, 1) // M1
  assert.strictEqual(summary.cleared, 1) // M2
  assert.deepStrictEqual(summary.byTier['lapsed-30d'], 1)

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

test('runLapsedTaggingForLocation: dryRun makes no PUT calls but still writes run-log rows', async () => {
  const { db, inserted } = makeFakeDb({
    members: baseMembers(),
    contacts: baseContacts(),
    fieldDefs: FIELD_DEFS,
  })
  const { put, calls } = makeFakePut()

  const summary = await runLapsedTaggingForLocation(LOCATION, {
    dryRun: true, db, now: NOW, put, sleepFn: noopSleep,
  })

  assert.strictEqual(calls.length, 0, 'dry run must never call put()')
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

  const summary = await runLapsedTaggingForLocation(LOCATION, {
    dryRun: false, db, now: NOW, put, sleepFn: noopSleep,
  })

  assert.strictEqual(summary.matched, 1)
  assert.strictEqual(summary.tagged, 0)
  assert.strictEqual(summary.cleared, 0)
  assert.strictEqual(calls.length, 0)
  assert.strictEqual(inserted.abc_sync_run_log.length, 0)
})
