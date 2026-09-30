const test = require('node:test')
const assert = require('node:assert/strict')
const crypto = require('crypto')
const {
  runMetaPurchaseForLocation, buildPurchaseEvent, isNewJoin, eventTimeFor,
  normalizePhone, normalizeDob, fbcFromFbclid, findLeadId,
} = require('./metaPurchase')

const sha = v => crypto.createHash('sha256').update(v).digest('hex')
const NOW = Date.parse('2026-09-30T20:00:00Z')
const LOCATION = { id: 'LOC1', name: 'Medford', clubNumber: '32073' }

const member = (id, extra = {}) => ({
  member_id: id, agreement_number: '01740', first_name: 'Jesus', last_name: 'Plata Cruz',
  email: 'JesPlata50@gmail.com ', primary_phone: '(541) 840-4182', mobile_phone: '(541) 840-4182',
  birth_date: '1995-06-25', membership_type: 'SINGLE', since_date: '2026-09-29',
  is_active: true, is_primary_member: true, is_non_member: false,
  agreement_entry_source: 'DataTrak EAE', ...extra,
})

// Chainable Supabase stand-in: canned rows per table, filters applied loosely,
// upserts recorded.
function fakeDb({ tables = {} } = {}) {
  const upserts = []
  function builder(rows) {
    let out = rows
    const b = {
      select: () => b,
      eq: (col, val) => { out = out.filter(r => !(col in r) || r[col] === val); return b },
      in: (col, vals) => { out = out.filter(r => !(col in r) || vals.includes(r[col])); return b },
      gte: (col, val) => { out = out.filter(r => !(col in r) || r[col] >= val); return b },
      lt: () => b,
      or: () => b,
      ilike: (col, val) => { out = out.filter(r => String(r[col] || '').toLowerCase() === val); return b },
      order: () => b,
      limit: n => { out = out.slice(0, n); return b },
      range: (from, to) => { out = out.slice(from, to + 1); return b },
      then: (resolve, reject) => Promise.resolve({ data: out, error: null }).then(resolve, reject),
    }
    return b
  }
  return {
    upserts,
    from: name => ({
      ...builder(tables[name] || []),
      upsert: row => { upserts.push({ table: name, row }); return Promise.resolve({ error: null }) },
    }),
  }
}

test('phone and dob normalize the way Meta hashes them', () => {
  assert.equal(normalizePhone('(541) 840-4182'), '15418404182')
  assert.equal(normalizePhone('1-541-840-4182'), '15418404182')
  assert.equal(normalizePhone(''), null)
  assert.equal(normalizeDob('1995-06-25'), '19950625')
  assert.equal(normalizeDob(null), null)
})

test('new join rules: active primary member inside the window, real membership', () => {
  const opts = { windowStart: '2026-09-23' }
  assert.equal(isNewJoin(member('a'), opts), true)
  assert.equal(isNewJoin(member('a', { since_date: '2026-09-01' }), opts), false)
  assert.equal(isNewJoin(member('a', { is_active: false }), opts), false)
  assert.equal(isNewJoin(member('a', { is_primary_member: false }), opts), false)
  assert.equal(isNewJoin(member('a', { is_non_member: true }), opts), false)
  assert.equal(isNewJoin(member('a', { membership_type: 'NON-MEMBER' }), opts), false)
  assert.equal(isNewJoin(member('a', { membership_type: 'Employee' }), opts), false)
  assert.equal(isNewJoin(member('a', { membership_type: 'Z. Deleting Delete' }), opts), false)
  assert.equal(isNewJoin(member('a', { membership_type: 'PT ONLY' }), { ...opts, skipTypes: new Set(['pt only']) }), false)
})

test('event time is noon Pacific on since_date, never in the future', () => {
  assert.equal(eventTimeFor(member('a', { since_date: '2026-09-29' }), NOW), Date.parse('2026-09-29T19:00:00Z') / 1000)
  assert.equal(eventTimeFor(member('a', { since_date: '2026-09-30' }), Date.parse('2026-09-30T15:00:00Z')), Date.parse('2026-09-30T15:00:00Z') / 1000)
})

test('purchase event hashes normalized PII and carries GHL click data', () => {
  const contact = {
    id: 'C1', email: null, phone: null, created_at_ghl: '2026-09-20T18:00:00Z',
    custom_fields: { F_FBP: 'fb.1.123.456', F_FBCLID: 'IwAR0abc', F_XID: ' ABC-uuid ' },
  }
  const ev = buildPurchaseEvent({
    member: member('m1'), contact, fieldIds: { fbp: 'F_FBP', fbc: 'F_FBC', fbclid: 'F_FBCLID', external_id: 'F_XID' },
    value: 990, locationName: 'Medford', nowMs: NOW,
  })
  assert.equal(ev.event_name, 'Purchase')
  assert.equal(ev.event_id, 'purchase_m1_01740')
  assert.equal(ev.action_source, 'physical_store')
  assert.deepEqual(ev.user_data.em, [sha('jesplata50@gmail.com')])
  assert.deepEqual(ev.user_data.ph, [sha('15418404182')])
  assert.deepEqual(ev.user_data.fn, [sha('jesus')])
  assert.deepEqual(ev.user_data.ln, [sha('plata cruz')])
  assert.deepEqual(ev.user_data.db, [sha('19950625')])
  assert.equal(ev.user_data.fbp, 'fb.1.123.456')
  assert.equal(ev.user_data.fbc, fbcFromFbclid('IwAR0abc', '2026-09-20T18:00:00Z'))
  assert.deepEqual(ev.user_data.external_id, [sha('abc-uuid')])
  assert.deepEqual(ev.custom_data, { currency: 'USD', value: 990, content_name: 'SINGLE', content_category: 'Medford', order_id: '01740' })
})

