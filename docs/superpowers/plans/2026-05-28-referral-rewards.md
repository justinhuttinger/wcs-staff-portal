# Referral Rewards Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** When a referred member signs up, automatically zero the referring member's next month of ABC dues and trigger a GoHighLevel SMS, with edge cases surfaced in an admin-only portal page.

**Architecture:** Detection hooks into the existing `ghl-sync` ABC reconcile loop. Pure decision functions (`pickNextDuesInvoice`, `isEligibleCandidate`) are unit-tested in isolation; ABC reads/writes go through `abc/client.js`; orchestration lives in a new `abc/referralRewards.js`. A new `referral_rewards` Supabase table is the source of truth and idempotency ledger. The `auth` API exposes an admin-only read/resolve route, and the React portal adds a "Referral Rewards" technical tile.

**Tech Stack:** Node.js + Express (ghl-sync, auth), Supabase (Postgres), axios, `node:test` for tests, React 19 + Vite + Tailwind (portal).

---

## File Structure

**ghl-sync (detection + ABC + GHL writes):**
- Create: `ghl-sync/src/config/referral.js` — config constants (field keys, tag, amounts, flags).
- Modify: `ghl-sync/src/abc/client.js` — add `fetchMemberInvoices`, `adjustInvoice`.
- Create: `ghl-sync/src/abc/referralRewards.js` — pure decision fns + orchestration.
- Modify: `ghl-sync/src/abc/reconcile.js` — collect candidates, call `processReferralRewards`.
- Create: `ghl-sync/migrations/0XX_referral_rewards.sql` — table + indexes.
- Create: `ghl-sync/test/referralRewards.test.js` — unit/integration tests.

**auth (admin API):**
- Create: `auth/src/routes/referralRewards.js` — `GET /` list, `POST /:id/resolve`.
- Modify: `auth/src/index.js` — mount the router at `/referral-rewards`.

**portal (admin UI):**
- Modify: `portal/src/lib/api.js` — `getReferralRewards`, `resolveReferralReward`.
- Create: `portal/src/components/admin/ReferralRewardsAdmin.jsx` — list + resolve UI.
- Modify: `portal/src/components/AdminPanel.jsx` — register tile + render branch + import.

---

## Task 1: Referral config module

**Files:**
- Create: `ghl-sync/src/config/referral.js`

- [ ] **Step 1: Write the config module**

```js
// ghl-sync/src/config/referral.js
/**
 * Referral Rewards configuration.
 * Field keys are identical across all 7 GHL sub-accounts.
 */
module.exports = {
  // Master on/off. Ship dark; enable after the GHL workflow exists.
  ENABLED: process.env.REFERRAL_REWARDS_ENABLED === 'true',
  // Back-catalog fence: only members who signed on/after this date are eligible.
  PROGRAM_START_DATE: process.env.REFERRAL_PROGRAM_START_DATE || '2026-05-28',
  // New member's contact field holding the referrer's ABC member id.
  REFERRED_BY_FIELD_KEY: 'contact.referred_by_abc_id',
  // Referrer's contact field we write the new member's first name into (for the SMS).
  FRIEND_NAME_FIELD_KEY: 'contact.referral_friend_name',
  // Tag added to the referrer's contact to trigger the GHL SMS workflow.
  REWARD_TAG: 'referral reward',
  // ABC invoice adjustment params.
  DUES_PROFIT_CENTER: 'DUES',
  ADJUST_AMOUNT: '0.00',
  NUMBER_OF_INVOICES: '1',
};
```

- [ ] **Step 2: Verify it loads**

Run: `node -e "console.log(require('./ghl-sync/src/config/referral.js'))"`
Expected: prints the object with `ENABLED: false`, `REWARD_TAG: 'referral reward'`, etc.

- [ ] **Step 3: Commit**

```bash
git add ghl-sync/src/config/referral.js
git commit -m "feat(ghl-sync): referral rewards config module"
```

---

## Task 2: Pure decision functions + tests

**Files:**
- Create: `ghl-sync/src/abc/referralRewards.js` (decision fns only this task)
- Test: `ghl-sync/test/referralRewards.test.js`

- [ ] **Step 1: Write the failing tests**

