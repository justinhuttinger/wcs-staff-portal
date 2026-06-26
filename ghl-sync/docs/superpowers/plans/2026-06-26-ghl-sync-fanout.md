# GHL Sync Fan-Out Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the ghl-sync worker faster by fanning out the 7-location GHL work concurrently and replacing fixed inter-request sleeps with a per-credential token-bucket limiter that honors `Retry-After`, with zero change to the data written or to any downstream report.

**Architecture:** Each GHL location has its own private-integration key with an independent rate bucket, so the per-location GHL work (contacts, opportunities, first-contact) is fanned out with bounded concurrency using `Promise.allSettled` semantics — one location failing never aborts the others. ABC calls (calendar events, check-ins) share a *single* `app_id/app_key` bucket, so they stay sequential. A token-bucket limiter keyed by credential replaces the fixed 300 ms read sleeps and reacts to `Retry-After` on 429.

**Tech Stack:** Node.js (CommonJS), axios, `node:test` + `node:assert` (built-in, no deps), node-cron, `@supabase/supabase-js` (service role).

## Global Constraints

- **No data/report semantics change.** Same rows, same keys, same columns land in the same tables. This is a performance/concurrency refactor only.
- **Error isolation must be preserved.** Today one location's failure is caught and logged; the loop continues. Concurrency MUST use allSettled semantics (`mapSettled`), never `Promise.all` (which rejects the whole batch on first failure).
- **ABC is a single shared rate bucket** (`ABC_APP_ID`/`ABC_APP_KEY`). ABC calls must NOT fan out. GHL keys are per-location (independent buckets) and may fan out.
- **Kill switch:** `LOCATION_CONCURRENCY=1` must fully restore the old sequential behavior (limiter still active, one location at a time). Default `4`.
- **Do NOT run recurring sync tasks locally** (per project rule). Validate Tasks 1–2 with unit tests; validate Tasks 3–6 by code review + production `ghl_sync_log`/console after deploy.
- **CommonJS** (`require`/`module.exports`). Tests are `*.test.js` run with `node --test <path>`.
- **No new npm dependencies.**
- **Open a PR; do not merge** (Justin is the merger of record).

---

## File Structure

- `ghl-sync/src/util/mapSettled.js` (Create) — bounded-concurrency allSettled map. One clear responsibility: run an async fn over items, N at a time, never reject.
- `ghl-sync/src/util/mapSettled.test.js` (Create) — unit tests.
- `ghl-sync/src/util/rateLimiter.js` (Create) — per-key token-bucket limiter + `parseRetryAfter`. One responsibility: pace requests per credential.
- `ghl-sync/src/util/rateLimiter.test.js` (Create) — unit tests (virtual clock).
- `ghl-sync/src/ghl/client.js` (Modify) — route every GHL request through the limiter keyed by `apiKey`; honor `Retry-After`; drop the fixed 300 ms sleep.
- `ghl-sync/src/sync/deltaSync.js` (Modify) — fan out the per-location GHL phase; keep ABC calendar + check-ins sequential; preserve cursor logic.
- `ghl-sync/src/sync/fullSync.js` (Modify) — fan out `syncLocation` across locations; keep ABC reconcile sequential.
- `ghl-sync/src/scheduler.js` (Modify) — add run-locks so a long delta/full run can't overlap the next cron tick.

---

### Task 1: Bounded-concurrency allSettled map (`mapSettled`)

**Files:**
- Create: `ghl-sync/src/util/mapSettled.js`
- Test: `ghl-sync/src/util/mapSettled.test.js`

**Interfaces:**
- Consumes: nothing.
- Produces: `async mapSettled(items, limit, fn) -> Array<{status:'fulfilled', value} | {status:'rejected', reason}>`. Result order matches `items` order. `fn(item, index)` is awaited. Never rejects. Concurrency capped at `min(limit, items.length)` (min 1).

- [ ] **Step 1: Write the failing test**

```js
// ghl-sync/src/util/mapSettled.test.js
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test src/util/mapSettled.test.js`
Expected: FAIL — `Cannot find module './mapSettled'`.

