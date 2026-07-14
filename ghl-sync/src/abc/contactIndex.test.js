const test = require('node:test')
const assert = require('node:assert')
const { buildContactIndex, matchContact, isClaimedByOther } = require('./contactIndex')

const FIELD_DEFS = [{ id: 'fld_member_id', field_key: 'contact.abc_member_id' }]

function makeContacts() {
  return [
    {
      id: 'ghl_1',
      email: 'byid@example.com',
      phone: '+15035551111',
      first_name: 'By',
      last_name: 'Id',
      tags: [],
      custom_fields: { fld_member_id: 'M100' },
    },
    {
      id: 'ghl_2',
      email: 'byemail@example.com',
      phone: '+15035552222',
      first_name: 'By',
      last_name: 'Email',
      tags: [],
      custom_fields: {},
    },
    {
      id: 'ghl_3',
      email: null,
      phone: '(503) 555-3333',
      first_name: 'By',
      last_name: 'Phone',
      tags: [],
      custom_fields: {},
    },
    {
      id: 'ghl_4',
      email: 'family@example.com',
      phone: '+15035554444',
      first_name: 'Family',
      last_name: 'Claimed',
      tags: [],
      custom_fields: { fld_member_id: 'M200' }, // claimed by a different member_id
    },
  ]
}

test('buildContactIndex: indexes by member_id field, email, phone last-10', () => {
  const idx = buildContactIndex(makeContacts(), FIELD_DEFS)
  assert.strictEqual(idx.abcMemberIdFieldId, 'fld_member_id')
  assert.strictEqual(idx.byMemberId.get('M100').id, 'ghl_1')
  assert.strictEqual(idx.byEmail.get('byemail@example.com').id, 'ghl_2')
  assert.strictEqual(idx.byPhone.get('5035553333').id, 'ghl_3')
})

test('buildContactIndex: missing field def -> no member_id index, null field id', () => {
  const idx = buildContactIndex(makeContacts(), [])
  assert.strictEqual(idx.abcMemberIdFieldId, null)
  assert.strictEqual(idx.byMemberId.size, 0)
})

test('matchContact: matches by abc_member_id first', () => {
  const idx = buildContactIndex(makeContacts(), FIELD_DEFS)
  const m = matchContact(idx, { member_id: 'M100', email: 'other@example.com' })
  assert.strictEqual(m.contact.id, 'ghl_1')
  assert.strictEqual(m.matchMethod, 'member_id')
})

test('matchContact: falls back to email', () => {
  const idx = buildContactIndex(makeContacts(), FIELD_DEFS)
  const m = matchContact(idx, { member_id: 'M999', email: 'byemail@example.com' })
  assert.strictEqual(m.contact.id, 'ghl_2')
  assert.strictEqual(m.matchMethod, 'email')
})

test('matchContact: falls back to phone (last 10 digits)', () => {
  const idx = buildContactIndex(makeContacts(), FIELD_DEFS)
  const m = matchContact(idx, { member_id: 'M999', primary_phone: '503-555-3333' })
  assert.strictEqual(m.contact.id, 'ghl_3')
  assert.strictEqual(m.matchMethod, 'phone')
})

test('matchContact: family-plan guard — email/phone claimed by a different member_id is not matched', () => {
  const idx = buildContactIndex(makeContacts(), FIELD_DEFS)
  const byEmail = matchContact(idx, { member_id: 'M300', email: 'family@example.com' })
  assert.strictEqual(byEmail, null)
  const byPhone = matchContact(idx, { member_id: 'M300', primary_phone: '5035554444' })
  assert.strictEqual(byPhone, null)
})

test('matchContact: no match returns null', () => {
  const idx = buildContactIndex(makeContacts(), FIELD_DEFS)
  const m = matchContact(idx, { member_id: 'M999', email: 'nope@example.com', primary_phone: '5035559999' })
  assert.strictEqual(m, null)
})

test('isClaimedByOther: true when contact custom field holds a different member_id', () => {
  const idx = buildContactIndex(makeContacts(), FIELD_DEFS)
  const claimed = idx.byMemberId.size ? { custom_fields: { fld_member_id: 'M200' } } : null
  assert.strictEqual(isClaimedByOther(idx, claimed, 'M300'), true)
  assert.strictEqual(isClaimedByOther(idx, claimed, 'M200'), false)
  assert.strictEqual(isClaimedByOther(idx, null, 'M300'), false)
})