```js
// ghl-sync/test/referralRewards.test.js
const test = require('node:test');
const assert = require('node:assert');
const {
  pickNextDuesInvoice,
  isEligibleCandidate,
  buildAdjustmentBody,
} = require('../src/abc/referralRewards');

// Sample payload mirrors the real ABC /agreements/invoices response.
const SAMPLE_INVOICES = [
  { dueDate: '2026-05-31', profitCenterAbcCode: 'DUES', invoiceAmount: 54.99, amountDue: 54.99 },
  { dueDate: '2026-06-29', profitCenterAbcCode: 'ANNUALFEE', invoiceAmount: 39.99, amountDue: 39.99 },
  { dueDate: '2026-06-30', profitCenterAbcCode: 'DUES', invoiceAmount: 54.99, amountDue: 54.99 },
];

test('pickNextDuesInvoice returns earliest future DUES invoice', () => {
  const inv = pickNextDuesInvoice(SAMPLE_INVOICES, '2026-05-28');
  assert.strictEqual(inv.dueDate, '2026-05-31');
  assert.strictEqual(inv.profitCenterAbcCode, 'DUES');
});

test('pickNextDuesInvoice skips ANNUALFEE', () => {
  const onlyAnnual = [{ dueDate: '2026-06-29', profitCenterAbcCode: 'ANNUALFEE', invoiceAmount: 39.99 }];
  assert.strictEqual(pickNextDuesInvoice(onlyAnnual, '2026-05-28'), null);
});

test('pickNextDuesInvoice ignores invoices whose dueDate is before today', () => {
  const inv = pickNextDuesInvoice(SAMPLE_INVOICES, '2026-06-01');
  assert.strictEqual(inv.dueDate, '2026-06-30');
});

test('pickNextDuesInvoice returns null on empty list', () => {
  assert.strictEqual(pickNextDuesInvoice([], '2026-05-28'), null);
});

test('isEligibleCandidate true for active, recent, referred member with no prior row', () => {
  const r = isEligibleCandidate({
    abcMember: { member_id: 'NEW1', is_active: true, sign_date: '2026-05-28' },
    referredByValue: 'REF1',
    existingRow: null,
    programStartDate: '2026-05-28',
  });
  assert.strictEqual(r.eligible, true);
});

test('isEligibleCandidate false when referredBy empty', () => {
  const r = isEligibleCandidate({
    abcMember: { member_id: 'NEW1', is_active: true, sign_date: '2026-05-28' },
    referredByValue: '',
    existingRow: null,
    programStartDate: '2026-05-28',
  });
  assert.strictEqual(r.eligible, false);
});

test('isEligibleCandidate false when signed before program start', () => {
  const r = isEligibleCandidate({
    abcMember: { member_id: 'NEW1', is_active: true, sign_date: '2026-05-01' },
    referredByValue: 'REF1',
    existingRow: null,
    programStartDate: '2026-05-28',
  });
  assert.strictEqual(r.eligible, false);
});

test('isEligibleCandidate false on self-referral', () => {
  const r = isEligibleCandidate({
    abcMember: { member_id: 'REF1', is_active: true, sign_date: '2026-05-28' },
    referredByValue: 'REF1',
    existingRow: null,
    programStartDate: '2026-05-28',
  });
  assert.strictEqual(r.eligible, false);
});

test('isEligibleCandidate false when already zeroed (terminal)', () => {
  const r = isEligibleCandidate({
    abcMember: { member_id: 'NEW1', is_active: true, sign_date: '2026-05-28' },
    referredByValue: 'REF1',
    existingRow: { dues_status: 'zeroed' },
    programStartDate: '2026-05-28',
  });
  assert.strictEqual(r.eligible, false);
});

test('isEligibleCandidate false when no_dues_invoice (terminal)', () => {
  const r = isEligibleCandidate({
    abcMember: { member_id: 'NEW1', is_active: true, sign_date: '2026-05-28' },
    referredByValue: 'REF1',
    existingRow: { dues_status: 'no_dues_invoice' },
    programStartDate: '2026-05-28',
  });
  assert.strictEqual(r.eligible, false);
});

test('isEligibleCandidate true when prior row errored (retry)', () => {
  const r = isEligibleCandidate({
    abcMember: { member_id: 'NEW1', is_active: true, sign_date: '2026-05-28' },
    referredByValue: 'REF1',
    existingRow: { dues_status: 'error' },
    programStartDate: '2026-05-28',
  });
  assert.strictEqual(r.eligible, true);
});

test('buildAdjustmentBody zeroes the given invoice', () => {
  const body = buildAdjustmentBody('2026-05-31');
  assert.deepStrictEqual(body, {
    startDate: '2026-05-31',
    profitCenterAbcCode: 'DUES',
    invoiceAmount: '0.00',
    numberOfInvoices: '1',
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `node --test ghl-sync/test/referralRewards.test.js`
Expected: FAIL — `Cannot find module` / functions undefined.

- [ ] **Step 3: Implement the pure functions**

```js
// ghl-sync/src/abc/referralRewards.js
const referral = require('../config/referral');

/**
 * Earliest invoice with profitCenterAbcCode === DUES and dueDate >= today.
 * Dates are YYYY-MM-DD strings (lexicographic compare is safe).
 * @returns {object|null}
 */
function pickNextDuesInvoice(invoices, today) {
  const dues = (invoices || [])
    .filter((i) => i && i.profitCenterAbcCode === referral.DUES_PROFIT_CENTER)
    .filter((i) => i.dueDate && i.dueDate >= today)
    .sort((a, b) => (a.dueDate < b.dueDate ? -1 : a.dueDate > b.dueDate ? 1 : 0));
  return dues[0] || null;
}

/**
 * Decide whether a referred member should be processed this cycle.
 * @returns {{eligible: boolean, reason: string}}
 */
function isEligibleCandidate({ abcMember, referredByValue, existingRow, programStartDate }) {
  const ref = (referredByValue || '').trim();
  if (!ref) return { eligible: false, reason: 'no_referrer' };
  if (!abcMember || abcMember.is_active !== true) return { eligible: false, reason: 'inactive' };
  if (ref === abcMember.member_id) return { eligible: false, reason: 'self_referral' };
  const signDate = abcMember.sign_date || abcMember.since_date || '';
  if (!signDate || signDate < programStartDate) return { eligible: false, reason: 'before_program_start' };
  if (existingRow) {
    const s = existingRow.dues_status;
    if (s === 'zeroed' || s === 'no_dues_invoice') return { eligible: false, reason: 'terminal' };
    // s === 'error' (or anything else) → retry
  }
  return { eligible: true, reason: 'ok' };
}

/** Body for POST /agreements/invoiceadjustment that zeroes one DUES invoice. */
function buildAdjustmentBody(dueDate) {
  return {
    startDate: dueDate,
    profitCenterAbcCode: referral.DUES_PROFIT_CENTER,
    invoiceAmount: referral.ADJUST_AMOUNT,
    numberOfInvoices: referral.NUMBER_OF_INVOICES,
  };
}