- [ ] **Step 3: Write minimal implementation**

```js
// ghl-sync/src/util/mapSettled.js
// Run an async fn over items with bounded concurrency. Never rejects: each item
// resolves to { status:'fulfilled', value } or { status:'rejected', reason }
// (same shape as Promise.allSettled), so one item's failure can't abort the rest.
// Result order always matches the input order.
async function mapSettled(items, limit, fn) {
  const results = new Array(items.length);
  let next = 0;

  async function worker() {
    while (true) {
      const i = next++;
      if (i >= items.length) return;
      try {
        results[i] = { status: 'fulfilled', value: await fn(items[i], i) };
      } catch (reason) {
        results[i] = { status: 'rejected', reason };
      }
    }
  }

  const workers = Math.max(1, Math.min(limit, items.length));
  await Promise.all(Array.from({ length: workers }, worker));
  return results;
}

module.exports = { mapSettled };
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test src/util/mapSettled.test.js`
Expected: PASS — `# pass 5`, `# fail 0`.

- [ ] **Step 5: Commit**

```bash
git add ghl-sync/src/util/mapSettled.js ghl-sync/src/util/mapSettled.test.js
git commit -m "feat(ghl-sync): add bounded-concurrency allSettled map helper"
```

---

### Task 2: Per-key token-bucket rate limiter + Retry-After parser

**Files:**
- Create: `ghl-sync/src/util/rateLimiter.js`
- Test: `ghl-sync/src/util/rateLimiter.test.js`

**Interfaces:**
- Consumes: nothing.
- Produces:
  - `parseRetryAfter(headerVal, now = Date.now()) -> number|null` — returns milliseconds to wait. Accepts integer seconds (`"5"` → `5000`) or an HTTP-date; returns `null` if unparseable, `0` if a date is already in the past.
  - `class RateLimiter`:
    - `new RateLimiter({ capacity = 10, refillPerSec = 10, now, sleep })` — `now()` returns ms; `sleep(ms)` returns a Promise. Both injectable for tests.
    - `async acquire(key)` — resolves once a token is available for `key`, consuming one. Per-key check-and-consume is serialized so concurrent callers never double-spend the last token. Different keys are fully independent.
    - `penalize(key, ms)` — block `key` for `ms` (used after a 429 `Retry-After`) and zero its tokens.

- [ ] **Step 1: Write the failing test**

```js
// ghl-sync/src/util/rateLimiter.test.js
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test src/util/rateLimiter.test.js`
Expected: FAIL — `Cannot find module './rateLimiter'`.

- [ ] **Step 3: Write minimal implementation**

```js
// ghl-sync/src/util/rateLimiter.js

// Convert a 429 `Retry-After` header into milliseconds. GHL sends integer
// seconds; the HTTP spec also allows an HTTP-date, so handle both. Returns null
// when unparseable (caller falls back to its own backoff), 0 for a past date.
function parseRetryAfter(headerVal, now = Date.now()) {
  if (headerVal == null) return null;
  const s = String(headerVal).trim();
  if (/^\d+$/.test(s)) return parseInt(s, 10) * 1000;
  const when = Date.parse(s);
  if (!Number.isNaN(when)) return Math.max(0, when - now);
  return null;
}

const realSleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Token bucket per key. Each credential (GHL location key, or the single shared
// ABC key) gets its own bucket, so concurrency across keys adds no rate pressure
// while each key stays under its own ceiling.
class RateLimiter {
  constructor({ capacity = 10, refillPerSec = 10, now = () => Date.now(), sleep = realSleep } = {}) {
    this.capacity = capacity;
    this.refillPerSec = refillPerSec;
    this.now = now;
    this.sleep = sleep;
    this.buckets = new Map(); // key -> { tokens, last, until }
    this.chains = new Map();  // key -> Promise (serializes acquire per key)
  }

  _bucket(key) {
    let b = this.buckets.get(key);
    if (!b) { b = { tokens: this.capacity, last: this.now(), until: 0 }; this.buckets.set(key, b); }
    return b;
  }

  _refill(b) {
    const t = this.now();
    const elapsed = (t - b.last) / 1000;
    if (elapsed > 0) {
      b.tokens = Math.min(this.capacity, b.tokens + elapsed * this.refillPerSec);
      b.last = t;
    }
  }

  // Block a key until now()+ms (e.g. after a 429 Retry-After) and zero its tokens.
  penalize(key, ms) {
    const b = this._bucket(key);
    const until = this.now() + ms;
    if (until > b.until) b.until = until;
    b.tokens = 0;
  }

  // Resolve once a token is available for `key`, consuming it. Per-key calls are
  // chained so two concurrent acquires can't both consume the last token.
  async acquire(key) {
    const prev = this.chains.get(key) || Promise.resolve();
    const run = prev.then(() => this._acquireOne(key), () => this._acquireOne(key));
    this.chains.set(key, run);
    return run;
  }

  async _acquireOne(key) {
    const b = this._bucket(key);
    const penaltyWait = b.until - this.now();
    if (penaltyWait > 0) await this.sleep(penaltyWait);
    while (true) {
      this._refill(b);
      if (b.tokens >= 1) { b.tokens -= 1; return; }
      const needMs = ((1 - b.tokens) / this.refillPerSec) * 1000;
      await this.sleep(Math.max(needMs, 1));
    }
  }
}

module.exports = { RateLimiter, parseRetryAfter };
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test src/util/rateLimiter.test.js`
Expected: PASS — `# pass 7`, `# fail 0`.

