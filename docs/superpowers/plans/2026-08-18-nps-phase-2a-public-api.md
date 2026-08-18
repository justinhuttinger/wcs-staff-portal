# NPS Phase 2a — Public API + Manual Fire — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Serve the tokenised survey link and the walk-up QR link from the auth API, and add an admin-only endpoint that fires a chosen member through a chosen survey end to end, GHL included.

**Architecture:** All database and network access lives in service modules with injectable dependencies; the Express routes are thin wrappers that translate a service result into a status code. Pure schema validation is its own module with no I/O at all. The GHL write for manual fire uses `auth`'s own client rather than `ghl-sync`'s, while token generation and invite row construction are required from `ghl-sync` because they are dependency-free and must not fork.

**Tech Stack:** Node.js CommonJS, `node:test` + `node:assert`, Express 4, `@supabase/supabase-js`, `express-rate-limit` v8, Postgres (Supabase project `ybopxxydsuwlbwxiuzve`).

**Spec:** `docs/superpowers/specs/2026-08-18-nps-phase-2a-public-api-design.md`
(parent: `docs/superpowers/specs/2026-08-18-nps-system-design.md`)

## Global Constraints

- **Migration number is `109`.** Master is at `108_nps_system.sql`. The file is `auth/migrations/109_nps_phase2.sql`.
- **Migrations are applied to production BY HAND at merge time.** This repo has no migration runner. Migration 108 is already applied.
- **Tests use `node:test` and `node:assert`**, CommonJS `require`, run with `node --test`. No jest, no mocha.
- **`services/supabase.js` calls `createClient()` eagerly at import time.** Every new service must lazy-load it behind a `getDb()` function or requiring the module in a test will throw. Tests must run with no `SUPABASE_URL` set.
- **All new service modules take injectable dependencies** (`db`, `now`, `ghlGet`, `ghlPut`, `locations`) with real defaults.
- **Partial upserts fail NOT NULL columns.** Always send whole rows.
- **Supabase `.select()` defaults to 1000 rows.** Any multi-row read paginates with `.range()`.
- **`express-rate-limit` is v8: the option is `limit`, not the deprecated `max`.**
- **Dates are `YYYY-MM-DD` strings in US Pacific**, never `Date` objects, never UTC.
- **`is_test` propagates** from invite to response to every score row. A test fire must never reach the report.
- **The two location configs disagree on a field name.** `ghl-sync/src/config/locations.js` uses `clubNumber`; `auth/src/config/ghlLocations.js` uses `clubCode`. This plan is in `auth`, so it is `clubCode`. Reading the wrong one yields `undefined` and silently matches no location.
- **Cross-service requires are lazy.** `require('../../../ghl-sync/...')` happens inside the function that needs it, never at module top level, so a path problem degrades to one failing endpoint instead of crashing auth at boot.

---

## File Structure

| File | Responsibility |
| --- | --- |
| `auth/migrations/109_nps_phase2.sql` | Metric seed, `is_test` columns, partial idempotency index, report index |
| `auth/src/services/npsSchema.js` | Pure. Question schema validation + submission validation + score extraction |
| `auth/src/services/npsSchema.test.js` | Tests for the above |
| `auth/src/services/npsPublic.js` | Token/QR resolution and response writing, injectable `db` |
| `auth/src/services/npsPublic.test.js` | Tests for the above, with a fake `db` |
| `auth/src/routes/publicNps.js` | Thin unauthenticated Express wrapper, rate limited |
| `auth/src/services/npsTestFire.js` | Manual fire: build invite, write GHL, record audit |
| `auth/src/services/npsTestFire.test.js` | Tests for the above |
| `auth/src/routes/nps.js` | Thin authenticated, admin-gated Express wrapper |
| `auth/src/index.js` | Modified: allowlist the survey origin, mount both routers |

---

### Task 1: Migration 109

**Files:**
- Create: `auth/migrations/109_nps_phase2.sql`

**Interfaces:**
- Consumes: the `nps_*` tables from migration 108.
- Produces: `is_test` columns on `nps_invites`, `nps_responses`, `nps_response_scores`; five seeded `nps_metrics` rows; a partial unique index on `nps_invites`.

- [ ] **Step 1: Write the migration**

Create `auth/migrations/109_nps_phase2.sql`:

```sql
-- NPS phase 2a: the metric vocabulary, test isolation, and the indexes the
-- report needs.

-- The controlled vocabulary every rating question points at. Deliberately
-- small: five metrics with full history beat twelve each answered by a
-- fraction of people. Adding one later is free; removing one is not.
insert into nps_metrics (key, label) values
  ('nps',              'Likelihood to recommend'),
  ('cleanliness',      'Cleanliness of the gym'),
  ('staff_positivity', 'Staff friendliness and helpfulness'),
  ('equipment',        'Equipment condition and availability'),
  ('value',            'Value for money')
on conflict (key) do nothing;

-- Manual test fires write real rows through the real code path. They must be
-- excludable everywhere the report reads, which includes nps_response_scores
-- directly — hence the denormalised copy, alongside the club_number/source/
-- submitted_at that are already denormalised there for the same reason.
alter table nps_invites         add column if not exists is_test boolean not null default false;
alter table nps_responses       add column if not exists is_test boolean not null default false;
alter table nps_response_scores add column if not exists is_test boolean not null default false;

-- The idempotency guard becomes partial so a test fire can repeat.
--
-- Real invites keep the guarantee that a job rerun, an overlapping cron tick or
-- a replayed back-window cannot double-send. Test rows are exempt BY
-- CONSTRUCTION rather than by a code path that has to remember to skip the
-- check, which is the version that rots.
drop index if exists nps_invites_survey_member_date_idx;
create unique index nps_invites_survey_member_date_idx
  on nps_invites (survey_id, member_id, trigger_date)
  where not is_test;

-- Serves "what do cancelling members think versus six-month members": the
-- report segments by survey. The existing (metric_key, club_number,
-- submitted_at desc) index serves the by-club view and stays.
create index if not exists nps_response_scores_survey_metric_time_idx
  on nps_response_scores (survey_id, metric_key, submitted_at desc);
```

- [ ] **Step 2: Verify the file is the only migration numbered 109**

Run: `ls auth/migrations/ | grep '^109'`
Expected: exactly one line, `109_nps_phase2.sql`

- [ ] **Step 3: Commit**

```bash
git add auth/migrations/109_nps_phase2.sql
git commit -m "feat(nps): migration 109 — metric seed, is_test, partial index"
```

---

### Task 2: Schema validation

**Files:**
- Create: `auth/src/services/npsSchema.js`
- Test: `auth/src/services/npsSchema.test.js`

**Interfaces:**
- Consumes: nothing. Pure module, no I/O.
- Produces:
  - `validateSchema(schema, { metricKeys }) => { ok: boolean, error?: string }`
  - `validateSubmission(schema, answers) => { ok, errors, cleaned, scores }` where `scores` is `[{ metric_key, score }]`
  - `QUESTION_TYPES`, `INPUT_TYPES`, `SCORE_TYPES` arrays

- [ ] **Step 1: Write the failing test**

Create `auth/src/services/npsSchema.test.js`:

```js
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd auth && node --test src/services/npsSchema.test.js`
Expected: FAIL with `Cannot find module './npsSchema'`

- [ ] **Step 3: Write the implementation**

Create `auth/src/services/npsSchema.js`:

```js
// Pure validation for NPS survey question schemas and submitted answers.
// No I/O: the caller supplies the metric vocabulary. Mirrors the shape of
// services/formsSchema.js.

const DISPLAY_TYPES = ['header', 'description'];
const SCORE_TYPES = ['rating', 'nps'];
const INPUT_TYPES = ['rating', 'nps', 'textarea', 'short_text', 'select'];
const QUESTION_TYPES = [...INPUT_TYPES, ...DISPLAY_TYPES];

const ID_RE = /^q_[a-z0-9_]{1,20}$/i;
const MAX_TEXT = 2000;

// An nps question is the standard 0..10 recommendation scale. It is fixed here
// rather than read from the schema so one survey cannot quietly redefine the
// scale and make its scores incomparable with every other survey's.
const NPS_MIN = 0;
const NPS_MAX = 10;

function ratingBounds(field) {
  if (field.type === 'nps') return { min: NPS_MIN, max: NPS_MAX };
  return { min: Number(field.min), max: Number(field.max) };
}

function validateSchema(schema, { metricKeys = [] } = {}) {
  if (!Array.isArray(schema)) return { ok: false, error: 'schema must be an array' };
  const allowed = new Set(metricKeys);
  const seen = new Set();

  for (const f of schema) {
    if (!f || typeof f !== 'object') return { ok: false, error: 'question must be an object' };
    if (typeof f.id !== 'string' || !ID_RE.test(f.id)) {
      return { ok: false, error: `invalid question id: ${f.id}` };
    }
    if (seen.has(f.id)) return { ok: false, error: `duplicate question id: ${f.id}` };
    seen.add(f.id);
    if (!QUESTION_TYPES.includes(f.type)) return { ok: false, error: `invalid question type: ${f.type}` };

    if (!DISPLAY_TYPES.includes(f.type) && (typeof f.label !== 'string' || !f.label.trim())) {
      return { ok: false, error: `question ${f.id} needs a label` };
    }
    if (f.type === 'select') {
      const opts = f.options;
      if (!Array.isArray(opts) || opts.length === 0 || opts.some(o => typeof o !== 'string' || !o.trim())) {
        return { ok: false, error: `question ${f.id} needs at least one option` };
      }
    }
    if (f.type === 'rating') {
      const min = Number(f.min);
      const max = Number(f.max);
      if (!Number.isInteger(min) || !Number.isInteger(max) || min >= max) {
        return { ok: false, error: `question ${f.id} needs integer min < max` };
      }
    }
    if (SCORE_TYPES.includes(f.type)) {
      // The controlled vocabulary is the point. See nps_metrics.
      if (typeof f.metric_key !== 'string' || !allowed.has(f.metric_key)) {
        return { ok: false, error: `question ${f.id} has an unknown metric_key: ${f.metric_key}` };
      }
    }
  }
  return { ok: true };
}

function isBlank(v) {
  return v == null || (typeof v === 'string' && !v.trim());
}

function validateSubmission(schema, answers) {
  const errors = {};
  const cleaned = {};
  const scores = [];
  const body = answers && typeof answers === 'object' ? answers : {};
  const inputs = (schema || []).filter(f => INPUT_TYPES.includes(f.type));
  const known = new Set(inputs.map(f => f.id));

  for (const key of Object.keys(body)) {
    if (!known.has(key)) errors[key] = 'Unknown question';
  }

  for (const f of inputs) {
    const raw = body[f.id];
    if (isBlank(raw)) {
      if (f.required) errors[f.id] = 'This question is required';
      continue;
    }

    if (SCORE_TYPES.includes(f.type)) {
      const n = Number(raw);
      const { min, max } = ratingBounds(f);
      if (!Number.isInteger(n) || n < min || n > max) {
        errors[f.id] = `Pick a number from ${min} to ${max}`;
        continue;
      }
      cleaned[f.id] = n;
      scores.push({ metric_key: f.metric_key, score: n });
      continue;
    }

    if (f.type === 'select') {
      const s = String(raw);
      if (!(f.options || []).includes(s)) {
        errors[f.id] = 'Pick one of the listed options';
        continue;
      }
      cleaned[f.id] = s;
      continue;
    }

    const text = String(raw).trim();
    if (text.length > MAX_TEXT) {
      errors[f.id] = `Keep it under ${MAX_TEXT} characters`;
      continue;
    }
    cleaned[f.id] = text;
  }

  return { ok: Object.keys(errors).length === 0, errors, cleaned, scores };
}

module.exports = {
  validateSchema, validateSubmission,
  QUESTION_TYPES, INPUT_TYPES, SCORE_TYPES, DISPLAY_TYPES,
};
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd auth && node --test src/services/npsSchema.test.js`
Expected: PASS, 8 tests

- [ ] **Step 5: Commit**

```bash
git add auth/src/services/npsSchema.js auth/src/services/npsSchema.test.js
git commit -m "feat(nps): question schema and submission validation"
```

---

### Task 3: Token and QR resolution

**Files:**
- Create: `auth/src/services/npsPublic.js`
- Test: `auth/src/services/npsPublic.test.js`

**Interfaces:**
- Consumes: `validateSubmission` from `./npsSchema` (used in Task 4, imported now).
- Produces:
  - `loadByToken({ db, slug, token, now }) => { ok: true, survey, invite, member } | { ok: false, reason }`
  - `loadByQr({ db, slug, key }) => { ok: true, survey, clubNumber } | { ok: false, reason }`
  - `reason` is `'expired' | 'answered' | null`. `null` means "did not resolve".

- [ ] **Step 1: Write the failing test**

Create `auth/src/services/npsPublic.test.js`:

