const test = require('node:test');
const assert = require('node:assert');
const { runNpsSurvey, runNpsAll } = require('./npsJob');

function fakeDb({ members = [], invites = [], surveys = [] } = {}) {
  const inserted = [];
  return {
    inserted,
    from(table) {
      const state = { table, eq: {}, in: {}, gte: null };
      const builder = {
        select() { return builder; },
        eq(c, v) { state.eq[c] = v; return builder; },
        in(c, v) { state.in[c] = v; return builder; },
        // Honoured, not ignored: the cooldown query is a gte on created_at, and
        // a fake that swallowed it would make the cooldown look like it caught
        // rows it never would in production — hiding whichever guard we meant
        // to test behind the wrong one.
        gte(c, v) { state.gte = [c, v]; return builder; },
        order() { return builder; },
        range(from, to) {
          const src = table === 'abc_members' ? members
            : table === 'nps_invites' ? invites
              : surveys;
          const rows = src.filter(r => {
            for (const [c, v] of Object.entries(state.eq)) if (r[c] !== v) return false;
            for (const [c, vs] of Object.entries(state.in)) if (!vs.includes(r[c])) return false;
            if (state.gte && !(String(r[state.gte[0]]) >= String(state.gte[1]))) return false;
            return true;
          });
          return Promise.resolve({ data: rows.slice(from, to + 1), error: null });
        },
        upsert(rows) {
          // Emulate ignoreDuplicates: only rows whose (survey_id, member_id,
          // trigger_date) is not already present come back.
          const fresh = rows.filter(r => !invites.some(i =>
            i.survey_id === r.survey_id && i.member_id === r.member_id && i.trigger_date === r.trigger_date));
          inserted.push(...fresh);
          return { select: () => Promise.resolve({ data: fresh, error: null }) };
        },
      };
      return builder;
    },
  };
}

const SURVEY_6MO = {
  id: 'srv-6mo', slug: '6mo', title: '6 Month Check-In', status: 'active',
  trigger_type: 'tenure_months', trigger_value: 6, send_window_days: 1,
  resend_cooldown_days: 60, expires_days: 30, audience_filter: {},
  ghl_tag: 'nps-6mo', ghl_field_key: 'contact.nps_survey_url',
};

const NOW = new Date('2026-08-18T14:00:00Z');

test('dry run creates invite rows and never touches GHL', async () => {
  const db = fakeDb({
    members: [{ member_id: 'M1', club_number: '30935', email: 'a@x.com', begin_date: '2026-02-18', is_active: true }],
  });
  let ghlCalls = 0;
  const put = async () => { ghlCalls++; };

  const summary = await runNpsSurvey(SURVEY_6MO, { db, dryRun: true, now: NOW, put });

  assert.equal(summary.created, 1);
  assert.equal(summary.tagged, 0);
  assert.equal(ghlCalls, 0);
  assert.equal(db.inserted.length, 1);
  assert.equal(db.inserted[0].dry_run, true);
  assert.equal(db.inserted[0].member_id, 'M1');
});

test('a rerun creates nothing when the invite already exists', async () => {
  const db = fakeDb({
    members: [{ member_id: 'M1', club_number: '30935', email: 'a@x.com', begin_date: '2026-02-18', is_active: true }],
    invites: [{ survey_id: 'srv-6mo', member_id: 'M1', trigger_date: '2026-08-18', created_at: '2000-01-01T00:00:00Z' }],
  });

  const summary = await runNpsSurvey(SURVEY_6MO, { db, dryRun: true, now: NOW, put: async () => {} });

  // The existing invite is dated 2000, far outside the 60-day cooldown, so the
  // cooldown does NOT catch this member. The row is built and offered to the
  // upsert, and the unique index is what rejects it. That is the guard under
  // test — if the cooldown swallowed it first this test would prove nothing.
  assert.equal(summary.evaluated, 1);
  assert.equal(summary.created, 0);
  assert.equal(summary.skipped.duplicate, 1);
  assert.equal(summary.skipped.cooldown, 0);
});

test('summary reports the skip reasons', async () => {
  const db = fakeDb({
    members: [
      { member_id: 'M1', club_number: '30935', email: null, begin_date: '2026-02-18', is_active: true },
      { member_id: 'M2', club_number: '30935', email: 'b@x.com', begin_date: '2026-02-18', is_active: true },
    ],
    invites: [{ member_id: 'M2', survey_id: 'srv-other', created_at: '2026-08-01T00:00:00Z' }],
  });

  const summary = await runNpsSurvey(SURVEY_6MO, { db, dryRun: true, now: NOW, put: async () => {} });

  assert.equal(summary.skipped.noEmail, 1);
  assert.equal(summary.skipped.cooldown, 1);
  assert.equal(summary.created, 0);
});

test('runNpsAll skips walkup and non-active surveys', async () => {
  const db = fakeDb({
    members: [{ member_id: 'M1', club_number: '30935', email: 'a@x.com', begin_date: '2026-02-18', is_active: true }],
    surveys: [
      SURVEY_6MO,
      { ...SURVEY_6MO, id: 'srv-qr', slug: 'feedback', trigger_type: 'walkup', trigger_value: null },
      { ...SURVEY_6MO, id: 'srv-draft', slug: 'draft', status: 'draft' },
    ],
  });

  const out = await runNpsAll({ db, dryRun: true, now: NOW, put: async () => {} });

  assert.equal(out.surveys.length, 1);
  assert.equal(out.surveys[0].slug, '6mo');
});
