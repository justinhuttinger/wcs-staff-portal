const test = require('node:test');
const assert = require('node:assert');
const { validateSchema, validateSubmission } = require('./npsSchema');

const METRICS = ['nps', 'cleanliness', 'staff_positivity'];

const GOOD = [
  { id: 'q_clean', type: 'rating', label: 'How clean?', min: 1, max: 10, metric_key: 'cleanliness', required: true },
  { id: 'q_nps', type: 'nps', label: 'Recommend us?', metric_key: 'nps', required: true },
  { id: 'q_why', type: 'textarea', label: 'Anything else?' },
];

test('accepts a well-formed schema', () => {
  assert.deepEqual(validateSchema(GOOD, { metricKeys: METRICS }), { ok: true });
});

test('rejects a duplicate question id', () => {
  const r = validateSchema([GOOD[0], GOOD[0]], { metricKeys: METRICS });
  assert.equal(r.ok, false);
  assert.match(r.error, /duplicate/i);
});

test('rejects a rating question whose metric_key is not in the vocabulary', () => {
  // This is the whole reason nps_metrics exists. A typo here would split one
  // metric into two half-populated ones and the report could never show it.
  const r = validateSchema(
    [{ id: 'q_x', type: 'rating', label: 'x', min: 1, max: 10, metric_key: 'cleanlyness' }],
    { metricKeys: METRICS },
  );
  assert.equal(r.ok, false);
  assert.match(r.error, /metric_key/);
});

test('rejects a rating question with no metric_key at all', () => {
  const r = validateSchema(
    [{ id: 'q_x', type: 'rating', label: 'x', min: 1, max: 10 }],
    { metricKeys: METRICS },
  );
  assert.equal(r.ok, false);
});

test('validates a submission and extracts the score rows', () => {
  const r = validateSubmission(GOOD, { q_clean: 8, q_nps: 10, q_why: '  good  ' });
  assert.equal(r.ok, true);
  assert.equal(r.cleaned.q_why, 'good');
  assert.deepEqual(
    r.scores.sort((a, b) => a.metric_key.localeCompare(b.metric_key)),
    [{ metric_key: 'cleanliness', score: 8 }, { metric_key: 'nps', score: 10 }],
  );
});

test('rejects an out-of-range rating and a missing required answer', () => {
  const r = validateSubmission(GOOD, { q_clean: 44 });
  assert.equal(r.ok, false);
  assert.ok(r.errors.q_clean);
  assert.ok(r.errors.q_nps);
});

test('rejects an unknown answer key', () => {
  const r = validateSubmission(GOOD, { q_clean: 5, q_nps: 5, q_nope: 'x' });
  assert.equal(r.ok, false);
  assert.ok(r.errors.q_nope);
});

test('an nps question is fixed at 0..10 regardless of what the schema says', () => {
  const r = validateSubmission([{ id: 'q_nps', type: 'nps', label: 'x', metric_key: 'nps', min: 1, max: 3 }], { q_nps: 9 });
  assert.equal(r.ok, true);
  assert.deepEqual(r.scores, [{ metric_key: 'nps', score: 9 }]);
});
