const test = require('node:test')
const assert = require('node:assert')
const Module = require('module')

// The module pulls in services/supabase, so it is only ever required behind the
// stub below — a bare require fails wherever @supabase/supabase-js is absent.

const load = Module._load

/** Load dayOneReporting with supabase and fetchAll stubbed. */
function loadStubbed(rows, calls) {
  Module._load = function (request) {
    if (request === '../services/supabase') {
      return { supabaseAdmin: { from: () => builderFor(calls) } }
    }
    if (request === './supabaseFetchAll') return { fetchAll: async () => rows }
    return load.apply(this, arguments)
  }
  delete require.cache[require.resolve('./dayOneReporting')]
  return require('./dayOneReporting')
}

function builderFor(calls) {
  const q = {
    select() { return q }, order() { return q },
    eq(c, v) { calls.push(['eq', c, v]); return q },
    in(c, v) { calls.push(['in', c, v]); return q },
    gte(c, v) { calls.push(['gte', c, v]); return q },
    lte(c, v) { calls.push(['lte', c, v]); return q },
    not(c, o, v) { calls.push(['not', c, o, v]); return q },
  }
  return q
}

function restore() {
  Module._load = load
  delete require.cache[require.resolve('./dayOneReporting')]
}

/** Run `fn` against the module with `rows` as every query result. */
async function withRows(rows, fn) {
  const calls = []
  try { return await fn(loadStubbed(rows, calls), calls) } finally { restore() }
}

// ---------------------------------------------------------------------------
// Name keying
// ---------------------------------------------------------------------------

test('names key the same however they were typed', async () => {
  await withRows([], async ({ normalizeName }) => {
    const want = 'Christopher Martinez'
    for (const raw of ['Christopher Martinez', 'christopher martinez', '  CHRISTOPHER   MARTINEZ ']) {
      assert.equal(normalizeName(raw), want, raw)
    }
  })
})

test('an absent name is empty, not "Undefined"', async () => {
  await withRows([], async ({ normalizeName }) => {
    assert.equal(normalizeName(null), '')
    assert.equal(normalizeName(''), '')
  })
})

// ---------------------------------------------------------------------------
// The legacy shape
// ---------------------------------------------------------------------------

// The calendar and tracker views read day_one_* field names. Changing where the
// data comes from must not change what those components receive.
test('every legacy status string is produced', async () => {
  await withRows([], async ({ statusLabel }) => {
    assert.equal(statusLabel('completed'), 'Completed')
    assert.equal(statusLabel('no_show'), 'No Show')
    assert.equal(statusLabel('cancelled'), 'Cancelled')
    assert.equal(statusLabel('scheduled'), 'Scheduled')
    assert.equal(statusLabel('something_new'), 'Unknown')
    assert.equal(statusLabel(null), 'Unknown')
  })
})

test('the four statuses in the table all map', async () => {
  await withRows([], async ({ STATUS_LABEL }) => {
    // These are the only four values day_one_appointments.status carries.
    for (const s of ['completed', 'scheduled', 'no_show', 'cancelled']) {
      assert.ok(STATUS_LABEL[s], `${s} has no legacy label`)
    }
  })
})

const row = {
  id: 'appt1', ghl_contact_id: 'c1', contact_name: 'teri m erickson',
  contact_email: 't@example.com', contact_phone: '555', location_slug: 'clackamas',
  scheduled_date: '2026-08-14', booked_at: '2026-08-11T15:54:38Z',
  status: 'completed', outcome: 'Sale', pt_sale_type: '5 Pack',
  why_no_sale: null, trainer_name: 'Kirstyn Pagano-Jackson',
  booked_by_name: 'Christopher Martinez',
}

test('an appointment maps onto the legacy field names', async () => {
  await withRows([], async ({ toLegacyShape }) => {
  const out = toLegacyShape(row, null)
  assert.equal(out.day_one_booked, 'Yes')
  assert.equal(out.day_one_date, '2026-08-14')
  assert.equal(out.day_one_status, 'Completed')
  assert.equal(out.day_one_sale, 'Sale')
  assert.equal(out.day_one_trainer, 'Kirstyn Pagano-Jackson')
  assert.equal(out.day_one_booking_team_member, 'Christopher Martinez')
  assert.equal(out.pt_sale_type, '5 Pack')
  assert.equal(out.location_slug, 'clackamas')
  })
})

// day_one_date is when it HAPPENS, day_one_booking_date is when it was BOOKED.
// Conflating them was the original sin of the legacy reports: the leaderboard
// scores the month a booking was made, the funnel measures the month it happens.
test('the two dates stay distinct', async () => {
  await withRows([], async ({ toLegacyShape }) => {
    const out = toLegacyShape(row, null)
    assert.equal(out.day_one_date, '2026-08-14')
    assert.equal(out.day_one_booking_date, '2026-08-11T15:54:38Z')
    assert.notEqual(out.day_one_date, out.day_one_booking_date)
  })
})