```js
const test = require('node:test');
const assert = require('node:assert');
const { loadByToken, loadByQr } = require('./npsPublic');

const SURVEY = {
  id: 'srv-1', slug: '6mo', title: '6 Month Check-In', intro: 'Two minutes',
  status: 'active', schema: [{ id: 'q_nps', type: 'nps', label: 'Recommend?', metric_key: 'nps' }],
};

// Minimal Supabase-shaped fake. Supports the exact chain the service uses:
// .select().eq().maybeSingle(), and .update().eq().
function fakeDb({ invites = [], surveys = [SURVEY], qr = [] } = {}) {
  const updates = [];
  const tables = { nps_invites: invites, nps_surveys: surveys, nps_club_qr: qr };
  return {
    updates,
    from(table) {
      const eq = {};
      const builder = {
        select() { return builder; },
        eq(c, v) { eq[c] = v; return builder; },
        maybeSingle() {
          const rows = (tables[table] || []).filter(r =>
            Object.entries(eq).every(([c, v]) => r[c] === v));
          return Promise.resolve({ data: rows[0] || null, error: null });
        },
        update(patch) {
          return { eq: (c, v) => { updates.push({ table, patch, where: [c, v] }); return Promise.resolve({ error: null }); } };
        },
      };
      return builder;
    },
  };
}

const NOW = new Date('2026-08-18T14:00:00Z');
const LIVE = {
  id: 'inv-1', survey_id: 'srv-1', token: 'tok-live', member_id: 'M1', club_number: '30935',
  member_email: 'a@x.com', member_name: 'Jo Doe', status: 'pending', opened_at: null,
  expires_at: '2026-09-30T00:00:00Z', is_test: false,
};

test('resolves a live token and stamps opened_at', async () => {
  const db = fakeDb({ invites: [LIVE] });
  const r = await loadByToken({ db, slug: '6mo', token: 'tok-live', now: NOW });
  assert.equal(r.ok, true);
  assert.equal(r.survey.slug, '6mo');
  assert.equal(r.member.first_name, 'Jo');
  const stamped = db.updates.find(u => u.table === 'nps_invites');
  assert.ok(stamped.patch.opened_at, 'opened_at must be stamped');
});

test('does not re-stamp opened_at on a second open', async () => {
  const db = fakeDb({ invites: [{ ...LIVE, opened_at: '2026-08-18T10:00:00Z', status: 'opened' }] });
  const r = await loadByToken({ db, slug: '6mo', token: 'tok-live', now: NOW });
  assert.equal(r.ok, true);
  assert.equal(db.updates.length, 0, 'opened_at is first-open only');
});

test('refuses an expired token with a reason', async () => {
  const db = fakeDb({ invites: [{ ...LIVE, expires_at: '2026-07-01T00:00:00Z' }] });
  const r = await loadByToken({ db, slug: '6mo', token: 'tok-live', now: NOW });
  assert.equal(r.ok, false);
  assert.equal(r.reason, 'expired');
});

test('refuses an already-answered token with a reason', async () => {
  const db = fakeDb({ invites: [{ ...LIVE, status: 'responded' }] });
  const r = await loadByToken({ db, slug: '6mo', token: 'tok-live', now: NOW });
  assert.equal(r.ok, false);
  assert.equal(r.reason, 'answered');
});

test('an unknown token resolves to no reason at all', async () => {
  // Telling a prober "expired" vs "never existed" tells them which tokens are
  // real. Unknown must be indistinguishable from the route's perspective.
  const db = fakeDb({ invites: [] });
  const r = await loadByToken({ db, slug: '6mo', token: 'nope', now: NOW });
  assert.equal(r.ok, false);
  assert.equal(r.reason, null);
});

test('refuses a token whose survey does not match the path slug', async () => {
  const db = fakeDb({ invites: [LIVE] });
  const r = await loadByToken({ db, slug: 'cancel', token: 'tok-live', now: NOW });
  assert.equal(r.ok, false);
  assert.equal(r.reason, null);
});

test('resolves an active QR key with no member payload', async () => {
  const db = fakeDb({ qr: [{ id: 'q1', key: 'abc123', survey_id: 'srv-1', club_number: '31599', active: true }] });
  const r = await loadByQr({ db, slug: '6mo', key: 'abc123' });
  assert.equal(r.ok, true);
  assert.equal(r.clubNumber, '31599');
  assert.equal(r.member, undefined);
});

test('refuses an inactive QR key', async () => {
  const db = fakeDb({ qr: [{ id: 'q1', key: 'abc123', survey_id: 'srv-1', club_number: '31599', active: false }] });
  const r = await loadByQr({ db, slug: '6mo', key: 'abc123' });
  assert.equal(r.ok, false);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd auth && node --test src/services/npsPublic.test.js`
Expected: FAIL with `Cannot find module './npsPublic'`

- [ ] **Step 3: Write the implementation**

Create `auth/src/services/npsPublic.js`:

```js
// Resolution and response writing for the public survey endpoints. All db
// access is injectable so the whole module tests offline.

// Lazy: services/supabase.js calls createClient() at import time, so a top
// level require would make every test need SUPABASE_URL.
let _db = null;
function getDb() {
  if (!_db) _db = require('./supabase').supabaseAdmin;
  return _db;
}

async function loadSurveyById(db, surveyId) {
  const { data } = await db.from('nps_surveys').select('*').eq('id', surveyId).maybeSingle();
  return data || null;
}

/**
 * Resolve an invite token for a given survey slug.
 *
 * `reason` is returned ONLY for a token that resolved but is unusable. An
 * unknown token returns reason null, so the route cannot accidentally tell a
 * prober which tokens exist.
 */
async function loadByToken({ db = getDb(), slug, token, now = new Date() }) {
  if (!token) return { ok: false, reason: null };

  const { data: invite } = await db.from('nps_invites').select('*').eq('token', token).maybeSingle();
  if (!invite) return { ok: false, reason: null };

  const survey = await loadSurveyById(db, invite.survey_id);
  if (!survey || survey.slug !== slug) return { ok: false, reason: null };

  if (invite.status === 'responded') return { ok: false, reason: 'answered' };
  if (invite.expires_at && Date.parse(invite.expires_at) < now.getTime()) {
    return { ok: false, reason: 'expired' };
  }

  // First open only. Re-stamping would destroy the open-to-response timing.
  if (!invite.opened_at) {
    await db.from('nps_invites')
      .update({ opened_at: now.toISOString(), status: 'opened' })
      .eq('id', invite.id);
  }

  const firstName = (invite.member_name || '').trim().split(/\s+/)[0] || null;
  return {
    ok: true,
    survey,
    invite,
    member: { first_name: firstName, club_number: invite.club_number },
  };
}

/** Resolve a walk-up QR key. No member identity exists on this path. */
async function loadByQr({ db = getDb(), slug, key }) {
  if (!key) return { ok: false, reason: null };

  const { data: qr } = await db.from('nps_club_qr').select('*')
    .eq('key', key).eq('active', true).maybeSingle();
  if (!qr) return { ok: false, reason: null };

  const survey = await loadSurveyById(db, qr.survey_id);
  if (!survey || survey.slug !== slug) return { ok: false, reason: null };

  return { ok: true, survey, clubNumber: qr.club_number };
}

module.exports = { loadByToken, loadByQr };
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd auth && node --test src/services/npsPublic.test.js`
Expected: PASS, 8 tests

- [ ] **Step 5: Commit**

```bash
git add auth/src/services/npsPublic.js auth/src/services/npsPublic.test.js
git commit -m "feat(nps): invite token and QR key resolution"
```

---

### Task 4: Writing a response

**Files:**
- Modify: `auth/src/services/npsPublic.js`
- Modify: `auth/src/services/npsPublic.test.js`

**Interfaces:**
- Consumes: `loadByToken`, `loadByQr` from Task 3; `validateSubmission` from `./npsSchema`.
- Produces: `submitResponse({ db, slug, token, key, answers, now, ipHash, userAgent }) => { ok, status, errors?, responseId? }`

- [ ] **Step 1: Write the failing test**

Append to `auth/src/services/npsPublic.test.js`:

