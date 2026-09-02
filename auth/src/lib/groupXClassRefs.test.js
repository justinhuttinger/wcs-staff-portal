const test = require('node:test')
const assert = require('node:assert')
const fs = require('node:fs')
const path = require('node:path')

// Stub supabaseAdmin before groupXClassRefs loads it: a chainable double whose
// .update().eq().eq() resolves per-table so each test controls exactly which
// table errors.
let updateCalls = []
let errorsByTable = {}

function queryStub(table) {
  return {
    // update().eq(club).eq(oldId) — the code under test only ever chains two
    // .eq() calls, so the first returns another eq()-bearing object and the
    // second resolves.
    update(patch) {
      const call = { table, patch, filters: {} }
      updateCalls.push(call)
      return {
        eq(col1, val1) {
          call.filters[col1] = val1
          return {
            eq(col2, val2) {
              call.filters[col2] = val2
              return Promise.resolve({ error: errorsByTable[table] || null })
            },
          }
        },
      }
    },
  }
}

require.cache[require.resolve(path.join(__dirname, '..', 'services', 'supabase.js'))] = {
  id: 'supabase-stub', filename: 'supabase-stub', loaded: true,
  exports: { supabaseAdmin: { from: queryStub } },
}

const { REF_TABLES, moveClassRefs } = require('./groupXClassRefs')

test.beforeEach(() => {
  updateCalls = []
  errorsByTable = {}
})

// ---------------------------------------------------------------------------
// REF_TABLES coverage — the whole point of this test file. A table added
// later with an abc_event_id column and no entry here is exactly how an
// orphaned reference happens after the next edit.
// ---------------------------------------------------------------------------

test('REF_TABLES covers every migrations table with an abc_event_id column, except the documented exclusion', () => {
  const migrationsDir = path.join(__dirname, '..', '..', 'migrations')
  const files = fs.readdirSync(migrationsDir).filter(f => f.endsWith('.sql'))

  const tablesWithColumn = new Set()
  for (const file of files) {
    const sql = fs.readFileSync(path.join(migrationsDir, file), 'utf8')
    // Match "create table ... (" blocks and check whether abc_event_id is
    // declared inside. Simple line-scan: track the current table name and
    // flag it the moment an abc_event_id column line is seen before the
    // block's closing.
    const lines = sql.split('\n')
    let currentTable = null
    for (const line of lines) {
      const createMatch = line.match(/create table if not exists\s+(\w+)/i)
      if (createMatch) currentTable = createMatch[1]
      if (currentTable && /^\s*abc_event_id\s+text/i.test(line)) {
        tablesWithColumn.add(currentTable)
      }
      if (currentTable && /^\);/.test(line)) currentTable = null
    }
  }

  // Sanity check the scan actually found something, so a regex typo above
  // does not make this test vacuously pass.
  assert.ok(tablesWithColumn.size > 0, 'expected to find at least one table with abc_event_id in migrations')

  const EXCLUDED = new Set(['class_seed_log'])
  const expected = [...tablesWithColumn].filter(t => !EXCLUDED.has(t)).sort()
  const covered = REF_TABLES.map(r => r.table).sort()

  assert.deepStrictEqual(covered, expected)
  // And the exclusion is real, not accidental — class_seed_log does exist and
  // does have the column, it is just intentionally left out.
  assert.ok(tablesWithColumn.has('class_seed_log'))
  assert.ok(!covered.includes('class_seed_log'))
})

// ---------------------------------------------------------------------------
// moveClassRefs behavior
// ---------------------------------------------------------------------------

test('moveClassRefs updates every ref table to the new event id, scoped to the club and old id', async () => {
  const result = await moveClassRefs('7655', 'old-1', 'new-1', '2026-09-10', 'Yoga')
  assert.strictEqual(updateCalls.length, 3)
  for (const call of updateCalls) {
    assert.strictEqual(call.patch.abc_event_id, 'new-1')
    assert.strictEqual(call.filters.club_number, '7655')
    assert.strictEqual(call.filters.abc_event_id, 'old-1')
  }
  assert.deepStrictEqual(result, { badge_error: null, link_error: null, attendance_error: null })
})

test('moveClassRefs carries the new date onto group_x_series_events', async () => {
  await moveClassRefs('7655', 'old-1', 'new-1', '2026-09-10', 'Yoga')
  const seriesCall = updateCalls.find(c => c.table === 'group_x_series_events')
  assert.strictEqual(seriesCall.patch.event_date, '2026-09-10')
})

test('moveClassRefs carries a changed class name onto group_x_new_class_events', async () => {
  await moveClassRefs('7655', 'old-1', 'new-1', '2026-09-10', 'Power Yoga')
  const badgeCall = updateCalls.find(c => c.table === 'group_x_new_class_events')
  assert.strictEqual(badgeCall.patch.class_name, 'Power Yoga')
})

test('moveClassRefs tolerates a missing date or class name without adding undefined columns', async () => {
  await moveClassRefs('7655', 'old-1', 'new-1')
  const seriesCall = updateCalls.find(c => c.table === 'group_x_series_events')
  const badgeCall = updateCalls.find(c => c.table === 'group_x_new_class_events')
  assert.ok(!('event_date' in seriesCall.patch))
  assert.ok(!('class_name' in badgeCall.patch))
})

test('moveClassRefs is best-effort: one table failing does not stop the others or throw', async () => {
  errorsByTable.group_x_series_events = { message: 'link table unreachable' }
  const result = await moveClassRefs('7655', 'old-1', 'new-1', '2026-09-10', 'Yoga')
  assert.strictEqual(updateCalls.length, 3)
  assert.strictEqual(result.link_error, 'link table unreachable')
  assert.strictEqual(result.badge_error, null)
  assert.strictEqual(result.attendance_error, null)
})

test('moveClassRefs reports each table under its own error key', async () => {
  errorsByTable.group_x_new_class_events = { message: 'badge move failed' }
  errorsByTable.group_x_class_attendance = { message: 'attendance move failed' }
  const result = await moveClassRefs('7655', 'old-1', 'new-1', '2026-09-10', 'Yoga')
  assert.strictEqual(result.badge_error, 'badge move failed')
  assert.strictEqual(result.attendance_error, 'attendance move failed')
  assert.strictEqual(result.link_error, null)
})

test('moveClassRefs coerces ids to strings', async () => {
  await moveClassRefs(7655, 111, 222)
  for (const call of updateCalls) {
    assert.strictEqual(call.patch.abc_event_id, '222')
    assert.strictEqual(call.filters.club_number, '7655')
    assert.strictEqual(call.filters.abc_event_id, '111')
  }
})
