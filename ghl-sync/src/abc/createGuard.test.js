const test = require('node:test');
const assert = require('node:assert/strict');
const { allowSmallCache, maxCreatesPerRun, DEFAULT_MAX_CREATES_PER_RUN } = require('./createGuard');

const wilsonville = { slug: 'wilsonville', id: 'lZZ4V8Vi8sp4WQMqyKJK' };
const salem = { slug: 'salem', id: 'salemLocId' };

test('allowSmallCache: off when env unset or empty', () => {
  assert.equal(allowSmallCache(wilsonville, {}), false);
  assert.equal(allowSmallCache(wilsonville, { ABC_RECONCILE_ALLOW_SMALL_CACHE: ' , ' }), false);
});

test('allowSmallCache: matches slug case-insensitively, only listed clubs', () => {
  const env = { ABC_RECONCILE_ALLOW_SMALL_CACHE: 'Wilsonville' };
  assert.equal(allowSmallCache(wilsonville, env), true);
  assert.equal(allowSmallCache(salem, env), false);
});

test('allowSmallCache: matches GHL location id in a list', () => {
  const env = { ABC_RECONCILE_ALLOW_SMALL_CACHE: 'other, lZZ4V8Vi8sp4WQMqyKJK' };
  assert.equal(allowSmallCache(wilsonville, env), true);
});

test('allowSmallCache: tolerates a missing location', () => {
  assert.equal(allowSmallCache(undefined, { ABC_RECONCILE_ALLOW_SMALL_CACHE: 'wilsonville' }), false);
});

test('maxCreatesPerRun: default, override, and bad values', () => {
  assert.equal(maxCreatesPerRun({}), DEFAULT_MAX_CREATES_PER_RUN);
  assert.equal(maxCreatesPerRun({ ABC_RECONCILE_MAX_CREATES_PER_RUN: '250' }), 250);
  assert.equal(maxCreatesPerRun({ ABC_RECONCILE_MAX_CREATES_PER_RUN: '0' }), DEFAULT_MAX_CREATES_PER_RUN);
  assert.equal(maxCreatesPerRun({ ABC_RECONCILE_MAX_CREATES_PER_RUN: 'abc' }), DEFAULT_MAX_CREATES_PER_RUN);
});