```js
const { submitResponse } = require('./npsPublic');

// The submit path inserts, so the fake needs insert() returning the row.
function fakeSubmitDb({ invites = [], surveys = [SURVEY], qr = [] } = {}) {
  const inserted = [];
  const updates = [];
  const tables = { nps_invites: invites, nps_surveys: surveys, nps_club_qr: qr };
  return {
    inserted,
    updates,
    from(table) {
      const eq = {};
      const builder = {
        select() { return builder; },
        eq(c, v) { eq[c] = v; return builder; },
        maybeSingle() {
          const rows = (tables[table] || []).filter(r =>
            Object.entries(eq).every(([c, v]) => r[c] === v));
          return Promise.resolve({ data: rows[0] || null, error: null });
        },
        update(patch) {
          return { eq: (c, v) => { updates.push({ table, patch, where: [c, v] }); return Promise.resolve({ error: null }); } };
        },
        insert(rows) {
          const list = Array.isArray(rows) ? rows : [rows];
          list.forEach(r => inserted.push({ table, row: r }));
          return {
            select: () => ({ maybeSingle: () => Promise.resolve({ data: { id: 'resp-1', ...list[0] }, error: null }) }),
            then: (res) => res({ data: list, error: null }),
          };
        },
      };
      return builder;
    },
  };
}

test('an invited submission writes the response, the scores, and burns the token', async () => {
  const db = fakeSubmitDb({ invites: [LIVE] });
  const r = await submitResponse({
    db, slug: '6mo', token: 'tok-live', answers: { q_nps: 9 }, now: NOW,
  });

  assert.equal(r.ok, true);
  const resp = db.inserted.find(i => i.table === 'nps_responses').row;
  assert.equal(resp.source, 'invited');
  assert.equal(resp.nps_score, 9);
  assert.equal(resp.member_id, 'M1');

  const score = db.inserted.find(i => i.table === 'nps_response_scores').row;
  assert.equal(score.metric_key, 'nps');
  assert.equal(score.score, 9);
  assert.equal(score.club_number, '30935', 'club is denormalised onto the score row');

  const burn = db.updates.find(u => u.patch.status === 'responded');
  assert.ok(burn, 'the token must be burned so the link is one-shot');
});

test('is_test propagates from the invite all the way to the score rows', async () => {
  // A manual fire must never reach the report, and the report reads
  // nps_response_scores directly.
  const db = fakeSubmitDb({ invites: [{ ...LIVE, is_test: true }] });
  await submitResponse({ db, slug: '6mo', token: 'tok-live', answers: { q_nps: 3 }, now: NOW });

  assert.equal(db.inserted.find(i => i.table === 'nps_responses').row.is_test, true);
  assert.equal(db.inserted.find(i => i.table === 'nps_response_scores').row.is_test, true);
});

test('a walk-up submission records no member identity', async () => {
  const db = fakeSubmitDb({ qr: [{ id: 'q1', key: 'abc123', survey_id: 'srv-1', club_number: '31599', active: true }] });
  const r = await submitResponse({ db, slug: '6mo', key: 'abc123', answers: { q_nps: 7 }, now: NOW });

  assert.equal(r.ok, true);
  const resp = db.inserted.find(i => i.table === 'nps_responses').row;
  assert.equal(resp.source, 'walkup');
  assert.equal(resp.member_id, null);
  assert.equal(resp.invite_id, null);
  assert.equal(resp.club_number, '31599');
});

test('a bad answer is rejected with field errors and writes nothing', async () => {
  const db = fakeSubmitDb({ invites: [LIVE] });
  const r = await submitResponse({ db, slug: '6mo', token: 'tok-live', answers: { q_nps: 44 }, now: NOW });

  assert.equal(r.ok, false);
  assert.equal(r.status, 400);
  assert.ok(r.errors.q_nps);
  assert.equal(db.inserted.length, 0, 'nothing is written when validation fails');
});

test('submitting on an already-answered token is refused', async () => {
  const db = fakeSubmitDb({ invites: [{ ...LIVE, status: 'responded' }] });
  const r = await submitResponse({ db, slug: '6mo', token: 'tok-live', answers: { q_nps: 9 }, now: NOW });
  assert.equal(r.ok, false);
  assert.equal(r.status, 404);
  assert.equal(db.inserted.length, 0);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd auth && node --test src/services/npsPublic.test.js`
Expected: FAIL — `submitResponse is not a function`

- [ ] **Step 3: Write the implementation**

In `auth/src/services/npsPublic.js`, add the import at the top, below the existing `getDb` block:

```js
const { validateSubmission } = require('./npsSchema');
```

Then add before `module.exports`:

```js
/**
 * Write one response and its score rows.
 *
 * Resolution reuses loadByToken/loadByQr so the submit path enforces exactly
 * the same expiry, already-answered and slug rules the render path does. A
 * separate check here would drift and let a dead link still post.
 */
async function submitResponse({
  db = getDb(), slug, token, key, answers, now = new Date(), ipHash = null, userAgent = null,
}) {
  const ctx = token
    ? await loadByToken({ db, slug, token, now })
    : await loadByQr({ db, slug, key });
  if (!ctx.ok) return { ok: false, status: 404, reason: ctx.reason };

  const { survey } = ctx;
  const invited = Boolean(token);
  const invite = ctx.invite || null;

  const v = validateSubmission(survey.schema || [], answers);
  if (!v.ok) return { ok: false, status: 400, errors: v.errors };

  const isTest = invited ? Boolean(invite.is_test) : false;
  const clubNumber = invited ? invite.club_number : ctx.clubNumber;
  const submittedAt = now.toISOString();
  // Denormalised for report speed, per the parent spec.
  const npsScore = v.scores.find(s => s.metric_key === 'nps')?.score ?? null;

  const { data: response, error } = await db.from('nps_responses').insert({
    invite_id: invited ? invite.id : null,
    survey_id: survey.id,
    member_id: invited ? invite.member_id : null,
    club_number: clubNumber,
    source: invited ? 'invited' : 'walkup',
    nps_score: npsScore,
    answers: v.cleaned,
    contact_name: v.cleaned.q_contact_name || null,
    contact_email: v.cleaned.q_contact_email || null,
    ip_hash: ipHash,
    user_agent: userAgent,
    submitted_at: submittedAt,
    is_test: isTest,
  }).select().maybeSingle();
  if (error) throw new Error(`[NPS] failed to write nps_responses: ${error.message}`);

  if (v.scores.length) {
    const { error: scoreErr } = await db.from('nps_response_scores').insert(
      v.scores.map(s => ({
        response_id: response.id,
        survey_id: survey.id,
        metric_key: s.metric_key,
        score: s.score,
        club_number: clubNumber,
        source: invited ? 'invited' : 'walkup',
        submitted_at: submittedAt,
        is_test: isTest,
      })),
    );
    if (scoreErr) throw new Error(`[NPS] failed to write nps_response_scores: ${scoreErr.message}`);
  }

  if (invited) {
    await db.from('nps_invites')
      .update({ status: 'responded', responded_at: submittedAt })
      .eq('id', invite.id);
  }

  return { ok: true, status: 200, responseId: response.id };
}
```

Update the exports line to:

```js
module.exports = { loadByToken, loadByQr, submitResponse };
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd auth && node --test src/services/npsPublic.test.js`
Expected: PASS, 13 tests

- [ ] **Step 5: Commit**

```bash
git add auth/src/services/npsPublic.js auth/src/services/npsPublic.test.js
git commit -m "feat(nps): write survey responses and score rows"
```

---

### Task 5: The public route

**Files:**
- Create: `auth/src/routes/publicNps.js`
- Modify: `auth/src/index.js:17` (allowlist) and the route mount block near `auth/src/index.js:146`

**Interfaces:**
- Consumes: `loadByToken`, `loadByQr`, `submitResponse` from `../services/npsPublic`.
- Produces: HTTP endpoints. Nothing later in this plan imports from it.

- [ ] **Step 1: Write the route**

Create `auth/src/routes/publicNps.js`:

```js
const { Router } = require('express');
const crypto = require('crypto');
const rateLimit = require('express-rate-limit');
const { loadByToken, loadByQr, submitResponse } = require('../services/npsPublic');

// Public survey renderer endpoints. Intentionally NOT behind authenticate:
// the invite token or the QR key IS the credential. Mirrors routes/publicForms.js.
const router = Router();

const submitLimiter = rateLimit({
  windowMs: 60 * 1000,
  limit: 10, // express-rate-limit v8: 'limit', not the deprecated 'max'
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many submissions. Try again in a minute.' },
});

// Walk-up has no token to burn, so the render path is rate limited too. Tuned
// to stop idle repeat-submitting from one phone, not to trip on a busy Saturday.
const readLimiter = rateLimit({
  windowMs: 60 * 1000,
  limit: 60,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many requests. Try again in a minute.' },
});

function hashIp(req) {
  const ip = req.ip || '';
  return ip ? crypto.createHash('sha256').update(ip).digest('hex').slice(0, 32) : null;
}

function publicSurvey(survey) {
  return {
    slug: survey.slug, title: survey.title,
    intro: survey.intro, schema: survey.schema || [],
  };
}

// GET /public/nps/:slug?t={token}  invited
// GET /public/nps/:slug?k={key}    walk-up
router.get('/:slug', readLimiter, async (req, res) => {
  try {
    const { t, k } = req.query;
    const result = t
      ? await loadByToken({ slug: req.params.slug, token: String(t) })
      : await loadByQr({ slug: req.params.slug, key: String(k || '') });

    if (!result.ok) {
      return res.status(404).json({
        error: 'This survey is not available',
        reason: result.reason || undefined,
      });
    }
    res.json({
      survey: publicSurvey(result.survey),
      member: result.member || null,
    });
  } catch (err) {
    console.error('[publicNps] fetch failed:', err.message);
    res.status(500).json({ error: 'Something went wrong. Try again.' });
  }
});

// POST /public/nps/:slug/submit
router.post('/:slug/submit', submitLimiter, async (req, res) => {
  try {
    const { t, k, answers } = req.body || {};
    const result = await submitResponse({
      slug: req.params.slug,
      token: t ? String(t) : undefined,
      key: k ? String(k) : undefined,
      answers,
      ipHash: hashIp(req),
      userAgent: (req.get('user-agent') || '').slice(0, 500),
    });

    if (!result.ok && result.status === 400) {
      return res.status(400).json({ errors: result.errors });
    }
    if (!result.ok) {
      return res.status(404).json({
        error: 'This survey is not available',
        reason: result.reason || undefined,
      });
    }
    res.json({ ok: true });
  } catch (err) {
    console.error('[publicNps] submit failed:', err.message);
    res.status(500).json({ error: 'Something went wrong. Try again.' });
  }
});

module.exports = router;
```

- [ ] **Step 2: Allowlist the survey origin**

In `auth/src/index.js`, in the `ALLOWED_ORIGINS` array (line 15-20), add the survey domain below the forms one:

```js
  'https://forms.westcoaststrength.com',
  'https://survey.westcoaststrength.com',
```

Do NOT add a path-scoped `cors()` for `/public/nps`. The permissive block at
lines 26-27 exists only for the in-gym TV boards that load from a third-party
origin. The survey renderer is our own domain, so the global allowlist is both
sufficient and tighter.

- [ ] **Step 3: Mount the router**

In `auth/src/index.js`, immediately after the existing `/public/forms` mount:

```js
app.use('/public/forms', require('./routes/publicForms'))
app.use('/public/nps', require('./routes/publicNps'))
```

- [ ] **Step 4: Verify the app still loads and the routes are registered**

Run:

```bash
cd auth && SUPABASE_URL=https://example.supabase.co SUPABASE_SERVICE_ROLE_KEY=dummy \
  node -e "const app=require('./src/index'); console.log('loaded ok')"
```

Expected: prints `loaded ok`. If it prints a `Cannot find module` for `publicNps`, the mount path is wrong.

- [ ] **Step 5: Commit**

```bash
git add auth/src/routes/publicNps.js auth/src/index.js
git commit -m "feat(nps): public survey render and submit endpoints"
```

---

### Task 6: Manual fire service

**Files:**
- Create: `auth/src/services/npsTestFire.js`
- Test: `auth/src/services/npsTestFire.test.js`

**Interfaces:**
- Consumes: `buildInvite`, `surveyUrl` from `ghl-sync/src/nps/npsInvites` (lazy require); `pacificToday` from `ghl-sync/src/nps/npsTriggers` (lazy require); `ghlFetch` from `./ghlClient`; `LOCATIONS` from `../config/ghlLocations`.
- Produces: `testFire({ db, slug, memberId, force, now, locations, ghlFetchFn }) => { ok, status, error?, invite?, contact?, url?, ghl? }`

- [ ] **Step 1: Write the failing test**

Create `auth/src/services/npsTestFire.test.js`:

```js
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
      const builder = {
        select() { return builder; },
        eq(c, v) { eq[c] = v; return builder; },
        gte(c, v) { gteHit = (tables[table] || []).some(r => String(r[c]) >= String(v)); return builder; },
        limit() { return Promise.resolve({ data: rows(), error: null }); },
        range() { return Promise.resolve({ data: rows(), error: null }); },
        maybeSingle() { return Promise.resolve({ data: rows()[0] || null, error: null }); },
        update(patch) { return { eq: () => Promise.resolve({ error: null }) }; },
        insert(row) {
          inserted.push({ table, row });
          return { select: () => ({ maybeSingle: () => Promise.resolve({ data: { id: 'inv-new', ...row }, error: null }) }) };
        },
      };
      function rows() {
        const base = (tables[table] || []).filter(r =>
          Object.entries(eq).every(([c, v]) => r[c] === v));
        return table === 'nps_invites' && !gteHit ? [] : base;
      }
      return builder;
    },
  };
}

test('a forced fire writes the field before the tag and marks the invite as a test', async () => {
  const order = [];
  const db = fakeDb({ contacts: [{ id: 'C1', email: 'a@x.com', first_name: 'Jo', last_name: 'Doe', tags: [], custom_fields: [] }] });

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
  const db = fakeDb({ contacts: [{ id: 'C1', email: 'a@x.com', tags: [], custom_fields: [] }] });
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
    contacts: [{ id: 'C1', email: 'a@x.com', tags: [], custom_fields: [] }],
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd auth && node --test src/services/npsTestFire.test.js`
Expected: FAIL with `Cannot find module './npsTestFire'`

- [ ] **Step 3: Write the implementation**

Create `auth/src/services/npsTestFire.js`:

```js
const DEFAULT_LOCATIONS = require('../config/ghlLocations');
const { ghlFetch } = require('./ghlClient');

let _db = null;
function getDb() {
  if (!_db) _db = require('./supabase').supabaseAdmin;
  return _db;
}

// Required lazily and from ghl-sync on purpose.
//
// Token generation and invite row construction MUST NOT fork: two
// implementations of a security token is how one of them ends up predictable.
// Both modules are dependency-free (npsInvites imports only node:crypto,
// npsTriggers imports nothing), so auth can load them across the service
// boundary without inheriting ghl-sync's node_modules. The require is inside
// the function so a path problem degrades to this one endpoint failing rather
// than crashing auth at boot.
function shared() {
  const { buildInvite, surveyUrl } = require('../../../ghl-sync/src/nps/npsInvites');
  const { pacificToday, addDays } = require('../../../ghl-sync/src/nps/npsTriggers');
  return { buildInvite, surveyUrl, pacificToday, addDays };
}

const PAGE_SIZE = 1000;

async function loadContacts(db, locationId) {
  const rows = [];
  let from = 0;
  for (;;) {
    const { data, error } = await db.from('ghl_contacts_v2')
      .select('id, email, phone, first_name, last_name, tags, custom_fields')
      .eq('location_id', locationId)
      .range(from, from + PAGE_SIZE - 1);
    if (error) throw new Error(`[NPS] failed to load ghl_contacts_v2: ${error.message}`);
    if (!data || data.length === 0) break;
    rows.push(...data);
    if (data.length < PAGE_SIZE) break;
    from += PAGE_SIZE;
  }
  return rows;
}

/**
 * Fire one chosen member through one chosen survey, for real.
 *
 * This deliberately does not call selectCohort: cohort selection is exactly
 * what is being bypassed, because the member has already been chosen. With
 * force it also bypasses the cooldown, and writes is_test so the partial
 * unique index lets it repeat and the report never sees it.
 */
async function testFire({
  db = getDb(), slug, memberId, force = true, now = new Date(),
  locations = DEFAULT_LOCATIONS, ghlFetchFn = ghlFetch,
  baseUrl = process.env.NPS_SURVEY_BASE_URL || 'https://survey.westcoaststrength.com',
}) {
  const { buildInvite, surveyUrl, pacificToday, addDays } = shared();

  const { data: survey } = await db.from('nps_surveys').select('*').eq('slug', slug).maybeSingle();
  if (!survey) return { ok: false, status: 404, error: `no survey with slug ${slug}` };
  if (!survey.ghl_tag || !survey.ghl_field_key) {
    return { ok: false, status: 400, error: `survey ${slug} has no ghl_tag/ghl_field_key configured` };
  }

  const { data: member } = await db.from('abc_members').select('*').eq('member_id', memberId).maybeSingle();
  if (!member) return { ok: false, status: 404, error: `no member with id ${memberId}` };
  if (!member.email) return { ok: false, status: 400, error: `member ${memberId} has no email` };

  const today = pacificToday(now);

  if (!force) {
    const since = addDays(today, -Math.max(0, Number(survey.resend_cooldown_days) || 0));
    const { data: recent } = await db.from('nps_invites')
      .select('member_id, created_at')
      .eq('member_id', memberId)
      .gte('created_at', `${since}T00:00:00Z`)
      .limit(1);
    if (recent && recent.length) {
      return { ok: false, status: 409, error: `member ${memberId} is inside the ${survey.resend_cooldown_days}-day cooldown; pass force to override` };
    }
  }

  // NOTE: auth's config calls this clubCode; ghl-sync calls the same field
  // clubNumber. Reading the wrong one yields undefined and matches nothing.
  const location = locations.find(l => l.clubCode === member.club_number);
  if (!location) {
    return { ok: false, status: 400, error: `no GHL location configured for club ${member.club_number}` };
  }

  const contacts = await loadContacts(db, location.id);
  const email = String(member.email).toLowerCase().trim();
  const contact = contacts.find(c => (c.email || '').toLowerCase().trim() === email);
  if (!contact) {
    return { ok: false, status: 404, error: `no GHL contact for ${member.email} in ${location.name}` };
  }

  const row = buildInvite({ survey, member, targetDate: today, now, dryRun: false });
  row.is_test = true;
  row.ghl_contact_id = contact.id;

  const { data: invite, error: insErr } = await db.from('nps_invites').insert(row).select().maybeSingle();
  if (insErr) throw new Error(`[NPS] failed to insert test invite: ${insErr.message}`);

  const url = surveyUrl(baseUrl, survey.slug, row.token);
  const ghl = { tagged: 0, errors: [] };

  try {
    // Field FIRST. The workflow triggers on the tag, so tagging before the URL
    // exists sends an email with an empty link. npsJob.test.js pins the same
    // ordering on the ghl-sync side; both must fail if either flips.
    await ghlFetchFn(`/contacts/${contact.id}`, location.apiKey, {
      method: 'PUT',
      body: JSON.stringify({ customFields: [{ key: survey.ghl_field_key, field_value: url }] }),
    });

    const live = await ghlFetchFn(`/contacts/${contact.id}`, location.apiKey, { method: 'GET' });
    const existing = live?.contact?.tags ?? contact.tags ?? [];
    if (!existing.includes(survey.ghl_tag)) {
      await ghlFetchFn(`/contacts/${contact.id}`, location.apiKey, {
        method: 'PUT',
        body: JSON.stringify({ tags: [...existing, survey.ghl_tag] }),
      });
    }

    await db.from('nps_invites').update({
      status: 'sent',
      sent_at: now.toISOString(),
      ghl_tag_applied_at: now.toISOString(),
      ghl_error: null,
    }).eq('id', invite.id);

    ghl.tagged = 1;
  } catch (err) {
    ghl.errors.push(err.message);
    await db.from('nps_invites')
      .update({ status: 'failed', ghl_error: err.message })
      .eq('id', invite.id);
  }

  return {
    ok: true,
    status: 200,
    invite: { id: invite.id, token: row.token, trigger_date: today, is_test: true },
    contact: { id: contact.id, email: contact.email, location: location.name },
    url,
    ghl,
  };
}

module.exports = { testFire };
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd auth && node --test src/services/npsTestFire.test.js`
Expected: PASS, 5 tests

- [ ] **Step 5: Commit**

```bash
git add auth/src/services/npsTestFire.js auth/src/services/npsTestFire.test.js
git commit -m "feat(nps): manual test-fire service with rails-off force"
```

---

### Task 7: Manual fire route

**Files:**
- Create: `auth/src/routes/nps.js`
- Modify: `auth/src/index.js` route mount block

**Interfaces:**
- Consumes: `testFire` from `../services/npsTestFire`; `authenticate` from `../middleware/auth`; `requireRole` from `../middleware/role`; `record` from `../services/auditLog`.
- Produces: `POST /nps/test-fire`.

- [ ] **Step 1: Write the route**

Create `auth/src/routes/nps.js`:

```js
const { Router } = require('express');
const authenticate = require('../middleware/auth');
const { requireRole } = require('../middleware/role');
const { testFire } = require('../services/npsTestFire');
const auditLog = require('../services/auditLog');

// Admin-only NPS tooling. The public render/submit endpoints live in
// routes/publicNps.js and are deliberately unauthenticated.
const router = Router();
router.use(authenticate);
router.use(requireRole('admin'));

// POST /nps/test-fire  { slug, member_id, force }
//
// Rails off by design: with force this skips the cooldown and writes a real
// GHL field + tag, so a real email really sends. That is the only way to
// verify the GHL workflow itself, which no unit test reaches.
router.post('/test-fire', async (req, res) => {
  const { slug, member_id: memberId, force = true } = req.body || {};
  if (!slug || !memberId) {
    return res.status(400).json({ error: 'slug and member_id are required' });
  }

  try {
    const result = await testFire({ slug, memberId, force: Boolean(force) });

    auditLog.record(req.staff?.id, 'nps_test_fire', {
      target: memberId,
      metadata: { slug, force: Boolean(force), ok: result.ok, error: result.error || null },
      ip: req.ip,
    });

    if (!result.ok) return res.status(result.status || 400).json({ error: result.error });
    res.json(result);
  } catch (err) {
    console.error('[nps] test-fire failed:', err.message);
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
```

- [ ] **Step 2: Mount the router**

In `auth/src/index.js`, directly below the `/public/nps` mount added in Task 5:

```js
app.use('/public/nps', require('./routes/publicNps'))
app.use('/nps', require('./routes/nps'))
```

