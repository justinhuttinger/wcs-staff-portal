const test = require('node:test')
const assert = require('node:assert')
const path = require('node:path')
const Module = require('node:module')

// ---------------------------------------------------------------------------
// Name resolution, run against a stubbed database.
//
// The point of these is the FALLBACK ORDER: appointment name, then contact
// name, then leave it alone. Getting that wrong is not a crash — it is a list
// of "Unnamed member" that looks like missing data rather than a missing join,
// which is exactly how this survived on the Problem Areas drill-down.
// ---------------------------------------------------------------------------

const base = path.join(__dirname, '..')

// ASYNC, and it awaits fn. A synchronous finally would restore the real loader
// the moment fn returned its promise — before any await inside it resolved — so
// a second lookup on the far side of an await would reach for the real Supabase
// client and fail on a missing module.
async function withStubbedDb(tables, fn) {
  const supabaseAdmin = {
    from(table) {
      const q = {
        select: () => q,
        in: async (_col, ids) => ({ data: (tables[table] || []).filter(r => ids.includes(r.id)) }),
      }
      return q
    },
  }
  const stub = { [path.join(base, 'services/supabase.js')]: { supabaseAdmin } }
  const origResolve = Module._resolveFilename
  const origLoad = Module._load
  Module._load = function (request, parent, isMain) {
    try {
      const resolved = origResolve.call(Module, request, parent, isMain)
      if (stub[resolved]) return stub[resolved]
    } catch { /* fall through */ }
    return origLoad.apply(Module, arguments)
  }
  try {
    delete require.cache[require.resolve('./dayOneContactNames')]
    return await fn(require('./dayOneContactNames'))
  } finally {
    Module._load = origLoad
    delete require.cache[require.resolve('./dayOneContactNames')]
  }
}

const CONTACTS = [
  { id: 'c1', first_name: 'Jane', last_name: 'Doe' },
  { id: 'c2', first_name: 'John', last_name: 'Roe' },
  { id: 'c3', first_name: null, last_name: null },
]
const APPTS = [
  { id: 'a1', ghl_contact_id: 'c1' },
  { id: 'a2', ghl_contact_id: null },
]

const db = { ghl_contacts_v2: CONTACTS, day_one_appointments: APPTS }

test('a row that already has a name is left exactly as it was', async () => {
  await withStubbedDb(db, async (m) => {
    const out = await m.attachContactNames([{ contact_name: 'Typed Name', ghl_contact_id: 'c1' }])
    assert.equal(out[0].contact_name, 'Typed Name')
  })
})

test('a missing name is filled from the contact', async () => {
  await withStubbedDb(db, async (m) => {
    const out = await m.attachContactNames([{ contact_name: null, ghl_contact_id: 'c1' }])
    assert.equal(out[0].contact_name, 'Jane Doe')
  })
})

test('blank and whitespace count as missing, not as a name', async () => {
  await withStubbedDb(db, async (m) => {
    const out = await m.attachContactNames([
      { contact_name: '', ghl_contact_id: 'c1' },
      { contact_name: '   ', ghl_contact_id: 'c2' },
    ])
    assert.deepEqual(out.map(r => r.contact_name), ['Jane Doe', 'John Roe'])
  })
})

// The pending SQL function returns the appointment id but not the contact id,
// so that hop has to happen before the name lookup.
test('a row with only an appointment id still resolves', async () => {
  await withStubbedDb(db, async (m) => {
    const out = await m.attachContactNames([{ id: 'a1', contact_name: null }])
    assert.equal(out[0].contact_name, 'Jane Doe')
  })
})

// A contact that exists but has no name is a real gap. Leaving it null lets the
// caller say "Unnamed member" honestly rather than inventing something.
test('a contact with no name of its own leaves the row unnamed', async () => {
  await withStubbedDb(db, async (m) => {
    const out = await m.attachContactNames([{ contact_name: null, ghl_contact_id: 'c3' }])
    assert.equal(out[0].contact_name, null)
  })
})

test('a contact id matching nothing leaves the row unnamed', async () => {
  await withStubbedDb(db, async (m) => {
    const out = await m.attachContactNames([{ contact_name: null, ghl_contact_id: 'nope' }])
    assert.equal(out[0].contact_name, null)
  })
})

test('rows that all have names cost no lookup and come back unchanged', async () => {
  await withStubbedDb(db, async (m) => {
    const rows = [{ contact_name: 'A' }, { contact_name: 'B' }]
    const out = await m.attachContactNames(rows)
    assert.deepEqual(out, rows)
  })
})

test('an empty list resolves to an empty list rather than throwing', async () => {
  await withStubbedDb(db, async (m) => {
    assert.deepEqual(await m.attachContactNames([]), [])
    assert.deepEqual(await m.attachContactNames(null), [])
  })
})
