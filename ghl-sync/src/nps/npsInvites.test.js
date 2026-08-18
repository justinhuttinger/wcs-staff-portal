const test = require('node:test');
const assert = require('node:assert');
const { generateToken, tenureDays, buildInvite, surveyUrl } = require('./npsInvites');

test('generateToken produces distinct URL-safe tokens', () => {
  const a = generateToken();
  const b = generateToken();
  assert.notEqual(a, b);
  assert.match(a, /^[A-Za-z0-9_-]{32}$/);
});

test('tenureDays counts whole days from begin_date', () => {
  assert.equal(tenureDays('2026-07-19', '2026-08-18'), 30);
  assert.equal(tenureDays('2026-08-18', '2026-08-18'), 0);
  assert.equal(tenureDays(null, '2026-08-18'), null);
});

test('buildInvite snapshots member fields and computes expiry', () => {
  const survey = { id: 'srv-1', expires_days: 30 };
  const member = {
    member_id: 'M100', club_number: '30935', email: 'jo@example.com',
    first_name: 'Jo', last_name: 'Doe', begin_date: '2026-07-19',
  };
  const row = buildInvite({
    survey, member, targetDate: '2026-08-18',
    now: new Date('2026-08-18T14:00:00Z'), dryRun: true,
  });

  assert.equal(row.survey_id, 'srv-1');
  assert.equal(row.member_id, 'M100');
  assert.equal(row.club_number, '30935');
  assert.equal(row.member_email, 'jo@example.com');
  assert.equal(row.member_name, 'Jo Doe');
  assert.equal(row.tenure_days, 30);
  assert.equal(row.trigger_date, '2026-08-18');
  assert.equal(row.status, 'pending');
  assert.equal(row.dry_run, true);
  assert.match(row.token, /^[A-Za-z0-9_-]{32}$/);
  assert.equal(row.expires_at, new Date('2026-09-17T14:00:00Z').toISOString());
});

test('buildInvite handles a member with no name parts', () => {
  const row = buildInvite({
    survey: { id: 'srv-1', expires_days: 30 },
    member: { member_id: 'M2', club_number: '7655', email: 'x@y.com' },
    targetDate: '2026-08-18', now: new Date('2026-08-18T14:00:00Z'), dryRun: false,
  });
  assert.equal(row.member_name, null);
  assert.equal(row.tenure_days, null);
  assert.equal(row.dry_run, false);
});

test('surveyUrl builds the tokenised public link', () => {
  assert.equal(
    surveyUrl('https://survey.westcoaststrength.com', '6mo', 'abc123'),
    'https://survey.westcoaststrength.com/6mo?t=abc123',
  );
  // Trailing slash on the base must not double up.
  assert.equal(
    surveyUrl('https://survey.westcoaststrength.com/', '6mo', 'abc123'),
    'https://survey.westcoaststrength.com/6mo?t=abc123',
  );
});
