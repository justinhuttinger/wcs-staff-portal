const test = require('node:test');
const assert = require('node:assert');
const { loadByToken, loadByQr } = require('./npsPublic');

const SURVEY = {
  id: 'srv-1', slug: '6mo', title: '6 Month Check-In', intro: 'Two minutes',
  status: 'active', schema: [{ id: 'q_nps', type: 'nps', label: 'Recommend?', metric_key: 'nps' }],
};

// Minimal Supabase-shaped fake. Supports the exact chain the service uses:
// .select().eq().maybeSingle(), and .update().eq().
function fakeDb({ invites = [], surveys = [SURVEY], qr = [] } = {}) {
  const updates = [];
  const tables = { nps_invites: invites, nps_surveys: surveys, nps_club_qr: qr };
  return {
    updates,
    from(table) {
      const eq = {};
      const builder = {
        select() { return builder; },
        eq(c, v) { eq[c] = v; return builder; },
        maybeSingle() {
          const rows = (tables[table] || []).filter(r =>
            Object.entries(eq).every(([c, v]) => r[c] === v));
          return Promise.resolve({ data: rows[0] || null, error: null });
        },
        update(patch) {
          return { eq: (c, v) => { updates.push({ table, patch, where: [c, v] }); return Promise.resolve({ error: null }); } };
        },
      };
      return builder;
    },
  };
}

const NOW = new Date('2026-08-18T14:00:00Z');
const LIVE = {
  id: 'inv-1', survey_id: 'srv-1', token: 'tok-live', member_id: 'M1', club_number: '30935',
  member_email: 'a@x.com', member_name: 'Jo Doe', status: 'pending', opened_at: null,
  expires_at: '2026-09-30T00:00:00Z', is_test: false,
};

test('resolves a live token and stamps opened_at', async () => {
  const db = fakeDb({ invites: [LIVE] });
  const r = await loadByToken({ db, slug: '6mo', token: 'tok-live', now: NOW });
  assert.equal(r.ok, true);
  assert.equal(r.survey.slug, '6mo');
  assert.equal(r.member.first_name, 'Jo');
  const stamped = db.updates.find(u => u.table === 'nps_invites');
  assert.ok(stamped.patch.opened_at, 'opened_at must be stamped');
});

test('does not re-stamp opened_at on a second open', async () => {
  const db = fakeDb({ invites: [{ ...LIVE, opened_at: '2026-08-18T10:00:00Z', status: 'opened' }] });
  const r = await loadByToken({ db, slug: '6mo', token: 'tok-live', now: NOW });
  assert.equal(r.ok, true);
  assert.equal(db.updates.length, 0, 'opened_at is first-open only');
});

test('refuses an expired token with a reason', async () => {
  const db = fakeDb({ invites: [{ ...LIVE, expires_at: '2026-07-01T00:00:00Z' }] });
  const r = await loadByToken({ db, slug: '6mo', token: 'tok-live', now: NOW });
  assert.equal(r.ok, false);
  assert.equal(r.reason, 'expired');
});

test('refuses an already-answered token with a reason', async () => {
  const db = fakeDb({ invites: [{ ...LIVE, status: 'responded' }] });
  const r = await loadByToken({ db, slug: '6mo', token: 'tok-live', now: NOW });
  assert.equal(r.ok, false);
  assert.equal(r.reason, 'answered');
});

test('an unknown token resolves to no reason at all', async () => {
  // Telling a prober "expired" vs "never existed" tells them which tokens are
  // real. Unknown must be indistinguishable from the route's perspective.
  const db = fakeDb({ invites: [] });
  const r = await loadByToken({ db, slug: '6mo', token: 'nope', now: NOW });
  assert.equal(r.ok, false);
  assert.equal(r.reason, null);
});

test('refuses a token whose survey does not match the path slug', async () => {
  const db = fakeDb({ invites: [LIVE] });
  const r = await loadByToken({ db, slug: 'cancel', token: 'tok-live', now: NOW });
  assert.equal(r.ok, false);
  assert.equal(r.reason, null);
});

test('resolves an active QR key with no member payload', async () => {
  const db = fakeDb({ qr: [{ id: 'q1', key: 'abc123', survey_id: 'srv-1', club_number: '31599', active: true }] });
  const r = await loadByQr({ db, slug: '6mo', key: 'abc123' });
  assert.equal(r.ok, true);
  assert.equal(r.clubNumber, '31599');
  assert.equal(r.member, undefined);
});

