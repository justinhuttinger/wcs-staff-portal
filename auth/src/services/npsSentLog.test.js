const test = require('node:test');
const assert = require('node:assert');
const { loadSentLog, describe: describeOutcome } = require('./npsSentLog');

const SURVEYS = [{ id: 's1', title: '6 Month Check-In', slug: '6-month' }];

function invite(over = {}) {
  return {
    id: 'i1', survey_id: 's1', member_id: 'M1', member_name: 'Jo Doe',
    member_email: 'jo@x.com', club_number: '30935', trigger_date: '2026-08-18',
    status: 'sent', ghl_tag_applied_at: '2026-08-18T14:00:00Z',
    opened_at: null, responded_at: null, ghl_error: null,
    dry_run: false, is_test: false, created_at: '2026-08-18T14:00:00Z',
    ...over,
  };
}

function fakeDb(invites) {
  return {
    from(table) {
      const builder = {
        select() { return builder; },
        eq() { return builder; },
        gte() { return builder; },
        lte() { return builder; },
        order() { return builder; },
        range(from, to) {
          return Promise.resolve({ data: invites.slice(from, to + 1), error: null });
        },
        then: (res) => res({ data: SURVEYS, error: null }),
      };
      return table === 'nps_surveys'
        ? { select: () => Promise.resolve({ data: SURVEYS, error: null }) }
        : builder;
    },
  };
}

test('an operator sees the outcome, not the raw status columns', () => {
  // "status: sent, ghl_error: null, dry_run: true" takes a beat to decode.
  assert.equal(describeOutcome(invite({ dry_run: true })), 'recorded only (dry run)');
  assert.equal(describeOutcome(invite({ ghl_error: 'boom' })), 'failed: boom');
  assert.equal(describeOutcome(invite({ responded_at: 'x' })), 'answered');
  assert.equal(describeOutcome(invite({ opened_at: 'x' })), 'opened');
  assert.equal(describeOutcome(invite()), 'tagged in GHL');
  assert.equal(describeOutcome(invite({ status: 'pending', ghl_tag_applied_at: null })), 'not sent yet');
});

test('a dry-run row never counts as tagged', async () => {
  // The whole point of a dry run is that nothing reached anybody. Counting it
  // as sent would make a rehearsal look like a launch.
  const out = await loadSentLog({ db: fakeDb([invite({ dry_run: true })]), date: '2026-08-18' });
  assert.equal(out.summary.total, 1);
  assert.equal(out.summary.dry_run, 1);
  assert.equal(out.summary.tagged, 0);
});

test('club numbers are shown as gym names', async () => {
  const out = await loadSentLog({ db: fakeDb([invite()]), date: '2026-08-18' });
  assert.equal(out.rows[0].club_name, 'Salem');
});

test('test fires are listed but counted separately', async () => {
  // They belong in an ops log during rollout, unlike in the report, but they
  // must never inflate the "real sends" number.
  const out = await loadSentLog({
    db: fakeDb([invite({ is_test: true }), invite({ id: 'i2' })]),
    date: '2026-08-18',
  });
  assert.equal(out.summary.total, 2);
  assert.equal(out.summary.tests, 1);
});

test('failures are surfaced with the reason attached', async () => {
  const out = await loadSentLog({
    db: fakeDb([invite({ ghl_error: 'Contact not found' })]),
    date: '2026-08-18',
  });
  assert.equal(out.summary.failed, 1);
  assert.equal(out.rows[0].error, 'Contact not found');
  assert.match(out.rows[0].outcome, /Contact not found/);
});

test('a quiet night returns an empty list rather than failing', async () => {
  const out = await loadSentLog({ db: fakeDb([]), date: '2026-08-18' });
  assert.deepEqual(out.rows, []);
  assert.equal(out.summary.total, 0);
});
