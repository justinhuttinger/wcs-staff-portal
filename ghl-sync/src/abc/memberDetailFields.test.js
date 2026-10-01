const test = require('node:test');
const assert = require('node:assert');
const { desiredMemberDetails, memberDetailUpdates, dateOfBirthUpdate, MEMBER_DETAIL_FIELD_KEYS } = require('./memberDetailFields');

const member = {
  next_billing_date: '2026-10-24',
  expiration_date: null,
  is_past_due: false,
  total_past_due_balance: 0,
  next_due_amount: 50,
  agreement_payment_method: 'EFT',
  agreement_term: 'Open',
  is_primary_member: false,
  last_check_in_timestamp: '2026-09-20 18:34:27.907009',
  total_check_in_count: 7,
  barcode: '238509',
  birth_date: '1992-05-28',
};

// every key → its own fake field id
const ids = Object.fromEntries(MEMBER_DETAIL_FIELD_KEYS.map((k) => [k, `id:${k}`]));

test('maps an abc_members row to GHL values', () => {
  assert.deepStrictEqual(desiredMemberDetails(member), {
    'contact.next_billing_date': '2026-10-24',
    'contact.past_due': 'No',
    'contact.past_due_balance': 0,
    'contact.next_due_amount': 50,
    'contact.payment_method': 'EFT',
    'contact.agreement_term': 'Open',
    'contact.member_relationship': 'Add-on',
    'contact.last_checkin': '2026-09-20',
    'contact.last_checkin_time': '6:34 PM',
    'contact.total_checkins': 7,
    'contact.abc_barcode': '238509',
  });
});

test('last check-in time: club-local clock, 12-hour', () => {
  const t = (ts) => desiredMemberDetails({ last_check_in_timestamp: ts })['contact.last_checkin_time'];
  assert.strictEqual(t('2026-09-18 09:49:09.912000'), '9:49 AM');
  assert.strictEqual(t('2026-09-18 12:05:00.000000'), '12:05 PM');
  assert.strictEqual(t('2026-09-18 00:30:00.000000'), '12:30 AM');
  // Legacy rows carry a bare date as midnight; that is not a real visit time.
  assert.strictEqual(t('2017-10-17 00:00:00.000000'), undefined);
  assert.strictEqual(t('2017-10-17'), undefined);
});

test('missing ABC values are omitted, never written as blanks', () => {
  const d = desiredMemberDetails({ is_past_due: true, is_primary_member: null });
  assert.deepStrictEqual(d, { 'contact.past_due': 'Yes' });
});

test('empty cache → every present field is an update', () => {
  const u = memberDetailUpdates(member, {}, ids);
  assert.strictEqual(Object.keys(u).length, 11);
  assert.strictEqual(u['id:contact.past_due_balance'], 0);
});

test('values GHL already holds in its own shapes are not re-written', () => {
  const cf = {
    'id:contact.next_billing_date': Date.UTC(2026, 9, 24), // epoch ms
    'id:contact.past_due': 'No',
    'id:contact.past_due_balance': '0.00',
    'id:contact.next_due_amount': 50,
    'id:contact.payment_method': 'EFT ',
    'id:contact.agreement_term': 'Open',
    'id:contact.member_relationship': 'Add-on',
    'id:contact.last_checkin': '2026-09-20',
    'id:contact.last_checkin_time': '6:34 PM',
    'id:contact.total_checkins': '7',
    'id:contact.abc_barcode': 238509,
  };
  assert.deepStrictEqual(memberDetailUpdates(member, cf, ids), {});
});

test('only the changed field is returned', () => {
  const cf = Object.fromEntries(Object.entries(desiredMemberDetails(member)).map(([k, v]) => [ids[k], v]));
  const u = memberDetailUpdates({ ...member, total_past_due_balance: 42.5, is_past_due: true }, cf, ids);
  assert.deepStrictEqual(u, { 'id:contact.past_due_balance': 42.5, 'id:contact.past_due': 'Yes' });
});

test('fields the location does not have are skipped', () => {
  const u = memberDetailUpdates(member, {}, { 'contact.abc_barcode': 'bc' });
  assert.deepStrictEqual(u, { bc: '238509' });
});

test('date of birth: only when ABC has one and it differs', () => {
  assert.strictEqual(dateOfBirthUpdate(member, null), '1992-05-28');
  assert.strictEqual(dateOfBirthUpdate(member, '1992-05-28'), null);
  assert.strictEqual(dateOfBirthUpdate({ birth_date: null }, '1990-01-01'), null);
});