test('refuses an inactive QR key', async () => {
  const db = fakeDb({ qr: [{ id: 'q1', key: 'abc123', survey_id: 'srv-1', club_number: '31599', active: false }] });
  const r = await loadByQr({ db, slug: '6mo', key: 'abc123' });
  assert.equal(r.ok, false);
});

const { submitResponse } = require('./npsPublic');

// The submit path inserts, so the fake needs insert() returning the row.
function fakeSubmitDb({ invites = [], surveys = [SURVEY], qr = [] } = {}) {
  const inserted = [];
  const updates = [];
  const tables = { nps_invites: invites, nps_surveys: surveys, nps_club_qr: qr };
  return {
    inserted,
    updates,
    from(table) {
      const eq = {};
      const builder = {
        select() { return builder; },
        eq(c, v) { eq[c] = v; return builder; },
        maybeSingle() {
          const rows = (tables[table] || []).filter(r =>
            Object.entries(eq).every(([c, v]) => r[c] === v));
          return Promise.resolve({ data: rows[0] || null, error: null });
        },
        update(patch) {
          return { eq: (c, v) => { updates.push({ table, patch, where: [c, v] }); return Promise.resolve({ error: null }); } };
        },
        insert(rows) {
          const list = Array.isArray(rows) ? rows : [rows];
          list.forEach(r => inserted.push({ table, row: r }));
          return {
            select: () => ({ maybeSingle: () => Promise.resolve({ data: { id: 'resp-1', ...list[0] }, error: null }) }),
            then: (res) => res({ data: list, error: null }),
          };
        },
      };
      return builder;
    },
  };
}

test('an invited submission writes the response, the scores, and burns the token', async () => {
  const db = fakeSubmitDb({ invites: [LIVE] });
  const r = await submitResponse({
    db, slug: '6mo', token: 'tok-live', answers: { q_nps: 9 }, now: NOW,
  });

  assert.equal(r.ok, true);
  const resp = db.inserted.find(i => i.table === 'nps_responses').row;
  assert.equal(resp.source, 'invited');
  assert.equal(resp.nps_score, 9);
  assert.equal(resp.member_id, 'M1');

  const score = db.inserted.find(i => i.table === 'nps_response_scores').row;
  assert.equal(score.metric_key, 'nps');
  assert.equal(score.score, 9);
  assert.equal(score.club_number, '30935', 'club is denormalised onto the score row');

  const burn = db.updates.find(u => u.patch.status === 'responded');
  assert.ok(burn, 'the token must be burned so the link is one-shot');
});

test('is_test propagates from the invite all the way to the score rows', async () => {
  // A manual fire must never reach the report, and the report reads
  // nps_response_scores directly.
  const db = fakeSubmitDb({ invites: [{ ...LIVE, is_test: true }] });
  await submitResponse({ db, slug: '6mo', token: 'tok-live', answers: { q_nps: 3 }, now: NOW });

  assert.equal(db.inserted.find(i => i.table === 'nps_responses').row.is_test, true);
  assert.equal(db.inserted.find(i => i.table === 'nps_response_scores').row.is_test, true);
});

test('a walk-up submission records no member identity', async () => {
  const db = fakeSubmitDb({ qr: [{ id: 'q1', key: 'abc123', survey_id: 'srv-1', club_number: '31599', active: true }] });
  const r = await submitResponse({ db, slug: '6mo', key: 'abc123', answers: { q_nps: 7 }, now: NOW });

  assert.equal(r.ok, true);
  const resp = db.inserted.find(i => i.table === 'nps_responses').row;
  assert.equal(resp.source, 'walkup');
  assert.equal(resp.member_id, null);
  assert.equal(resp.invite_id, null);
  assert.equal(resp.club_number, '31599');
});

test('a bad answer is rejected with field errors and writes nothing', async () => {
  const db = fakeSubmitDb({ invites: [LIVE] });
  const r = await submitResponse({ db, slug: '6mo', token: 'tok-live', answers: { q_nps: 44 }, now: NOW });

  assert.equal(r.ok, false);
  assert.equal(r.status, 400);
  assert.ok(r.errors.q_nps);
  assert.equal(db.inserted.length, 0, 'nothing is written when validation fails');
});

test('submitting on an already-answered token is refused', async () => {
  const db = fakeSubmitDb({ invites: [{ ...LIVE, status: 'responded' }] });
  const r = await submitResponse({ db, slug: '6mo', token: 'tok-live', answers: { q_nps: 9 }, now: NOW });
  assert.equal(r.ok, false);
  assert.equal(r.status, 404);
  assert.equal(db.inserted.length, 0);
});
