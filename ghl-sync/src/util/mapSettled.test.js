const test = require('node:test');
const assert = require('node:assert');
const { mapSettled } = require('./mapSettled');

const delay = (ms) => new Promise(r => setTimeout(r, ms));

test('preserves order and values', async () => {
  const out = await mapSettled([1, 2, 3], 2, async (n) => n * 10);
  assert.deepEqual(out, [
    { status: 'fulfilled', value: 10 },
    { status: 'fulfilled', value: 20 },
    { status: 'fulfilled', value: 30 },
  ]);
});

test('a throwing item is isolated, others still run', async () => {
  const out = await mapSettled([1, 2, 3], 3, async (n) => {
    if (n === 2) throw new Error('boom');
    return n;
  });
  assert.equal(out[0].status, 'fulfilled');
  assert.equal(out[1].status, 'rejected');
  assert.equal(out[1].reason.message, 'boom');
  assert.equal(out[2].status, 'fulfilled');
  assert.equal(out[2].value, 3);
});

test('never exceeds the concurrency limit', async () => {
  let active = 0, peak = 0;
  await mapSettled([1, 2, 3, 4, 5, 6], 2, async () => {
    active++; peak = Math.max(peak, active);
    await delay(10);
    active--;
  });
  assert.ok(peak <= 2, `peak was ${peak}`);
});

test('empty array returns empty array', async () => {
  const out = await mapSettled([], 4, async () => 1);
  assert.deepEqual(out, []);
});

test('passes the index to fn', async () => {
  const out = await mapSettled(['a', 'b'], 1, async (item, i) => `${item}${i}`);
  assert.deepEqual(out.map(r => r.value), ['a0', 'b1']);
});