- [ ] **Step 5: Commit**

```bash
git add ghl-sync/src/util/rateLimiter.js ghl-sync/src/util/rateLimiter.test.js
git commit -m "feat(ghl-sync): add per-key token-bucket rate limiter + Retry-After parser"
```

---

### Task 3: Route the GHL client through the limiter + honor Retry-After

**Files:**
- Modify: `ghl-sync/src/ghl/client.js`

**Interfaces:**
- Consumes: `RateLimiter`, `parseRetryAfter` from `../util/rateLimiter` (Task 2).
- Produces: unchanged public surface — `get`, `post`, `put`, `getPaginated`, `sleep` still exported with identical signatures. Behavior change is internal pacing only.

**Note:** This task is validated by code review (it needs axios + live GHL; do not run the worker locally). The pure pieces it relies on are already unit-tested in Task 2. Keep the diff mechanical.

- [ ] **Step 1: Add the limiter imports and singleton at the top of the file**

Replace the top of `ghl-sync/src/ghl/client.js`:

```js
const axios = require('axios');

const BASE_URL = process.env.GHL_BASE_URL || 'https://services.leadconnectorhq.com';

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

const MAX_RETRIES = 5;
const BACKOFF = [5000, 10000, 20000, 30000, 60000]; // exponential-ish backoff
```

with:

```js
const axios = require('axios');
const { RateLimiter, parseRetryAfter } = require('../util/rateLimiter');

const BASE_URL = process.env.GHL_BASE_URL || 'https://services.leadconnectorhq.com';

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

const MAX_RETRIES = 5;
const BACKOFF = [5000, 10000, 20000, 30000, 60000]; // exponential-ish backoff fallback

// One limiter, bucketed by api key. GHL's documented v2 limit is ~100 req / 10s
// burst per key; default to a conservative 10/s (capacity 10) and let env tune it.
// Each location key is an independent bucket, so fanning out locations adds no
// rate pressure. The single shared ABC key is NOT routed here.
const limiter = new RateLimiter({
  capacity: parseInt(process.env.GHL_RL_CAPACITY || '10', 10),
  refillPerSec: parseInt(process.env.GHL_RL_REFILL || '10', 10),
});

// On a 429, prefer the server's Retry-After; otherwise fall back to BACKOFF.
// Also penalize the key's bucket so concurrent in-flight calls back off too.
function rate429Delay(err, attempt, apiKey) {
  const ra = parseRetryAfter(err.response?.headers?.['retry-after']);
  const delay = ra != null ? ra : (BACKOFF[attempt - 1] || 60000);
  limiter.penalize(apiKey, delay);
  return delay;
}
```

- [ ] **Step 2: Gate `get` on the limiter and use `rate429Delay`**