module.exports = { pickNextDuesInvoice, isEligibleCandidate, buildAdjustmentBody };
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `node --test ghl-sync/test/referralRewards.test.js`
Expected: PASS — all decision-function tests green.

- [ ] **Step 5: Commit**

```bash
git add ghl-sync/src/abc/referralRewards.js ghl-sync/test/referralRewards.test.js
git commit -m "feat(ghl-sync): referral reward decision functions + tests"
```

---

## Task 3: ABC client — invoices read + adjustment write

**Files:**
- Modify: `ghl-sync/src/abc/client.js`

- [ ] **Step 1: Add the two functions**

Add inside `ghl-sync/src/abc/client.js`, before `module.exports`:

```js
/**
 * Fetch a member's upcoming agreement invoices.
 * GET /{club}/members/{memberId}/agreements/invoices
 * @returns {Promise<Array>} invoices array (possibly empty)
 */
async function fetchMemberInvoices(clubNumber, memberId) {
  if (!ABC_APP_ID || !ABC_APP_KEY) {
    throw new Error('ABC_APP_ID and ABC_APP_KEY must be set');
  }
  const url = `${ABC_BASE_URL}/${clubNumber}/members/${memberId}/agreements/invoices`;
  const res = await axios.get(url, {
    headers: { app_id: ABC_APP_ID, app_key: ABC_APP_KEY, Accept: 'application/json' },
    timeout: 60000,
  });
  return res.data?.invoices || [];
}

/**
 * Adjust (e.g. zero) a member's invoice.
 * POST /{club}/members/{memberId}/agreements/invoiceadjustment
 * ABC sometimes returns HTTP 200 with a non-success status body, so treat
 * success as: HTTP 2xx AND status.message === 'success' (when a status block
 * is present).
 * @returns {Promise<{ok: boolean, status: number, data: object}>}
 */
async function adjustInvoice(clubNumber, memberId, body) {
  if (!ABC_APP_ID || !ABC_APP_KEY) {
    throw new Error('ABC_APP_ID and ABC_APP_KEY must be set');
  }
  const url = `${ABC_BASE_URL}/${clubNumber}/members/${memberId}/agreements/invoiceadjustment`;
  const res = await axios.post(url, body, {
    headers: {
      app_id: ABC_APP_ID,
      app_key: ABC_APP_KEY,
      Accept: 'application/json',
      'Content-Type': 'application/json',
    },
    timeout: 60000,
  });
  const statusMsg = res.data?.status?.message;
  const ok = res.status >= 200 && res.status < 300 && (statusMsg === undefined || statusMsg === 'success');
  return { ok, status: res.status, data: res.data };
}
```

- [ ] **Step 2: Export them**

Change the export line at the bottom of `ghl-sync/src/abc/client.js`:

```js
module.exports = { fetchAllABCMembers, transformABCMember, fetchMemberInvoices, adjustInvoice };
```

- [ ] **Step 3: Smoke-check it parses**

Run: `node -e "const c=require('./ghl-sync/src/abc/client.js'); console.log(typeof c.fetchMemberInvoices, typeof c.adjustInvoice)"`
Expected: `function function`

- [ ] **Step 4: Commit**

```bash
git add ghl-sync/src/abc/client.js
git commit -m "feat(ghl-sync): ABC client fetchMemberInvoices + adjustInvoice"
```

---

## Task 4: `referral_rewards` table migration

**Files:**
- Create: `ghl-sync/migrations/010_referral_rewards.sql` (use the next free number; check `ls ghl-sync/migrations` and bump if 010 is taken)

- [ ] **Step 1: Confirm the next migration number**

Run: `ls ghl-sync/migrations`
Expected: a numbered list (e.g. `006_payroll_tables.sql`). Pick the next unused number; this plan assumes `010`.

- [ ] **Step 2: Write the migration**

```sql
-- ghl-sync/migrations/010_referral_rewards.sql
-- Ledger of referral rewards: one row per referred new signup.
create table if not exists referral_rewards (
  id                      uuid primary key default gen_random_uuid(),
  run_id                  uuid,                    -- reconcile run that produced this row
  club_number             text not null,
  location_id             text,
  new_member_id           text not null,          -- ABC member id of the signup
  new_member_name         text,
  referrer_abc_id         text not null,          -- value of contact.referred_by_abc_id
  referrer_ghl_contact_id text,
  dues_invoice_due_date   date,                    -- the invoice we zeroed
  dues_status             text not null,           -- 'zeroed' | 'no_dues_invoice' | 'error'
  sms_status              text not null,           -- 'tagged' | 'skipped' | 'no_referrer_contact' | 'error'
  needs_review            boolean not null default false,
  resolved_at             timestamptz,
  resolved_by             text,
  dry_run                 boolean not null default false,
  error                   text,
  created_at              timestamptz not null default now()
);

-- Idempotency: one reward per new signup. Dry runs never write rows
-- (processReferralReward returns before recordReward when dryRun), so a plain
-- (non-partial) unique index is correct and works as the onConflict arbiter.
create unique index if not exists referral_rewards_new_member_uniq
  on referral_rewards (new_member_id);

create index if not exists referral_rewards_needs_review_idx
  on referral_rewards (needs_review) where needs_review = true;
```

- [ ] **Step 3: Apply the migration in Supabase**

Apply via the project's usual migration path (run the SQL in the Supabase SQL editor for project `ybopxxydsuwlbwxiuzve`, or whatever mechanism the other `ghl-sync/migrations/*.sql` files use — these are applied manually).
Expected: table `referral_rewards` exists with the two indexes.

