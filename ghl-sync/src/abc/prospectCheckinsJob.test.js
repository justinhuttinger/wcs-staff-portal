const test = require('node:test');
const assert = require('node:assert/strict');
const { runProspectCheckinsForLocation } = require('./prospectCheckinsJob');

const location = { id: 'loc1', name: 'Salem', clubNumber: '30935', apiKey: 'key' };
const now = new Date('2026-09-30T18:00:00Z');

// Minimal stand-in for the supabase query builder: every filter is recorded,
// and awaiting the chain resolves with whatever `answer` returns for it.
function fakeDb(answer) {
  const inserts = [];
  return {
    inserts,
    from: (table) => {
      const q = { table, filters: {} };
      const chain = {
        select: () => chain,
        eq: (col, val) => { q.filters[col] = val; return chain; },
        gte: (col, val) => { q.filters[`gte:${col}`] = val; return chain; },
        in: (col, vals) => { q.filters[`in:${col}`] = vals; return chain; },
        range: () => chain,
        insert: (rows) => { inserts.push({ table, rows }); return Promise.resolve({ error: null }); },
        then: (resolve, reject) => Promise.resolve({ data: answer(q), error: null }).then(resolve, reject),
      };
      return chain;
    },
  };
}

function setup({ contactFields = {} } = {}) {
  const queries = [];
  const db = fakeDb((q) => {
    queries.push(q);
    if (q.table === 'abc_member_checkin_days') return [{ member_id: 'member1' }, { member_id: 'prospect1' }, { member_id: 'prospect1' }, { member_id: 'walkin' }];
    if (q.table === 'abc_members') return [{ member_id: 'member1' }];
    if (q.table === 'ghl_custom_field_defs') {
      return [
        { id: 'fMember', field_key: 'contact.abc_member_id' },
        { id: 'fLast', field_key: 'contact.last_checkin' },
        { id: 'fTotal', field_key: 'contact.total_checkins' },
      ];
    }
    if (q.table === 'ghl_contacts_v2') {
      return [{ id: 'c1', email: 's@x.com', first_name: 'Sierra', last_name: 'Austin', custom_fields: { fMember: 'prospect1', ...contactFields } }];
    }
    return [];
  });
  const abcCalls = [];
  const abcGet = async (url) => {
    abcCalls.push(url);
    return { data: { members: [{ memberId: 'prospect1', personal: { joinStatus: 'Prospect', totalCheckInCount: '2', lastCheckInTimestamp: '2026-09-18 09:49:09.912000' } }] } };
  };
  const puts = [];
  const put = async (path, body, apiKey) => { puts.push({ path, body, apiKey }); };
  const opts = { db, now, abcGet, put, sleepFn: async () => {} };
  return { db, queries, abcCalls, puts, opts };
}

test('writes check-in fields for a prospect; members and unstamped visitors are left alone', async () => {
  const s = setup();
  const summary = await runProspectCheckinsForLocation(location, s.opts);

  assert.deepEqual(summary, { checkedIn: 3, nonMembers: 2, matched: 1, updated: 1, unchanged: 0, errors: 0 });
  // 4-day window ending today (Pacific), this club only
  const daysQ = s.queries.find(q => q.table === 'abc_member_checkin_days');
  assert.equal(daysQ.filters.club_number, '30935');
  assert.equal(daysQ.filters['gte:day'], '2026-09-27');
  // contacts are looked up by the stamped member id, members excluded
  const contactQ = s.queries.find(q => q.table === 'ghl_contacts_v2');
  assert.deepEqual(contactQ.filters['in:custom_fields->>fMember'], ['prospect1', 'walkin']);
  // one ABC lookup, for the matched prospect only
  assert.equal(s.abcCalls.length, 1);
  assert.match(s.abcCalls[0], /\/30935\/members\/prospect1$/);

  assert.equal(s.puts.length, 1);
  assert.equal(s.puts[0].path, '/contacts/c1');
  assert.deepEqual(s.puts[0].body, { customFields: [{ id: 'fLast', value: '2026-09-18' }, { id: 'fTotal', value: 2 }] });

  const log = s.db.inserts[0];
  assert.equal(log.table, 'abc_sync_run_log');
  assert.deepEqual(log.rows.map(r => [r.detail.field, r.detail.to, r.applied]), [
    ['contact.last_checkin', '2026-09-18', true],
    ['contact.total_checkins', 2, true],
  ]);
});

test('nothing is written when GHL already holds the values', async () => {
  const s = setup({ contactFields: { fLast: Date.UTC(2026, 8, 18), fTotal: 2 } });
  const summary = await runProspectCheckinsForLocation(location, s.opts);
  assert.equal(summary.unchanged, 1);
  assert.equal(summary.updated, 0);
  assert.equal(s.puts.length, 0);
});

test('dry run logs the planned change without writing to GHL', async () => {
  const s = setup();
  const summary = await runProspectCheckinsForLocation(location, { ...s.opts, dryRun: true });
  assert.equal(summary.updated, 1);
  assert.equal(s.puts.length, 0);
  assert.ok(s.db.inserts[0].rows.every(r => r.dry_run === true && r.applied === false));
});
