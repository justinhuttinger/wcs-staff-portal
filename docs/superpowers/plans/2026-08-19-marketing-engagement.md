# Marketing Engagement Report Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give WCS per-location email and SMS engagement reporting — workflow email open/click rates over a real date range, and SMS reply rates broken out per automated text.

**Architecture:** `ghl-sync` gains two data feeds: a nightly cumulative snapshot of GHL workflow email stats (diffed to produce period figures) and a watermark-driven pull of GHL SMS messages clustered into templates by body fingerprint. Reply attribution is computed in JavaScript at sync time and stored, so the report query is a single Postgres aggregate exposed as an RPC. The portal gains one `marketing-engagement` report with Email and SMS tabs.

**Tech Stack:** Node 20 CommonJS, `node:test` + `node:assert`, Express 4, `@supabase/supabase-js`, React + Tailwind (portal), Postgres (Supabase).

**Spec:** `docs/superpowers/specs/2026-08-19-marketing-engagement-design.md`

## Global Constraints

- **Worktree:** all work happens in `C:\Users\justi\wcs-worktrees\marketing-engagement` on branch `feat/marketing-engagement`. Never commit to `master`.
- **Test runner:** `node:test` + `node:assert`, CommonJS `require`. Tests are colocated as `<module>.test.js`. `auth` runs them via `npm test` (`node --test src/`); `ghl-sync` has no test script yet — Task 5 adds one.
- **Package manager:** pnpm only. Never run `npm install` in this repo.
- **Migrations are applied BY HAND to prod.** There is no migration runner. `ghl-sync/migrations/*.sql` and `auth/migrations/*.sql` are numbered sequentially; next free numbers are `014`, `015` (ghl-sync) and `111` (auth).
- **Supabase upserts must send WHOLE rows.** A partial upsert always fails the NOT NULL columns.
- **Every new table gets `ALTER TABLE <t> ENABLE ROW LEVEL SECURITY;` with no policy** — portal DB access is 100% service-role.
- **Sync log table is `ghl_sync_log`** (via `writeSyncLog` in `ghl-sync/src/sync/syncLog.js`), not `sync_run_log`.
- **Report registration has three points**, all required: `ReportingView.jsx` (catalog + group + render branch), `portal/src/config/portalTiles.js`, and a `permission_catalog` + `role_tool_visibility` migration.
- **Dark backdrop:** every content block wraps in a `bg-surface rounded-xl border border-border` card.
- **Omit empty rows:** templates and campaigns with zero sends in range are excluded entirely — never render a "no data" row.
- **No em-dashes in user-facing copy.**
- **Do not merge.** Open a PR and stop.

---

## File Structure

**ghl-sync — new**
- `src/sync/emailSnapshotDiff.js` — pure period-diff math over cumulative snapshots.
- `src/db/upsertEmailStatsDaily.js` — whole-row batch upsert into `email_stats_daily`.
- `src/sms/templateKey.js` — pure body normalization and fingerprint.
- `src/sms/replyAttribution.js` — pure reply/opt-out attribution over one contact's messages.
- `src/db/upsertSmsMessages.js` — batch upsert into `ghl_sms_messages`, `sms_templates`, `sms_replies`.
- `src/sync/smsStatsSync.js` — the per-location conversation walk and orchestration.
- `scripts/backfillSmsMessages.js` — one-time 180-day backfill.
- `migrations/014_email_stats_daily.sql`, `migrations/015_sms_messages.sql`

**ghl-sync — modified**
- `src/ghl/conversations.js` — export `fetchAllMessages` and add `searchConversations`.
- `src/sync/emailStatsSync.js` — also write a daily snapshot.
- `src/index.js`, `src/scheduler.js` — wire the SMS sync.
- `package.json` — add a `test` script.

**auth — new**
- `src/routes/smsMarketing.js`
- `migrations/111_marketing_engagement_grant.sql`

**auth — modified**
- `src/routes/emailMarketing.js` — add `/automations`, scope `/campaigns` to real campaigns.
- `src/index.js` — mount `/sms-marketing`.

**portal — new**
- `src/components/reports/SmsMarketingReport.jsx`
- `src/components/reports/MarketingEngagementReport.jsx` — Email/SMS tab shell.

**portal — modified**
- `src/components/reports/EmailMarketingReport.jsx` — add the Automations table.
- `src/lib/api.js`, `src/components/ReportingView.jsx`, `src/config/portalTiles.js`

---

### Task 1: Email snapshot period diff

The pure math that turns two cumulative snapshots into a period figure. No I/O, no Supabase.

**Files:**
- Create: `ghl-sync/src/sync/emailSnapshotDiff.js`
- Test: `ghl-sync/src/sync/emailSnapshotDiff.test.js`

**Interfaces:**
- Consumes: nothing.
- Produces:
  - `COUNTER_FIELDS` — `string[]`, the cumulative counter column names.
  - `diffSnapshots(latest, baseline)` → `{ ...counters, is_lifetime: boolean }`. `latest` and `baseline` are snapshot row objects (or `null`). Returns `null` when `latest` is null.
  - `computeRates(counters)` → `{ open_rate, click_rate, reply_rate, unsubscribe_rate, bounce_rate }`, numbers rounded to 2dp.

- [ ] **Step 1: Write the failing test**

Create `ghl-sync/src/sync/emailSnapshotDiff.test.js`:

```js
const test = require('node:test')
const assert = require('node:assert')
const { diffSnapshots, computeRates, COUNTER_FIELDS } = require('./emailSnapshotDiff')

// A full snapshot row: every counter present, overridden by `over`.
const snap = (over = {}) =>
  Object.assign(Object.fromEntries(COUNTER_FIELDS.map(f => [f, 0])), over)

test('diffSnapshots: subtracts the baseline from the latest', () => {
  const out = diffSnapshots(snap({ sent: 100, delivered: 98, opened: 30 }), snap({ sent: 60, delivered: 59, opened: 18 }))
  assert.strictEqual(out.sent, 40)
  assert.strictEqual(out.delivered, 39)
  assert.strictEqual(out.opened, 12)
  assert.strictEqual(out.is_lifetime, false)
})

test('diffSnapshots: no baseline returns lifetime totals flagged as such', () => {
  const out = diffSnapshots(snap({ sent: 100, opened: 30 }), null)
  assert.strictEqual(out.sent, 100)
  assert.strictEqual(out.opened, 30)
  assert.strictEqual(out.is_lifetime, true)
})

test('diffSnapshots: a restated (negative) counter clamps to zero', () => {
  const out = diffSnapshots(snap({ sent: 50 }), snap({ sent: 80 }))
  assert.strictEqual(out.sent, 0)
})

test('diffSnapshots: null latest returns null', () => {
  assert.strictEqual(diffSnapshots(null, snap({ sent: 5 })), null)
})

test('diffSnapshots: missing counters are treated as zero', () => {
  const out = diffSnapshots({ sent: 10 }, {})
  assert.strictEqual(out.sent, 10)
  assert.strictEqual(out.opened, 0)
})

test('computeRates: opens/clicks/replies over delivered, bounces over sent', () => {
  const r = computeRates({ sent: 100, delivered: 80, opened: 20, clicked: 8, replied: 4, unsubscribed: 2, permanent_fail: 3, temporary_fail: 2 })
  assert.strictEqual(r.open_rate, 25)
  assert.strictEqual(r.click_rate, 10)
  assert.strictEqual(r.reply_rate, 5)
  assert.strictEqual(r.unsubscribe_rate, 2.5)
  assert.strictEqual(r.bounce_rate, 5)
})

test('computeRates: zero denominators yield zero, never NaN', () => {
  const r = computeRates({ sent: 0, delivered: 0, opened: 0 })
  assert.strictEqual(r.open_rate, 0)
  assert.strictEqual(r.bounce_rate, 0)
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd ghl-sync && node --test src/sync/emailSnapshotDiff.test.js`
Expected: FAIL, cannot find module `./emailSnapshotDiff`.

- [ ] **Step 3: Write the implementation**

Create `ghl-sync/src/sync/emailSnapshotDiff.js`:

```js
// Pure period math for workflow email stats.
//
// GHL's workflow-campaign stats endpoint returns LIFETIME cumulative counters
// with no date dimension, so "opens in July" is only obtainable by snapshotting
// the counters daily and subtracting. This module is that subtraction, kept
// free of I/O so it can be tested directly.

const COUNTER_FIELDS = [
  'sent', 'accepted', 'delivered', 'opened', 'clicked', 'unsubscribed',
  'complained', 'permanent_fail', 'temporary_fail', 'rejected', 'failed', 'replied',
]

const num = v => {
  const n = Number(v)
  return Number.isFinite(n) ? n : 0
}

// latest - baseline, clamped at 0. A null baseline means we have no snapshot
// from before the range, so the only honest answer is the lifetime total —
// flagged with is_lifetime so the UI can say so rather than imply a period.
function diffSnapshots(latest, baseline) {
  if (!latest) return null
  const out = { is_lifetime: !baseline }
  for (const f of COUNTER_FIELDS) {
    const d = num(latest[f]) - (baseline ? num(baseline[f]) : 0)
    // GHL occasionally restates a counter downward; a negative period is not a
    // real reading, so floor it and let the caller log.
    out[f] = d > 0 ? d : 0
  }
  return out
}

const pct = (n, d) => (d > 0 ? +((n / d) * 100).toFixed(2) : 0)

// Rates are recomputed from the diffed counters rather than carried over from
// GHL's precomputed lifetime rates, which are meaningless for a period.
// Denominator matches GHL's own math: delivered for engagement, sent for bounce.
function computeRates(c) {
  const delivered = num(c.delivered)
  const sent = num(c.sent)
  const bounced = num(c.permanent_fail) + num(c.temporary_fail)
  return {
    open_rate: pct(num(c.opened), delivered),
    click_rate: pct(num(c.clicked), delivered),
    reply_rate: pct(num(c.replied), delivered),
    unsubscribe_rate: pct(num(c.unsubscribed), delivered),
    bounce_rate: pct(bounced, sent),
  }
}

module.exports = { COUNTER_FIELDS, diffSnapshots, computeRates }
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd ghl-sync && node --test src/sync/emailSnapshotDiff.test.js`
Expected: PASS, 7 tests.

- [ ] **Step 5: Commit**

```bash
git add ghl-sync/src/sync/emailSnapshotDiff.js ghl-sync/src/sync/emailSnapshotDiff.test.js
git commit -m "feat(ghl-sync): pure period-diff math for cumulative email snapshots"
```

---

### Task 2: Email snapshot table and write path

**Files:**
- Create: `ghl-sync/migrations/014_email_stats_daily.sql`
- Create: `ghl-sync/src/db/upsertEmailStatsDaily.js`
- Modify: `ghl-sync/src/sync/emailStatsSync.js`

**Interfaces:**
- Consumes: `COUNTER_FIELDS` from Task 1; `transformRow` from `ghl-sync/src/ghl/emailCampaigns.js`.
- Produces: `upsertEmailStatsDaily(rows)` → `{ upserted: number, errors: Array }`, and `snapshotRow(statsRow, snapshotDate)` → a whole `email_stats_daily` row object.

