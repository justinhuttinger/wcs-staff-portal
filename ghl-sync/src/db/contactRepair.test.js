const { test } = require('node:test');
const assert = require('node:assert');
const { nullMissingContacts } = require('./contactRepair');

test('preserves contact_id when the contact exists', () => {
  const batch = [{ id: 'o1', contact_id: 'c1' }];
  const out = nullMissingContacts(batch, new Set(['c1']));
  assert.equal(out[0].contact_id, 'c1');
});

test('nulls contact_id when the contact is missing', () => {
  const batch = [{ id: 'o1', contact_id: 'ghost' }];
  const out = nullMissingContacts(batch, new Set(['c1']));
  assert.equal(out[0].contact_id, null);
});

// The core bug: one orphaned opp in a batch must NOT blank valid opps' links.
test('only the orphaned opp loses its contact link, not its batch-mates', () => {
  const batch = [
    { id: 'daniel', contact_id: '86kC9w3okbBp1vtX08HM' },
    { id: 'adela', contact_id: 'DMRHqG8SOJH6gYinoYIl' },
    { id: 'orphan', contact_id: 'deleted-in-ghl' },
  ];
  const existing = new Set(['86kC9w3okbBp1vtX08HM', 'DMRHqG8SOJH6gYinoYIl']);
  const out = nullMissingContacts(batch, existing);
  assert.equal(out.find(o => o.id === 'daniel').contact_id, '86kC9w3okbBp1vtX08HM');
  assert.equal(out.find(o => o.id === 'adela').contact_id, 'DMRHqG8SOJH6gYinoYIl');
  assert.equal(out.find(o => o.id === 'orphan').contact_id, null);
});

test('leaves already-null contact_id untouched', () => {
  const batch = [{ id: 'o1', contact_id: null }];
  const out = nullMissingContacts(batch, new Set());
  assert.equal(out[0].contact_id, null);
});

test('does not mutate the input batch objects', () => {
  const batch = [{ id: 'o1', contact_id: 'ghost' }];
  nullMissingContacts(batch, new Set());
  assert.equal(batch[0].contact_id, 'ghost');
});

test('preserves all other opp fields on the repaired row', () => {
  const batch = [{ id: 'o1', contact_id: 'ghost', pipeline_id: 'p1', name: 'Lead' }];
  const out = nullMissingContacts(batch, new Set());
  assert.deepEqual(out[0], { id: 'o1', contact_id: null, pipeline_id: 'p1', name: 'Lead' });
});