- [ ] **Step 4: Commit**

```bash
git add ghl-sync/migrations/010_referral_rewards.sql
git commit -m "feat(ghl-sync): referral_rewards table migration"
```

---

## Task 5: Orchestration — `processReferralReward` + tests

**Files:**
- Modify: `ghl-sync/src/abc/referralRewards.js` (add orchestration)
- Test: `ghl-sync/test/referralRewards.test.js` (add orchestration tests)

- [ ] **Step 1: Write the failing orchestration tests**

Append to `ghl-sync/test/referralRewards.test.js`:

```js
const { processReferralReward } = require('../src/abc/referralRewards');

function makeDeps(overrides = {}) {
  const calls = { adjust: [], tagged: [], recorded: [] };
  const deps = {
    today: '2026-05-28',
    fetchMemberInvoices: async () => overrides.invoices ?? [
      { dueDate: '2026-05-31', profitCenterAbcCode: 'DUES', invoiceAmount: 54.99 },
    ],
    adjustInvoice: async (club, id, body) => {
      calls.adjust.push({ club, id, body });
      return overrides.adjustResult ?? { ok: true, status: 200, data: {} };
    },
    tagReferrer: async (contactId, friendName) => {
      if (overrides.tagThrows) throw new Error('ghl down');
      calls.tagged.push({ contactId, friendName });
    },
    recordReward: async (row) => { calls.recorded.push(row); },
  };
  return { deps, calls };
}

const BASE = {
  location: { clubNumber: '30935', id: 'LOC1', name: 'Salem' },
  runId: 'run1',
  abcMember: { member_id: 'NEW1', first_name: 'Sam', last_name: 'Jones', sign_date: '2026-05-28', is_active: true },
  referrerAbcId: 'REF1',
  referrerContact: { id: 'GHLREF1' },
  dryRun: false,
};

test('processReferralReward: happy path zeroes then tags', async () => {
  const { deps, calls } = makeDeps();
  const row = await processReferralReward({ ...BASE, ...deps });
  assert.strictEqual(calls.adjust.length, 1);
  assert.deepStrictEqual(calls.adjust[0].body, {
    startDate: '2026-05-31', profitCenterAbcCode: 'DUES', invoiceAmount: '0.00', numberOfInvoices: '1',
  });
  assert.strictEqual(calls.tagged.length, 1);
  assert.strictEqual(calls.tagged[0].friendName, 'Sam');
  assert.strictEqual(row.dues_status, 'zeroed');
  assert.strictEqual(row.sms_status, 'tagged');
  assert.strictEqual(row.needs_review, false);
});

test('processReferralReward: no DUES invoice → flag, never tags', async () => {
  const { deps, calls } = makeDeps({ invoices: [{ dueDate: '2026-06-29', profitCenterAbcCode: 'ANNUALFEE' }] });
  const row = await processReferralReward({ ...BASE, ...deps });
  assert.strictEqual(calls.adjust.length, 0);
  assert.strictEqual(calls.tagged.length, 0);
  assert.strictEqual(row.dues_status, 'no_dues_invoice');
  assert.strictEqual(row.needs_review, true);
});

test('processReferralReward: ABC adjust fails → no tag, status error', async () => {
  const { deps, calls } = makeDeps({ adjustResult: { ok: false, status: 200, data: { status: { message: 'fail' } } } });
  const row = await processReferralReward({ ...BASE, ...deps });
  assert.strictEqual(calls.tagged.length, 0);
  assert.strictEqual(row.dues_status, 'error');
});

test('processReferralReward: no referrer contact → zeroed but flagged, no tag', async () => {
  const { deps, calls } = makeDeps();
  const row = await processReferralReward({ ...BASE, referrerContact: null, ...deps });
  assert.strictEqual(calls.adjust.length, 1);
  assert.strictEqual(calls.tagged.length, 0);
  assert.strictEqual(row.dues_status, 'zeroed');
  assert.strictEqual(row.sms_status, 'no_referrer_contact');
  assert.strictEqual(row.needs_review, true);
});

test('processReferralReward: zeroed but tag write fails → flagged sms error', async () => {
  const { deps } = makeDeps({ tagThrows: true });
  const row = await processReferralReward({ ...BASE, ...deps });
  assert.strictEqual(row.dues_status, 'zeroed');
  assert.strictEqual(row.sms_status, 'error');
  assert.strictEqual(row.needs_review, true);
});

test('processReferralReward: dryRun zeroes nothing, records nothing', async () => {
  const { deps, calls } = makeDeps();
  const row = await processReferralReward({ ...BASE, dryRun: true, ...deps });
  assert.strictEqual(calls.adjust.length, 0);
  assert.strictEqual(calls.tagged.length, 0);
  assert.strictEqual(calls.recorded.length, 0);
  assert.strictEqual(row.dry_run, true);
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `node --test ghl-sync/test/referralRewards.test.js`
Expected: FAIL — `processReferralReward is not a function`.

- [ ] **Step 3: Implement `processReferralReward`**

Add to `ghl-sync/src/abc/referralRewards.js` (before `module.exports`). Note: this function takes injected deps (`fetchMemberInvoices`, `adjustInvoice`, `tagReferrer`, `recordReward`, `today`) so it is unit-testable without network/db. The real wiring is supplied in Task 6.

```js
/**
 * Process one referral reward end-to-end. Pure of side effects except through
 * the injected dep functions, which makes it unit-testable.
 *
 * deps: { today, fetchMemberInvoices, adjustInvoice, tagReferrer, recordReward }
 * Returns the referral_rewards row object that was (or would be) recorded.
 */
