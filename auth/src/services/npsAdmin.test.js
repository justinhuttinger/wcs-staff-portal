const test = require('node:test');
const assert = require('node:assert');
const {
  createSurvey, updateSurvey, deleteSurvey,
  createQrKey, rotateQrKey, setMetricActive,
} = require('./npsAdmin');

const METRICS = [
  { id: 'm1', key: 'nps', label: 'Likelihood to recommend', active: true },
  { id: 'm2', key: 'cleanliness', label: 'Cleanliness', active: true },
  { id: 'm3', key: 'retired_thing', label: 'Retired', active: false },
];

const SURVEY = {
  id: 'srv-1', slug: '6mo', title: '6 Month Check-In', status: 'draft',
  trigger_type: 'tenure_months', trigger_value: 6, trigger_status: null,
  schema: [], audience_filter: {}, send_window_days: 3,
  resend_cooldown_days: 60, expires_days: 30,
  ghl_tag: null, ghl_field_key: null,
  updated_at: '2026-08-18T12:00:00Z',
};

function fakeDb({ surveys = [], metrics = METRICS, responses = [], qr = [] } = {}) {
  const writes = [];
  const tables = {
    nps_surveys: surveys, nps_metrics: metrics,
    nps_responses: responses, nps_club_qr: qr,
  };
  return {
    writes,
    from(table) {
      const eq = {};
      function rows() {
        return (tables[table] || []).filter(r =>
          Object.entries(eq).every(([c, v]) => r[c] === v));
      }
      const builder = {
        select() { return builder; },
        eq(c, v) { eq[c] = v; return builder; },
        neq(c, v) { return builder; },
        order() { return Promise.resolve({ data: rows(), error: null }); },
        limit() { return Promise.resolve({ data: rows(), error: null }); },
        maybeSingle() { return Promise.resolve({ data: rows()[0] || null, error: null }); },
        insert(row) {
          writes.push({ op: 'insert', table, row });
          return { select: () => ({ maybeSingle: () => Promise.resolve({ data: { id: 'new-id', ...row }, error: null }) }) };
        },
        update(patch) {
          return {
            eq: (c, v) => {
              writes.push({ op: 'update', table, patch, where: [c, v] });
              return {
                select: () => ({ maybeSingle: () => Promise.resolve({ data: { ...rows()[0], ...patch }, error: null }) }),
                then: (res) => res({ error: null }),
              };
            },
          };
        },
        delete() {
          return { eq: (c, v) => { writes.push({ op: 'delete', table, where: [c, v] }); return Promise.resolve({ error: null }); } };
        },
      };
      return builder;
    },
  };
}

// --- slug -------------------------------------------------------------------

test('rejects a slug that would not survive being a URL path', async () => {
  // The slug IS the public address: survey.westcoaststrength.com/{slug}.
  const db = fakeDb();
  const r = await createSurvey({ db, input: { title: 'Six Month', slug: 'Six Month!', trigger_type: 'walkup' } });
  assert.equal(r.ok, false);
  assert.match(r.error, /slug/i);
});

test('rejects a duplicate slug', async () => {
  const db = fakeDb({ surveys: [SURVEY] });
  const r = await createSurvey({ db, input: { title: 'Another', slug: '6mo', trigger_type: 'walkup' } });
  assert.equal(r.ok, false);
  assert.equal(r.status, 409);
});

test('derives a clean slug from the title when none is given', async () => {
  const db = fakeDb();
  const r = await createSurvey({ db, input: { title: '6 Month Check-In', trigger_type: 'walkup' } });
  assert.equal(r.ok, true);
  // No random suffix: a member reads this in a URL.
  assert.equal(r.survey.slug, '6-month-check-in');
});

// --- trigger coherence ------------------------------------------------------

test('a tenure trigger without a value is refused', async () => {
  const db = fakeDb();
  const r = await createSurvey({ db, input: { title: 'Tenure', slug: 'tenure', trigger_type: 'tenure_months' } });
  assert.equal(r.ok, false);
  assert.match(r.error, /trigger_value/);
});

test('a status_change trigger without a status is refused', async () => {
  const db = fakeDb();
  const r = await createSurvey({ db, input: { title: 'Cancel', slug: 'cancel', trigger_type: 'status_change' } });
  assert.equal(r.ok, false);
  assert.match(r.error, /trigger_status/);
});

test('a walkup trigger needs neither and is accepted', async () => {
  const db = fakeDb();
  const r = await createSurvey({ db, input: { title: 'Feedback', slug: 'feedback', trigger_type: 'walkup' } });
  assert.equal(r.ok, true);
  assert.equal(r.survey.trigger_value, null);
});

// --- schema validation against the live vocabulary --------------------------

