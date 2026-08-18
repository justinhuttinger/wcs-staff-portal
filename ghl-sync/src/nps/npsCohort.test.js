const test = require('node:test');
const assert = require('node:assert');
const { selectCohort } = require('./npsCohort');

// Minimal fake of the supabase-js query builder: records the filters applied
// and returns whatever rows the fixture supplies for that table.
function fakeDb(tables) {
  return {
    calls: [],
    from(table) {
      const state = { table, eq: {}, in: {}, gte: null };
      const self = this;
      const builder = {
        select() { return builder; },
        eq(col, val) { state.eq[col] = val; return builder; },
        in(col, vals) { state.in[col] = vals; return builder; },
        gte(col, val) { state.gte = [col, val]; return builder; },
        range(from, to) {
          self.calls.push(state);
          const rows = (tables[table] || []).filter(r => {
            for (const [c, v] of Object.entries(state.eq)) if (r[c] !== v) return false;
            for (const [c, vs] of Object.entries(state.in)) if (!vs.includes(r[c])) return false;
            if (state.gte && !(String(r[state.gte[0]]) >= String(state.gte[1]))) return false;
            return true;
          });
          return Promise.resolve({ data: rows.slice(from, to + 1), error: null });
        },
      };
      return builder;
    },
  };
}

const SURVEY_6MO = {
  id: 'srv-6mo', slug: '6mo', trigger_type: 'tenure_months', trigger_value: 6,
  send_window_days: 1, resend_cooldown_days: 60, expires_days: 30,
  audience_filter: {},
};

test('selectCohort returns members whose begin_date matches the anniversary', async () => {
  const db = fakeDb({
    abc_members: [
      { member_id: 'M1', club_number: '30935', email: 'a@x.com', begin_date: '2026-02-18', is_active: true },
      { member_id: 'M2', club_number: '30935', email: 'b@x.com', begin_date: '2026-02-17', is_active: true },
    ],
    nps_invites: [],
  });

  const out = await selectCohort({ db, survey: SURVEY_6MO, now: new Date('2026-08-18T14:00:00Z') });

  assert.equal(out.candidates.length, 1);
  assert.equal(out.candidates[0].member.member_id, 'M1');
  assert.equal(out.candidates[0].targetDate, '2026-08-18');
});

test('selectCohort skips members with no email', async () => {
  const db = fakeDb({
    abc_members: [
      { member_id: 'M1', club_number: '30935', email: null, begin_date: '2026-02-18', is_active: true },
      { member_id: 'M2', club_number: '30935', email: '   ', begin_date: '2026-02-18', is_active: true },
    ],
    nps_invites: [],
  });

  const out = await selectCohort({ db, survey: SURVEY_6MO, now: new Date('2026-08-18T14:00:00Z') });

  assert.equal(out.candidates.length, 0);
  assert.equal(out.skipped.noEmail, 2);
});

test('selectCohort suppresses members invited inside the cooldown, across surveys', async () => {
  const db = fakeDb({
    abc_members: [
      { member_id: 'M1', club_number: '30935', email: 'a@x.com', begin_date: '2026-02-18', is_active: true },
    ],
    // A DIFFERENT survey invited this member recently.
    nps_invites: [{ member_id: 'M1', survey_id: 'srv-other', created_at: '2026-08-01T00:00:00Z' }],
  });

  const out = await selectCohort({ db, survey: SURVEY_6MO, now: new Date('2026-08-18T14:00:00Z') });

  assert.equal(out.candidates.length, 0);
  assert.equal(out.skipped.cooldown, 1);
});

test('selectCohort walks the whole send window and dedupes a member across days', async () => {
  const db = fakeDb({
    abc_members: [
      { member_id: 'M1', club_number: '30935', email: 'a@x.com', begin_date: '2026-02-18', is_active: true },
      { member_id: 'M2', club_number: '30935', email: 'b@x.com', begin_date: '2026-02-17', is_active: true },
    ],
    nps_invites: [],
  });

  const out = await selectCohort({
    db, survey: { ...SURVEY_6MO, send_window_days: 2 }, now: new Date('2026-08-18T14:00:00Z'),
  });

  // M1 matches 2026-08-18, M2 matches 2026-08-17. Both in, one each.
  assert.equal(out.candidates.length, 2);
  const ids = out.candidates.map(c => c.member.member_id).sort();
  assert.deepEqual(ids, ['M1', 'M2']);
});

test('selectCohort narrows to the audience club list when set', async () => {
  const db = fakeDb({
    abc_members: [
      { member_id: 'M1', club_number: '30935', email: 'a@x.com', begin_date: '2026-02-18', is_active: true },
      { member_id: 'M2', club_number: '7655', email: 'b@x.com', begin_date: '2026-02-18', is_active: true },
    ],
    nps_invites: [],
  });

  const out = await selectCohort({
    db, survey: { ...SURVEY_6MO, audience_filter: { club_numbers: ['7655'] } },
    now: new Date('2026-08-18T14:00:00Z'),
  });

  assert.equal(out.candidates.length, 1);
  assert.equal(out.candidates[0].member.club_number, '7655');
});

test('selectCohort does NOT suppress a member whose only invite predates the cooldown', async () => {
  const db = fakeDb({
    abc_members: [
      { member_id: 'M1', club_number: '30935', email: 'a@x.com', begin_date: '2026-02-18', is_active: true },
    ],
    // Years old — far outside the 60-day cooldown. If the .gte cutoff were
    // dropped, this member would be wrongly suppressed forever and this test
    // is the only thing that would notice.
    nps_invites: [{ member_id: 'M1', survey_id: 'srv-other', created_at: '2020-01-01T00:00:00Z' }],
  });

  const out = await selectCohort({ db, survey: SURVEY_6MO, now: new Date('2026-08-18T14:00:00Z') });

  assert.equal(out.candidates.length, 1);
  assert.equal(out.candidates[0].member.member_id, 'M1');
  assert.equal(out.skipped.cooldown, 0);
});