Replace the `get` function body with:

```js
async function get(path, params = {}, apiKey) {
  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    try {
      await limiter.acquire(apiKey);
      const res = await axios.get(`${BASE_URL}${path}`, {
        params,
        headers: {
          'Authorization': `Bearer ${apiKey}`,
          'Version': '2021-07-28',
          'Content-Type': 'application/json',
        },
        timeout: 30000,
      });
      return res.data;
    } catch (err) {
      if (err.response?.status === 429 && attempt < MAX_RETRIES) {
        const delay = rate429Delay(err, attempt, apiKey);
        console.warn(`[GHL] Rate limited on ${path}, retrying in ${delay / 1000}s (attempt ${attempt}/${MAX_RETRIES})`);
        await sleep(delay);
        continue;
      }
      throw err;
    }
  }
}
```

- [ ] **Step 3: Apply the same change to `post` and `put`**

For `post`, replace its body so the `axios.post` is preceded by `await limiter.acquire(apiKey);` and the 429 branch uses `rate429Delay`:

```js
async function post(path, body = {}, apiKey) {
  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    try {
      await limiter.acquire(apiKey);
      const res = await axios.post(`${BASE_URL}${path}`, body, {
        headers: {
          'Authorization': `Bearer ${apiKey}`,
          'Version': '2021-07-28',
          'Content-Type': 'application/json',
        },
        timeout: 30000,
      });
      return res.data;
    } catch (err) {
      if (err.response?.status === 429 && attempt < MAX_RETRIES) {
        const delay = rate429Delay(err, attempt, apiKey);
        console.warn(`[GHL] Rate limited on POST ${path}, retrying in ${delay / 1000}s (attempt ${attempt}/${MAX_RETRIES})`);
        await sleep(delay);
        continue;
      }
      throw err;
    }
  }
}
```

For `put`, the identical pattern:

```js
async function put(path, body = {}, apiKey) {
  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    try {
      await limiter.acquire(apiKey);
      const res = await axios.put(`${BASE_URL}${path}`, body, {
        headers: {
          'Authorization': `Bearer ${apiKey}`,
          'Version': '2021-07-28',
          'Content-Type': 'application/json',
        },
        timeout: 30000,
      });
      return res.data;
    } catch (err) {
      if (err.response?.status === 429 && attempt < MAX_RETRIES) {
        const delay = rate429Delay(err, attempt, apiKey);
        console.warn(`[GHL] Rate limited on PUT ${path}, retrying in ${delay / 1000}s (attempt ${attempt}/${MAX_RETRIES})`);
        await sleep(delay);
        continue;
      }
      throw err;
    }
  }
}
```

- [ ] **Step 4: Remove the fixed 300 ms read sleep in `getPaginated`**

In `getPaginated`, the pacing is now handled by `limiter.acquire` inside `get`. Delete the trailing inter-page sleep. Replace:

```js
    if (paginationType === 'meta') {
      // GHL contacts: meta contains startAfter (timestamp) + startAfterId (contact ID)
      if (!data.meta?.startAfter || !data.meta?.startAfterId) break;
      metaCursor = {
        startAfter: data.meta.startAfter,
        startAfterId: data.meta.startAfterId,
      };
    } else {
      offset += limit;
    }

    await sleep(300); // Rate limit for reads: ~200 req/min (writes use 650ms separately)
  }
```

with:

```js
    if (paginationType === 'meta') {
      // GHL contacts: meta contains startAfter (timestamp) + startAfterId (contact ID)
      if (!data.meta?.startAfter || !data.meta?.startAfterId) break;
      metaCursor = {
        startAfter: data.meta.startAfter,
        startAfterId: data.meta.startAfterId,
      };
    } else {
      offset += limit;
    }
    // Pacing is handled by the per-key token bucket inside get(); no fixed sleep.
  }
```

- [ ] **Step 5: Sanity-check the module loads (requires node_modules)**

