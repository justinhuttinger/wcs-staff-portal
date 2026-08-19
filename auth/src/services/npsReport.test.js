const test = require('node:test');
const assert = require('node:assert');
const { npsFromScores, band, aggregate, responseRates } = require('./npsReport');

// --- the NPS formula --------------------------------------------------------

test('bands follow the standard split, not an even one', () => {
  // 0-6 detractor, 7-8 passive, 9-10 promoter. A 6 is a detractor even though
  // it reads as a pass mark, which is the part people get wrong by hand.
  assert.equal(band(0), 'detractor');
  assert.equal(band(6), 'detractor');
  assert.equal(band(7), 'passive');
  assert.equal(band(8), 'passive');
  assert.equal(band(9), 'promoter');
  assert.equal(band(10), 'promoter');
});

test('nps is percent promoters minus percent detractors', () => {
  // 2 promoters, 1 passive, 1 detractor of 4 = 50% - 25% = 25.
  const r = npsFromScores([10, 9, 8, 3]);
  assert.equal(r.n, 4);
  assert.equal(r.promoters, 2);
  assert.equal(r.passives, 1);
  assert.equal(r.detractors, 1);
  assert.equal(r.nps, 25);
});

test('passives drag the score without being counted directly', () => {
  // All passives is 0, not 100. This is the property that makes NPS mean
  // anything: indifference is not endorsement.
  assert.equal(npsFromScores([7, 7, 8, 8]).nps, 0);
});

test('no responses is null, not zero', () => {
  // Zero is a real, bad score. Reporting it for an empty club would invent a
  // result nobody measured.
  assert.equal(npsFromScores([]).nps, null);
  assert.equal(npsFromScores([]).n, 0);
});

// --- aggregation ------------------------------------------------------------

const SCORES = [
  { survey_id: 's1', metric_key: 'nps', score: 10, club_number: '30935', source: 'invited', submitted_at: '2026-08-10T00:00:00Z', is_test: false },
  { survey_id: 's1', metric_key: 'nps', score: 3, club_number: '30935', source: 'invited', submitted_at: '2026-08-11T00:00:00Z', is_test: false },
  { survey_id: 's1', metric_key: 'cleanliness', score: 8, club_number: '30935', source: 'invited', submitted_at: '2026-08-11T00:00:00Z', is_test: false },
  { survey_id: 's1', metric_key: 'nps', score: 9, club_number: '31599', source: 'walkup', submitted_at: '2026-08-12T00:00:00Z', is_test: false },
];

test('a test fire never reaches the report', () => {
  // The whole point of is_test. A single leaked row moves a club's number.
  const withTest = [...SCORES, { survey_id: 's1', metric_key: 'nps', score: 0, club_number: '30935', source: 'invited', submitted_at: '2026-08-11T00:00:00Z', is_test: true }];
  const clean = aggregate({ scoreRows: SCORES });
  const dirty = aggregate({ scoreRows: withTest });
  assert.deepEqual(dirty.byClub, clean.byClub);
});

test('invited and walk-up are separated by default', () => {
  // Walk-up is self-selected and skews to the extremes; invited is a roughly
  // random sample. Blending them silently means company NPS moves when a
  // poster gets hung nearer the door.
  const out = aggregate({ scoreRows: SCORES });
  const salem = out.byClub.find(c => c.club_number === '30935');
  const keizer = out.byClub.find(c => c.club_number === '31599');

  assert.equal(salem.invited.nps, 0, '1 promoter 1 detractor of 2');
  assert.equal(salem.walkup.n, 0);
  assert.equal(keizer.walkup.nps, 100);
  assert.equal(keizer.invited.n, 0);
});

test('combining is possible but has to be asked for', () => {
  const out = aggregate({ scoreRows: SCORES, combineSources: true });
  const salem = out.byClub.find(c => c.club_number === '30935');
  assert.equal(salem.combined.n, 2);
  const overall = out.overall.combined;
  assert.equal(overall.n, 3, 'all three nps answers across both sources');
});