async function processReferralReward(opts) {
  const {
    location, runId, abcMember, referrerAbcId, referrerContact, dryRun,
    today, fetchMemberInvoices, adjustInvoice, tagReferrer, recordReward,
  } = opts;

  const friendName = (abcMember.first_name || '').trim();
  const row = {
    run_id: runId,
    club_number: location.clubNumber,
    location_id: location.id,
    new_member_id: abcMember.member_id,
    new_member_name: `${abcMember.first_name || ''} ${abcMember.last_name || ''}`.trim() || null,
    referrer_abc_id: referrerAbcId,
    referrer_ghl_contact_id: referrerContact?.id || null,
    dues_invoice_due_date: null,
    dues_status: 'error',
    sms_status: 'skipped',
    needs_review: false,
    dry_run: !!dryRun,
    error: null,
  };

  if (dryRun) {
    console.log(`[Referral] DRY_RUN would reward referrer ${referrerAbcId} for new member ${abcMember.member_id}`);
    return row;
  }

  // 1. Find the next DUES invoice for the referrer.
  let invoices;
  try {
    invoices = await fetchMemberInvoices(location.clubNumber, referrerAbcId);
  } catch (err) {
    row.dues_status = 'error';
    row.error = `fetch invoices failed: ${err.message}`;
    await recordReward(row);
    return row;
  }

  const invoice = pickNextDuesInvoice(invoices, today);
  if (!invoice) {
    row.dues_status = 'no_dues_invoice';
    row.sms_status = 'skipped';
    row.needs_review = true;
    await recordReward(row);
    return row;
  }
  row.dues_invoice_due_date = invoice.dueDate;

  // 2. Zero it. Must succeed before we touch the SMS-triggering tag.
  let result;
  try {
    result = await adjustInvoice(location.clubNumber, referrerAbcId, buildAdjustmentBody(invoice.dueDate));
  } catch (err) {
    row.dues_status = 'error';
    row.error = `invoice adjustment failed: ${err.message}`;
    await recordReward(row);
    return row;
  }
  if (!result.ok) {
    row.dues_status = 'error';
    row.error = `invoice adjustment not ok: ${JSON.stringify(result.data?.status || result.status)}`;
    await recordReward(row);
    return row;
  }
  row.dues_status = 'zeroed';

  // 3. Dues confirmed zeroed. Only now do we trigger the SMS via the tag.
  if (!referrerContact?.id) {
    row.sms_status = 'no_referrer_contact';
    row.needs_review = true;
    await recordReward(row);
    return row;
  }
  try {
    await tagReferrer(referrerContact.id, friendName);
    row.sms_status = 'tagged';
  } catch (err) {
    row.sms_status = 'error';
    row.needs_review = true;
    row.error = `tag write failed (dues already zeroed): ${err.message}`;
  }

  await recordReward(row);
  return row;
}
```

- [ ] **Step 4: Export it**

Update the export at the bottom of `ghl-sync/src/abc/referralRewards.js`:

```js
module.exports = { pickNextDuesInvoice, isEligibleCandidate, buildAdjustmentBody, processReferralReward };
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `node --test ghl-sync/test/referralRewards.test.js`
Expected: PASS — all decision + orchestration tests green.

- [ ] **Step 6: Commit**

```bash
git add ghl-sync/src/abc/referralRewards.js ghl-sync/test/referralRewards.test.js
git commit -m "feat(ghl-sync): processReferralReward orchestration + tests"
```

---

## Task 6: Wire detection into `reconcile.js`

**Files:**
- Modify: `ghl-sync/src/abc/reconcile.js`

- [ ] **Step 1: Add imports + supabase helpers at the top**

At the top of `ghl-sync/src/abc/reconcile.js`, after the existing requires (which already include `supabase`, the ghl client `{ get, post, put, sleep }`, `ABC_GHL_FIELD_MAP`, `ABC_TAGS`):

```js
const referral = require('../config/referral');
const { isEligibleCandidate, processReferralReward } = require('./referralRewards');
const { fetchMemberInvoices, adjustInvoice } = require('./client');
```

- [ ] **Step 2: Resolve the two referral field ids alongside the existing field defs**

In `reconcileLocation`, the code already loads `abcMemberIdFieldId` and builds `fieldKeyToId`. Immediately after the `fieldKeyToId` block (around line 177), add:

```js
  // Referral field ids (looked up the same way as the mapped ABC fields).
  let referredByFieldId = null;
  let friendNameFieldId = null;
  if (referral.ENABLED) {
    const { data: refDefs } = await supabase
      .from('ghl_custom_field_defs')
      .select('id, field_key')
      .eq('location_id', locationId)
      .in('field_key', [referral.REFERRED_BY_FIELD_KEY, referral.FRIEND_NAME_FIELD_KEY]);
    for (const fd of (refDefs || [])) {
      if (fd.field_key === referral.REFERRED_BY_FIELD_KEY) referredByFieldId = fd.id;
      if (fd.field_key === referral.FRIEND_NAME_FIELD_KEY) friendNameFieldId = fd.id;
    }
    if (!referredByFieldId) {
      console.warn(`[Reconcile] ${locationName}: ${referral.REFERRED_BY_FIELD_KEY} field def not found — referral rewards skipped this location`);
    }
  }
  const referralCandidates = [];
```

- [ ] **Step 3: Collect candidates inside the matched-member branch**

In the matched-member section (after `processedGhlIds.add(ghlContact.id)` and `const isActive = ...`, around line 415), add candidate collection. This only reads from the already-loaded contact; it does not perform any writes:

