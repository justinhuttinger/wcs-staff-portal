const test = require('node:test')
const assert = require('node:assert')
const { applyTreePlan } = require('./coachingWrite')
const { normaliseTree, planTreeDiff } = require('./coachingPrograms')

const EX = 'aaaaaaaa-0000-4000-8000-000000000001'

// A recording stand-in for the bits of supabase-js the writer uses.
function fakeDb({ failOn } = {}) {
  const calls = []
  let n = 0
  const db = {
    calls,
    from(table) {
      const call = { table, op: null, rows: null, filters: [] }
      const chain = {
        insert(rows) { call.op = 'insert'; call.rows = rows; return chain },
        upsert(rows, opts) { call.op = 'upsert'; call.rows = rows; call.opts = opts; return chain },
        delete() { call.op = 'delete'; return chain },
        in(col, vals) { call.filters.push(['in', col, vals]); return chain },
        eq(col, val) { call.filters.push(['eq', col, val]); return chain },
        select() { return chain },
        then(resolve) {
          calls.push(call)
          if (failOn && failOn(call)) return resolve({ data: null, error: { message: 'boom' } })
          const data = call.op === 'insert' && table === 'memberapp_program_days'
            ? call.rows.map(r => ({ id: `new-day-${++n}`, position: r.position }))
            : null
          return resolve({ data, error: null })
        },
      }
      return chain
    },
  }
  return db
}

const item = (over = {}) => ({ section: 'workout', exercise_id: EX, sets: 3, ...over })

test('applyTreePlan inserts days before items, deletes last, and resolves new day ids', async () => {
  const stored = { days: [{ id: 'd1', items: [{ id: 'i1' }, { id: 'i2' }] }, { id: 'd2', items: [{ id: 'i3' }] }] }
  const { tree } = normaliseTree({
    name: 'P',
    days: [
      { id: 'd1', name: 'A', items: [item({ id: 'i1' })] },
      { name: 'New', items: [item({ id: 'i3' }), item()] },
    ],
  })
  const db = fakeDb()
  await applyTreePlan(db, 'prog-1', planTreeDiff(stored, tree))

  const ops = db.calls.map(c => `${c.op}:${c.table}`)
  assert.deepEqual(ops, [
    'insert:memberapp_program_days',
    'insert:memberapp_program_items',
    'upsert:memberapp_program_days',
    'upsert:memberapp_program_items',
    'delete:memberapp_program_items',
    'delete:memberapp_program_days',
  ])
  const [dayInsert, itemInsert, , itemUpsert, itemDelete, dayDelete] = db.calls
  assert.equal(dayInsert.rows[0].program_id, 'prog-1')
  assert.deepEqual(itemInsert.rows.map(r => r.day_id), ['new-day-1'])
  const moved = itemUpsert.rows.find(r => r.id === 'i3')
  assert.equal(moved.day_id, 'new-day-1')
  assert.equal(itemUpsert.rows.find(r => r.id === 'i1').day_id, 'd1')
  assert.deepEqual(itemDelete.filters, [['in', 'id', ['i2']]])
  assert.deepEqual(dayDelete.filters, [['in', 'id', ['d2']], ['eq', 'program_id', 'prog-1']])
})

test('applyTreePlan skips empty steps and stops at the first error', async () => {
  const { tree } = normaliseTree({ name: 'P', days: [{ name: 'A', items: [item()] }] })
  const db = fakeDb({ failOn: c => c.table === 'memberapp_program_items' })
  await assert.rejects(applyTreePlan(db, 'p', planTreeDiff({ days: [] }, tree)), (err) => {
    assert.match(err.message, /boom/)
    assert.equal(err.partial, true) // the days went in before the items failed
    return true
  })
  assert.deepEqual(db.calls.map(c => c.op), ['insert', 'insert'])
})

test('applyTreePlan: a failure on the first write is not a partial save', async () => {
  const { tree } = normaliseTree({ name: 'P', days: [{ name: 'A', items: [item()] }] })
  const db = fakeDb({ failOn: c => c.table === 'memberapp_program_days' })
  await assert.rejects(applyTreePlan(db, 'p', planTreeDiff({ days: [] }, tree)), (err) => err.partial === false)
})

test('applyTreePlan places items on new days by insert order, not by position', async () => {
  // Two new days that (as in an old copy) share a position: matching by
  // position would put both days' items on one of them.
  const plan = {
    days: {
      insert: [
        { day_index: 0, row: { position: 0, name: 'A' } },
        { day_index: 1, row: { position: 0, name: 'B' } },
      ],
      update: [],
      delete: [],
    },
    items: {
      insert: [
        { day_index: 0, row: { position: 0, exercise_id: EX } },
        { day_index: 1, row: { position: 0, exercise_id: EX } },
      ],
      update: [],
      delete: [],
    },
  }
  const db = fakeDb()
  await applyTreePlan(db, 'p', plan)
  assert.deepEqual(db.calls[1].rows.map(r => r.day_id), ['new-day-1', 'new-day-2'])
})

test('applyTreePlan refuses to guess when the day insert returns the wrong number of rows', async () => {
  const plan = {
    days: { insert: [{ day_index: 0, row: { position: 0, name: 'A' } }], update: [], delete: [] },
    items: { insert: [], update: [], delete: [] },
  }
  const db = fakeDb()
  const real = db.from.bind(db)
  db.from = (table) => {
    const chain = real(table)
    const then = chain.then
    chain.then = (resolve) => then((r) => resolve({ ...r, data: [] }))
    return chain
  }
  await assert.rejects(applyTreePlan(db, 'p', plan), /new days/)
})