test('a club with no responses is omitted entirely', () => {
  // House convention: never a row that says "nothing here".
  const out = aggregate({ scoreRows: SCORES });
  assert.equal(out.byClub.length, 2);
  assert.ok(!out.byClub.some(c => c.club_number === '7655'));
});

test('per-metric averages skip metrics nobody answered', () => {
  const out = aggregate({ scoreRows: SCORES });
  const keys = out.byMetric.map(m => m.metric_key);
  assert.ok(keys.includes('cleanliness'));
  assert.ok(!keys.includes('equipment'));

  const clean = out.byMetric.find(m => m.metric_key === 'cleanliness');
  assert.equal(clean.invited.average, 8);
});

test('an average is rounded to one decimal, not left as a float tail', () => {
  const rows = [
    { survey_id: 's1', metric_key: 'value', score: 8, club_number: '30935', source: 'invited', submitted_at: '2026-08-10T00:00:00Z', is_test: false },
    { survey_id: 's1', metric_key: 'value', score: 9, club_number: '30935', source: 'invited', submitted_at: '2026-08-10T00:00:00Z', is_test: false },
    { survey_id: 's1', metric_key: 'value', score: 9, club_number: '30935', source: 'invited', submitted_at: '2026-08-10T00:00:00Z', is_test: false },
  ];
  const out = aggregate({ scoreRows: rows });
  assert.equal(out.byMetric[0].invited.average, 8.7);
});

// --- response rates ---------------------------------------------------------

test('response rate counts sent, opened and answered', () => {
  const invites = [
    { survey_id: 's1', status: 'sent', is_test: false, dry_run: false, opened_at: null, responded_at: null },
    { survey_id: 's1', status: 'opened', is_test: false, dry_run: false, opened_at: 'x', responded_at: null },
    { survey_id: 's1', status: 'responded', is_test: false, dry_run: false, opened_at: 'x', responded_at: 'y' },
    { survey_id: 's1', status: 'failed', is_test: false, dry_run: false, opened_at: null, responded_at: null },
  ];
  const out = responseRates({ inviteRows: invites });
  const s1 = out.find(r => r.survey_id === 's1');

  assert.equal(s1.sent, 3, 'failed invites never reached anyone, so they are not the denominator');
  assert.equal(s1.opened, 2);
  assert.equal(s1.responded, 1);
  assert.equal(s1.response_rate, 33.3);
});

test('dry-run and test invites are excluded from response rate', () => {
  const invites = [
    { survey_id: 's1', status: 'sent', is_test: false, dry_run: true, opened_at: null, responded_at: null },
    { survey_id: 's1', status: 'responded', is_test: true, dry_run: false, opened_at: 'x', responded_at: 'y' },
  ];
  assert.deepEqual(responseRates({ inviteRows: invites }), []);
});

test('a survey that sent nothing has a null rate rather than a zero', () => {
  const invites = [
    { survey_id: 's1', status: 'failed', is_test: false, dry_run: false, opened_at: null, responded_at: null },
  ];
  const out = responseRates({ inviteRows: invites });
  assert.equal(out.length, 1);
  assert.equal(out[0].response_rate, null);
});

// --- comment feed -----------------------------------------------------------

const { buildComments } = require('./npsReport');

const RESPONSES = [
  {
    id: 'r1', survey_id: 's1', club_number: '30935', source: 'invited', nps_score: 3,
    answers: { q_nps: 3, q_more: '  The squat racks are always busy  ', q_clean: 8 },
    contact_name: null, contact_email: null, submitted_at: '2026-08-10T00:00:00Z', is_test: false,
  },
  {
    id: 'r2', survey_id: 's1', club_number: '31599', source: 'walkup', nps_score: 10,
    answers: { q_nps: 10, q_more: 'Love this place' },
    contact_name: 'Jo', contact_email: 'jo@x.com', submitted_at: '2026-08-12T00:00:00Z', is_test: false,
  },
];