test('show_or_no_show follows the status', async () => {
  await withRows([], async ({ toLegacyShape }) => {
    assert.equal(toLegacyShape({ ...row, status: 'completed' }, null).show_or_no_show, 'Show')
    assert.equal(toLegacyShape({ ...row, status: 'no_show' }, null).show_or_no_show, 'No Show')
    assert.equal(toLegacyShape({ ...row, status: 'scheduled' }, null).show_or_no_show, null)
  })
})

// pt_value, pt_sign_date and tags exist only on the contact, so the appointment
// alone cannot answer them — but a missing contact must not throw.
test('contact-only fields come from the contact, and are optional', async () => {
  await withRows([], async ({ toLegacyShape }) => {
    const withContact = toLegacyShape(row, {
      id: 'c1', full_name: 'Teri M Erickson', pt_value: 499, pt_sign_date: '2026-08-14',
      tags: ['pt'], location_name: 'Clackamas',
    })
    assert.equal(withContact.pt_value, 499)
    assert.equal(withContact.full_name, 'Teri M Erickson')

    const without = toLegacyShape(row, null)
    assert.equal(without.pt_value, null)
    // Falls back to the name the appointment carries rather than going blank.
    assert.equal(without.full_name, 'teri m erickson')
  })
})

// ---------------------------------------------------------------------------
// Queries
// ---------------------------------------------------------------------------

test('bookedByPerson counts per person and folds name spelling', async () => {
  await withRows([
    { booked_by_name: 'Christopher Martinez' },
    { booked_by_name: 'christopher  martinez' },
    { booked_by_name: 'Esme Johnson' },
    { booked_by_name: 'Unassigned' },
  ], async (mod) => {
    const out = await mod.bookedByPerson({ startISO: 'a', endISO: 'b' })
    assert.equal(out['Christopher Martinez'], 2)
    assert.equal(out['Esme Johnson'], 1)
    assert.equal(out['Unassigned'], undefined)
  })
})

test('bookedByPerson windows on booked_at, not scheduled_date', async () => {
  await withRows([], async (mod, calls) => {
    await mod.bookedByPerson({ startISO: '2026-08-01T00:00:00Z', endISO: '2026-08-31T23:59:59Z' })
    const cols = calls.filter(c => c[0] === 'gte' || c[0] === 'lte').map(c => c[1])
    assert.deepEqual(cols, ['booked_at', 'booked_at'])
  })
})

test('funnel counts set, show and close', async () => {
  await withRows([
    { status: 'completed', outcome: 'Sale' },
    { status: 'completed', outcome: 'No Sale' },
    { status: 'completed', outcome: null },
    { status: 'no_show', outcome: null },
    { status: 'cancelled', outcome: null },
    { status: 'scheduled', outcome: null },
  ], async (mod) => {
    const out = await mod.funnel({ startDate: '2026-08-01', endDate: '2026-08-31' })
    // Set includes cancellations, exactly as the legacy version did.
    assert.deepEqual(out, { set: 6, show: 3, close: 1 })
  })
})

test('funnel windows on scheduled_date, not booked_at', async () => {
  await withRows([], async (mod, calls) => {
    await mod.funnel({ startDate: '2026-08-01', endDate: '2026-08-31' })
    const cols = calls.filter(c => c[0] === 'gte' || c[0] === 'lte').map(c => c[1])
    assert.deepEqual(cols, ['scheduled_date', 'scheduled_date'])
  })
})

test('a slug list scopes with IN, a single slug with EQ, "all" with neither', async () => {
  await withRows([], async (mod, calls) => {
    await mod.funnel({ locationSlugs: ['salem', 'keizer'] })
    assert.ok(calls.some(c => c[0] === 'in' && c[1] === 'location_slug'))
  })
  await withRows([], async (mod, calls) => {
    await mod.funnel({ locationSlug: 'salem' })
    assert.ok(calls.some(c => c[0] === 'eq' && c[1] === 'location_slug'))
  })
  await withRows([], async (mod, calls) => {
    await mod.funnel({ locationSlug: 'all' })
    assert.ok(!calls.some(c => c[1] === 'location_slug'))
  })
})

// Matching on email would silently drop the 30% of appointments that carry no
// contact_email; contact id is set on every row.
test('contactIdsWithDayOne matches on contact id', async () => {
  await withRows([{ ghl_contact_id: 'c1' }, { ghl_contact_id: 'c2' }], async (mod, calls) => {
    const found = await mod.contactIdsWithDayOne(['c1', 'c2', 'c3', null])
    assert.ok(found.has('c1') && found.has('c2'))
    assert.ok(!found.has('c3'))
    const inCall = calls.find(c => c[0] === 'in')
    assert.equal(inCall[1], 'ghl_contact_id')
    // Nulls and duplicates must not reach the query.
    assert.deepEqual(inCall[2], ['c1', 'c2', 'c3'])
  })
})