- [ ] **Step 3: Verify the app loads with both routers mounted**

Run:

```bash
cd auth && SUPABASE_URL=https://example.supabase.co SUPABASE_SERVICE_ROLE_KEY=dummy \
  node -e "require('./src/index'); console.log('loaded ok')"
```

Expected: prints `loaded ok`

- [ ] **Step 4: Verify the cross-service require actually resolves**

This is the one deployment risk in the plan: `auth` requires two modules from
`ghl-sync`. Prove the path is right before shipping.

Run:

```bash
cd auth && node -e "
const { buildInvite, surveyUrl } = require('../ghl-sync/src/nps/npsInvites');
const { pacificToday } = require('../ghl-sync/src/nps/npsTriggers');
console.log('shared modules resolve:', typeof buildInvite, typeof surveyUrl, pacificToday(new Date()));
"
```

Expected: `shared modules resolve: function function 2026-08-18` (today's Pacific date)

- [ ] **Step 5: Run the whole auth test suite**

Run: `cd auth && node --test src/`
Expected: all PASS, including the pre-existing suites.

- [ ] **Step 6: Commit**

```bash
git add auth/src/routes/nps.js auth/src/index.js
git commit -m "feat(nps): admin test-fire endpoint"
```

---

### Task 8: The `?s={score}` pre-answer

**Files:**
- Modify: `auth/src/services/npsPublic.js`
- Modify: `auth/src/services/npsPublic.test.js`
- Modify: `auth/src/routes/publicNps.js`

**Interfaces:**
- Consumes: `loadByToken`, `submitResponse` from Tasks 3 and 4.
- Produces: `recordPreScore({ db, survey, invite, score, now }) => Promise<void>`; `submitResponse` changes from `.insert()` to `.upsert(..., { onConflict: 'invite_id' })`.

The invite email renders the primary question's buttons inline. Clicking one
opens `/{slug}?t={token}&s={score}`, which records that score immediately and
drops the member into the remaining questions. This is typically the difference
between roughly 5% and 15% completion versus a bare "click here" link.

Recording immediately means an abandoned survey still yields its NPS score,
which is the whole point. It works because `nps_responses.invite_id` is already
`unique`: the early row and the eventual full submission are the same row, so
the response is created on open and completed on submit.

- [ ] **Step 1: Write the failing test**

Append to `auth/src/services/npsPublic.test.js`:

```js
const { recordPreScore } = require('./npsPublic');

test('a pre-score writes the response immediately so an abandon still counts', async () => {
  const db = fakeSubmitDb({ invites: [LIVE] });
  await recordPreScore({ db, slug: '6mo', token: 'tok-live', score: 9, now: NOW });

  const resp = db.inserted.find(i => i.table === 'nps_responses').row;
  assert.equal(resp.nps_score, 9);
  assert.equal(resp.answers.q_nps, 9);
  assert.equal(resp.invite_id, 'inv-1');

  const score = db.inserted.find(i => i.table === 'nps_response_scores').row;
  assert.equal(score.metric_key, 'nps');
  assert.equal(score.score, 9);
});

test('a pre-score does NOT burn the token — they still have questions to answer', async () => {
  const db = fakeSubmitDb({ invites: [LIVE] });
  await recordPreScore({ db, slug: '6mo', token: 'tok-live', score: 9, now: NOW });
  assert.equal(db.updates.filter(u => u.patch.status === 'responded').length, 0);
});

test('an out-of-range pre-score is ignored rather than throwing', async () => {
  // It arrives from a URL an email client may have mangled. A bad ?s must not
  // stop the survey rendering.
  const db = fakeSubmitDb({ invites: [LIVE] });
  await recordPreScore({ db, slug: '6mo', token: 'tok-live', score: 99, now: NOW });
  assert.equal(db.inserted.length, 0);
});

test('finishing after a pre-score updates the same response row', async () => {
  const db = fakeSubmitDb({ invites: [LIVE] });
  await submitResponse({ db, slug: '6mo', token: 'tok-live', answers: { q_nps: 4 }, now: NOW });

  const writes = db.inserted.filter(i => i.table === 'nps_responses');
  assert.equal(writes.length, 1);
  assert.equal(writes[0].conflictTarget, 'invite_id',
    'one response per invite: the pre-score row and the final row are the same row');
});
```

- [ ] **Step 2: Teach the test fake to record the upsert conflict target**

In `auth/src/services/npsPublic.test.js`, inside `fakeSubmitDb`, add an
`upsert` alongside the existing `insert`:

```js
        upsert(rows, opts = {}) {
          const list = Array.isArray(rows) ? rows : [rows];
          list.forEach(r => inserted.push({ table, row: r, conflictTarget: opts.onConflict }));
          return {
            select: () => ({ maybeSingle: () => Promise.resolve({ data: { id: 'resp-1', ...list[0] }, error: null }) }),
          };
        },
```

- [ ] **Step 3: Run test to verify it fails**

Run: `cd auth && node --test src/services/npsPublic.test.js`
Expected: FAIL — `recordPreScore is not a function`

- [ ] **Step 4: Change the response write to an upsert**

In `auth/src/services/npsPublic.js`, in `submitResponse`, replace the
`nps_responses` insert with an upsert keyed on the invite:

```js
  const { data: response, error } = await db.from('nps_responses').upsert({
```

and change the closing of that call from:

```js
  }).select().maybeSingle();
```

to:

```js
  }, { onConflict: 'invite_id' }).select().maybeSingle();
```

Leave the walk-up path alone conceptually: `invite_id` is null there, and
Postgres allows many NULLs under a unique constraint, so every walk-up
response is still its own row.

- [ ] **Step 5: Add `recordPreScore`**

In `auth/src/services/npsPublic.js`, add before `module.exports`:

```js
/**
 * Record the score a member clicked straight from the invite email.
 *
 * Written immediately rather than held in the browser so an abandoned survey
 * still yields its NPS score. Safe to call repeatedly: the response row is
 * keyed on invite_id, so a reload overwrites rather than duplicates.
 *
 * A malformed score is ignored, never thrown. It arrives from a URL that an
 * email client may have rewritten, and a bad ?s must not stop the survey from
 * rendering.
 */
async function recordPreScore({ db = getDb(), slug, token, score, now = new Date() }) {
  const n = Number(score);
  if (!Number.isInteger(n) || n < 0 || n > 10) return;

  const ctx = await loadByToken({ db, slug, token, now });
  if (!ctx.ok) return;

  const { survey, invite } = ctx;
  const npsQuestion = (survey.schema || []).find(q => q.type === 'nps');
  if (!npsQuestion) return;

  const submittedAt = now.toISOString();
  const isTest = Boolean(invite.is_test);

  const { data: response, error } = await db.from('nps_responses').upsert({
    invite_id: invite.id,
    survey_id: survey.id,
    member_id: invite.member_id,
    club_number: invite.club_number,
    source: 'invited',
    nps_score: n,
    answers: { [npsQuestion.id]: n },
    contact_name: null,
    contact_email: null,
    ip_hash: null,
    user_agent: null,
    submitted_at: submittedAt,
    is_test: isTest,
  }, { onConflict: 'invite_id' }).select().maybeSingle();
  if (error) throw new Error(`[NPS] failed to pre-record response: ${error.message}`);

  await db.from('nps_response_scores').insert({
    response_id: response.id,
    survey_id: survey.id,
    metric_key: npsQuestion.metric_key,
    score: n,
    club_number: invite.club_number,
    source: 'invited',
    submitted_at: submittedAt,
    is_test: isTest,
  });
}
```

Update the exports line to:

```js
module.exports = { loadByToken, loadByQr, submitResponse, recordPreScore };
```

- [ ] **Step 6: Run test to verify it passes**

Run: `cd auth && node --test src/services/npsPublic.test.js`
Expected: PASS, 17 tests

- [ ] **Step 7: Wire it into the route**

In `auth/src/routes/publicNps.js`, add `recordPreScore` to the import:

```js
const { loadByToken, loadByQr, submitResponse, recordPreScore } = require('../services/npsPublic');
```

Then in the `GET /:slug` handler, immediately after the `if (!result.ok)`
block and before the `res.json`, add:

```js
    // ?s= carries the score clicked straight from the email. Record it before
    // responding so an abandoned survey still counts.
    if (t && req.query.s !== undefined) {
      await recordPreScore({ slug: req.params.slug, token: String(t), score: req.query.s });
    }
```

- [ ] **Step 8: Commit**

```bash
git add auth/src/services/npsPublic.js auth/src/services/npsPublic.test.js auth/src/routes/publicNps.js
git commit -m "feat(nps): record the score clicked from the invite email"
```

---

### Task 9: Walk-up per-key hourly cap

**Files:**
- Modify: `auth/src/services/npsPublic.js`
- Modify: `auth/src/services/npsPublic.test.js`

**Interfaces:**
- Consumes: `loadByQr` from Task 3.
- Produces: `submitResponse` gains a `409` outcome when a QR key exceeds its hourly cap.

The invited path has a token to burn, so it is one-shot by construction. Walk-up
has no such guarantee: the QR poster hangs in public. The IP hash in Task 5
handles one phone; this handles one poster being hammered from many phones.

Tuned to stop idle repeat-submitting, not to trip on a busy Saturday.

- [ ] **Step 1: Write the failing test**

Append to `auth/src/services/npsPublic.test.js`:

```js
const QR_ROW = { id: 'q1', key: 'abc123', survey_id: 'srv-1', club_number: '31599', active: true };

test('a walk-up key over its hourly cap is refused', async () => {
  // 30 responses already recorded for this survey+club in the last hour.
  const db = fakeSubmitDb({ qr: [QR_ROW], walkupCount: 30 });

  const r = await submitResponse({ db, slug: '6mo', key: 'abc123', answers: { q_nps: 7 }, now: NOW });

  assert.equal(r.ok, false);
  assert.equal(r.status, 409);
  assert.equal(db.inserted.length, 0);
});

test('a walk-up key under its hourly cap is allowed', async () => {
  const db = fakeSubmitDb({ qr: [QR_ROW], walkupCount: 3 });

  const r = await submitResponse({ db, slug: '6mo', key: 'abc123', answers: { q_nps: 7 }, now: NOW });
  assert.equal(r.ok, true);
});

test('the cap does not apply to the invited path', async () => {
  // An invite token is one-shot already; capping it would block a legitimate
  // member at a busy club.
  const db = fakeSubmitDb({ invites: [LIVE], walkupCount: 999 });

  const r = await submitResponse({ db, slug: '6mo', token: 'tok-live', answers: { q_nps: 7 }, now: NOW });
  assert.equal(r.ok, true);
});
```

- [ ] **Step 2: Teach the test fake to answer a count query**

In `auth/src/services/npsPublic.test.js`, change `fakeSubmitDb`'s signature to
accept the count, and add the two builder methods the count query needs.

Change the signature line from:

```js
function fakeSubmitDb({ invites = [], surveys = [SURVEY], qr = [] } = {}) {
```

to:

```js
function fakeSubmitDb({ invites = [], surveys = [SURVEY], qr = [], walkupCount = 0 } = {}) {
```

Then add these two methods to the returned `builder`, alongside `select` and
`eq`:

```js
        gte() { return builder; },
        // Supabase's count query terminates on .head(); the fake returns the
        // number the test asked for rather than filtering by time.
        head() { return Promise.resolve({ count: walkupCount, error: null }); },
```

`walkupCount` is a plain parameter captured by the closure, so no setter and no
mutation after construction.

- [ ] **Step 3: Run test to verify it fails**

Run: `cd auth && node --test src/services/npsPublic.test.js`
Expected: FAIL — the over-cap submission succeeds instead of returning 409.

- [ ] **Step 4: Add the cap**

In `auth/src/services/npsPublic.js`, add near the top:

```js
// One poster, one hour. High enough that a genuinely busy club never notices,
// low enough that idle repeat-tapping stops mattering.
const WALKUP_HOURLY_CAP = 25;
```

Then in `submitResponse`, after the `if (!ctx.ok)` guard and before validation:

```js
  if (!token) {
    const hourAgo = new Date(now.getTime() - 60 * 60 * 1000).toISOString();
    const { count } = await db.from('nps_responses')
      .select('id', { count: 'exact' })
      .eq('survey_id', survey.id)
      .eq('club_number', ctx.clubNumber)
      .eq('source', 'walkup')
      .gte('submitted_at', hourAgo)
      .head();
    if ((count || 0) >= WALKUP_HOURLY_CAP) {
      return { ok: false, status: 409, reason: 'rate_limited' };
    }
  }
```

Note this reads `survey` and `ctx.clubNumber`, so it must sit after `const { survey } = ctx;`.

- [ ] **Step 5: Run test to verify it passes**

Run: `cd auth && node --test src/services/npsPublic.test.js`
Expected: PASS, 20 tests

- [ ] **Step 6: Return a friendly message from the route**

In `auth/src/routes/publicNps.js`, in the submit handler, add before the
existing `if (!result.ok)` 404 branch:

```js
    if (!result.ok && result.status === 409) {
      return res.status(429).json({ error: 'Thanks! We have plenty of responses from here right now.' });
    }
```

- [ ] **Step 7: Commit**

```bash
git add auth/src/services/npsPublic.js auth/src/services/npsPublic.test.js auth/src/routes/publicNps.js
git commit -m "feat(nps): cap walk-up submissions per QR key per hour"
```

---

## Manual verification before opening the PR

- [ ] `cd auth && node --test src/` — all pass.
- [ ] `cd ghl-sync && node --test src/ test/` — still all pass; this plan modified nothing in `ghl-sync`.
- [ ] No new module requires `services/supabase` at import time: `cd auth && node -e "require('./src/services/npsPublic'); require('./src/services/npsTestFire'); require('./src/services/npsSchema'); console.log('ok')"` with no `SUPABASE_URL` set prints `ok`.
- [ ] Migration 109 has not been applied to production. It is applied by hand at merge.
- [ ] `survey.westcoaststrength.com` does not resolve yet. That is expected: the Worker is sub-project 2b.

## PR notes

- Migration `109_nps_phase2.sql` must be applied by hand at merge time.
- The public endpoints ship live but are unreachable in practice until a survey
  row exists with `status = 'active'` and an invite has been created.
- `POST /nps/test-fire` sends a real email to a real member when a survey is
  configured with a valid `ghl_tag`. It is admin-gated and audited.

## Not in this plan

The Worker and `survey.westcoaststrength.com` (2b), the admin UI (3), the
report, and walk-up QR key generation (Phase 5). Manual fire has no UI here; it
is an endpoint until the admin UI wraps it.