```js
    // --- Referral reward candidate detection ---
    if (referral.ENABLED && referredByFieldId && isActive) {
      const referredByValue = (ghlContact.custom_fields || {})[referredByFieldId];
      if (referredByValue && String(referredByValue).trim()) {
        referralCandidates.push({
          abcMember: abc,
          referredByValue: String(referredByValue).trim(),
          newMemberContact: ghlContact,
        });
      }
    }
```

- [ ] **Step 4: Process candidates after the member loop, before writing log entries**

After the `for (const abc of abcMembers)` loop closes (around line 574, just before "// 5. Write log entries"), add:

```js
  // 4.5 Referral rewards — process collected candidates.
  if (referral.ENABLED && referredByFieldId && referralCandidates.length > 0) {
    const today = new Date().toISOString().slice(0, 10);

    // Load existing referral_rewards rows for idempotency (live rows only).
    const newMemberIds = referralCandidates.map((c) => c.abcMember.member_id);
    const { data: existingRows } = await supabase
      .from('referral_rewards')
      .select('new_member_id, dues_status')
      .eq('dry_run', false)
      .in('new_member_id', newMemberIds);
    const existingByMember = new Map((existingRows || []).map((r) => [r.new_member_id, r]));

    // tagReferrer closes over apiKey/put + the friend-name field id. Writes the
    // friend's name AND the trigger tag in a single GHL PUT (atomic trigger).
    const tagReferrer = async (contactId, friendName) => {
      const current = await get(`/contacts/${contactId}`, {}, apiKey);
      const existingTags = current?.contact?.tags || [];
      const tags = existingTags.includes(referral.REWARD_TAG)
        ? existingTags
        : [...existingTags, referral.REWARD_TAG];
      const updateBody = { tags };
      if (friendNameFieldId) {
        updateBody.customFields = [{ id: friendNameFieldId, value: friendName }];
      }
      await put(`/contacts/${contactId}`, updateBody, apiKey);
      await sleep(650);
    };

    const recordReward = async (row) => {
      const { error: upErr } = await supabase
        .from('referral_rewards')
        .upsert(row, { onConflict: 'new_member_id' });
      if (upErr) console.error(`[Referral] failed to record reward for ${row.new_member_id}: ${upErr.message}`);
    };

    for (const cand of referralCandidates) {
      const existingRow = existingByMember.get(cand.abcMember.member_id) || null;
      const { eligible } = isEligibleCandidate({
        abcMember: cand.abcMember,
        referredByValue: cand.referredByValue,
        existingRow,
        programStartDate: referral.PROGRAM_START_DATE,
      });
      if (!eligible) continue;

      const referrerContact = byMemberId.get(cand.referredByValue) || null;
      try {
        await processReferralReward({
          location, runId,
          abcMember: cand.abcMember,
          referrerAbcId: cand.referredByValue,
          referrerContact,
          dryRun: DRY_RUN,
          today,
          fetchMemberInvoices,
          adjustInvoice,
          tagReferrer,
          recordReward,
        });
      } catch (err) {
        console.error(`[Referral] unexpected error for new member ${cand.abcMember.member_id}: ${err.message}`);
        errors++;
      }
      await sleep(650);
    }
    console.log(`[Reconcile] ${locationName}: processed ${referralCandidates.length} referral candidate(s)`);
  }
```

- [ ] **Step 5: Verify the module still parses and existing tests pass**

