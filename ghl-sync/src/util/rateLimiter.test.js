const test = require('node:test');
const assert = require('node:assert');
const { RateLimiter, parseRetryAfter } = require('./rateLimiter');

// Virtual clock: sleep() instantly advances the fake clock so tests are fast
// and deterministic. clock is closed over by both now() and sleep().
function harness() {
  let clock = 0;
  return {
    now: () => clock,
    sleep: (ms) => { clock += ms; return Promise.resolve(); },
    advance: (ms) => { clock += ms; },
    get clock() { return clock; },
  };
}

test('parseRetryAfter handles integer seconds', () => {
  assert.equal(parseRetryAfter('5'), 5000);
  assert.equal(parseRetryAfter('0'), 0);
});

test('parseRetryAfter handles an HTTP-date in the future', () => {
  const now = 1_000_000;
  const future = new Date(now + 3000).toUTCString(); // truncates to whole seconds
  const ms = parseRetryAfter(future, now);
  assert.ok(ms >= 2000 && ms <= 3000, `got ${ms}`);
});

test('parseRetryAfter returns null for garbage and 0 for past dates', () => {
  assert.equal(parseRetryAfter('not-a-date'), null);
  assert.equal(parseRetryAfter(null), null);
  assert.equal(parseRetryAfter(undefined), null);
  assert.equal(parseRetryAfter(new Date(500).toUTCString(), 1_000_000), 0);
});

test('a full bucket grants capacity tokens immediately', async () => {
  const h = harness();
  const rl = new RateLimiter({ capacity: 3, refillPerSec: 1, now: h.now, sleep: h.sleep });
  await rl.acquire('k'); await rl.acquire('k'); await rl.acquire('k');
  assert.equal(h.clock, 0); // no waiting while tokens remain
});

test('an empty bucket waits for refill', async () => {
  const h = harness();
  const rl = new RateLimiter({ capacity: 1, refillPerSec: 2, now: h.now, sleep: h.sleep });
  await rl.acquire('k');        // consumes the only token at t=0
  await rl.acquire('k');        // must wait ~500ms for the next (2/sec)
  assert.ok(h.clock >= 500, `clock=${h.clock}`);
});

test('keys are independent', async () => {
  const h = harness();
  const rl = new RateLimiter({ capacity: 1, refillPerSec: 1, now: h.now, sleep: h.sleep });
  await rl.acquire('a');        // drains a
  await rl.acquire('b');        // b still full → no wait
  assert.equal(h.clock, 0);
});

test('penalize blocks a key for the given duration', async () => {
  const h = harness();
  const rl = new RateLimiter({ capacity: 5, refillPerSec: 100, now: h.now, sleep: h.sleep });
  rl.penalize('k', 1000);
  await rl.acquire('k');
  assert.ok(h.clock >= 1000, `clock=${h.clock}`);
});