Run (from the worktree's ghl-sync dir, with node_modules resolvable):
`NODE_PATH="$(node -e "process.stdout.write(require('path').resolve('../../../node_modules'))" 2>/dev/null || echo ../../../node_modules)" node -e "require('./src/ghl/client'); console.log('client loads OK')"`
Expected: `client loads OK` (no throw). If `axios` can't resolve in the worktree, skip this check — it's verified at deploy; the limiter/parse logic is already unit-tested.

- [ ] **Step 6: Commit**

```bash
git add ghl-sync/src/ghl/client.js
git commit -m "feat(ghl-sync): pace GHL client via per-key token bucket and honor Retry-After"
```

---

### Task 4: Fan out the per-location GHL phase in deltaSync

**Files:**
- Modify: `ghl-sync/src/sync/deltaSync.js`

**Interfaces:**
- Consumes: `mapSettled` from `../util/mapSettled` (Task 1); existing `resolveMembershipPipelineIds` is already exported from `./computeFirstContact`.
- Produces: `deltaSync()` unchanged signature. Internally: Phase 1 fans out GHL work (contacts delta, opps delta, first-contact) across locations with `LOCATION_CONCURRENCY` workers; Phase 2 runs ABC calendar events sequentially; Phase 3 runs the check-ins refresh once. Cursor `last_delta_sync` is updated iff at least one location's GHL delta succeeded.

**Note:** Validated by code review (do not run locally). Preserve every existing `writeSyncLog` call and per-entity try/catch verbatim — only the control flow changes.

- [ ] **Step 1: Add imports**

At the top of `ghl-sync/src/sync/deltaSync.js`, after the existing requires, add:

```js
const { mapSettled } = require('../util/mapSettled');
const { resolveMembershipPipelineIds } = require('./computeFirstContact');
```

(`computeFirstContact` is already imported on the existing line `const { computeFirstContact } = require('./computeFirstContact');` — extend that line or add this one; both names are exported.)

- [ ] **Step 2: Extract the per-location GHL block into a helper**

Add this function above `async function deltaSync()`. Its body is the contacts-delta + opportunities-delta + first-contact blocks moved verbatim out of the current loop, returning whether the GHL delta (contacts or opps) succeeded:

```js
// One location's GHL delta work: contacts, opportunities, first-contact.
// Uses the location's OWN api key (independent rate bucket), so this is safe to
// run concurrently across locations. Returns { ok } where ok=true if contacts or
// opportunities synced — that gates the shared last_delta_sync cursor.
async function syncLocationDelta(location, syncSince, pipelineIds) {
  let ok = false;

  // Contacts delta
  let ctStart = new Date().toISOString();
  try {
    const rawContacts = await fetchContactsDelta(location.id, syncSince, location.apiKey);
    if (rawContacts.length > 0) {
      const contacts = rawContacts.map(c => transformContact(c, location.id));
      const result = await upsertContacts(contacts);
      console.log(`[Delta] ${location.name}: ${rawContacts.length} contacts updated, ${result.upserted} upserted`);
      await writeSyncLog({ syncType: 'delta', entity: 'contacts', locationId: location.id, recordsFetched: rawContacts.length, recordsUpserted: result.upserted, errors: result.errors, startedAt: ctStart });
      ok = true;
    }
  } catch (err) {
    console.error(`[Delta] ${location.name} contacts failed:`, err.message);
    await writeSyncLog({ syncType: 'delta', entity: 'contacts', locationId: location.id, recordsFetched: 0, recordsUpserted: 0, errors: [{ error: err.message }], startedAt: ctStart });
  }

  // Opportunities delta
  let opStart = new Date().toISOString();
  try {
    const rawOpps = await fetchOpportunitiesDelta(location.id, syncSince, location.apiKey);
    if (rawOpps.length > 0) {
      const opps = rawOpps.map(o => transformOpportunity(o, location.id));
      const result = await upsertOpportunities(opps);
      console.log(`[Delta] ${location.name}: ${rawOpps.length} opportunities updated, ${result.upserted} upserted`);
      await writeSyncLog({ syncType: 'delta', entity: 'opportunities', locationId: location.id, recordsFetched: rawOpps.length, recordsUpserted: result.upserted, errors: result.errors, startedAt: opStart });
      ok = true;
    }
  } catch (err) {
    console.error(`[Delta] ${location.name} opportunities failed:`, err.message);
    await writeSyncLog({ syncType: 'delta', entity: 'opportunities', locationId: location.id, recordsFetched: 0, recordsUpserted: 0, errors: [{ error: err.message }], startedAt: opStart });
  }

  // Speed to Lead: first human contact for Membership-pipeline opps.
  let fcStart = new Date().toISOString();
  try {
    const fc = await computeFirstContact(location, pipelineIds);
    console.log(`[Delta] ${location.name}: first-contact checked ${fc.checked}, resolved ${fc.resolved}`);
    await writeSyncLog({ syncType: 'delta', entity: 'first_contact', locationId: location.id, recordsFetched: fc.checked, recordsUpserted: fc.resolved, errors: fc.errors, startedAt: fcStart });
  } catch (err) {
    console.error(`[Delta] ${location.name} first-contact failed:`, err.message);
    await writeSyncLog({ syncType: 'delta', entity: 'first_contact', locationId: location.id, recordsFetched: 0, recordsUpserted: 0, errors: [{ error: err.message }], startedAt: fcStart });
  }

  return { ok };
}
```

- [ ] **Step 3: Rewrite the body of `deltaSync` to three phases**

Replace the existing location `for` loop (the block starting `for (const location of LOCATIONS) {` and ending at its matching brace just before the check-ins comment) with Phase 1 + Phase 2 below. Keep everything above it (cursor read, `syncSince`, `start`, `syncTimestamp`) and the check-ins block (Phase 3) and the final cursor write exactly as they are — except replace the `let anySuccess = false;` line as shown.

Delete:
```js
  let anySuccess = false;

  for (const location of LOCATIONS) {
    if (isGhlSyncAborted()) {
      console.log('[Delta] Delta sync aborted by user');
      break;
    }
    // ... contacts delta ... opportunities delta ... first-contact ...
    // ... calendar events delta (the `if (location.clubNumber) { ... }` block) ...
  }
```

Insert in its place:
```js
  const LIMIT = parseInt(process.env.LOCATION_CONCURRENCY || '4', 10);

  // Resolve membership pipeline IDs once, shared by every location's first-contact pass.
  let pipelineIds = [];
  try {
    pipelineIds = await resolveMembershipPipelineIds();
  } catch (err) {
    console.error('[Delta] Failed to resolve membership pipelines:', err.message);
  }

  // Phase 1 — GHL work, fanned out. Each location uses its own api key (independent
  // rate bucket), so concurrency adds no rate pressure. mapSettled isolates failures:
  // one location erroring never aborts the others.
  const settled = await mapSettled(LOCATIONS, LIMIT, async (location) => {
    if (isGhlSyncAborted()) return { ok: false };
    return syncLocationDelta(location, syncSince, pipelineIds);
  });
  const anySuccess = settled.some(r => r.status === 'fulfilled' && r.value && r.value.ok);

  // Phase 2 — ABC calendar events per club. SEQUENTIAL: ABC uses a single shared
  // app_id/app_key (one rate bucket), so these must not fan out. Window + logging
  // are unchanged from the prior per-location loop.
  if (!isGhlSyncAborted()) {
    for (const location of LOCATIONS) {
      if (!location.clubNumber) continue;
      const calStart = new Date().toISOString();
      try {
        const now = new Date();
        const calFrom = new Date(now.getTime() - 14 * 86400000);
        const calTo = new Date(now.getTime() + 86400000);
        const upserted = await syncCalendarEventsForClub(location.clubNumber, calFrom, calTo);
        if (upserted > 0) {
          console.log(`[Delta] ${location.name}: ${upserted} calendar events upserted`);
        }
        await writeSyncLog({ syncType: 'delta', entity: 'calendar_events', locationId: location.id, recordsFetched: upserted, recordsUpserted: upserted, errors: [], startedAt: calStart });
      } catch (err) {
        console.error(`[Delta] ${location.name} calendar events failed:`, err.message);
        await writeSyncLog({ syncType: 'delta', entity: 'calendar_events', locationId: location.id, recordsFetched: 0, recordsUpserted: 0, errors: [{ error: err.message }], startedAt: calStart });
      }
    }
  }
```

(The check-ins refresh block, the `if (anySuccess) { await updateLastDeltaSync(...) }` block, and the duration log all stay exactly as they currently are — `anySuccess` is now a `const` assigned above.)

- [ ] **Step 4: Static syntax check**

Run: `node --check src/sync/deltaSync.js`
Expected: no output (exit 0). A syntax error prints the location.

- [ ] **Step 5: Commit**

```bash
git add ghl-sync/src/sync/deltaSync.js
git commit -m "feat(ghl-sync): fan out deltaSync GHL phase, keep ABC calendar sequential"
```

---

### Task 5: Fan out syncLocation across locations in fullSync

**Files:**
- Modify: `ghl-sync/src/sync/fullSync.js`

**Interfaces:**
- Consumes: `mapSettled` from `../util/mapSettled` (Task 1).
- Produces: `fullSync()` unchanged signature. Phase 1 fans out `syncLocation(location, 'full')` across locations with `LOCATION_CONCURRENCY` workers; Phase 2 runs the wide ABC calendar reconcile sequentially. `syncLocationForLocation`, abort flag, and exports are unchanged.

**Note:** Validated by code review (do not run locally). `syncLocation` already self-contains per-entity try/catch; only the loop structure changes.

- [ ] **Step 1: Add the import**

At the top of `ghl-sync/src/sync/fullSync.js`, after the existing requires, add:

```js
const { mapSettled } = require('../util/mapSettled');
```

- [ ] **Step 2: Rewrite the body of `fullSync` to two phases**

Replace the entire `for (const location of LOCATIONS) { ... }` loop inside `fullSync()` (which today calls `syncLocation` then the calendar reconcile per iteration) with:

```js
  const LIMIT = parseInt(process.env.LOCATION_CONCURRENCY || '4', 10);

  // Phase 1 — per-location GHL sync (location upsert, custom fields, pipelines,
  // contacts, opportunities), fanned out across independent api keys. mapSettled
  // isolates failures so one location can't abort the rest. LOCATION_CONCURRENCY
  // also bounds peak memory (each location pulls its full contact set).
  await mapSettled(LOCATIONS, LIMIT, async (location) => {
    if (isGhlSyncAborted()) return;
    await syncLocation(location, 'full');
  });

  // Phase 2 — wide ABC calendar reconcile per club. SEQUENTIAL: ABC is a single
  // shared rate bucket. Recaptures sessions marked Completed / Canceled-Charge
  // after the 7-day delta window moved past. Logic + logging unchanged.
  if (!isGhlSyncAborted()) {
    for (const location of LOCATIONS) {
      if (!location.clubNumber) continue;
      const calStart = new Date().toISOString();
      try {
        const now = new Date();
        const calFrom = new Date(now.getTime() - CALENDAR_RECONCILE_DAYS * 86400000);
        const calTo = new Date(now.getTime() + 86400000);
        const upserted = await syncCalendarEventsRange(location.clubNumber, calFrom, calTo, undefined, 150);
        console.log(`[Sync] ${location.name}: calendar reconcile (${CALENDAR_RECONCILE_DAYS}d) upserted ${upserted}`);
        await writeSyncLog({ syncType: 'full', entity: 'calendar_events', locationId: location.id, recordsFetched: upserted, recordsUpserted: upserted, errors: [], startedAt: calStart });
      } catch (err) {
        console.error(`[Sync] ${location.name} calendar reconcile failed:`, err.message);
        await writeSyncLog({ syncType: 'full', entity: 'calendar_events', locationId: location.id, recordsFetched: 0, recordsUpserted: 0, errors: [{ error: err.message }], startedAt: calStart });
      }
    }
  }
```

(Keep the `console.log('[Sync] Starting full sync ...')`, `const start = Date.now();`, `ghlSyncAbort = false;` lines above, and the duration log below, exactly as they are.)

- [ ] **Step 3: Static syntax check**

Run: `node --check src/sync/fullSync.js`
Expected: no output (exit 0).

- [ ] **Step 4: Commit**

```bash
git add ghl-sync/src/sync/fullSync.js
git commit -m "feat(ghl-sync): fan out fullSync per-location GHL phase, keep ABC reconcile sequential"
```

---

### Task 6: Add overlap run-locks in the scheduler

**Files:**
- Modify: `ghl-sync/src/scheduler.js`

**Interfaces:**
- Consumes: nothing new.
- Produces: `startScheduler()` unchanged signature. The delta and full-sync cron callbacks now skip a tick if their previous run is still in flight.

**Why:** node-cron does not prevent overlapping runs. Fan-out makes runs faster (shrinking overlap risk), but a guard makes double-runs impossible, which also protects the shared `last_delta_sync` cursor.

- [ ] **Step 1: Add module-level run flags**

In `ghl-sync/src/scheduler.js`, inside `startScheduler()` (top of the function, before the first `cron.schedule`), add:

```js
  let deltaRunning = false;
  let fullRunning = false;
```

- [ ] **Step 2: Guard the delta cron**

Replace the delta `cron.schedule(...)` callback so it bails if already running and always clears the flag:

```js
  cron.schedule(`*/${intervalMinutes} * * * *`, async () => {
    if (deltaRunning) {
      console.warn('[Scheduler] Previous delta sync still running — skipping this tick');
      return;
    }
    deltaRunning = true;
    console.log('[Scheduler] Starting delta sync...');
    let deltaOk = false;
    try {
      await deltaSync();
      deltaOk = true;
    } catch (err) {
      console.error('[Scheduler] Delta sync failed:', err.message);
    }
    if (deltaOk) {
      try {
        await crossLocCleanup();
      } catch (err) {
        console.error('[Scheduler] Cross-loc cleanup failed:', err.message);
      }
    }
    deltaRunning = false;
  });
```

- [ ] **Step 3: Guard the full-sync cron**

Replace the full-sync `cron.schedule(...)` callback:

```js
  cron.schedule(`0 ${fullSyncHourUTC} * * *`, async () => {
    if (fullRunning) {
      console.warn('[Scheduler] Previous full sync still running — skipping');
      return;
    }
    fullRunning = true;
    console.log('[Scheduler] Starting daily full sync...');
    try {
      await fullSync();
    } catch (err) {
      console.error('[Scheduler] Full sync failed:', err.message);
    } finally {
      fullRunning = false;
    }
  });
```

- [ ] **Step 4: Static syntax check**

Run: `node --check src/scheduler.js`
Expected: no output (exit 0).

- [ ] **Step 5: Commit**

```bash
git add ghl-sync/src/scheduler.js
git commit -m "feat(ghl-sync): guard delta/full cron against overlapping runs"
```

---

## Final Verification (after all tasks)

- [ ] Run the full unit suite for the new utils:
  `node --test src/util/mapSettled.test.js src/util/rateLimiter.test.js`
  Expected: `# pass 12`, `# fail 0`.
- [ ] Static-check every modified file:
  `node --check src/ghl/client.js && node --check src/sync/deltaSync.js && node --check src/sync/fullSync.js && node --check src/scheduler.js`
  Expected: all exit 0, no output.
- [ ] Re-run the pre-existing tests to confirm no regressions:
  `node --test src/abc/recurringPtRow.test.js`
  Expected: `# pass 4`, `# fail 0`.
- [ ] Open a PR (do not merge). In the PR description, document the kill switch: **set `LOCATION_CONCURRENCY=1`** to restore fully-sequential location processing if anything looks off in production; optionally tune `GHL_RL_CAPACITY` / `GHL_RL_REFILL`.
- [ ] Post-deploy check (production, not local): watch `/api/sync/logs` (`ghl_sync_log`) and Render console for the first delta + nightly full run — confirm per-location entries for all 7 locations and no new 429 storms.

## Notes / Out of Scope

- **ABC client is intentionally untouched.** ABC stays sequential (single shared bucket). No ABC files change.
- **Webhooks are out** (decided: won't work here).
- **The ABC full-sync project stays parked** — separate plan, separate worktree.
