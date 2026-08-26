// VIP referral write-back to GHL.
//
// The field ids differ per club, so everything resolves by fieldKey. Writing to
// a hardcoded id would silently populate the wrong field at six of seven gyms.

const test = require('node:test')
const assert = require('node:assert/strict')
const path = require('node:path')

// --- stubs, primed before the module under test loads ---
let contactResponse = { contact: { customFields: [] } }
let putCalls = []
let fieldIds = {
  'contact.referred_by_full_name': 'FID-name',
  'contact.referred_by_abc_id': 'FID-abc',
  'contact.vip_team_member': 'FID-team',
}

function prime(rel, exports) {
  const resolved = require.resolve(path.join(__dirname, '..', 'src', rel))
  require.cache[resolved] = { id: resolved, filename: resolved, loaded: true, exports }
}

let putShouldFail = false
prime('services/ghlClient', {
  ghlFetch: async (p, key, opts = {}) => {
    if (opts.method === 'PUT') {
      if (putShouldFail) throw new Error('GHL 429')
      putCalls.push({ path: p, body: opts.body })
      return {}
    }
    return contactResponse
  },
})
prime('services/ghlCustomFields', {
  getFieldId: async (_loc, _key, fieldKey) => fieldIds[fieldKey] || null,
})

const { readReferral, writeReferral, KEYS } = require('../src/lib/vipReferral')

const CTX = { locationId: 'loc-1', apiKey: 'key', contactId: 'c-1' }

test.beforeEach(() => {
  putCalls = []
  putShouldFail = false
  contactResponse = { contact: { customFields: [] } }
  fieldIds = {
    'contact.referred_by_full_name': 'FID-name',
    'contact.referred_by_abc_id': 'FID-abc',
    'contact.vip_team_member': 'FID-team',
  }
})

test('the three keys are the documented ones', () => {
  assert.equal(KEYS.fullName, 'contact.referred_by_full_name')
  assert.equal(KEYS.abcId, 'contact.referred_by_abc_id')
  assert.equal(KEYS.teamMember, 'contact.vip_team_member')
})

test('reads what the contact already holds', async () => {
  contactResponse = {
    contact: {
      customFields: [
        { id: 'FID-name', value: 'Henry Magnuson' },
        { id: 'FID-team', value: 'Caleb Ivey' },
      ],
    },
  }

  const r = await readReferral(CTX)
  assert.equal(r.fullName, 'Henry Magnuson')
  assert.equal(r.teamMember, 'Caleb Ivey')
  assert.equal(r.abcId, '', 'absent field reads empty, not undefined')
})

test('reads the fieldValue spelling too', async () => {
  // GHL returns one or the other depending on the endpoint.
  contactResponse = { contact: { customFields: [{ id: 'FID-name', fieldValue: 'Dana Reyes' }] } }
  const r = await readReferral(CTX)
  assert.equal(r.fullName, 'Dana Reyes')
})

test('writes only the values supplied', async () => {
  await writeReferral(CTX, { fullName: 'Henry Magnuson', abcId: 'ABC-1', teamMember: '' })

  assert.equal(putCalls.length, 1)
  const sent = putCalls[0].body.customFields
  assert.equal(sent.length, 2, 'the blank team member is not sent')
  assert.deepEqual(sent.find(f => f.id === 'FID-name'), { id: 'FID-name', field_value: 'Henry Magnuson' })
  assert.deepEqual(sent.find(f => f.id === 'FID-abc'), { id: 'FID-abc', field_value: 'ABC-1' })
})

test('a blank answer never clears what is already on the record', async () => {
  // Both questions are optional. An empty write would wipe a referral somebody
  // else captured earlier.
  const r = await writeReferral(CTX, { fullName: '', abcId: '', teamMember: '' })
  assert.equal(r.ok, true)
  assert.deepEqual(r.written, [])
  assert.equal(putCalls.length, 0, 'nothing is sent at all')
})

test('resolves ids by fieldKey, never a hardcoded id', async () => {
  // Simulate a different club: same keys, different ids.
  fieldIds = {
    'contact.referred_by_full_name': 'MEDFORD-name',
    'contact.referred_by_abc_id': 'MEDFORD-abc',
    'contact.vip_team_member': 'MEDFORD-team',
  }

  await writeReferral(CTX, { fullName: 'Dana Reyes', abcId: 'ABC-9' })

  const ids = putCalls[0].body.customFields.map(f => f.id).sort()
  assert.deepEqual(ids, ['MEDFORD-abc', 'MEDFORD-name'])
})

test('a field missing at this club is skipped, not sent as null', async () => {
  fieldIds['contact.vip_team_member'] = null

  await writeReferral(CTX, { fullName: 'Dana Reyes', teamMember: 'Caleb Ivey' })

  const ids = putCalls[0].body.customFields.map(f => f.id)
  assert.deepEqual(ids, ['FID-name'])
})

test('a GHL failure is reported rather than thrown', async () => {
  putShouldFail = true

  // A rate-limited write must not take the tour down with it: the outcome is
  // still saved and the row still deleted.
  const r = await writeReferral(CTX, { fullName: 'Dana Reyes' })

  assert.equal(r.ok, false)
  assert.match(r.error, /429/)
  assert.deepEqual(r.written, [])
})

test('no contact id means nothing is attempted', async () => {
  const r = await writeReferral({ ...CTX, contactId: '' }, { fullName: 'Dana Reyes' })
  assert.equal(r.ok, false)
  assert.equal(putCalls.length, 0)
  assert.equal(await readReferral({ ...CTX, contactId: '' }), null)
})
