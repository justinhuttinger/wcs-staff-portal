const test = require('node:test');
const assert = require('node:assert');
const { testFire } = require('./npsTestFire');

const SURVEY = {
  id: 'srv-1', slug: '6mo', title: '6 Month Check-In', status: 'active',
  expires_days: 30, resend_cooldown_days: 60,
  ghl_tag: 'nps-6mo', ghl_field_key: 'contact.nps_survey_url',
};
const MEMBER = {
  member_id: 'M1', club_number: '30935', email: 'a@x.com',
  first_name: 'Jo', last_name: 'Doe', begin_date: '2026-02-18',
};
const LOCATIONS = [{ id: 'LOC1', name: 'Salem', slug: 'salem', clubCode: '30935', apiKey: 'k' }];
const CONTACT = {
  id: 'C1', location_id: 'LOC1', email: 'a@x.com',
  first_name: 'Jo', last_name: 'Doe', tags: [], custom_fields: [],
};
const NOW = new Date('2026-08-18T14:00:00Z');

function fakeDb({ surveys = [SURVEY], members = [MEMBER], invites = [], contacts = [] } = {}) {
  const inserted = [];
  const tables = {
    nps_surveys: surveys, abc_members: members,
    nps_invites: invites, ghl_contacts_v2: contacts,
  };
  return {
    inserted,
    from(table) {
      const eq = {};
      let gteHit = true;
      function rows() {
        const base = (tables[table] || []).filter(r =>
          Object.entries(eq).every(([c, v]) => r[c] === v));
        return gteHit ? base : [];
      }
      const builder = {
        select() { return builder; },
        eq(c, v) { eq[c] = v; return builder; },
        gte(c, v) {
          gteHit = (tables[table] || []).some(r => String(r[c]) >= String(v));
          return builder;
        },
        limit() { return Promise.resolve({ data: rows(), error: null }); },
        range() { return Promise.resolve({ data: rows(), error: null }); },
        maybeSingle() { return Promise.resolve({ data: rows()[0] || null, error: null }); },
        update() { return { eq: () => Promise.resolve({ error: null }) }; },
        insert(row) {
          inserted.push({ table, row });
          return { select: () => ({ maybeSingle: () => Promise.resolve({ data: { id: 'inv-new', ...row }, error: null }) }) };
        },
      };
      return builder;
    },
  };
}

test('a forced fire writes the field before the tag and marks the invite as a test', async () => {
  const order = [];
  const db = fakeDb({ contacts: [CONTACT] });

  const out = await testFire({
    db, slug: '6mo', memberId: 'M1', force: true, now: NOW, locations: LOCATIONS,
    ghlFetchFn: async (path, apiKey, options = {}) => {
      const body = options.body ? JSON.parse(options.body) : {};
      if (options.method === 'PUT' && body.customFields) order.push('field');
      if (options.method === 'PUT' && body.tags) order.push('tag');
      return { contact: { id: 'C1', tags: [] } };
    },
  });

  assert.equal(out.ok, true);
  assert.equal(order[0], 'field', 'the workflow fires on the tag, so the URL must land first');
  assert.equal(order[1], 'tag');

  const invite = db.inserted.find(i => i.table === 'nps_invites').row;
  assert.equal(invite.is_test, true, 'test rows must never reach the report');
  assert.equal(invite.dry_run, false, 'a manual fire is a real send');
  assert.equal(invite.member_id, 'M1');
  assert.match(out.url, /\/6mo\?t=/);
});

test('two forced fires on the same member and day both succeed', async () => {
  // The partial unique index excludes is_test rows, which is what makes
  // repeated testing possible. A real invite would be rejected here.
  const db = fakeDb({ contacts: [CONTACT] });
  const opts = {
    db, slug: '6mo', memberId: 'M1', force: true, now: NOW, locations: LOCATIONS,
    ghlFetchFn: async () => ({ contact: { id: 'C1', tags: [] } }),
  };

  assert.equal((await testFire(opts)).ok, true);
  assert.equal((await testFire(opts)).ok, true);
  assert.equal(db.inserted.filter(i => i.table === 'nps_invites').length, 2);
});

test('without force, a member inside the cooldown is refused', async () => {
  const db = fakeDb({
    contacts: [CONTACT],
    invites: [{ member_id: 'M1', survey_id: 'srv-other', created_at: '2026-08-15T00:00:00Z' }],
  });

  const out = await testFire({
    db, slug: '6mo', memberId: 'M1', force: false, now: NOW, locations: LOCATIONS,
    ghlFetchFn: async () => ({ contact: { id: 'C1', tags: [] } }),
  });

  assert.equal(out.ok, false);
  assert.match(out.error, /cooldown/i);
  assert.equal(db.inserted.length, 0);
});

test('an unknown member is refused before anything is written', async () => {
  const db = fakeDb();
  const out = await testFire({
    db, slug: '6mo', memberId: 'NOPE', force: true, now: NOW, locations: LOCATIONS,
    ghlFetchFn: async () => ({}),
  });
  assert.equal(out.ok, false);
  assert.equal(out.status, 404);
  assert.equal(db.inserted.length, 0);
});

test('a club with no configured GHL location is refused', async () => {
  const db = fakeDb({ members: [{ ...MEMBER, club_number: '99999' }] });
  const out = await testFire({
    db, slug: '6mo', memberId: 'M1', force: true, now: NOW, locations: LOCATIONS,
    ghlFetchFn: async () => ({}),
  });
  assert.equal(out.ok, false);
  assert.match(out.error, /location/i);
});

// --- the locations config contract ------------------------------------------
//
// These exist because the first version of this module did
// `require('../config/ghlLocations')` and called .find on it. auth exports an
// OBJECT there; ghl-sync exports the array directly. Every test injected a real
// array, so the default path was never exercised and it shipped broken with
// "locations.find is not a function" the first time anyone pressed the button.

test('auth config exports LOCATIONS as an array, not the array itself', () => {
  const mod = require('../config/ghlLocations');
  assert.equal(Array.isArray(mod), false, 'the module itself is an object');
  assert.ok(Array.isArray(mod.LOCATIONS), 'the array lives under .LOCATIONS');
});

test('a module-shaped locations object still resolves a club', async () => {
  const db = fakeDb({ contacts: [CONTACT] });
  const out = await testFire({
    db, slug: '6mo', memberId: 'M1', force: true, now: NOW,
    // Deliberately the module shape rather than a bare array.
    locations: { LOCATIONS },
    ghlFetchFn: async () => ({ contact: { id: 'C1', tags: [] } }),
  });
  assert.equal(out.ok, true);
  assert.equal(out.contact.location, 'Salem');
});