- [ ] **Step 1: Write the migration**

Create `ghl-sync/migrations/014_email_stats_daily.sql`:

```sql
-- Daily cumulative snapshots of GHL email campaign stats.
--
-- Why this exists: GHL's workflow-campaign stats endpoint returns LIFETIME
-- totals with no date dimension. email_stats holds the current lifetime value
-- and is overwritten each sync, so a date range over it is impossible for
-- workflows. This table keeps one frozen copy per campaign per day; a period
-- figure is (snapshot on/before end) - (snapshot before start).
--
-- Written by src/sync/emailStatsSync.js alongside the email_stats upsert.
-- Re-running the sync on the same day overwrites that day's row, so the last
-- run of the day wins. Counters only, no rates: rates are recomputed from the
-- diffed counters (a lifetime rate is meaningless for a period).
CREATE TABLE IF NOT EXISTS email_stats_daily (
  location        TEXT NOT NULL,   -- location slug (e.g. 'springfield')
  source          TEXT NOT NULL,   -- email-campaigns | bulk-actions | workflow-campaigns
  source_id       TEXT NOT NULL,   -- GHL sourceId
  snapshot_date   DATE NOT NULL,   -- UTC date the snapshot was taken
  name            TEXT,
  subject         TEXT,
  sent            INTEGER NOT NULL DEFAULT 0,
  accepted        INTEGER NOT NULL DEFAULT 0,
  delivered       INTEGER NOT NULL DEFAULT 0,
  opened          INTEGER NOT NULL DEFAULT 0,
  clicked         INTEGER NOT NULL DEFAULT 0,
  unsubscribed    INTEGER NOT NULL DEFAULT 0,
  complained      INTEGER NOT NULL DEFAULT 0,
  permanent_fail  INTEGER NOT NULL DEFAULT 0,
  temporary_fail  INTEGER NOT NULL DEFAULT 0,
  rejected        INTEGER NOT NULL DEFAULT 0,
  failed          INTEGER NOT NULL DEFAULT 0,
  replied         INTEGER NOT NULL DEFAULT 0,
  synced_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (location, source_id, snapshot_date)
);

-- The report reads "latest snapshot on or before date X" per campaign, so the
-- descending date order is the hot path.
CREATE INDEX IF NOT EXISTS idx_email_stats_daily_lookup
  ON email_stats_daily (location, source, source_id, snapshot_date DESC);

-- Portal DB access is 100% service-role; enable RLS (no policy) on every table.
ALTER TABLE email_stats_daily ENABLE ROW LEVEL SECURITY;
```

- [ ] **Step 2: Write the upsert module**

Create `ghl-sync/src/db/upsertEmailStatsDaily.js`:

```js
const supabase = require('./supabase');
const { COUNTER_FIELDS } = require('../sync/emailSnapshotDiff');

const BATCH_SIZE = 500;

// Build a WHOLE email_stats_daily row from an email_stats row. Whole rows only:
// a partial upsert always fails the NOT NULL counter columns.
function snapshotRow(statsRow, snapshotDate) {
  const row = {
    location: statsRow.location,
    source: statsRow.source,
    source_id: statsRow.source_id,
    snapshot_date: snapshotDate,
    name: statsRow.name || null,
    subject: statsRow.subject || null,
    synced_at: new Date().toISOString(),
  };
  for (const f of COUNTER_FIELDS) {
    const n = Number(statsRow[f]);
    row[f] = Number.isFinite(n) ? n : 0;
  }
  return row;
}

// Upsert snapshots, conflict target (location, source_id, snapshot_date) so a
// second run the same day overwrites rather than duplicating.
async function upsertEmailStatsDaily(rows) {
  let upserted = 0;
  const errors = [];

  const seen = new Map();
  for (const r of rows) {
    if (!r.source_id || !r.snapshot_date) continue;
    seen.set(`${r.location}|${r.source_id}|${r.snapshot_date}`, r); // last wins
  }
  const deduped = Array.from(seen.values());

  for (let i = 0; i < deduped.length; i += BATCH_SIZE) {
    const batch = deduped.slice(i, i + BATCH_SIZE);
    const { error, count } = await supabase
      .from('email_stats_daily')
      .upsert(batch, { onConflict: 'location,source_id,snapshot_date', count: 'exact' });

    if (error) {
      console.error('[DB] email_stats_daily upsert batch error:', error.message);
      errors.push({ batch: Math.floor(i / BATCH_SIZE), error: error.message });
    } else {
      upserted += count || batch.length;
    }
  }

  return { upserted, errors };
}

module.exports = { upsertEmailStatsDaily, snapshotRow };
```

- [ ] **Step 3: Wire the snapshot into the existing sync**

In `ghl-sync/src/sync/emailStatsSync.js`, add to the imports at the top:

```js
const { upsertEmailStatsDaily, snapshotRow } = require('../db/upsertEmailStatsDaily');
```

Then replace this line inside `emailStatsSyncForLocation`:

```js
  const { upserted, errors } = rows.length ? await upsertEmailStats(rows) : { upserted: 0, errors: [] };
```

with:

```js
  const { upserted, errors } = rows.length ? await upsertEmailStats(rows) : { upserted: 0, errors: [] };

  // Freeze today's cumulative counters so period figures are derivable later.
  // Snapshot failures are logged but never fail the run: email_stats (the
  // live view) is the primary write, this is the history feed.
  const snapshotDate = new Date().toISOString().slice(0, 10);
  const snapshots = rows.map(r => snapshotRow(r, snapshotDate));
  const snap = snapshots.length
    ? await upsertEmailStatsDaily(snapshots)
    : { upserted: 0, errors: [] };
  if (snap.errors.length) {
    console.warn(`[EmailStats] ${loc.name}: ${snap.errors.length} snapshot batch error(s)`);
  }
```

And extend the `writeSyncLog` call's `errors` array in the same function from:

```js
    errors: [...errors, ...skipped],
```

to:

```js
    errors: [...errors, ...snap.errors, ...skipped],
```

- [ ] **Step 4: Verify the module loads and the row shape is whole**

Run:

```bash
cd ghl-sync && node -e "const {snapshotRow}=require('./src/db/upsertEmailStatsDaily');const r=snapshotRow({location:'salem',source:'workflow-campaigns',source_id:'abc',name:'n',sent:5},'2026-08-19');console.log(Object.keys(r).length, r.sent, r.opened, r.snapshot_date)"
```

Expected: `19 5 0 2026-08-19` — every counter present (no undefined), so the upsert cannot trip a NOT NULL.

- [ ] **Step 5: Commit**

```bash
git add ghl-sync/migrations/014_email_stats_daily.sql ghl-sync/src/db/upsertEmailStatsDaily.js ghl-sync/src/sync/emailStatsSync.js
git commit -m "feat(ghl-sync): snapshot cumulative email stats daily"
```

---

### Task 3: Automations endpoint

**Files:**
- Modify: `auth/src/routes/emailMarketing.js`
- Modify: `portal/src/lib/api.js:966-970`

**Interfaces:**
- Consumes: `email_stats_daily` from Task 2.
- Produces: `GET /email-marketing/automations?location_slug=&start_date=&end_date=` → `{ automations, totals, baseline_date }`, and `getEmailMarketingAutomations(params)` in the portal API client.

Each `automations` entry: `{ location, source_id, name, subject, sent, delivered, opened, clicked, replied, unsubscribed, bounced, open_rate, click_rate, reply_rate, unsubscribe_rate, bounce_rate, is_lifetime }`.

- [ ] **Step 1: Create the shared math module first**

The math lives in `ghl-sync`, which `auth` cannot require across package roots, so `auth` gets a local copy. Create it before the route references it. Create `auth/src/routes/emailAutomationMath.js`:

```js
// Period math for cumulative workflow email snapshots.
//
// Mirrors ghl-sync/src/sync/emailSnapshotDiff.js. The two packages have
// separate dependency roots and cannot require across them, so this is a
// deliberate duplicate. Change both together.

const COUNTER_FIELDS = [
  'sent', 'accepted', 'delivered', 'opened', 'clicked', 'unsubscribed',
  'complained', 'permanent_fail', 'temporary_fail', 'rejected', 'failed', 'replied',
]

const num = v => {
  const n = Number(v)
  return Number.isFinite(n) ? n : 0
}

function diffSnapshots(latest, baseline) {
  if (!latest) return null
  const out = { is_lifetime: !baseline }
  for (const f of COUNTER_FIELDS) {
    const d = num(latest[f]) - (baseline ? num(baseline[f]) : 0)
    out[f] = d > 0 ? d : 0
  }
  return out
}

const pct = (n, d) => (d > 0 ? +((n / d) * 100).toFixed(2) : 0)

function computeRates(c) {
  const delivered = num(c.delivered)
  const sent = num(c.sent)
  const bounced = num(c.permanent_fail) + num(c.temporary_fail)
  return {
    open_rate: pct(num(c.opened), delivered),
    click_rate: pct(num(c.clicked), delivered),
    reply_rate: pct(num(c.replied), delivered),
    unsubscribe_rate: pct(num(c.unsubscribed), delivered),
    bounce_rate: pct(bounced, sent),
  }
}

module.exports = { COUNTER_FIELDS, diffSnapshots, computeRates }
```

- [ ] **Step 2: Scope /campaigns to real campaigns**

In `auth/src/routes/emailMarketing.js`, inside the `/campaigns` handler, immediately after the `.order(...)` call, add:

```js
      // One-time sends only. Workflow rows are evergreen automations with a
      // null completed_at, so the date filter below would silently drop them —
      // they get their own endpoint with real period math instead.
      .in('source', ['bulk-actions', 'email-campaigns'])
```

- [ ] **Step 3: Add the automations handler**

In the same file, add above `module.exports = router`:

```js
const { diffSnapshots, computeRates } = require('./emailAutomationMath')

// GET /email-marketing/automations?location_slug=&start_date=&end_date=
//
// Workflow email performance over a real date range. GHL only exposes LIFETIME
// counters per workflow, so the period figure is the difference between the
// last snapshot in the range and the last snapshot before it. When no snapshot
// predates the range (we started snapshotting after start_date), the row is
// returned as a lifetime total flagged is_lifetime rather than a made-up
// period number.
router.get('/automations', async (req, res) => {
  const { location_slug, start_date, end_date } = req.query
  try {
    let q = supabaseAdmin
      .from('email_stats_daily')
      .select('location, source_id, name, subject, snapshot_date, sent, accepted, delivered, opened, clicked, unsubscribed, complained, permanent_fail, temporary_fail, rejected, failed, replied')
      .eq('source', 'workflow-campaigns')
      .order('snapshot_date', { ascending: true })

    if (location_slug) q = q.eq('location', location_slug)
    if (end_date) q = q.lte('snapshot_date', end_date)

    const { data, error } = await q
    if (error) throw error

    // Per campaign: the last snapshot at or before end_date is the "latest";
    // the last one strictly before start_date is the baseline. Rows arrive in
    // ascending date order, so a single pass keeps the newest of each.
    const byCampaign = new Map()
    let baselineDate = null
    for (const row of data || []) {
      const k = `${row.location}|${row.source_id}`
      const entry = byCampaign.get(k) || { latest: null, baseline: null, meta: row }
      entry.latest = row
      if (start_date && row.snapshot_date < start_date) {
        entry.baseline = row
        if (!baselineDate || row.snapshot_date > baselineDate) baselineDate = row.snapshot_date
      }
      entry.meta = row
      byCampaign.set(k, entry)
    }

    const automations = []
    for (const [, { latest, baseline, meta }] of byCampaign) {
      const counters = diffSnapshots(latest, baseline)
      if (!counters) continue
      if (!counters.sent) continue // omit automations with no sends in range
      automations.push({
        location: meta.location,
        source_id: meta.source_id,
        name: meta.name,
        subject: meta.subject,
        sent: counters.sent,
        delivered: counters.delivered,
        opened: counters.opened,
        clicked: counters.clicked,
        replied: counters.replied,
        unsubscribed: counters.unsubscribed,
        bounced: counters.permanent_fail + counters.temporary_fail,
        is_lifetime: counters.is_lifetime,
        ...computeRates(counters),
      })
    }
    automations.sort((a, b) => b.sent - a.sent)

    const t = automations.reduce((a, c) => {
      a.automations += 1
      a.sent += c.sent; a.delivered += c.delivered; a.opened += c.opened
      a.clicked += c.clicked; a.replied += c.replied
      a.unsubscribed += c.unsubscribed; a.bounced += c.bounced
      return a
    }, { automations: 0, sent: 0, delivered: 0, opened: 0, clicked: 0, replied: 0, unsubscribed: 0, bounced: 0 })

    res.json({
      automations,
      totals: { ...t, ...computeRates({ ...t, permanent_fail: t.bounced, temporary_fail: 0 }) },
      baseline_date: baselineDate,
    })
  } catch (err) {
    console.error('[Email Marketing] automations error:', err.message)
    res.status(500).json({ error: err.message })
  }
})
```

- [ ] **Step 4: Add the portal API wrapper**

In `portal/src/lib/api.js`, directly below `getEmailMarketingCampaigns`, add:

```js
// Workflow email performance over a date range, derived from daily snapshots.
export async function getEmailMarketingAutomations(params = {}) {
  const qs = new URLSearchParams(params).toString()
  return api('/email-marketing/automations' + (qs ? '?' + qs : ''))
}
```

- [ ] **Step 5: Verify auth still boots and the math module loads**

Run:

```bash
cd auth && node -e "require('./src/routes/emailAutomationMath');require('./src/routes/emailMarketing');console.log('routes load OK')"
```

Expected: `routes load OK`.

- [ ] **Step 6: Commit**

```bash
git add auth/src/routes/emailMarketing.js auth/src/routes/emailAutomationMath.js portal/src/lib/api.js
git commit -m "feat(auth): workflow email automations endpoint with period diffs"
```

---

### Task 4: Automations table in the Email report

**Files:**
- Modify: `portal/src/components/reports/EmailMarketingReport.jsx`

**Interfaces:**
- Consumes: `getEmailMarketingAutomations` from Task 3.
- Produces: nothing new; the existing default export gains a second table.

- [ ] **Step 1: Fetch automations alongside campaigns**

In `EmailMarketingReport.jsx`, add to the imports:

```js
import { getEmailMarketingCampaigns, getEmailMarketingAutomations } from '../../lib/api'
```

(replacing the existing single-name import), and add state beside the existing `data` state inside the component:

```js
  const [autoData, setAutoData] = useState(null)
```

Then, immediately after the existing `useEffect` that loads campaigns, add:

```js
  // Automations load independently: a failure here must not blank the
  // Campaigns table, which is the part that has always worked.
  useEffect(() => {
    let ignore = false
    getEmailMarketingAutomations(params)
      .then(d => { if (!ignore) setAutoData(d) })
      .catch(() => { if (!ignore) setAutoData(null) })
    return () => { ignore = true }
  }, [params])
```

- [ ] **Step 2: Render the Automations card**

Add this component above the default export:

```js
// Evergreen workflow emails. GHL only reports lifetime totals per workflow, so
// these figures come from diffing daily snapshots; a row with no snapshot from
// before the range shows its lifetime total, labelled as such.
function AutomationsTable({ data }) {
  const rows = data?.automations || []
  if (!rows.length) return null
  const anyLifetime = rows.some(r => r.is_lifetime)

  return (
    <div className="bg-surface rounded-xl border border-border overflow-hidden">
      <div className="px-4 py-3 border-b border-border flex items-center justify-between gap-3 flex-wrap">
        <div>
          <h3 className="font-bold text-text-primary">Automations</h3>
          <p className="text-xs text-text-muted">Workflow emails, performance within the selected range</p>
        </div>
        {anyLifetime && (
          <span className="text-xs px-2 py-1 rounded-md bg-amber-500/15 text-amber-500 font-semibold">
            Lifetime to date — not enough snapshot history for this range yet
          </span>
        )}
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="text-xs uppercase tracking-wide text-text-muted border-b border-border">
            <tr>
              <th className="py-2.5 px-4 text-left">Workflow</th>
              <th className="py-2.5 px-2 text-right">Sent</th>
              <th className="py-2.5 px-2 text-right">Delivered</th>
              <th className="py-2.5 px-2 text-right">Opened</th>
              <th className="py-2.5 px-2 text-right">Open %</th>
              <th className="py-2.5 px-2 text-right">Clicked</th>
              <th className="py-2.5 px-2 text-right">Click %</th>
              <th className="py-2.5 px-2 text-right">Bounced</th>
            </tr>
          </thead>
          <tbody>
            {rows.map(r => (
              <tr key={`${r.location}|${r.source_id}`} className="border-b border-border/50 last:border-0">
                <td className="py-2.5 px-4 text-text-primary">
                  {r.name || '—'}
                  {r.is_lifetime && <span className="ml-2 text-xs text-text-muted">(lifetime)</span>}
                </td>
                <td className="py-2.5 px-2 text-right text-text-primary">{fmtInt(r.sent)}</td>
                <td className="py-2.5 px-2 text-right text-text-primary">{fmtInt(r.delivered)}</td>
                <td className="py-2.5 px-2 text-right text-text-primary">{fmtInt(r.opened)}</td>
                <td className="py-2.5 px-2 text-right font-semibold text-text-primary">{fmtPct(r.open_rate)}</td>
                <td className="py-2.5 px-2 text-right text-text-primary">{fmtInt(r.clicked)}</td>
                <td className="py-2.5 px-2 text-right font-semibold text-text-primary">{fmtPct(r.click_rate)}</td>
                <td className="py-2.5 px-2 text-right text-text-primary">{fmtInt(r.bounced)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}
```

Then render it inside the component's returned JSX, immediately after the existing campaigns table block, wrapped so the two cards stack:

```jsx
      <AutomationsTable data={autoData} />
```

- [ ] **Step 3: Verify the portal builds**

Run: `cd portal && pnpm build`
Expected: build succeeds with no unresolved import or JSX errors.

- [ ] **Step 4: Commit**

```bash
git add portal/src/components/reports/EmailMarketingReport.jsx
git commit -m "feat(portal): show workflow email automations in the Email report"
```

---

### Task 5: SMS template fingerprint

**Files:**
- Create: `ghl-sync/src/sms/templateKey.js`
- Test: `ghl-sync/src/sms/templateKey.test.js`
- Modify: `ghl-sync/package.json`

**Interfaces:**
- Consumes: nothing.
- Produces: `normalizeBody(body)` → `string`, and `templateKey(body)` → 16-char hex `string` (or `null` for an empty body).

- [ ] **Step 1: Add a test script to ghl-sync**

In `ghl-sync/package.json`, add to `scripts`:

```json
    "test": "node --test src/",
```

so the block reads:

```json
  "scripts": {
    "start": "node src/index.js",
    "dev": "node --watch src/index.js",
    "test": "node --test src/"
  },
```

- [ ] **Step 2: Write the failing test**

Create `ghl-sync/src/sms/templateKey.test.js`:

```js
const test = require('node:test')
const assert = require('node:assert')
const { templateKey, normalizeBody } = require('./templateKey')

// GHL gives no workflow id on a message, so the message body IS the only
// identity an automated text has. These cases pin the normalization that makes
// two sends of the same template collide and two different templates not.

test('same template with different merged first names collides', () => {
  const a = 'Hi Shaun!\n\nWelcome to your free week at West Coast Strength.'
  const b = 'Hi Marcia!\n\nWelcome to your free week at West Coast Strength.'
  assert.strictEqual(templateKey(a), templateKey(b))
})

test('different templates do not collide', () => {
  const a = 'Hi Shaun! Welcome to your free week at West Coast Strength.'
  const b = 'Hi Shaun! Your trial expires tomorrow, want to lock in a rate?'
  assert.notStrictEqual(templateKey(a), templateKey(b))
})

test('differing short links in the same template collide', () => {
  const a = 'Book your tour here: https://link.wcs.com/a1b2c3'
  const b = 'Book your tour here: https://link.wcs.com/z9y8x7'
  assert.strictEqual(templateKey(a), templateKey(b))
})

test('differing phone numbers and digits in the same template collide', () => {
  const a = 'Call us at 503-555-0142 to confirm your 9:00 session'
  const b = 'Call us at 541-555-9987 to confirm your 6:30 session'
  assert.strictEqual(templateKey(a), templateKey(b))
})

test('greeting variants are not force-merged into one template', () => {
  const a = 'Hey Shaun! Your trial expires tomorrow.'
  const b = 'Hi Shaun! Your trial expires tomorrow.'
  assert.notStrictEqual(templateKey(a), templateKey(b))
})

test('punctuation and whitespace noise collapses', () => {
  assert.strictEqual(templateKey('Hi  Shaun!!   See   you soon.'), templateKey('Hi Shaun! See you soon.'))
})

test('empty or missing body yields null', () => {
  assert.strictEqual(templateKey(''), null)
  assert.strictEqual(templateKey(null), null)
  assert.strictEqual(templateKey('   '), null)
})

test('key is 16 hex characters and stable across calls', () => {
  const k = templateKey('Hi Shaun! Welcome aboard.')
  assert.match(k, /^[0-9a-f]{16}$/)
  assert.strictEqual(k, templateKey('Hi Shaun! Welcome aboard.'))
})

test('normalizeBody strips the merged name but keeps the greeting word', () => {
  assert.strictEqual(normalizeBody('Hi Shaun! Welcome aboard.'), 'hi welcome aboard')
})

test('bodies differing only past 160 normalized characters collide', () => {
  const base = 'x'.repeat(200)
  assert.strictEqual(templateKey(base + 'aaa'), templateKey(base + 'bbb'))
})
```

- [ ] **Step 3: Run test to verify it fails**

Run: `cd ghl-sync && node --test src/sms/templateKey.test.js`
Expected: FAIL, cannot find module `./templateKey`.