test('a join with no GHL contact still builds, on ABC data alone', () => {
  const ev = buildPurchaseEvent({ member: member('m1'), contact: null, fieldIds: { fbp: 'F', fbc: 'G', fbclid: 'H', external_id: 'I' }, value: 990, nowMs: NOW })
  assert.equal(ev.user_data.fbp, undefined)
  assert.equal(ev.user_data.fbc, undefined)
  assert.equal(ev.user_data.em.length, 1)
})

test('online joins go as system_generated', () => {
  const ev = buildPurchaseEvent({ member: member('m1', { agreement_entry_source: 'Web' }), contact: null, value: 990, nowMs: NOW })
  assert.equal(ev.action_source, 'system_generated')
})

function setup({ members = [member('m1')], logged = [], contacts = [] } = {}) {
  return fakeDb({
    tables: {
      abc_members: members,
      meta_capi_events: logged,
      ghl_custom_field_defs: [{ id: 'F_FBP', field_key: 'contact.fbp', location_id: 'LOC1' }],
      ghl_contacts_v2: contacts,
    },
  })
}

test('dry run plans the send and writes nothing', async () => {
  const db = setup()
  let sends = 0
  const s = await runMetaPurchaseForLocation(LOCATION, { dryRun: true, db, nowMs: NOW, send: async () => { sends++; return { ok: true } } })
  assert.equal(s.candidates, 1)
  assert.equal(s.planned.length, 1)
  assert.match(s.planned[0].match, /^em=y ph=y fn=y ln=y db=y fbp=n fbc=n xid=n lead=n$/)
  assert.equal(sends, 0)
  assert.equal(db.upserts.length, 0)
})

test('live run sends once and logs the result', async () => {
  const db = setup({ contacts: [{ id: 'C1', location_id: 'LOC1', email: 'jesplata50@gmail.com', custom_fields: { F_FBP: 'fb.1.1.2' } }] })
  const sent = []
  const s = await runMetaPurchaseForLocation(LOCATION, { dryRun: false, db, nowMs: NOW, send: async e => { sent.push(e); return { ok: true, data: { events_received: 1 } } } })
  assert.equal(s.sent, 1)
  assert.equal(sent[0].user_data.fbp, 'fb.1.1.2')
  assert.equal(db.upserts[0].row.status, 'sent')
  assert.equal(db.upserts[0].row.ghl_contact_id, 'C1')
  assert.equal(db.upserts[0].row.attempts, 1)
})

test('already-sent joins are skipped; failures retry until the cap', async () => {
  const send = async () => ({ ok: false, error: 'bad' })
  const sentDb = setup({ logged: [{ event_id: 'purchase_m1_01740', status: 'sent', attempts: 1 }] })
  const a = await runMetaPurchaseForLocation(LOCATION, { dryRun: false, db: sentDb, nowMs: NOW, send })
  assert.equal(a.alreadySent, 1)
  assert.equal(sentDb.upserts.length, 0)

  const retryDb = setup({ logged: [{ event_id: 'purchase_m1_01740', status: 'failed', attempts: 2 }] })
  const b = await runMetaPurchaseForLocation(LOCATION, { dryRun: false, db: retryDb, nowMs: NOW, send })
  assert.equal(b.failed, 1)
  assert.equal(retryDb.upserts[0].row.attempts, 3)

  const cappedDb = setup({ logged: [{ event_id: 'purchase_m1_01740', status: 'failed', attempts: 5 }] })
  const c = await runMetaPurchaseForLocation(LOCATION, { dryRun: false, db: cappedDb, nowMs: NOW, send })
  assert.equal(c.gaveUp, 1)
  assert.equal(cappedDb.upserts.length, 0)
})

test('a lead id rides on the event unhashed and shows in the match column', async () => {
  const ev = buildPurchaseEvent({ member: member('m1'), contact: null, value: 990, nowMs: NOW, leadId: '1234567890' })
  assert.equal(ev.user_data.lead_id, '1234567890')
  const without = buildPurchaseEvent({ member: member('m1'), contact: null, value: 990, nowMs: NOW })
  assert.equal(without.user_data.lead_id, undefined)
})

test('findLeadId looks up by email or phone in the 90 days before the join', async () => {
  let q = null
  const db = { from: () => {
    const b = {
      select: () => b,
      or: v => { q = { or: v }; return b },
      gte: (_c, v) => { q.from = v; return b },
      lt: (_c, v) => { q.to = v; return b },
      order: () => b,
      limit: () => Promise.resolve({ data: [{ lead_id: 'L9' }], error: null }),
    }
    return b
  } }
  assert.equal(await findLeadId(db, member('m1')), 'L9')
  assert.equal(q.or, 'email.eq.jesplata50@gmail.com,phone.eq.5418404182')
  assert.equal(q.from, '2026-07-01T00:00:00.000Z')
  assert.equal(q.to, '2026-10-01T00:00:00.000Z')

  const missingTable = { from: () => { const b = { select: () => b, or: () => b, gte: () => b, lt: () => b, order: () => b, limit: () => Promise.resolve({ data: null, error: { message: 'relation does not exist' } }) }; return b } }
  assert.equal(await findLeadId(missingTable, member('m1')), null)
  assert.equal(await findLeadId(db, member('m1', { email: null, primary_phone: null, mobile_phone: null })), null)
})
