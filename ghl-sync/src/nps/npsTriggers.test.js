const test = require('node:test');
const assert = require('node:assert');
const {
  pacificToday, addDays, subMonths, targetDates, cohortFilters, isJobTrigger,
} = require('./npsTriggers');

test('pacificToday returns the Pacific calendar date, not the UTC one', () => {
  // 2026-08-19 05:00 UTC is still 2026-08-18 22:00 in Pacific.
  assert.equal(pacificToday(new Date('2026-08-19T05:00:00Z')), '2026-08-18');
  // 2026-08-19 18:00 UTC is 2026-08-19 11:00 in Pacific.
  assert.equal(pacificToday(new Date('2026-08-19T18:00:00Z')), '2026-08-19');
});

test('addDays crosses month and year boundaries', () => {
  assert.equal(addDays('2026-08-18', -30), '2026-07-19');
  assert.equal(addDays('2026-01-01', -1), '2025-12-31');
  assert.equal(addDays('2026-02-28', 1), '2026-03-01');
});

test('subMonths clamps to the last day when the target day does not exist', () => {
  assert.equal(subMonths('2026-08-15', 6), '2026-02-15');
  assert.equal(subMonths('2026-08-31', 6), '2026-02-28');
  assert.equal(subMonths('2026-01-15', 12), '2025-01-15');
  assert.equal(subMonths('2026-01-15', 24), '2024-01-15');
});

test('targetDates walks the send window backwards from today', () => {
  assert.deepEqual(targetDates('2026-08-18', 3), ['2026-08-18', '2026-08-17', '2026-08-16']);
  assert.deepEqual(targetDates('2026-08-18', 1), ['2026-08-18']);
});

test('cohortFilters translates a tenure_days rule', () => {
  const survey = { trigger_type: 'tenure_days', trigger_value: 30 };
  assert.deepEqual(cohortFilters(survey, '2026-08-18'), {
    beginDate: '2026-07-19', requireActive: true,
  });
});

test('cohortFilters translates a tenure_months rule', () => {
  const survey = { trigger_type: 'tenure_months', trigger_value: 6 };
  assert.deepEqual(cohortFilters(survey, '2026-08-18'), {
    beginDate: '2026-02-18', requireActive: true,
  });
});

test('cohortFilters translates a status_change rule and does not require active', () => {
  const survey = { trigger_type: 'status_change', trigger_status: 'Cancelled' };
  assert.deepEqual(cohortFilters(survey, '2026-08-18'), {
    memberStatus: 'Cancelled', memberStatusDate: '2026-08-18', requireActive: false,
  });
});

test('cohortFilters refuses a walkup survey', () => {
  assert.throws(
    () => cohortFilters({ trigger_type: 'walkup' }, '2026-08-18'),
    /walkup/,
  );
});

test('isJobTrigger excludes walkup only', () => {
  assert.equal(isJobTrigger('tenure_days'), true);
  assert.equal(isJobTrigger('tenure_months'), true);
  assert.equal(isJobTrigger('status_change'), true);
  assert.equal(isJobTrigger('walkup'), false);
});