- [ ] **Step 4: Write the implementation**

Create `ghl-sync/src/sms/templateKey.js`:

```js
const crypto = require('node:crypto');

// Identity for an automated SMS.
//
// GHL puts no workflow id or name on a message (verified 2026-08-19), so the
// body text is the only thing distinguishing one automation's text from
// another's. This normalizes away the per-recipient parts — merged first name,
// tracking links, phone numbers, times, whitespace — so every send of one
// template hashes to the same key.
//
// A copy edit produces a NEW key by design. sms_templates.label exists so an
// edited template can be given the same human label and stay grouped.

const MAX_CHARS = 160;

function normalizeBody(body) {
  if (typeof body !== 'string') return '';
  let s = body.toLowerCase();

  // Links first: a tracking short link differs per recipient.
  s = s.replace(/https?:\/\/\S+/g, ' ');

  // A leading greeting carries the merged first name. Keep the greeting word
  // (so "hey" and "hi" variants of a template stay distinct, which matches how
  // staff actually author them) and drop the token after it.
  s = s.replace(/^\s*(hi|hey|hello)\b[\s,!]+\S+/, '$1 ');

  // Every digit run: phone numbers, times, dollar amounts, session counts.
  s = s.replace(/\d+/g, ' ');

  // Collapse all punctuation and whitespace to single spaces.
  s = s.replace(/[^a-z\s]/g, ' ').replace(/\s+/g, ' ').trim();

  return s.slice(0, MAX_CHARS);
}

function templateKey(body) {
  const norm = normalizeBody(body);
  if (!norm) return null;
  return crypto.createHash('sha256').update(norm).digest('hex').slice(0, 16);
}

module.exports = { normalizeBody, templateKey, MAX_CHARS };
```

- [ ] **Step 5: Run test to verify it passes**

Run: `cd ghl-sync && node --test src/sms/templateKey.test.js`
Expected: PASS, 10 tests.

- [ ] **Step 6: Commit**

```bash
git add ghl-sync/src/sms/templateKey.js ghl-sync/src/sms/templateKey.test.js ghl-sync/package.json
git commit -m "feat(ghl-sync): SMS template fingerprint from normalized message body"
```

---

### Task 6: Reply attribution

Pure logic: given one contact's SMS messages, decide which outbound send each inbound message is replying to.

**Files:**
- Create: `ghl-sync/src/sms/replyAttribution.js`
- Test: `ghl-sync/src/sms/replyAttribution.test.js`

**Interfaces:**
- Consumes: nothing.
- Produces:
  - `DEFAULT_WINDOW_HOURS` — `number` (72).
  - `isOptOut(body)` → `boolean`.
  - `attributeReplies(messages, { windowHours })` → `Array<{ inbound_id, send_id, reply_minutes, is_opt_out }>`. `messages` is one contact's SMS rows, each `{ id, direction, body, date_added }`, any order.

- [ ] **Step 1: Write the failing test**

Create `ghl-sync/src/sms/replyAttribution.test.js`:

```js
const test = require('node:test')
const assert = require('node:assert')
const { attributeReplies, isOptOut, DEFAULT_WINDOW_HOURS } = require('./replyAttribution')

const at = (h) => new Date(Date.UTC(2026, 7, 19, h, 0, 0)).toISOString()
const out = (id, h) => ({ id, direction: 'outbound', body: 'Hi there!', date_added: at(h) })
const inb = (id, h, body = 'yes please') => ({ id, direction: 'inbound', body, date_added: at(h) })

test('an inbound message is credited to the outbound send before it', () => {
  const r = attributeReplies([out('s1', 1), inb('i1', 3)], {})
  assert.deepStrictEqual(r, [{ inbound_id: 'i1', send_id: 's1', reply_minutes: 120, is_opt_out: false }])
})

test('an inbound outside the window is not attributed', () => {
  const r = attributeReplies([out('s1', 0), inb('i1', 80)], { windowHours: 72 })
  assert.deepStrictEqual(r, [])
})

test('the NEAREST preceding send wins, not the first', () => {
  const r = attributeReplies([out('s1', 1), out('s2', 4), inb('i1', 5)], {})
  assert.strictEqual(r[0].send_id, 's2')
  assert.strictEqual(r[0].reply_minutes, 60)
})

test('two inbounds after one send both attribute to it', () => {
  const r = attributeReplies([out('s1', 1), inb('i1', 2), inb('i2', 3)], {})
  assert.strictEqual(r.length, 2)
  assert.ok(r.every(x => x.send_id === 's1'))
})

test('an inbound with no preceding outbound is ignored', () => {
  assert.deepStrictEqual(attributeReplies([inb('i1', 2), out('s1', 5)], {}), [])
})

test('input order does not matter', () => {
  const a = attributeReplies([inb('i1', 5), out('s2', 4), out('s1', 1)], {})
  const b = attributeReplies([out('s1', 1), out('s2', 4), inb('i1', 5)], {})
  assert.deepStrictEqual(a, b)
})

test('opt-out replies are attributed and flagged', () => {
  const r = attributeReplies([out('s1', 1), inb('i1', 2, 'STOP')], {})
  assert.strictEqual(r[0].is_opt_out, true)
})

test('messages with unusable timestamps are skipped', () => {
  const r = attributeReplies([out('s1', 1), { id: 'i1', direction: 'inbound', body: 'hi', date_added: 'nonsense' }], {})
  assert.deepStrictEqual(r, [])
})

test('isOptOut matches the standard carrier keywords, case-insensitively', () => {
  for (const w of ['STOP', 'stop', ' Stop ', 'STOPALL', 'unsubscribe', 'Cancel', 'end', 'QUIT']) {
    assert.strictEqual(isOptOut(w), true, w)
  }
})

test('isOptOut does not fire on the keyword inside a sentence', () => {
  assert.strictEqual(isOptOut('I cannot stop thinking about leg day'), false)
  assert.strictEqual(isOptOut(''), false)
  assert.strictEqual(isOptOut(null), false)
})

test('the default window is 72 hours', () => {
  assert.strictEqual(DEFAULT_WINDOW_HOURS, 72)
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd ghl-sync && node --test src/sms/replyAttribution.test.js`
Expected: FAIL, cannot find module `./replyAttribution`.

- [ ] **Step 3: Write the implementation**

Create `ghl-sync/src/sms/replyAttribution.js`:

```js
// Which automated text did this reply answer?
//
// GHL threads everything into one conversation per contact with no reply
// linkage, so attribution is positional: an inbound SMS answers the most recent
// outbound SMS that preceded it, provided it landed inside the window. Two
// replies to one send count as one replied send (the caller dedupes on
// send_id); the rows here are per inbound message.
//
// Pure and I/O-free so the rules above are directly testable.

const DEFAULT_WINDOW_HOURS = 72;

// Standard carrier opt-out keywords, as a WHOLE message. Matching the keyword
// anywhere would flag "I cannot stop thinking about leg day" as an opt-out.
const OPT_OUT_RE = /^\s*(stop|stopall|unsubscribe|cancel|end|quit)\s*$/i;

function isOptOut(body) {
  return typeof body === 'string' && OPT_OUT_RE.test(body);
}

function attributeReplies(messages, { windowHours = DEFAULT_WINDOW_HOURS } = {}) {
  const windowMs = windowHours * 60 * 60 * 1000;

  // Parse once, drop anything without a usable timestamp, then walk forward in
  // time carrying the most recent outbound.
  const sorted = (messages || [])
    .map(m => ({ m, t: Date.parse(m?.date_added) }))
    .filter(x => Number.isFinite(x.t))
    .sort((a, b) => a.t - b.t);

  const out = [];
  let lastSend = null;

  for (const { m, t } of sorted) {
    if (m.direction === 'outbound') {
      lastSend = { id: m.id, t };
      continue;
    }
    if (m.direction !== 'inbound') continue;
    if (!lastSend) continue; // an inbound with nothing before it is not a reply

    const delta = t - lastSend.t;
    if (delta < 0 || delta > windowMs) continue;

    out.push({
      inbound_id: m.id,
      send_id: lastSend.id,
      reply_minutes: Math.round(delta / 60000),
      is_opt_out: isOptOut(m.body),
    });
  }

  return out;
}

module.exports = { DEFAULT_WINDOW_HOURS, isOptOut, attributeReplies };
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd ghl-sync && node --test src/sms/replyAttribution.test.js`
Expected: PASS, 11 tests.

- [ ] **Step 5: Commit**

```bash
git add ghl-sync/src/sms/replyAttribution.js ghl-sync/src/sms/replyAttribution.test.js
git commit -m "feat(ghl-sync): positional SMS reply and opt-out attribution"
```

---

### Task 7: SMS tables, aggregate function, and write path

**Files:**
- Create: `ghl-sync/migrations/015_sms_messages.sql`
- Create: `ghl-sync/src/db/upsertSmsMessages.js`

**Interfaces:**
- Consumes: `templateKey` (Task 5).
- Produces:
  - `upsertSmsMessages(rows)` → `{ upserted, errors }`
  - `upsertSmsTemplates(rows)` → `{ upserted, errors }`
  - `upsertSmsReplies(rows)` → `{ upserted, errors }`
  - `messageRow(msg, loc)` → a whole `ghl_sms_messages` row, or `null` when the message is not an SMS.
  - SQL function `sms_engagement_by_template(p_location text, p_start timestamptz, p_end timestamptz, p_kind text)`.

- [ ] **Step 1: Write the migration**

Create `ghl-sync/migrations/015_sms_messages.sql`:

```sql
-- SMS engagement: per-message store, template clustering, and reply linkage.
--
-- GHL puts no workflow id on a message, so an automated text's only identity is
-- its body. ghl_sms_messages.template_key is a fingerprint of the normalized
-- body (see src/sms/templateKey.js); sms_templates lets a human name a cluster.
-- sms_replies links an inbound message to the send it answered, computed at
-- sync time by src/sms/replyAttribution.js.
--
-- Populated by src/sync/smsStatsSync.js and scripts/backfillSmsMessages.js.

CREATE TABLE IF NOT EXISTS ghl_sms_messages (
  id               TEXT PRIMARY KEY,   -- GHL message id
  location         TEXT NOT NULL,      -- location slug
  location_id      TEXT NOT NULL,      -- GHL sub-account id
  conversation_id  TEXT NOT NULL,
  contact_id       TEXT,
  direction        TEXT NOT NULL,      -- inbound | outbound
  source           TEXT,               -- workflow | bulk_actions | app | null
  status           TEXT,               -- delivered | failed | undelivered | ...
  body             TEXT,
  template_key     TEXT,               -- outbound only; null for inbound
  date_added       TIMESTAMPTZ NOT NULL,
  synced_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_sms_messages_loc_date ON ghl_sms_messages (location, date_added DESC);
-- Attribution reloads one contact's window at a time.
CREATE INDEX IF NOT EXISTS idx_sms_messages_contact_date ON ghl_sms_messages (contact_id, date_added);
-- The report groups sends by template within a location and date range.
CREATE INDEX IF NOT EXISTS idx_sms_messages_template ON ghl_sms_messages (location, template_key, date_added DESC);

CREATE TABLE IF NOT EXISTS sms_templates (
  location       TEXT NOT NULL,
  template_key   TEXT NOT NULL,
  label          TEXT,                 -- human-assigned name, nullable
  sample_body    TEXT NOT NULL,        -- first body seen, for identification
  first_seen_at  TIMESTAMPTZ NOT NULL,
  last_seen_at   TIMESTAMPTZ NOT NULL,
  PRIMARY KEY (location, template_key)
);

CREATE TABLE IF NOT EXISTS sms_replies (
  inbound_id     TEXT PRIMARY KEY,     -- the inbound message that replied
  send_id        TEXT NOT NULL,        -- the outbound send it answered
  location       TEXT NOT NULL,
  reply_minutes  INTEGER NOT NULL,
  is_opt_out     BOOLEAN NOT NULL DEFAULT false,
  computed_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- One replied send may have several inbound rows; the report counts DISTINCT
-- send_id, so this index carries that grouping.
CREATE INDEX IF NOT EXISTS idx_sms_replies_send ON sms_replies (send_id);

ALTER TABLE ghl_sms_messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE sms_templates ENABLE ROW LEVEL SECURITY;
ALTER TABLE sms_replies ENABLE ROW LEVEL SECURITY;

-- Per-template engagement for one location and send-date range.
--
-- p_location: location slug, or NULL for all locations.
-- p_kind:     'automated' (workflow + bulk_actions), 'staff' (app), or 'all'.
--
-- The range filters the SEND date only. A reply that arrives after p_end still
-- counts, because the attribution window (not the report range) bounds what
-- counts as a reply.
CREATE OR REPLACE FUNCTION sms_engagement_by_template(
  p_location TEXT,
  p_start    TIMESTAMPTZ,
  p_end      TIMESTAMPTZ,
  p_kind     TEXT
)
RETURNS TABLE (
  location              TEXT,
  template_key          TEXT,
  label                 TEXT,
  sample_body           TEXT,
  sends                 BIGINT,
  delivered             BIGINT,
  failed                BIGINT,
  replies               BIGINT,
  opt_outs              BIGINT,
  median_reply_minutes  NUMERIC
)
LANGUAGE sql
STABLE
AS $$
  SELECT
    m.location,
    m.template_key,
    max(t.label)                                              AS label,
    max(t.sample_body)                                        AS sample_body,
    count(*)                                                  AS sends,
    count(*) FILTER (WHERE m.status = 'delivered')            AS delivered,
    count(*) FILTER (WHERE m.status IN ('failed','undelivered')) AS failed,
    count(DISTINCT r.send_id)                                 AS replies,
    count(DISTINCT r.send_id) FILTER (WHERE r.is_opt_out)     AS opt_outs,
    percentile_cont(0.5) WITHIN GROUP (ORDER BY r.reply_minutes) AS median_reply_minutes
  FROM ghl_sms_messages m
  LEFT JOIN sms_replies r ON r.send_id = m.id
  LEFT JOIN sms_templates t
    ON t.location = m.location AND t.template_key = m.template_key
  WHERE m.direction = 'outbound'
    AND m.template_key IS NOT NULL
    AND (p_location IS NULL OR m.location = p_location)
    AND (p_start IS NULL OR m.date_added >= p_start)
    AND (p_end   IS NULL OR m.date_added <= p_end)
    AND (
      p_kind = 'all'
      OR (p_kind = 'automated' AND m.source IN ('workflow','bulk_actions'))
      OR (p_kind = 'staff'     AND m.source = 'app')
    )
  GROUP BY m.location, m.template_key
  HAVING count(*) > 0
  ORDER BY count(*) DESC;
$$;
```

- [ ] **Step 2: Write the upsert module**

Create `ghl-sync/src/db/upsertSmsMessages.js`:

```js
const supabase = require('./supabase');
const { templateKey } = require('../sms/templateKey');

const BATCH_SIZE = 500;

// Build a WHOLE ghl_sms_messages row from a GHL message. Returns null for
// anything that is not an SMS: the conversation feed also carries TYPE_CALL and
// TYPE_ACTIVITY_* rows, which are not sends and must never reach the table.
function messageRow(msg, loc) {
  if (!msg || msg.messageType !== 'TYPE_SMS') return null;
  if (!msg.id || !msg.dateAdded) return null;
  const direction = msg.direction === 'inbound' ? 'inbound' : 'outbound';
  return {
    id: msg.id,
    location: loc.slug,
    location_id: loc.id,
    conversation_id: msg.conversationId || '',
    contact_id: msg.contactId || null,
    direction,
    source: msg.source || null,
    status: msg.status || null,
    body: msg.body || null,
    // Inbound bodies are what a member typed; clustering them is meaningless.
    template_key: direction === 'outbound' ? templateKey(msg.body) : null,
    date_added: msg.dateAdded,
    synced_at: new Date().toISOString(),
  };
}

async function batchUpsert(table, rows, onConflict, keyFn) {
  let upserted = 0;
  const errors = [];

  const seen = new Map();
  for (const r of rows) {
    const k = keyFn(r);
    if (!k) continue;
    seen.set(k, r); // last occurrence wins
  }
  const deduped = Array.from(seen.values());

  for (let i = 0; i < deduped.length; i += BATCH_SIZE) {
    const batch = deduped.slice(i, i + BATCH_SIZE);
    const { error, count } = await supabase
      .from(table)
      .upsert(batch, { onConflict, count: 'exact' });

    if (error) {
      console.error(`[DB] ${table} upsert batch error:`, error.message);
      errors.push({ batch: Math.floor(i / BATCH_SIZE), error: error.message });
    } else {
      upserted += count || batch.length;
    }
  }

  return { upserted, errors };
}

const upsertSmsMessages = rows =>
  batchUpsert('ghl_sms_messages', rows, 'id', r => r.id);

const upsertSmsTemplates = rows =>
  batchUpsert('sms_templates', rows, 'location,template_key', r =>
    r.template_key ? `${r.location}|${r.template_key}` : null);

const upsertSmsReplies = rows =>
  batchUpsert('sms_replies', rows, 'inbound_id', r => r.inbound_id);

module.exports = { messageRow, upsertSmsMessages, upsertSmsTemplates, upsertSmsReplies };
```

- [ ] **Step 3: Verify the row builder filters non-SMS and shapes whole rows**

Run:

```bash
cd ghl-sync && node -e "
const {messageRow}=require('./src/db/upsertSmsMessages');
const loc={slug:'salem',id:'L1'};
console.log(messageRow({messageType:'TYPE_ACTIVITY_APPOINTMENT',id:'a',dateAdded:'2026-08-19T00:00:00Z'},loc));
console.log(messageRow({messageType:'TYPE_CALL',id:'c',dateAdded:'2026-08-19T00:00:00Z'},loc));
const r=messageRow({messageType:'TYPE_SMS',id:'m1',direction:'outbound',source:'workflow',status:'delivered',body:'Hi Shaun! Welcome.',contactId:'c1',conversationId:'v1',dateAdded:'2026-08-19T00:00:00Z'},loc);
console.log(r.template_key, r.direction, r.location, Object.keys(r).length);
const i=messageRow({messageType:'TYPE_SMS',id:'m2',direction:'inbound',body:'yes',dateAdded:'2026-08-19T01:00:00Z'},loc);
console.log('inbound template_key:', i.template_key);
"
```

Expected: `null`, `null`, then a 16-hex key with `outbound salem 12`, then `inbound template_key: null`.

- [ ] **Step 4: Commit**

```bash
git add ghl-sync/migrations/015_sms_messages.sql ghl-sync/src/db/upsertSmsMessages.js
git commit -m "feat(ghl-sync): SMS message store, template clusters, and engagement RPC"
```

---

### Task 8: SMS sync job

**Files:**
- Modify: `ghl-sync/src/ghl/conversations.js`
- Create: `ghl-sync/src/sync/smsStatsSync.js`
- Modify: `ghl-sync/src/index.js`
- Modify: `ghl-sync/src/scheduler.js`

**Interfaces:**
- Consumes: `messageRow`, `upsertSmsMessages`, `upsertSmsTemplates`, `upsertSmsReplies` (Task 7); `attributeReplies`, `DEFAULT_WINDOW_HOURS` (Task 6); `writeSyncLog`.
- Produces: `smsStatsSync()`, `smsStatsSyncForLocation(loc, opts)`, `smsStatsSyncForSlug(slug)`. `opts` is `{ sinceIso }` — when supplied it replaces the watermark, which is how the backfill in Task 9 reuses this job.

- [ ] **Step 1: Export the conversation helpers**

In `ghl-sync/src/ghl/conversations.js`, add this function above `module.exports`:

```js
// One page of a location's conversations, newest activity first.
//
// Pagination here is NOT the contacts/opportunities dual cursor, and it is not
// offset-based. Verified live 2026-08-19 against Salem: `startAfterId`, `page`,
// `skip`, and `offset` are all silently ignored and return page 1 again. The
// only cursor that works is `startAfterDate` — the epoch-ms `lastMessageDate`
// of the last row on the previous page. A four-page walk with it returned 80
// unique conversations, zero duplicates, strictly decreasing dates.
//
// NOTE: `lastMessageDate` is epoch MILLISECONDS (a number), not an ISO string.
async function searchConversations(locationId, apiKey, { limit = 100, startAfterDate = null } = {}) {
  const params = { locationId, limit, sortBy: 'last_message_date', sort: 'desc' };
  if (startAfterDate) params.startAfterDate = startAfterDate;
  const res = await get('/conversations/search', params, apiKey);
  return res?.conversations || [];
}
```

and change the export line to:

```js
module.exports = { fetchFirstHumanContact, pickFirstHumanContact, fetchAllMessages, searchConversations };
```

- [ ] **Step 2: Write the sync job**

Create `ghl-sync/src/sync/smsStatsSync.js`:

```js
const LOCATIONS = require('../config/locations');
const supabase = require('../db/supabase');
const { sleep } = require('../ghl/client');
const { fetchAllMessages, searchConversations } = require('../ghl/conversations');
const { messageRow, upsertSmsMessages, upsertSmsTemplates, upsertSmsReplies } = require('../db/upsertSmsMessages');
const { attributeReplies, DEFAULT_WINDOW_HOURS } = require('../sms/replyAttribution');
const { writeSyncLog } = require('./syncLog');

const PAGE_SIZE = 100;
const MAX_PAGES = 200; // 20k conversations per run; the backfill needs the headroom
const FETCH_DELAY_MS = Number(process.env.SMS_FETCH_DELAY_MS || 120);
const WINDOW_HOURS = Number(process.env.SMS_REPLY_WINDOW_HOURS || DEFAULT_WINDOW_HOURS);
// Re-walk a little before the last run so a conversation that moved mid-sync
// is not missed. Cheap: an already-stored message just upserts over itself.
const OVERLAP_MS = 2 * 60 * 60 * 1000;

// When did this location last finish an sms-messages run without errors?
// Returns null on the first ever run, which the caller reads as "no watermark".
async function lastSuccessfulRun(locationId) {
  const { data, error } = await supabase
    .from('ghl_sync_log')
    .select('started_at')
    .eq('sync_type', 'sms-messages')
    .eq('location_id', locationId)
    .is('errors', null)
    .order('started_at', { ascending: false })
    .limit(1);

  if (error) {
    console.warn('[SmsStats] watermark lookup failed:', error.message);
    return null;
  }
  const iso = data?.[0]?.started_at;
  if (!iso) return null;
  return new Date(new Date(iso).getTime() - OVERLAP_MS).toISOString();
}

// Recompute reply linkage for the contacts we just touched. Attribution needs
// a contact's neighbouring messages, not just the new ones, so reload each
// contact's window from the DB rather than attributing the fetched page alone.
async function attributeForContacts(contactIds, sinceIso) {
  const rows = [];
  const ids = Array.from(contactIds).filter(Boolean);

  for (let i = 0; i < ids.length; i += 50) {
    const chunk = ids.slice(i, i + 50);
    const { data, error } = await supabase
      .from('ghl_sms_messages')
      .select('id, contact_id, direction, body, date_added, location')
      .in('contact_id', chunk)
      .gte('date_added', sinceIso)
      .order('date_added', { ascending: true });

    if (error) {
      console.warn('[SmsStats] attribution reload failed:', error.message);
      continue;
    }

    const byContact = new Map();
    for (const m of data || []) {
      if (!byContact.has(m.contact_id)) byContact.set(m.contact_id, []);
      byContact.get(m.contact_id).push(m);
    }
    for (const [, msgs] of byContact) {
      for (const a of attributeReplies(msgs, { windowHours: WINDOW_HOURS })) {
        rows.push({
          inbound_id: a.inbound_id,
          send_id: a.send_id,
          location: msgs[0].location,
          reply_minutes: a.reply_minutes,
          is_opt_out: a.is_opt_out,
          computed_at: new Date().toISOString(),
        });
      }
    }
  }

  return rows;
}

// Walk one location's recently-active conversations, store their SMS, cluster
// the outbound ones into templates, and recompute reply linkage.
async function smsStatsSyncForLocation(loc, { sinceIso = null } = {}) {
  const startedAt = new Date().toISOString();
  const watermark = sinceIso || (await lastSuccessfulRun(loc.id));
  const errors = [];

  // lastMessageDate comes back as epoch ms, so the watermark is compared as a
  // number. Converting the other way (ms -> ISO per row) would be a string
  // compare on every conversation for no benefit.
  const watermarkMs = watermark ? Date.parse(watermark) : null;

  const messages = [];
  const touchedContacts = new Set();
  let startAfterDate = null;
  let reachedWatermark = false;
  let conversations = 0;

  for (let page = 0; page < MAX_PAGES && !reachedWatermark; page++) {
    let batch;
    try {
      batch = await searchConversations(loc.id, loc.apiKey, { limit: PAGE_SIZE, startAfterDate });
    } catch (err) {
      const code = err.response?.status || err.message;
      console.warn(`[SmsStats] ${loc.name}: conversation search failed (${code})`);
      errors.push({ stage: 'search', reason: String(code) });
      break;
    }
    if (!batch.length) break;

    for (const c of batch) {
      // Conversations come newest-activity first, so the first one older than
      // the watermark means everything after it is older too.
      if (watermarkMs && c.lastMessageDate && Number(c.lastMessageDate) < watermarkMs) {
        reachedWatermark = true;
        break;
      }
      conversations++;
      try {
        const msgs = await fetchAllMessages(c.id, loc.apiKey);
        for (const m of msgs) {
          const row = messageRow(m, loc);
          if (!row) continue;
          messages.push(row);
          if (row.contact_id) touchedContacts.add(row.contact_id);
        }
      } catch (err) {
        const code = err.response?.status || err.message;
        errors.push({ stage: 'messages', conversationId: c.id, reason: String(code) });
      }
      await sleep(FETCH_DELAY_MS);
    }

    // Cursor is the oldest lastMessageDate on this page, in epoch ms.
    startAfterDate = batch[batch.length - 1]?.lastMessageDate || null;
    if (!startAfterDate || batch.length < PAGE_SIZE) break;
  }

  const msgResult = messages.length ? await upsertSmsMessages(messages) : { upserted: 0, errors: [] };
  errors.push(...msgResult.errors);

  // One template row per distinct key, carrying the earliest and latest sighting.
  const templates = new Map();
  for (const m of messages) {
    if (m.direction !== 'outbound' || !m.template_key) continue;
    const prev = templates.get(m.template_key);
    if (!prev) {
      templates.set(m.template_key, {
        location: m.location,
        template_key: m.template_key,
        label: null,
        sample_body: m.body || '',
        first_seen_at: m.date_added,
        last_seen_at: m.date_added,
      });
    } else {
      if (m.date_added < prev.first_seen_at) prev.first_seen_at = m.date_added;
      if (m.date_added > prev.last_seen_at) prev.last_seen_at = m.date_added;
    }
  }
  // Never clobber a label a human set: only insert templates we have not seen.
  const { data: known } = await supabase
    .from('sms_templates')
    .select('template_key')
    .eq('location', loc.slug);
  const knownKeys = new Set((known || []).map(r => r.template_key));
  const newTemplates = Array.from(templates.values()).filter(t => !knownKeys.has(t.template_key));
  const tplResult = newTemplates.length ? await upsertSmsTemplates(newTemplates) : { upserted: 0, errors: [] };
  errors.push(...tplResult.errors);

  const attrSince = watermark || new Date(Date.now() - WINDOW_HOURS * 3600 * 1000).toISOString();
  const replies = await attributeForContacts(touchedContacts, attrSince);
  const repResult = replies.length ? await upsertSmsReplies(replies) : { upserted: 0, errors: [] };
  errors.push(...repResult.errors);

  await writeSyncLog({
    syncType: 'sms-messages',
    entity: 'ghl_sms_messages',
    locationId: loc.id,
    recordsFetched: messages.length,
    recordsUpserted: msgResult.upserted,
    errors,
    startedAt,
  });

  return {
    location: loc.name,
    conversations,
    messages: messages.length,
    upserted: msgResult.upserted,
    templates: tplResult.upserted,
    replies: repResult.upserted,
    errors: errors.length,
  };
}

// Every location, one fully before the next, so rate-limit accounting stays simple.
async function smsStatsSync(opts = {}) {
  const summary = [];
  for (const loc of LOCATIONS) {
    try {
      const r = await smsStatsSyncForLocation(loc, opts);
      summary.push(r);
      console.log(`[SmsStats] ${loc.name}: convos=${r.conversations} msgs=${r.messages} replies=${r.replies} errors=${r.errors}`);
    } catch (err) {
      console.error(`[SmsStats] ${loc.name}: FAILED — ${err.message}`);
      summary.push({ location: loc.name, error: err.message });
    }
  }
  console.log('[SmsStats] Run summary:', JSON.stringify(summary));
  return summary;
}

async function smsStatsSyncForSlug(slug, opts = {}) {
  const loc = LOCATIONS.find(l => l.slug === slug);
  if (!loc) throw new Error(`Unknown location slug: ${slug}`);
  return smsStatsSyncForLocation(loc, opts);
}

module.exports = { smsStatsSync, smsStatsSyncForLocation, smsStatsSyncForSlug };
```

- [ ] **Step 3: Add the manual-run endpoints**

In `ghl-sync/src/index.js`, add to the requires near `emailStatsSync`:

```js
const { smsStatsSync, smsStatsSyncForSlug } = require('./sync/smsStatsSync');
```

and add directly below the two `email-stats` endpoints:

```js
// POST /api/sync/sms-messages — all locations
app.post('/api/sync/sms-messages', requireSecret, (req, res) => {
  res.json({ status: 'started', message: 'SMS message sync running in background' });
  smsStatsSync().catch(err => console.error('[API] SMS sync failed:', err.message));
});

// POST /api/sync/sms-messages/:locationSlug — single location
app.post('/api/sync/sms-messages/:locationSlug', requireSecret, (req, res) => {
  res.json({ status: 'started', message: `SMS sync for ${req.params.locationSlug} running` });
  smsStatsSyncForSlug(req.params.locationSlug)
    .catch(err => console.error(`[API] SMS sync for ${req.params.locationSlug} failed:`, err.message));
});
```

- [ ] **Step 4: Schedule it**

In `ghl-sync/src/scheduler.js`, add to the requires at the top:

```js
const { smsStatsSync } = require('./sync/smsStatsSync');
```

and add directly after the existing email-stats `cron.schedule` block:

```js
  const smsStatsIntervalMinutes = process.env.SMS_STATS_INTERVAL_MINUTES || 60;
  cron.schedule(`*/${smsStatsIntervalMinutes} * * * *`, async () => {
    try {
      await smsStatsSync();
    } catch (err) {
      console.error('[Scheduler] SMS stats sync failed:', err.message);
    }
  });
```

and add beside the existing email-stats startup log line:

```js
  console.log(`[Scheduler] SMS stats sync every ${smsStatsIntervalMinutes}m`);
```

- [ ] **Step 5: Verify everything loads**

Run:

```bash
cd ghl-sync && node -e "require('./src/sync/smsStatsSync');require('./src/ghl/conversations');console.log('sms sync loads OK')"
```

Expected: `sms sync loads OK`.

- [ ] **Step 6: Run the full ghl-sync test suite**

Run: `cd ghl-sync && pnpm test`
Expected: all tests pass, including the ones from Tasks 1, 5, and 6.

- [ ] **Step 7: Commit**

```bash
git add ghl-sync/src/ghl/conversations.js ghl-sync/src/sync/smsStatsSync.js ghl-sync/src/index.js ghl-sync/src/scheduler.js
git commit -m "feat(ghl-sync): watermark-driven SMS message sync with reply attribution"
```

---

### Task 9: Backfill script

**Files:**
- Create: `ghl-sync/scripts/backfillSmsMessages.js`

**Interfaces:**
- Consumes: `smsStatsSyncForSlug`, `smsStatsSyncForLocation` (Task 8), `LOCATIONS`.
- Produces: a CLI entry point. No module exports needed.

- [ ] **Step 1: Write the script**

Create `ghl-sync/scripts/backfillSmsMessages.js`:

```js
#!/usr/bin/env node
// One-time SMS backfill.
//
//   node scripts/backfillSmsMessages.js                 # every location, 180 days
//   node scripts/backfillSmsMessages.js springfield     # one location
//   node scripts/backfillSmsMessages.js springfield 90  # one location, 90 days
//
// Reuses the normal sync with an explicit `sinceIso` instead of the watermark,
// so there is exactly one code path walking conversations. Idempotent: every
// write is an upsert keyed on the GHL message id, so re-running after an
// interruption resumes safely rather than duplicating.
//
// Expect roughly an hour across all seven locations at 180 days. Run it
// off-hours, one location at a time, so it does not compete with the scheduled
// syncs for GHL rate limit.

require('dotenv').config();
const LOCATIONS = require('../src/config/locations');
const { smsStatsSyncForLocation } = require('../src/sync/smsStatsSync');

const DEFAULT_DAYS = 180;

async function main() {
  const [slugArg, daysArg] = process.argv.slice(2);
  const days = Number(daysArg) > 0 ? Number(daysArg) : DEFAULT_DAYS;
  const sinceIso = new Date(Date.now() - days * 24 * 3600 * 1000).toISOString();

  const targets = slugArg
    ? LOCATIONS.filter(l => l.slug === slugArg)
    : LOCATIONS;

  if (!targets.length) {
    console.error(`No location matches "${slugArg}". Known: ${LOCATIONS.map(l => l.slug).join(', ')}`);
    process.exit(1);
  }

  console.log(`[Backfill] ${targets.length} location(s), back to ${sinceIso}`);

  for (const loc of targets) {
    const t0 = Date.now();
    try {
      const r = await smsStatsSyncForLocation(loc, { sinceIso });
      console.log(`[Backfill] ${loc.name}: convos=${r.conversations} msgs=${r.messages} upserted=${r.upserted} templates=${r.templates} replies=${r.replies} errors=${r.errors} in ${Math.round((Date.now() - t0) / 1000)}s`);
    } catch (err) {
      console.error(`[Backfill] ${loc.name}: FAILED — ${err.message}`);
    }
  }

  console.log('[Backfill] Done.');
  process.exit(0);
}

main().catch(err => {
  console.error('[Backfill] Fatal:', err);
  process.exit(1);
});
```

- [ ] **Step 2: Verify the script parses and rejects an unknown slug**

Run: `cd ghl-sync && node scripts/backfillSmsMessages.js not-a-gym`
Expected: exits 1 with `No location matches "not-a-gym". Known: salem, keizer, ...`

- [ ] **Step 3: Commit**

```bash
git add ghl-sync/scripts/backfillSmsMessages.js
git commit -m "feat(ghl-sync): one-time SMS backfill script"
```

---

### Task 10: SMS marketing endpoints

**Files:**
- Create: `auth/src/routes/smsMarketing.js`
- Modify: `auth/src/index.js:112-117`
- Modify: `portal/src/lib/api.js`

**Interfaces:**
- Consumes: SQL function `sms_engagement_by_template` (Task 7).
- Produces:
  - `GET /sms-marketing/templates?location_slug=&start_date=&end_date=&kind=` → `{ templates, totals }`
  - `PATCH /sms-marketing/templates/:key` body `{ location_slug, label }` → `{ ok: true }`
  - portal wrappers `getSmsMarketingTemplates(params)` and `setSmsTemplateLabel(key, location_slug, label)`

Each `templates` entry: `{ location, template_key, label, sample_body, sends, delivered, failed, replies, reply_rate, opt_outs, opt_out_rate, median_reply_minutes }`.

- [ ] **Step 1: Write the route**

Create `auth/src/routes/smsMarketing.js`:

```js
const { Router } = require('express')
const authenticate = require('../middleware/auth')
const { requireRole, requireReportAccess } = require('../middleware/role')
const { supabaseAdmin } = require('../services/supabase')

const router = Router()
router.use(authenticate)
// Same gate as Meta Ads and Email Marketing: corporate+, or a custom role
// holding the marketing-engagement report grant.
router.use(requireReportAccess('corporate', ['marketing-engagement']))

const VALID_KINDS = ['automated', 'staff', 'all']

const pct = (n, d) => (d > 0 ? +((n / d) * 100).toFixed(2) : 0)

// GET /sms-marketing/templates?location_slug=&start_date=&end_date=&kind=
//
// Reply rate per automated text. GHL exposes no workflow id on a message, so
// texts are clustered by a fingerprint of their body (see ghl-sync
// src/sms/templateKey.js) and named through sms_templates.label.
//
// The date range filters the SEND date. A reply landing after end_date still
// counts: the attribution window, not the report range, decides what is a reply.
router.get('/templates', async (req, res) => {
  const { location_slug, start_date, end_date } = req.query
  const kind = VALID_KINDS.includes(req.query.kind) ? req.query.kind : 'automated'

  try {
    const { data, error } = await supabaseAdmin.rpc('sms_engagement_by_template', {
      p_location: location_slug || null,
      p_start: start_date ? start_date + 'T00:00:00.000Z' : null,
      p_end: end_date ? end_date + 'T23:59:59.999Z' : null,
      p_kind: kind,
    })
    if (error) throw error

    const templates = (data || []).map(r => {
      const sends = Number(r.sends) || 0
      const replies = Number(r.replies) || 0
      const optOuts = Number(r.opt_outs) || 0
      return {
        location: r.location,
        template_key: r.template_key,
        label: r.label || null,
        sample_body: r.sample_body || '',
        sends,
        delivered: Number(r.delivered) || 0,
        failed: Number(r.failed) || 0,
        replies,
        reply_rate: pct(replies, sends),
        opt_outs: optOuts,
        opt_out_rate: pct(optOuts, sends),
        median_reply_minutes: r.median_reply_minutes == null ? null : Number(r.median_reply_minutes),
      }
    })

    const t = templates.reduce((a, c) => {
      a.templates += 1
      a.sends += c.sends; a.delivered += c.delivered; a.failed += c.failed
      a.replies += c.replies; a.opt_outs += c.opt_outs
      return a
    }, { templates: 0, sends: 0, delivered: 0, failed: 0, replies: 0, opt_outs: 0 })

    res.json({
      templates,
      totals: { ...t, reply_rate: pct(t.replies, t.sends), opt_out_rate: pct(t.opt_outs, t.sends) },
    })
  } catch (err) {
    console.error('[SMS Marketing] templates error:', err.message)
    res.status(500).json({ error: err.message })
  }
})

// PATCH /sms-marketing/templates/:key { location_slug, label }
//
// Names a cluster. Labels are per location because the same text can run at
// more than one gym. A copy edit produces a new fingerprint, so reusing the
// same label is how an edited template stays grouped in the report.
router.patch('/templates/:key', requireRole('admin'), async (req, res) => {
  const { location_slug, label } = req.body || {}
  if (!location_slug) return res.status(400).json({ error: 'location_slug is required' })

  const clean = typeof label === 'string' && label.trim() ? label.trim().slice(0, 120) : null

  try {
    const { error } = await supabaseAdmin
      .from('sms_templates')
      .update({ label: clean })
      .eq('location', location_slug)
      .eq('template_key', req.params.key)
    if (error) throw error
    res.json({ ok: true })
  } catch (err) {
    console.error('[SMS Marketing] label error:', err.message)
    res.status(500).json({ error: err.message })
  }
})

module.exports = router
```

- [ ] **Step 2: Mount the router**

In `auth/src/index.js`, directly below the `/email-marketing` mount on line 117, add:

```js
app.use('/sms-marketing', require('./routes/smsMarketing'))
```

- [ ] **Step 3: Add the portal API wrappers**

In `portal/src/lib/api.js`, below `getEmailMarketingAutomations` from Task 3, add:

```js
// SMS engagement per automated text (clustered by message-body fingerprint).
export async function getSmsMarketingTemplates(params = {}) {
  const qs = new URLSearchParams(params).toString()
  return api('/sms-marketing/templates' + (qs ? '?' + qs : ''))
}

export async function setSmsTemplateLabel(key, location_slug, label) {
  return api(`/sms-marketing/templates/${encodeURIComponent(key)}`, {
    method: 'PATCH',
    body: JSON.stringify({ location_slug, label }),
  })
}
```

- [ ] **Step 4: Verify the route loads and auth boots**

Run:

```bash
cd auth && node -e "require('./src/routes/smsMarketing');console.log('sms route loads OK')"
```

Expected: `sms route loads OK`.

- [ ] **Step 5: Run the auth test suite**

Run: `cd auth && pnpm test`
Expected: all existing tests still pass.

- [ ] **Step 6: Commit**

```bash
git add auth/src/routes/smsMarketing.js auth/src/index.js portal/src/lib/api.js
git commit -m "feat(auth): SMS engagement endpoints per template"
```

---

### Task 11: Marketing Engagement report and registration

**Files:**
- Create: `portal/src/components/reports/SmsMarketingReport.jsx`
- Create: `portal/src/components/reports/MarketingEngagementReport.jsx`
- Create: `auth/migrations/111_marketing_engagement_grant.sql`
- Modify: `portal/src/components/ReportingView.jsx`
- Modify: `portal/src/config/portalTiles.js`

**Interfaces:**
- Consumes: `getSmsMarketingTemplates` (Task 10), `EmailMarketingReport` (Task 4).
- Produces: default export `MarketingEngagementReport({ startDate, endDate, locationSlug })`.

- [ ] **Step 1: Write the SMS report component**

Create `portal/src/components/reports/SmsMarketingReport.jsx`:

```jsx
import { useState, useEffect, useMemo } from 'react'
import { getSmsMarketingTemplates } from '../../lib/api'
import { exportCSV } from '../../lib/export'

// SMS engagement per automated text. GHL attaches no workflow id to a message,
// so each distinct text is identified by a fingerprint of its body; the label
// column is a human name for that cluster when one has been set.

function fmtInt(v) {
  const n = Number(v)
  return Number.isFinite(n) ? n.toLocaleString('en-US') : '—'
}
function fmtPct(v) {
  const n = Number(v)
  return Number.isFinite(n) ? `${n.toFixed(1)}%` : '—'
}
function fmtMinutes(v) {
  const n = Number(v)
  if (!Number.isFinite(n)) return '—'
  if (n < 60) return `${Math.round(n)}m`
  if (n < 1440) return `${(n / 60).toFixed(1)}h`
  return `${(n / 1440).toFixed(1)}d`
}
function preview(body) {
  const s = (body || '').replace(/\s+/g, ' ').trim()
  return s.length > 90 ? s.slice(0, 90) + '…' : s || '—'
}

function StatCard({ label, value, sub }) {
  return (
    <div className="bg-surface rounded-xl border border-border p-4">
      <p className="text-xs font-semibold text-text-muted uppercase tracking-wide">{label}</p>
      <p className="text-2xl font-bold mt-1 text-text-primary">{value}</p>
      {sub && <p className="text-xs text-text-muted mt-0.5">{sub}</p>}
    </div>
  )
}

const KINDS = [
  { key: 'automated', label: 'Automated' },
  { key: 'staff', label: 'Staff sent' },
  { key: 'all', label: 'All' },
]

export default function SmsMarketingReport({ startDate, endDate, locationSlug }) {
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [kind, setKind] = useState('automated')

  const allLoc = locationSlug === 'all' || !locationSlug
  const params = useMemo(
    () => ({ location_slug: allLoc ? '' : locationSlug, start_date: startDate, end_date: endDate, kind }),
    [allLoc, locationSlug, startDate, endDate, kind]
  )

  useEffect(() => {
    let ignore = false
    setLoading(true)
    setError('')
    getSmsMarketingTemplates(params)
      .then(d => { if (!ignore) setData(d) })
      .catch(e => { if (!ignore) setError(e.message || 'Failed to load SMS engagement') })
      .finally(() => { if (!ignore) setLoading(false) })
    return () => { ignore = true }
  }, [params])

  const rows = data?.templates || []
  const totals = data?.totals

  function handleExport() {
    exportCSV(
      rows.map(r => ({
        Location: r.location,
        Text: r.label || preview(r.sample_body),
        Sends: r.sends,
        Delivered: r.delivered,
        Failed: r.failed,
        Replies: r.replies,
        'Reply %': r.reply_rate,
        'Opt-outs': r.opt_outs,
        'Median reply (min)': r.median_reply_minutes ?? '',
      })),
      `sms-engagement-${startDate}_to_${endDate}`
    )
  }

  return (
    <div className="space-y-4">
      <div className="bg-surface rounded-xl border border-border p-3 flex items-center gap-2 flex-wrap">
        {KINDS.map(k => (
          <button
            key={k.key}
            onClick={() => setKind(k.key)}
            className={`px-3 py-1.5 rounded-lg text-sm font-semibold transition-colors ${
              kind === k.key
                ? 'bg-wcs-red text-white'
                : 'text-text-muted hover:text-text-primary hover:bg-surface-hover'
            }`}
          >
            {k.label}
          </button>
        ))}
        <div className="flex-1" />
        {rows.length > 0 && (
          <button
            onClick={handleExport}
            className="px-3 py-1.5 rounded-lg text-sm font-semibold text-text-muted hover:text-text-primary hover:bg-surface-hover"
          >
            Export CSV
          </button>
        )}
      </div>

      {error && (
        <div className="bg-surface rounded-xl border border-border p-4">
          <p className="text-sm text-wcs-red">{error}</p>
        </div>
      )}

      {totals && (
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
          <StatCard label="Sends" value={fmtInt(totals.sends)} sub={`${fmtInt(totals.templates)} distinct texts`} />
          <StatCard label="Replies" value={fmtInt(totals.replies)} />
          <StatCard label="Reply Rate" value={fmtPct(totals.reply_rate)} />
          <StatCard label="Opt-outs" value={fmtInt(totals.opt_outs)} sub={fmtPct(totals.opt_out_rate)} />
        </div>
      )}

      {rows.length > 0 && (
        <div className="bg-surface rounded-xl border border-border overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="text-xs uppercase tracking-wide text-text-muted border-b border-border">
                <tr>
                  <th className="py-2.5 px-4 text-left">Text</th>
                  <th className="py-2.5 px-2 text-right">Sends</th>
                  <th className="py-2.5 px-2 text-right">Delivered</th>
                  <th className="py-2.5 px-2 text-right">Failed</th>
                  <th className="py-2.5 px-2 text-right">Replies</th>
                  <th className="py-2.5 px-2 text-right">Reply %</th>
                  <th className="py-2.5 px-2 text-right">Opt-outs</th>
                  <th className="py-2.5 px-2 text-right">Median Reply</th>
                </tr>
              </thead>
              <tbody>
                {rows.map(r => (
                  <tr key={`${r.location}|${r.template_key}`} className="border-b border-border/50 last:border-0 align-top">
                    <td className="py-2.5 px-4 max-w-md">
                      <p className="text-text-primary font-medium">{r.label || preview(r.sample_body)}</p>
                      {r.label && <p className="text-xs text-text-muted mt-0.5">{preview(r.sample_body)}</p>}
                      {allLoc && <p className="text-xs text-text-muted mt-0.5 capitalize">{r.location}</p>}
                    </td>
                    <td className="py-2.5 px-2 text-right text-text-primary">{fmtInt(r.sends)}</td>
                    <td className="py-2.5 px-2 text-right text-text-primary">{fmtInt(r.delivered)}</td>
                    <td className="py-2.5 px-2 text-right text-text-primary">{fmtInt(r.failed)}</td>
                    <td className="py-2.5 px-2 text-right text-text-primary">{fmtInt(r.replies)}</td>
                    <td className="py-2.5 px-2 text-right font-semibold text-text-primary">{fmtPct(r.reply_rate)}</td>
                    <td className="py-2.5 px-2 text-right text-text-primary">{fmtInt(r.opt_outs)}</td>
                    <td className="py-2.5 px-2 text-right text-text-primary">{fmtMinutes(r.median_reply_minutes)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {!loading && !error && !rows.length && (
        <div className="bg-surface rounded-xl border border-border p-6 text-center">
          <p className="text-sm text-text-muted">No SMS sends in this range yet.</p>
        </div>
      )}
    </div>
  )
}
```

Note the `allLoc` reference inside the table: it is already in scope from the component body.

- [ ] **Step 2: Write the tab shell**

Create `portal/src/components/reports/MarketingEngagementReport.jsx`:

```jsx
import { useState } from 'react'
import EmailMarketingReport from './EmailMarketingReport'
import SmsMarketingReport from './SmsMarketingReport'

// Marketing Engagement: how automated outreach performs, per channel.
// Location and date range come from the Reporting shell as props, so both tabs
// stay in sync with the filters the user already set.

const TABS = [
  { key: 'email', label: 'Email' },
  { key: 'sms', label: 'SMS' },
]

export default function MarketingEngagementReport({ startDate, endDate, locationSlug }) {
  const [tab, setTab] = useState('email')

  return (
    <div className="space-y-4">
      <div className="bg-surface rounded-xl border border-border p-3 flex items-center gap-2">
        {TABS.map(t => (
          <button
            key={t.key}
            onClick={() => setTab(t.key)}
            className={`px-4 py-1.5 rounded-lg text-sm font-semibold transition-colors ${
              tab === t.key
                ? 'bg-wcs-red text-white'
                : 'text-text-muted hover:text-text-primary hover:bg-surface-hover'
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {tab === 'email'
        ? <EmailMarketingReport startDate={startDate} endDate={endDate} locationSlug={locationSlug} />
        : <SmsMarketingReport startDate={startDate} endDate={endDate} locationSlug={locationSlug} />}
    </div>
  )
}
```

- [ ] **Step 3: Register the report (three points)**

In `portal/src/components/ReportingView.jsx`:

Add the import beside the other report imports:

```js
import MarketingEngagementReport from './reports/MarketingEngagementReport'
```

Add an icon entry beside the existing `'email-marketing'` icon (line ~55). Reuse a chat-bubble path:

```js
  'marketing-engagement': 'M8.625 12a.375.375 0 1 1-.75 0 .375.375 0 0 1 .75 0Zm0 0H8.25m4.125 0a.375.375 0 1 1-.75 0 .375.375 0 0 1 .75 0Zm0 0H12m4.125 0a.375.375 0 1 1-.75 0 .375.375 0 0 1 .75 0Zm0 0h-.375M21 12c0 4.556-4.03 8.25-9 8.25a9.764 9.764 0 0 1-2.555-.337A5.972 5.972 0 0 1 5.41 20.97a5.969 5.969 0 0 1-.474-.065 4.48 4.48 0 0 0 .978-2.025c.09-.457-.133-.901-.467-1.226C3.93 16.178 3 14.189 3 12c0-4.556 4.03-8.25 9-8.25s9 3.694 9 8.25Z',
```

Add the catalog entry directly after the `email-marketing` entry (line ~81):

```js
  { key: 'marketing-engagement', label: 'Marketing Engagement', desc: 'Email + SMS Performance' },
```

Add it to the Marketing group's `reports` array (line ~113), which becomes:

```js
    reports: ['meta-ads', 'google-marketing', 'email-marketing', 'marketing-engagement'],
```

Add the render branch directly after the `email-marketing` branch (line ~652):

```jsx
          {activeReport === 'marketing-engagement' && (
            <MarketingEngagementReport startDate={startDate} endDate={endDate} locationSlug={locationSlug} />
          )}
```

In `portal/src/config/portalTiles.js`, add directly after the `email-marketing` entry (line ~59):

```js
  { key: 'marketing-engagement', label: 'Marketing Engagement' },
```

- [ ] **Step 4: Write the grant migration**

Create `auth/migrations/111_marketing_engagement_grant.sql`:

```sql
-- Make the Marketing Engagement report visible in the Roles grid.
--
-- Report visibility is driven entirely by report:<key> grants in
-- role_tool_visibility (see migration 084). A tile in ReportingView and a tier
-- gate on the route are not enough: without a catalog entry the report cannot
-- be represented in Admin -> Roles, and without a visibility row nobody sees it.

insert into permission_catalog (perm_key, label, category, min_tier) values
  ('report:marketing-engagement', 'Marketing Engagement', 'Reports', 'corporate')
on conflict (perm_key) do nothing;

-- Same tiers the route's requireReportAccess('corporate', ['marketing-engagement'])
-- allows, so the grid and the gate agree. The legacy marketing tier is included
-- to match how Email Marketing and Meta Ads are granted.
insert into role_tool_visibility (role, tool_key, visible)
select r.role, 'report:marketing-engagement', true
from (values ('marketing'), ('corporate'), ('admin')) as r(role)
on conflict (role, tool_key) do update set visible = true;
```

- [ ] **Step 5: Verify the portal builds**

Run: `cd portal && pnpm build`
Expected: build succeeds.

- [ ] **Step 6: Run both test suites**

Run: `cd ghl-sync && pnpm test && cd ../auth && pnpm test`
Expected: all pass.

- [ ] **Step 7: Commit and open the PR**

```bash
git add portal/src/components/reports/SmsMarketingReport.jsx portal/src/components/reports/MarketingEngagementReport.jsx portal/src/components/ReportingView.jsx portal/src/config/portalTiles.js auth/migrations/111_marketing_engagement_grant.sql
git commit -m "feat(portal): Marketing Engagement report with Email and SMS tabs"
git push -u origin feat/marketing-engagement
```

Then open a PR against `master`. The PR body must list the three migrations that need applying BY HAND at merge: `ghl-sync/migrations/014_email_stats_daily.sql`, `ghl-sync/migrations/015_sms_messages.sql`, `auth/migrations/111_marketing_engagement_grant.sql`. Do not merge.

---

## Post-Merge Operations Checklist

Not code. These run after the PR merges, in this order.

1. Apply `014`, `015`, and `111` by hand to prod Supabase.
2. Deploy `ghl-sync`. Confirm the first scheduled `sms-messages` run appears in `ghl_sync_log`.
3. Pilot: `POST /api/sync/sms-messages/springfield` (lowest volume). Confirm rows land in `ghl_sms_messages` and that Springfield's known automated texts cluster into a sensible number of `sms_templates` rows. If one template splintered into many keys, the fingerprint needs another normalization rule before backfilling.
4. Run the backfill off-hours, one location at a time: `node scripts/backfillSmsMessages.js <slug>`.
5. Deploy `auth` and `portal`.
6. Name the top templates via `PATCH /sms-marketing/templates/:key` or leave them showing their body preview.
7. Email Automations shows "lifetime to date" until two snapshot days exist. Recheck after 48 hours.