Run: `node -e "require('./ghl-sync/src/abc/reconcile.js'); console.log('ok')"`
Expected: `ok`
Run: `node --test ghl-sync/test/referralRewards.test.js`
Expected: PASS (unchanged — reconcile wiring doesn't affect these unit tests).

- [ ] **Step 6: Commit**

```bash
git add ghl-sync/src/abc/reconcile.js
git commit -m "feat(ghl-sync): detect referrals in reconcile + process rewards"
```

---

## Task 7: auth API — referral rewards route

**Files:**
- Create: `auth/src/routes/referralRewards.js`
- Modify: `auth/src/index.js`

- [ ] **Step 1: Write the router**

```js
// auth/src/routes/referralRewards.js
const { Router } = require('express')
const { supabaseAdmin } = require('../services/supabase')
const authenticate = require('../middleware/auth')
const { requireRole } = require('../middleware/role')

const router = Router()
router.use(authenticate)
router.use(requireRole('admin'))

// GET /referral-rewards — list rewards, newest first. ?needs_review=true filters.
router.get('/', async (req, res) => {
  try {
    let query = supabaseAdmin
      .from('referral_rewards')
      .select('*')
      .order('created_at', { ascending: false })
      .limit(500)
    if (req.query.needs_review === 'true') query = query.eq('needs_review', true)
    const { data, error } = await query
    if (error) return res.status(500).json({ error: error.message })
    res.json({ rewards: data || [] })
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

// POST /referral-rewards/:id/resolve — mark a flagged reward handled.
router.post('/:id/resolve', async (req, res) => {
  try {
    const resolvedBy = req.user?.email || req.user?.id || 'unknown'
    const { data, error } = await supabaseAdmin
      .from('referral_rewards')
      .update({ needs_review: false, resolved_at: new Date().toISOString(), resolved_by: resolvedBy })
      .eq('id', req.params.id)
      .select()
      .single()
    if (error) return res.status(500).json({ error: error.message })
    res.json({ reward: data })
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

module.exports = router
```

- [ ] **Step 2: Mount the router**

In `auth/src/index.js`, find where sibling routers are mounted (e.g. `app.use('/sync-status', require('./routes/syncStatus'))` / `app.use('/abc-sync', ...)`) and add alongside them:

```js
app.use('/referral-rewards', require('./routes/referralRewards'))
```

- [ ] **Step 3: Verify `req.user` shape for `resolved_by`**

Run: `grep -n "req.user" auth/src/middleware/auth.js`
Expected: confirms `req.user` is set with an `email` (or `id`) field. If the field name differs, adjust `resolvedBy` in Step 1 to match (e.g. `req.user.user_id`).

- [ ] **Step 4: Smoke-check the server boots**

Run: `node -e "require('./auth/src/routes/referralRewards.js'); console.log('route ok')"`
Expected: `route ok`

- [ ] **Step 5: Commit**

```bash
git add auth/src/routes/referralRewards.js auth/src/index.js
git commit -m "feat(auth): admin-only referral-rewards list + resolve route"
```

---

## Task 8: Portal — api.js wrappers

**Files:**
- Modify: `portal/src/lib/api.js`

- [ ] **Step 1: Add the wrapper functions**

Add near the existing `getSyncStatus` (around line 573) in `portal/src/lib/api.js`, matching the file's existing `api(...)` helper style:

```js
export async function getReferralRewards({ needsReview = false } = {}) {
  const q = needsReview ? '?needs_review=true' : ''
  return api(`/referral-rewards${q}`)
}

export async function resolveReferralReward(id) {
  return api(`/referral-rewards/${id}/resolve`, { method: 'POST' })
}
```

- [ ] **Step 2: Verify the helper signature matches**

Run: `grep -n "async function api\|function api(" portal/src/lib/api.js`
Expected: confirms `api(path, options)` exists and that `{ method: 'POST' }` is the right options shape. If POSTs in this file pass a body differently, mirror an existing POST call's style.

- [ ] **Step 3: Commit**

```bash
git add portal/src/lib/api.js
git commit -m "feat(portal): referral rewards api wrappers"
```

---

## Task 9: Portal — ReferralRewardsAdmin component + tile

**Files:**
- Create: `portal/src/components/admin/ReferralRewardsAdmin.jsx`
- Modify: `portal/src/components/AdminPanel.jsx`

- [ ] **Step 1: Write the component**

```jsx
// portal/src/components/admin/ReferralRewardsAdmin.jsx
import { useState, useEffect } from 'react'
import { getReferralRewards, resolveReferralReward } from '../../lib/api'

function StatusPill({ value, tone }) {
  const tones = {
    green: 'bg-green-100 text-green-700',
    orange: 'bg-orange-100 text-orange-700',
    red: 'bg-red-100 text-red-700',
    gray: 'bg-gray-100 text-gray-600',
  }
  return <span className={`inline-block px-2 py-0.5 rounded-full text-xs font-medium ${tones[tone] || tones.gray}`}>{value}</span>
}

function duesTone(s) { return s === 'zeroed' ? 'green' : s === 'no_dues_invoice' ? 'orange' : 'red' }
function smsTone(s) { return s === 'tagged' ? 'green' : s === 'skipped' ? 'gray' : 'orange' }

export default function ReferralRewardsAdmin() {
  const [rows, setRows] = useState([])
  const [loading, setLoading] = useState(true)
  const [resolving, setResolving] = useState(null)

  async function load() {
    try {
      const res = await getReferralRewards()
      setRows(res.rewards || [])
    } catch {
      // leave existing rows; surface nothing destructive
    }
    setLoading(false)
  }

  useEffect(() => { load() }, [])

  async function handleResolve(id) {
    setResolving(id)
    try {
      await resolveReferralReward(id)
      await load()
    } finally {
      setResolving(null)
    }
  }

  if (loading) return <p className="text-sm text-text-muted px-2 py-4">Loading referral rewards…</p>

  const needsReview = rows.filter(r => r.needs_review)
  const recent = rows

  return (
    <div className="space-y-6">
      {/* Needs review */}
      <div>
        <p className="text-xs text-orange-600 uppercase font-semibold mb-2">
          Needs Review {needsReview.length > 0 && `(${needsReview.length})`}
        </p>
        {needsReview.length === 0 ? (
          <p className="text-sm text-text-muted">Nothing needs manual handling. 🎉</p>
        ) : (
          <div className="space-y-2">
            {needsReview.map(r => (
              <div key={r.id} className="bg-orange-50 border border-orange-200 rounded-lg px-3 py-2 flex items-center justify-between">
                <div>
                  <p className="text-sm text-text-primary font-medium">{r.new_member_name || r.new_member_id}</p>
                  <p className="text-xs text-text-muted">
                    Referrer ABC #{r.referrer_abc_id} · {r.club_number} ·{' '}
                    {r.dues_status === 'no_dues_invoice' ? 'no upcoming DUES invoice' :
                     r.sms_status === 'no_referrer_contact' ? 'dues zeroed, no GHL contact for SMS' :
                     r.sms_status === 'error' ? 'dues zeroed, SMS tag failed' : (r.error || 'review')}
                  </p>
                </div>
                <button
                  onClick={() => handleResolve(r.id)}
                  disabled={resolving === r.id}
                  className="text-xs px-3 py-1.5 rounded-lg bg-wcs-red text-white hover:opacity-90 disabled:opacity-50"
                >
                  {resolving === r.id ? 'Saving…' : 'Mark resolved'}
                </button>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Recent rewards */}
      <div>
        <p className="text-xs text-text-muted uppercase font-semibold mb-2">Recent ({recent.length})</p>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-text-muted">
                <th className="py-1 pr-4 font-medium">New member</th>
                <th className="py-1 pr-4 font-medium">Referrer ABC #</th>
                <th className="py-1 pr-4 font-medium">Club</th>
                <th className="py-1 pr-4 font-medium">Dues</th>
                <th className="py-1 pr-4 font-medium">SMS</th>
                <th className="py-1 pr-4 font-medium">When</th>
              </tr>
            </thead>
            <tbody>
              {recent.map(r => (
                <tr key={r.id} className="border-t border-border">
                  <td className="py-1.5 pr-4 text-text-primary">{r.new_member_name || r.new_member_id}</td>
                  <td className="py-1.5 pr-4 text-text-muted">{r.referrer_abc_id}</td>
                  <td className="py-1.5 pr-4 text-text-muted">{r.club_number}</td>
                  <td className="py-1.5 pr-4"><StatusPill value={r.dues_status} tone={duesTone(r.dues_status)} /></td>
                  <td className="py-1.5 pr-4"><StatusPill value={r.sms_status} tone={smsTone(r.sms_status)} /></td>
                  <td className="py-1.5 pr-4 text-text-muted">{new Date(r.created_at).toLocaleDateString()}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}
```

- [ ] **Step 2: Register the tile in AdminPanel**

In `portal/src/components/AdminPanel.jsx`:

(a) Add the import near the other admin imports (after line ~31):

```jsx
import ReferralRewardsAdmin from './admin/ReferralRewardsAdmin'
```

(b) Add a tile to the `TECHNICAL_TILES` array (it ends around line 62, after the `revenue-backfill` entry):

```jsx
  { key: 'referral-rewards', label: 'Referral Rewards', desc: 'Free-Month Credits', icon: 'M21 11.25v8.25a1.5 1.5 0 0 1-1.5 1.5H5.25a1.5 1.5 0 0 1-1.5-1.5v-8.25M12 4.875A2.625 2.625 0 1 0 9.375 7.5H12m0-2.625V7.5m0-2.625A2.625 2.625 0 1 1 14.625 7.5H12m0 0V21m-8.625-9.75h18c.621 0 1.125-.504 1.125-1.125v-1.5c0-.621-.504-1.125-1.125-1.125h-18c-.621 0-1.125.504-1.125 1.125v1.5c0 .621.504 1.125 1.125 1.125Z' },
```

(c) Add the render branch alongside the others (after the `abc-sync` / `membership-skip` lines, ~line 139):

```jsx
        {activeSection === 'referral-rewards' && <ReferralRewardsAdmin />}
```

- [ ] **Step 3: Build the portal to verify it compiles**

Run: `cd portal && npm run build`
Expected: build succeeds with no errors referencing `ReferralRewardsAdmin` or `api.js`.

- [ ] **Step 4: Commit**

```bash
git add portal/src/components/admin/ReferralRewardsAdmin.jsx portal/src/components/AdminPanel.jsx
git commit -m "feat(portal): Referral Rewards admin tile + view"
```

---

## Task 10: Full verification pass

**Files:** none (verification only)

- [ ] **Step 1: Run the ghl-sync test suite**

Run: `node --test ghl-sync/test/referralRewards.test.js`
Expected: PASS — all decision + orchestration tests green.

- [ ] **Step 2: Parse-check every touched node module**

Run:
```bash
node -e "require('./ghl-sync/src/config/referral.js'); require('./ghl-sync/src/abc/client.js'); require('./ghl-sync/src/abc/referralRewards.js'); require('./ghl-sync/src/abc/reconcile.js'); require('./auth/src/routes/referralRewards.js'); console.log('all modules parse')"
```
Expected: `all modules parse`

- [ ] **Step 3: Build the portal**

Run: `cd portal && npm run build`
Expected: build succeeds.

- [ ] **Step 4: Confirm the feature is dark by default**

Run: `node -e "console.log('ENABLED=', require('./ghl-sync/src/config/referral.js').ENABLED)"`
Expected: `ENABLED= false` (no env var set) — confirms the reconcile changes are inert until explicitly enabled.

- [ ] **Step 5: Codex review (per project convention)**

Per `feedback_codex_review`: run the Codex CLI in read-only sandbox over the diff for a second-opinion review before opening the PR. Address anything substantive.

- [ ] **Step 6: Final commit if review produced changes**

```bash
git add -A
git commit -m "chore: address review feedback for referral rewards"
```

---

## Manual / out-of-band steps (owned by Justin, not code)

These are tracked here so they aren't forgotten, but they are NOT implementation tasks:

1. **GHL, per sub-account (×7):** create custom field "Referral Friend Name" → confirm key `contact.referral_friend_name`; create tag `referral reward`; build a workflow triggered on that tag that sends the SMS using `{{contact.first_name}}` + `{{contact.referral_friend_name}}` (optionally removing the tag afterward).
2. **Render env (ghl-sync service):** set `REFERRAL_PROGRAM_START_DATE` (default `2026-05-28`); leave `REFERRAL_REWARDS_ENABLED` unset/false until the GHL workflow is live, then set it to `true`.
3. **Confirm** the `invoiceadjustment` success-response shape so `adjustInvoice`'s success check (`status.message === 'success'`) is correct; adjust if ABC uses a different success marker.

## Notes on assumptions to verify during execution

- Migration numbering (`010_`) — bump to the real next number (Task 4, Step 1).
- `req.user` field name for `resolved_by` (Task 7, Step 3).
- `portal/src/lib/api.js` `api()` POST options shape (Task 8, Step 2).
- ghl-sync test directory: this plan uses `ghl-sync/test/`. If the repo already has a test dir/runner convention for ghl-sync, follow it instead.
