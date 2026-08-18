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

const { applyGhlForInvites } = require('./npsJob');

test('applyGhlForInvites writes the URL field before adding the tag', async () => {
  const order = [];
  let written = null;
  const contacts = [
    { id: 'C1', email: 'a@x.com', first_name: 'Jo', last_name: 'Doe', tags: [], custom_fields: [] },
  ];
  // Models the real contract: the survey field id is resolved from
  // ghl_custom_field_defs, and the custom field is addressed by that id.
  const db = {
    from(table) {
      const eq = {};
      const builder = {
        select: () => builder,
        eq: (c, v) => { eq[c] = v; return builder; },
        limit: () => Promise.resolve({
          data: (table === 'ghl_custom_field_defs' && eq.field_key === 'contact.nps_survey_url')
            ? [{ id: 'FIELD1', field_key: 'contact.nps_survey_url' }]
            : [],
          error: null,
        }),
        range: () => Promise.resolve({
          data: table === 'ghl_contacts_v2' ? contacts : [], error: null,
        }),
        update: () => ({ eq: () => Promise.resolve({ error: null }) }),
      };
      return builder;
    },
  };

  const invites = [{
    id: 'INV1', member_id: 'M1', club_number: '30935',
    member_email: 'a@x.com', member_name: 'Jo Doe', token: 'tok123',
  }];
  const survey = { id: 'srv-6mo', slug: '6mo', ghl_tag: 'nps-6mo', ghl_field_key: 'contact.nps_survey_url' };

  const out = await applyGhlForInvites(survey, invites, {
    db,
    now: new Date('2026-08-18T14:00:00Z'),
    locations: [{ id: 'LOC1', name: 'Salem', slug: 'salem', clubNumber: '30935', apiKey: 'k' }],
    get: async () => ({ contact: { id: 'C1', tags: [], customFields: [{ id: 'FIELD1', value: written }] } }),
    put: async (path, body) => {
      // The workflow fires on the tag, so an empty URL field at tag time would
      // send a broken email. Record which landed first.
      if (body.customFields) {
        // GHL 200s the { key, field_value } form and drops it on the floor.
        assert.ok(body.customFields[0].id, 'the custom field must be written by id');
        assert.equal(body.customFields[0].key, undefined);
        written = body.customFields[0].value;
        order.push('field');
      }
      if (body.tags) order.push('tag');
      return { contact: { id: 'C1' } };
    },
    sleepFn: async () => {},
    baseUrl: 'https://survey.westcoaststrength.com',
  });

  assert.equal(out.tagged, 1);
  assert.deepEqual(out.errors, []);
  assert.equal(order[0], 'field', 'custom field must be written before the tag');
  assert.equal(order[1], 'tag');
});

test('applyGhlForInvites records an error and keeps going when one contact fails', async () => {
  const writes = {};
  const contacts = [
    { id: 'C1', email: 'a@x.com', first_name: 'A', last_name: 'A', tags: [], custom_fields: [] },
    { id: 'C2', email: 'b@x.com', first_name: 'B', last_name: 'B', tags: [], custom_fields: [] },
  ];
  // Models the real contract: the survey field id is resolved from
  // ghl_custom_field_defs, and the custom field is addressed by that id.
  const db = {
    from(table) {
      const eq = {};
      const builder = {
        select: () => builder,
        eq: (c, v) => { eq[c] = v; return builder; },
        limit: () => Promise.resolve({
          data: (table === 'ghl_custom_field_defs' && eq.field_key === 'contact.nps_survey_url')
            ? [{ id: 'FIELD1', field_key: 'contact.nps_survey_url' }]
            : [],
          error: null,
        }),
        range: () => Promise.resolve({
          data: table === 'ghl_contacts_v2' ? contacts : [], error: null,
        }),
        update: () => ({ eq: () => Promise.resolve({ error: null }) }),
      };
      return builder;
    },
  };

  const invites = [
    { id: 'INV1', member_id: 'M1', club_number: '30935', member_email: 'a@x.com', token: 't1' },
    { id: 'INV2', member_id: 'M2', club_number: '30935', member_email: 'b@x.com', token: 't2' },
  ];
  const survey = { id: 's', slug: '6mo', ghl_tag: 'nps-6mo', ghl_field_key: 'contact.nps_survey_url' };

  const out = await applyGhlForInvites(survey, invites, {
    db,
    now: new Date('2026-08-18T14:00:00Z'),
    locations: [{ id: 'LOC1', name: 'Salem', slug: 'salem', clubNumber: '30935', apiKey: 'k' }],
    get: async (path) => ({ contact: { id: 'C1', tags: [], customFields: [{ id: 'FIELD1', value: writes[path] }] } }),
    put: async (path, body) => {
      if (path.includes('C2')) throw new Error('GHL 500');
      if (body.customFields) writes[path] = body.customFields[0].value;
      return { contact: {} };
    },
    sleepFn: async () => {},
    baseUrl: 'https://survey.westcoaststrength.com',
  });

  assert.equal(out.tagged, 1);
  assert.equal(out.errors.length, 1);
  assert.match(out.errors[0], /GHL 500/);
});

test('a URL that does not store blocks the tag, so no dead-link email goes out', async () => {
  // GHL answers 200 to a custom-field write it never performs. Tagging anyway
  // fires the workflow and emails a member a link to nowhere. This is the
  // single worst failure this job has.
  const db = {
    from(table) {
      const eq = {};
      const builder = {
        select: () => builder,
        eq: (c, v) => { eq[c] = v; return builder; },
        limit: () => Promise.resolve({
          data: (table === 'ghl_custom_field_defs' && eq.field_key === 'contact.nps_survey_url')
            ? [{ id: 'FIELD1', field_key: 'contact.nps_survey_url' }] : [],
          error: null,
        }),
        range: () => Promise.resolve({
          data: table === 'ghl_contacts_v2'
            ? [{ id: 'C1', email: 'a@x.com', first_name: 'A', last_name: 'A', tags: [], custom_fields: [] }]
            : [],
          error: null,
        }),
        update: () => ({ eq: () => Promise.resolve({ error: null }) }),
      };
      return builder;
    },
  };

  const tagged = [];
  const out = await applyGhlForInvites(
    { id: 's', slug: '6mo', ghl_tag: 'nps-6mo', ghl_field_key: 'contact.nps_survey_url' },
    [{ id: 'INV1', member_id: 'M1', club_number: '30935', member_email: 'a@x.com', token: 't1' }],
    {
      db,
      now: new Date('2026-08-18T14:00:00Z'),
      locations: [{ id: 'LOC1', name: 'Salem', slug: 'salem', clubNumber: '30935', apiKey: 'k' }],
      // Read-back reports the field empty: the write silently failed.
      get: async () => ({ contact: { id: 'C1', tags: [], customFields: [] } }),
      put: async (path, body) => { if (body.tags) tagged.push(path); return { contact: {} }; },
      sleepFn: async () => {},
      baseUrl: 'https://survey.westcoaststrength.com',
    },
  );

  assert.equal(out.tagged, 0);
  assert.deepEqual(tagged, [], 'must not tag when the URL did not store');
  assert.match(out.errors[0], /did not store the survey URL/);
});