test('only free text becomes a comment, and it is trimmed', () => {
  // Numeric answers are already counted as scores; repeating them as comments
  // would bury the actual words in a list of digits.
  const out = buildComments(RESPONSES);
  assert.equal(out.length, 2);
  assert.equal(out[0].text, 'Love this place');
  assert.ok(out.every(c => typeof c.text === 'string'));
  assert.ok(!out.some(c => c.text === '8'));
});

test('newest comment comes first', () => {
  assert.equal(buildComments(RESPONSES)[0].response_id, 'r2');
});

test('each comment carries the band it came with', () => {
  // A 3 and a 9 saying the same words are different problems: one is a
  // complaint, the other is a compliment about how busy the gym is.
  const out = buildComments(RESPONSES);
  assert.equal(out.find(c => c.response_id === 'r1').band, 'detractor');
  assert.equal(out.find(c => c.response_id === 'r2').band, 'promoter');
});

test('a test response never appears in the feed', () => {
  // This feed does not go through aggregate(), so it needs its own guard.
  const out = buildComments([...RESPONSES, {
    id: 'r3', survey_id: 's1', club_number: '30935', source: 'invited', nps_score: 0,
    answers: { q_more: 'TESTING PLEASE IGNORE' },
    submitted_at: '2026-08-13T00:00:00Z', is_test: true,
  }]);
  assert.equal(out.length, 2);
  assert.ok(!out.some(c => c.text.includes('TESTING')));
});

test('an empty comment is dropped rather than listed blank', () => {
  const out = buildComments([{
    id: 'r4', survey_id: 's1', club_number: '30935', source: 'invited', nps_score: 7,
    answers: { q_more: '   ' }, submitted_at: '2026-08-14T00:00:00Z', is_test: false,
  }]);
  assert.deepEqual(out, []);
});

// --- blended views ----------------------------------------------------------

test('a club blends every rating answer, not just the nps one', () => {
  // "How are we doing at Salem" is one number over every question and both
  // sources. The nps-only figure answers a narrower question.
  const out = aggregate({ scoreRows: SCORES });
  const salem = out.byClub.find(c => c.club_number === '30935');
  // Salem: nps 10, nps 3, cleanliness 8 -> (10+3+8)/3 = 7
  assert.equal(salem.blended.n, 3);
  assert.equal(salem.blended.average, 7);
});

test('a question blends both sources without being asked to combine', () => {
  const out = aggregate({ scoreRows: SCORES });
  const nps = out.byMetric.find(m => m.metric_key === 'nps');
  // 10 and 3 invited at Salem, 9 walkup at Keizer -> (10+3+9)/3 = 7.3
  assert.equal(nps.blended.n, 3);
  assert.equal(nps.blended.average, 7.3);
});

test('the club x question matrix only holds cells somebody answered', () => {
  const out = aggregate({ scoreRows: SCORES });
  const salemClean = out.matrix.find(c => c.club_number === '30935' && c.metric_key === 'cleanliness');
  assert.equal(salemClean.average, 8);
  // Keizer has an nps answer but nothing on cleanliness, so no empty cell.
  assert.equal(out.matrix.some(c => c.club_number === '31599' && c.metric_key === 'cleanliness'), false);
});

test('test rows stay out of every blended figure too', () => {
  const withTest = [...SCORES, {
    survey_id: 's1', metric_key: 'cleanliness', score: 0, club_number: '30935',
    source: 'invited', submitted_at: '2026-08-11T00:00:00Z', is_test: true,
  }];
  assert.deepEqual(aggregate({ scoreRows: withTest }).byClub, aggregate({ scoreRows: SCORES }).byClub);
  assert.deepEqual(aggregate({ scoreRows: withTest }).matrix, aggregate({ scoreRows: SCORES }).matrix);
});