test('a question pointing at an inactive metric is refused', async () => {
  // Inactive metrics still exist as rows. Accepting one would quietly start
  // populating a metric nothing reports on.
  const db = fakeDb({ surveys: [SURVEY] });
  const r = await updateSurvey({
    db, id: 'srv-1', knownUpdatedAt: SURVEY.updated_at,
    patch: { schema: [{ id: 'q_a', type: 'rating', label: 'x', min: 1, max: 10, metric_key: 'retired_thing' }] },
  });
  assert.equal(r.ok, false);
  assert.match(r.error, /metric_key/);
});

test('a question pointing at an active metric is accepted', async () => {
  const db = fakeDb({ surveys: [SURVEY] });
  const r = await updateSurvey({
    db, id: 'srv-1', knownUpdatedAt: SURVEY.updated_at,
    patch: { schema: [{ id: 'q_a', type: 'rating', label: 'x', min: 1, max: 10, metric_key: 'cleanliness' }] },
  });
  assert.equal(r.ok, true);
});

// --- concurrency ------------------------------------------------------------

test('a stale edit is refused rather than silently overwriting', async () => {
  const db = fakeDb({ surveys: [SURVEY] });
  const r = await updateSurvey({
    db, id: 'srv-1', knownUpdatedAt: '2026-08-01T00:00:00Z', patch: { title: 'Mine' },
  });
  assert.equal(r.ok, false);
  assert.equal(r.status, 409);
  assert.equal(db.writes.length, 0);
});

// --- GHL half-configuration -------------------------------------------------

test('a tag without a field key is refused', async () => {
  // Half-configured is the dangerous state: the job would tag the contact and
  // fire the workflow with no URL to send.
  const db = fakeDb({ surveys: [SURVEY] });
  const r = await updateSurvey({
    db, id: 'srv-1', knownUpdatedAt: SURVEY.updated_at, patch: { ghl_tag: 'nps-6mo' },
  });
  assert.equal(r.ok, false);
  assert.match(r.error, /ghl_field_key/);
});

test('a tag and field key together are accepted', async () => {
  const db = fakeDb({ surveys: [SURVEY] });
  const r = await updateSurvey({
    db, id: 'srv-1', knownUpdatedAt: SURVEY.updated_at,
    patch: { ghl_tag: 'nps-6mo', ghl_field_key: 'contact.nps_survey_url' },
  });
  assert.equal(r.ok, true);
});

// --- delete -----------------------------------------------------------------

test('a survey with responses cannot be deleted', async () => {
  // The FK cascades, so deleting would take the responses with it.
  const db = fakeDb({ surveys: [SURVEY], responses: [{ id: 'r1', survey_id: 'srv-1' }] });
  const r = await deleteSurvey({ db, id: 'srv-1' });
  assert.equal(r.ok, false);
  assert.equal(r.status, 409);
  assert.equal(db.writes.filter(w => w.op === 'delete').length, 0);
});

test('a survey with no responses can be deleted', async () => {
  const db = fakeDb({ surveys: [SURVEY] });
  const r = await deleteSurvey({ db, id: 'srv-1' });
  assert.equal(r.ok, true);
  assert.equal(db.writes.filter(w => w.op === 'delete').length, 1);
});

// --- QR keys ----------------------------------------------------------------

test('a QR key is opaque, not the club number', async () => {
  const db = fakeDb({ surveys: [{ ...SURVEY, trigger_type: 'walkup' }] });
  const r = await createQrKey({ db, surveyId: 'srv-1', clubNumber: '30935' });
  assert.equal(r.ok, true);
  assert.ok(r.qr.key.length >= 20, 'a guessable key lets someone dump another club onto this report');
  assert.ok(!r.qr.key.includes('30935'));
});

test('rotating a key deactivates the old one and issues a new one', async () => {
  // A poster hangs in public; a photographed URL cannot be un-shared.
  const db = fakeDb({
    surveys: [{ ...SURVEY, trigger_type: 'walkup' }],
    qr: [{ id: 'qr-1', survey_id: 'srv-1', club_number: '30935', key: 'oldkey', active: true }],
  });
  const r = await rotateQrKey({ db, id: 'qr-1' });

  assert.equal(r.ok, true);
  const deactivated = db.writes.find(w => w.op === 'update' && w.patch.active === false);
  assert.ok(deactivated, 'the old key must stop working immediately');
  const issued = db.writes.find(w => w.op === 'insert' && w.table === 'nps_club_qr');
  assert.ok(issued);
  assert.notEqual(issued.row.key, 'oldkey');
});

// --- metrics ----------------------------------------------------------------

test('a metric can be retired without being deleted', async () => {
  // Deleting would orphan every score row already keyed to it.
  const db = fakeDb();
  const r = await setMetricActive({ db, id: 'm2', active: false });
  assert.equal(r.ok, true);
  const upd = db.writes.find(w => w.op === 'update' && w.table === 'nps_metrics');
  assert.equal(upd.patch.active, false);
});
