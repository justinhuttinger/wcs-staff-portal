// ghl-sync/test/firstContactPick.test.js
const test = require('node:test');
const assert = require('node:assert');
const { pickFirstHumanContact } = require('../src/ghl/firstContactPick');

// Mirrors Saber Burruss's real GHL conversation (2026-06-19/20). The genuine
// first human contact is JT Nelms's call, tagged source:'workflow' with a userId.
const SABER = [
  { dateAdded: '2026-06-19T10:29:26.189Z', direction: 'outbound', source: 'app',      messageType: 'TYPE_ACTIVITY_OPPORTUNITY' },
  { dateAdded: '2026-06-19T10:29:26.679Z', direction: 'outbound', source: 'workflow', messageType: 'TYPE_SMS' }, // auto-text, no userId
  { dateAdded: '2026-06-19T17:27:37.323Z', direction: 'outbound', source: 'workflow', messageType: 'TYPE_CALL', userId: 'DANUIhKRk2XCpZG0XUGC' }, // JT's call
  { dateAdded: '2026-06-19T17:28:40.411Z', direction: 'outbound', source: 'workflow', messageType: 'TYPE_SMS' },
  { dateAdded: '2026-06-20T23:01:36.256Z', direction: 'outbound', source: 'workflow', messageType: 'TYPE_SMS' },
  { dateAdded: '2026-06-20T23:07:41.685Z', direction: 'outbound', source: 'app',      messageType: 'TYPE_SMS' }, // booking confirmation, NO userId
];

test('picks the human call (workflow+userId) over a later app booking-confirmation text', () => {
  const r = pickFirstHumanContact(SABER);
  assert.strictEqual(r.kind, 'call');
  assert.strictEqual(r.at, '2026-06-19T17:27:37.323Z');
});

test('ignores automated workflow text that carries a userId', () => {
  const msgs = [
    { dateAdded: '2026-06-01T00:00:00.000Z', direction: 'outbound', source: 'workflow', messageType: 'TYPE_SMS', userId: 'wf-owner' }, // automated, has userId
    { dateAdded: '2026-06-01T05:00:00.000Z', direction: 'outbound', source: 'app',      messageType: 'TYPE_SMS', userId: 'staff-1' }, // genuine manual text
  ];
  const r = pickFirstHumanContact(msgs);
  assert.strictEqual(r.kind, 'sms');
  assert.strictEqual(r.at, '2026-06-01T05:00:00.000Z');
});

test('ignores app text with no userId (auto confirmation) and bulk blasts', () => {
  const msgs = [
    { dateAdded: '2026-06-01T00:00:00.000Z', direction: 'outbound', source: 'app',          messageType: 'TYPE_SMS' }, // no userId
    { dateAdded: '2026-06-01T01:00:00.000Z', direction: 'outbound', source: 'bulk_actions', messageType: 'TYPE_SMS', userId: 'staff-1' }, // mass blast
  ];
  assert.strictEqual(pickFirstHumanContact(msgs), null);
});

test('requires a userId on calls', () => {
  const msgs = [
    { dateAdded: '2026-06-01T00:00:00.000Z', direction: 'outbound', source: 'workflow', messageType: 'TYPE_CALL' }, // no userId — system/unknown
  ];
  assert.strictEqual(pickFirstHumanContact(msgs), null);
});

test('ignores inbound, non-sms/call types, and bad dates', () => {
  const msgs = [
    { dateAdded: '2026-06-01T00:00:00.000Z', direction: 'inbound',  source: 'app',      messageType: 'TYPE_SMS',  userId: 's' },
    { dateAdded: '2026-06-01T00:00:00.000Z', direction: 'outbound', source: 'app',      messageType: 'TYPE_EMAIL', userId: 's' },
    { dateAdded: 'not-a-date',               direction: 'outbound', source: 'workflow', messageType: 'TYPE_CALL', userId: 's' },
  ];
  assert.strictEqual(pickFirstHumanContact(msgs), null);
});

test('empty / null input returns null', () => {
  assert.strictEqual(pickFirstHumanContact([]), null);
  assert.strictEqual(pickFirstHumanContact(null), null);
});
