# NPS Phase 1 — Schema + Cohort Job Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Create the `nps_*` tables and a nightly `ghl-sync` job that finds members hitting a lifecycle milestone and records a survey invite for each — running dry by default, sending nothing.

**Architecture:** Trigger rules live as data on `nps_surveys` rows, so adding a survey is a config change, not a deploy. The job translates each rule into a date-bounded query over `abc_members`, diffs against existing invites, and inserts new ones. Pure date/rule logic is separated from all database and network access so it can be unit tested offline. The GHL write path (custom field then tag) is the final task and is gated behind a dry-run flag that defaults to on.

**Tech Stack:** Node.js CommonJS, `node:test` + `node:assert`, `@supabase/supabase-js`, `node-cron`, Postgres (Supabase project `ybopxxydsuwlbwxiuzve`).

**Spec:** `docs/superpowers/specs/2026-08-18-nps-system-design.md`

## Global Constraints

- **Migration number is `108`.** Master is at `107_day_one_cancellations.sql`. The file is `auth/migrations/108_nps_system.sql`.
- **Migrations are applied to production BY HAND at merge time.** This repo has no migration runner.
- **Every new table gets `alter table ... enable row level security;` with no policy.** The portal database is service-role only.
- **Tests use `node:test` and `node:assert`**, CommonJS `require`, run with `node --test`. No jest, no mocha.
- **All new modules take injectable dependencies** (`db`, `now`, `get`, `put`) with real defaults, following `ghl-sync/src/abc/lapsedTaggingJob.js`. Tests must run with no `SUPABASE_URL` set.
- **`db/supabase.js` calls `createClient()` eagerly at import time.** New modules must lazy-load it behind a `getDefaultDb()` function or requiring the module in a test will throw.
- **Dates are `YYYY-MM-DD` strings in US Pacific**, never `Date` objects, and never UTC. `abc_members.begin_date` and `.member_status_date` are `date` columns.
- **Supabase `.select()` defaults to 1000 rows.** Every member query must paginate with `.range()`.
- **Partial upserts fail NOT NULL columns.** Always send whole rows.
- **The job defaults to dry run.** `NPS_TAGGING_DRY_RUN` must be the string `'false'` to enable writes.

---

## File Structure

| File | Responsibility |
| --- | --- |
| `auth/migrations/108_nps_system.sql` | All six `nps_*` tables, indexes, RLS |
| `ghl-sync/src/nps/npsTriggers.js` | Pure. Date math + trigger rule → member query filters |
| `ghl-sync/src/nps/npsTriggers.test.js` | Tests for the above |
| `ghl-sync/src/nps/npsInvites.js` | Pure. Token generation + invite row construction |
| `ghl-sync/src/nps/npsInvites.test.js` | Tests for the above |
| `ghl-sync/src/nps/npsCohort.js` | Loads candidate members, applies email/cooldown filters |
| `ghl-sync/src/nps/npsCohort.test.js` | Tests for the above, with a fake `db` |
| `ghl-sync/src/nps/npsJob.js` | Orchestrates one survey and all surveys; GHL writes |
| `ghl-sync/src/nps/npsJob.test.js` | Tests for the above |
| `ghl-sync/src/scheduler.js` | Modified: register the nightly cron |

---

### Task 1: Database schema

**Files:**
- Create: `auth/migrations/108_nps_system.sql`

**Interfaces:**
- Consumes: nothing.
- Produces: tables `nps_surveys`, `nps_metrics`, `nps_invites`, `nps_responses`, `nps_response_scores`, `nps_club_qr`. Later tasks read `nps_surveys` and write `nps_invites`.

- [ ] **Step 1: Write the migration file**

Create `auth/migrations/108_nps_system.sql`:

```sql
-- NPS / member feedback system.
--
-- Two intake paths write into the same tables:
--   * invited  — a nightly ghl-sync job creates an nps_invites row per member
--                who hits a lifecycle milestone, tags them in GHL, and a GHL
--                workflow emails the tokenised link.
--   * walkup   — a QR poster in club, no invite and no member identity.
--
-- Trigger rules are DATA on nps_surveys, not code, so adding a "3 year" survey
-- is an admin action rather than a deploy.

create table if not exists nps_surveys (
  id                   uuid primary key default gen_random_uuid(),
  slug                 text not null unique,
  title                text not null,
  intro                text,
  -- Ordered question list. Validated by auth/src/services/npsSchema.js.
  schema               jsonb not null default '[]'::jsonb,
  status               text not null default 'draft'
                         check (status in ('draft', 'active', 'paused')),
  trigger_type         text not null
                         check (trigger_type in ('tenure_days', 'tenure_months', 'status_change', 'walkup')),
  -- 30 for day-30, 6/12/24 for month anniversaries. Null for status_change/walkup.
  trigger_value        int,
  -- e.g. 'Cancelled'. Only meaningful for trigger_type = 'status_change'.
  trigger_status       text,
  -- Optional narrowing, e.g. {"club_numbers": ["30935"]}.
  audience_filter      jsonb not null default '{}'::jsonb,
  -- How many days back the nightly job re-checks, so one missed night self-heals.
  send_window_days     int  not null default 3,
  -- Global per-member suppression across ALL surveys, not just this one.
  resend_cooldown_days int  not null default 60,
  ghl_tag              text,
  ghl_field_key        text,
  expires_days         int  not null default 30,
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now()
);

comment on table nps_surveys is
  'Survey definitions. The trigger rule lives here as data so new surveys need no deploy.';

create table if not exists nps_metrics (
  id          uuid primary key default gen_random_uuid(),
  key         text not null unique,
  label       text not null,
  description text,
  active      boolean not null default true,
  created_at  timestamptz not null default now()
);

-- Exists so metric_key is a PICKED value, never free text. 'cleanliness' in the
-- 6-month survey and 'cleanliness' in the 2-year survey must be the same string
-- to roll up together; a typo would silently split one metric into two
-- half-populated ones and nothing in the report would reveal it.
comment on table nps_metrics is
  'Controlled vocabulary for rating question metric_key values.';

create table if not exists nps_invites (
  id                  uuid primary key default gen_random_uuid(),
  survey_id           uuid not null references nps_surveys(id) on delete cascade,
  token               text not null unique,
  member_id           text not null,
  club_number         text not null,
  ghl_contact_id      text,
  -- Snapshots: the member may cancel, change email, or change name between the
  -- invite being created and the survey being answered.
  member_email        text not null,
  member_name         text,
  tenure_days         int,
  -- The date the trigger rule matched (begin_date + 30, the anniversary, or
  -- the cancellation date). Part of the idempotency key.
  trigger_date        date not null,
  status              text not null default 'pending'
                        check (status in ('pending', 'sent', 'opened', 'responded', 'failed', 'expired')),
  sent_at             timestamptz,
  ghl_tag_applied_at  timestamptz,
  ghl_error           text,
  opened_at           timestamptz,
  responded_at        timestamptz,
  expires_at          timestamptz,
  dry_run             boolean not null default false,
  created_at          timestamptz not null default now()
);

-- THE idempotency guard. A job rerun, an overlapping cron tick, or a replayed
-- back-window cannot produce a second invite for the same member+milestone.
create unique index if not exists nps_invites_survey_member_date_idx
  on nps_invites (survey_id, member_id, trigger_date);

-- The cooldown lookup is "any invite for these members since date X".
create index if not exists nps_invites_member_created_idx
  on nps_invites (member_id, created_at desc);

create index if not exists nps_invites_token_idx on nps_invites (token);

create table if not exists nps_responses (
  id            uuid primary key default gen_random_uuid(),
  -- Null for walk-up. Postgres allows many NULLs under a unique constraint, so
  -- this still guarantees one response per invite while allowing unlimited
  -- anonymous walk-up rows.
  invite_id     uuid unique references nps_invites(id) on delete set null,
  survey_id     uuid not null references nps_surveys(id) on delete cascade,
  member_id     text,
  club_number   text,
  source        text not null check (source in ('invited', 'walkup')),
  -- Denormalised from the 'nps' typed question for report speed.
  nps_score     int check (nps_score between 0 and 10),
  answers       jsonb not null default '{}'::jsonb,
  contact_name  text,
  contact_email text,
  ip_hash       text,
  user_agent    text,
  submitted_at  timestamptz not null default now()
);

create index if not exists nps_responses_survey_time_idx
  on nps_responses (survey_id, submitted_at desc);

create table if not exists nps_response_scores (
  id           uuid primary key default gen_random_uuid(),
  response_id  uuid not null references nps_responses(id) on delete cascade,
  survey_id    uuid not null references nps_surveys(id) on delete cascade,
  metric_key   text not null,
  score        int  not null,
  -- club_number, source and submitted_at are denormalised deliberately: it keeps
  -- every report query a single indexed scan with no joins, and all three are
  -- immutable once a response is submitted.
  club_number  text,
  source       text not null,
  submitted_at timestamptz not null
);

create index if not exists nps_response_scores_metric_club_time_idx
  on nps_response_scores (metric_key, club_number, submitted_at desc);

create table if not exists nps_club_qr (
  id          uuid primary key default gen_random_uuid(),
  club_number text not null,
  -- Opaque. Using the raw club number would let anyone edit the URL and dump
  -- one club's scores onto another's report. Rotatable because posters hang in
  -- public and a photographed URL cannot be un-shared.
  key         text not null unique,
  survey_id   uuid not null references nps_surveys(id) on delete cascade,
  active      boolean not null default true,
  created_at  timestamptz not null default now(),
  rotated_at  timestamptz
);

create index if not exists nps_club_qr_key_idx on nps_club_qr (key) where active;

-- Portal DB is service-role only: enable RLS with no policy on every table.
alter table nps_surveys         enable row level security;
alter table nps_metrics         enable row level security;
alter table nps_invites         enable row level security;
alter table nps_responses       enable row level security;
alter table nps_response_scores enable row level security;
alter table nps_club_qr         enable row level security;
```

- [ ] **Step 2: Verify the SQL parses**

There is no migration runner, so validate by eye against these three checks:
1. Every `create table` has a matching `enable row level security`. Expected: 6 and 6.
2. `nps_invites` has the unique index on `(survey_id, member_id, trigger_date)`.
3. `nps_responses.invite_id` and `.member_id` are nullable (no `not null`).

Run this to confirm the counts:

```bash
grep -c "^create table if not exists" auth/migrations/108_nps_system.sql
grep -c "enable row level security" auth/migrations/108_nps_system.sql
```

Expected: `6` and `6`.

- [ ] **Step 3: Commit**

```bash
git add auth/migrations/108_nps_system.sql
git commit -m "feat(nps): add nps_* schema (migration 108)"
```

**Do NOT apply this to production yet.** It is applied by hand at merge time.

---

### Task 2: Trigger rule and date logic

**Files:**
- Create: `ghl-sync/src/nps/npsTriggers.js`
- Test: `ghl-sync/src/nps/npsTriggers.test.js`

**Interfaces:**
- Consumes: nothing. Pure module, no imports beyond Node built-ins.
- Produces:
  - `pacificToday(now: Date) => string` — `'YYYY-MM-DD'`
  - `addDays(dateStr: string, n: number) => string`
  - `subMonths(dateStr: string, months: number) => string`
  - `targetDates(today: string, windowDays: number) => string[]`
  - `cohortFilters(survey: object, targetDate: string) => { beginDate?: string, memberStatus?: string, memberStatusDate?: string, requireActive: boolean }`
  - `isJobTrigger(triggerType: string) => boolean`

- [ ] **Step 1: Write the failing test**

Create `ghl-sync/src/nps/npsTriggers.test.js`:

```js
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd ghl-sync && node --test src/nps/npsTriggers.test.js`
Expected: FAIL with `Cannot find module './npsTriggers'`

- [ ] **Step 3: Write the implementation**

Create `ghl-sync/src/nps/npsTriggers.js`:

```js
// Pure trigger-rule and date logic for the NPS cohort job.
//
// Everything here is a string-in / string-out function over 'YYYY-MM-DD' dates
// so the nightly job can be reasoned about and tested without a database, a
// clock, or a timezone surprise. abc_members.begin_date and .member_status_date
// are `date` columns, so string comparison is exact.

const PACIFIC = 'America/Los_Angeles';

// en-CA formats as YYYY-MM-DD, which is what we want to compare against a
// Postgres `date`. Doing this with getUTC* would be off by a day for the whole
// evening in Pacific, every day.
const pacificFormatter = new Intl.DateTimeFormat('en-CA', {
  timeZone: PACIFIC, year: 'numeric', month: '2-digit', day: '2-digit',
});

function pacificToday(now = new Date()) {
  return pacificFormatter.format(now);
}

function addDays(dateStr, n) {
  const [y, m, d] = dateStr.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10);
}

// Calendar-month subtraction with end-of-month clamping: six months before
// 2026-08-31 is 2026-02-28, because 2026-02-31 does not exist.
//
// The clamp means a member who joined 2026-02-28 matches on BOTH 2026-08-28
// (their true anniversary) and 2026-08-31 (the clamped one). The global
// resend_cooldown_days suppression is what stops that becoming a second email;
// the unique index does not, because the two trigger_dates genuinely differ.
function subMonths(dateStr, months) {
  const [y, m, d] = dateStr.split('-').map(Number);
  let ty = y;
  let tm = m - months;
  while (tm <= 0) { tm += 12; ty -= 1; }
  // Day 0 of the following month is the last day of month `tm`.
  const lastDay = new Date(Date.UTC(ty, tm, 0)).getUTCDate();
  const td = Math.min(d, lastDay);
  return `${ty}-${String(tm).padStart(2, '0')}-${String(td).padStart(2, '0')}`;
}

// The back-window: today first, then backwards. A night the worker was down
// self-heals on the next run instead of silently dropping that day's cohort.
function targetDates(today, windowDays) {
  const days = Math.max(1, Number(windowDays) || 1);
  return Array.from({ length: days }, (_, i) => addDays(today, -i));
}

function isJobTrigger(triggerType) {
  return triggerType === 'tenure_days'
    || triggerType === 'tenure_months'
    || triggerType === 'status_change';
}

// Translate one survey's rule into the filters the cohort query applies.
function cohortFilters(survey, targetDate) {
  const type = survey.trigger_type;
  if (type === 'tenure_days') {
    return { beginDate: addDays(targetDate, -Number(survey.trigger_value)), requireActive: true };
  }
  if (type === 'tenure_months') {
    return { beginDate: subMonths(targetDate, Number(survey.trigger_value)), requireActive: true };
  }
  if (type === 'status_change') {
    return {
      memberStatus: survey.trigger_status,
      memberStatusDate: targetDate,
      // A cancelled member is by definition not active — requiring it would
      // return an empty cohort every night.
      requireActive: false,
    };
  }
  throw new Error(`cohortFilters: walkup surveys have no cohort (trigger_type=${type})`);
}

module.exports = {
  pacificToday, addDays, subMonths, targetDates, cohortFilters, isJobTrigger,
};
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd ghl-sync && node --test src/nps/npsTriggers.test.js`
Expected: PASS, 9 tests

- [ ] **Step 5: Commit**

```bash
git add ghl-sync/src/nps/npsTriggers.js ghl-sync/src/nps/npsTriggers.test.js
git commit -m "feat(nps): trigger rule and Pacific date logic"
```

---

### Task 3: Invite construction

**Files:**
- Create: `ghl-sync/src/nps/npsInvites.js`
- Test: `ghl-sync/src/nps/npsInvites.test.js`

**Interfaces:**
- Consumes: nothing. Pure module, `crypto` only.
- Produces:
  - `generateToken() => string` — 32-char URL-safe
  - `tenureDays(beginDate: string|null, targetDate: string) => number|null`
  - `buildInvite({ survey, member, targetDate, now, dryRun }) => object` — a full `nps_invites` row
  - `surveyUrl(baseUrl: string, slug: string, token: string) => string`

- [ ] **Step 1: Write the failing test**

Create `ghl-sync/src/nps/npsInvites.test.js`:

```js
const test = require('node:test');
const assert = require('node:assert');
const { generateToken, tenureDays, buildInvite, surveyUrl } = require('./npsInvites');

test('generateToken produces distinct URL-safe tokens', () => {
  const a = generateToken();
  const b = generateToken();
  assert.notEqual(a, b);
  assert.match(a, /^[A-Za-z0-9_-]{32}$/);
});

test('tenureDays counts whole days from begin_date', () => {
  assert.equal(tenureDays('2026-07-19', '2026-08-18'), 30);
  assert.equal(tenureDays('2026-08-18', '2026-08-18'), 0);
  assert.equal(tenureDays(null, '2026-08-18'), null);
});

test('buildInvite snapshots member fields and computes expiry', () => {
  const survey = { id: 'srv-1', expires_days: 30 };
  const member = {
    member_id: 'M100', club_number: '30935', email: 'jo@example.com',
    first_name: 'Jo', last_name: 'Doe', begin_date: '2026-07-19',
  };
  const row = buildInvite({
    survey, member, targetDate: '2026-08-18',
    now: new Date('2026-08-18T14:00:00Z'), dryRun: true,
  });

  assert.equal(row.survey_id, 'srv-1');
  assert.equal(row.member_id, 'M100');
  assert.equal(row.club_number, '30935');
  assert.equal(row.member_email, 'jo@example.com');
  assert.equal(row.member_name, 'Jo Doe');
  assert.equal(row.tenure_days, 30);
  assert.equal(row.trigger_date, '2026-08-18');
  assert.equal(row.status, 'pending');
  assert.equal(row.dry_run, true);
  assert.match(row.token, /^[A-Za-z0-9_-]{32}$/);
  assert.equal(row.expires_at, new Date('2026-09-17T14:00:00Z').toISOString());
});

test('buildInvite handles a member with no name parts', () => {
  const row = buildInvite({
    survey: { id: 'srv-1', expires_days: 30 },
    member: { member_id: 'M2', club_number: '7655', email: 'x@y.com' },
    targetDate: '2026-08-18', now: new Date('2026-08-18T14:00:00Z'), dryRun: false,
  });
  assert.equal(row.member_name, null);
  assert.equal(row.tenure_days, null);
  assert.equal(row.dry_run, false);
});

test('surveyUrl builds the tokenised public link', () => {
  assert.equal(
    surveyUrl('https://survey.westcoaststrength.com', '6mo', 'abc123'),
    'https://survey.westcoaststrength.com/6mo?t=abc123',
  );
  // Trailing slash on the base must not double up.
  assert.equal(
    surveyUrl('https://survey.westcoaststrength.com/', '6mo', 'abc123'),
    'https://survey.westcoaststrength.com/6mo?t=abc123',
  );
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd ghl-sync && node --test src/nps/npsInvites.test.js`
Expected: FAIL with `Cannot find module './npsInvites'`

- [ ] **Step 3: Write the implementation**

Create `ghl-sync/src/nps/npsInvites.js`:

```js
const crypto = require('crypto');

// 24 random bytes -> 32 base64url chars. The token is the ONLY credential
// protecting a member's survey, so it must not be guessable or sequential.
function generateToken() {
  return crypto.randomBytes(24).toString('base64url');
}

function tenureDays(beginDate, targetDate) {
  if (!beginDate) return null;
  const ms = Date.parse(`${targetDate}T00:00:00Z`) - Date.parse(`${beginDate}T00:00:00Z`);
  if (Number.isNaN(ms)) return null;
  return Math.round(ms / 86400000);
}

// A complete nps_invites row. Whole rows only — a partial upsert would fail the
// NOT NULL columns.
function buildInvite({ survey, member, targetDate, now = new Date(), dryRun = true }) {
  const name = [member.first_name, member.last_name].filter(Boolean).join(' ').trim();
  const expiresAt = new Date(
    Date.parse(now.toISOString()) + (Number(survey.expires_days) || 30) * 86400000,
  ).toISOString();

  return {
    survey_id: survey.id,
    token: generateToken(),
    member_id: member.member_id,
    club_number: member.club_number,
    ghl_contact_id: null,
    // Snapshots. The member may cancel, change email, or change name before
    // they get round to answering.
    member_email: member.email,
    member_name: name || null,
    tenure_days: tenureDays(member.begin_date, targetDate),
    trigger_date: targetDate,
    status: 'pending',
    sent_at: null,
    ghl_tag_applied_at: null,
    ghl_error: null,
    opened_at: null,
    responded_at: null,
    expires_at: expiresAt,
    dry_run: dryRun,
  };
}

function surveyUrl(baseUrl, slug, token) {
  return `${String(baseUrl).replace(/\/+$/, '')}/${slug}?t=${token}`;
}

module.exports = { generateToken, tenureDays, buildInvite, surveyUrl };
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd ghl-sync && node --test src/nps/npsInvites.test.js`
Expected: PASS, 5 tests

- [ ] **Step 5: Commit**

```bash
git add ghl-sync/src/nps/npsInvites.js ghl-sync/src/nps/npsInvites.test.js
git commit -m "feat(nps): invite row construction and token generation"
```

---

### Task 4: Cohort selection

**Files:**
- Create: `ghl-sync/src/nps/npsCohort.js`
- Test: `ghl-sync/src/nps/npsCohort.test.js`

**Interfaces:**
- Consumes: `cohortFilters`, `targetDates` from `./npsTriggers`.
- Produces:
  - `MEMBER_SELECT: string`
  - `loadMembersFor({ db, filters, audienceFilter }) => Promise<object[]>`
  - `loadCooldownMemberIds({ db, cooldownDays, now }) => Promise<Set<string>>`
  - `selectCohort({ db, survey, now }) => Promise<{ candidates: Array<{member, targetDate}>, skipped: { noEmail: number, cooldown: number } }>`

- [ ] **Step 1: Write the failing test**

Create `ghl-sync/src/nps/npsCohort.test.js`:

```js
const test = require('node:test');
const assert = require('node:assert');
const { selectCohort } = require('./npsCohort');

// Minimal fake of the supabase-js query builder: records the filters applied
// and returns whatever rows the fixture supplies for that table.
function fakeDb(tables) {
  return {
    calls: [],
    from(table) {
      const state = { table, eq: {}, in: {}, gte: null };
      const self = this;
      const builder = {
        select() { return builder; },
        eq(col, val) { state.eq[col] = val; return builder; },
        in(col, vals) { state.in[col] = vals; return builder; },
        gte(col, val) { state.gte = [col, val]; return builder; },
        range(from, to) {
          self.calls.push(state);
          const rows = (tables[table] || []).filter(r => {
            for (const [c, v] of Object.entries(state.eq)) if (r[c] !== v) return false;
            for (const [c, vs] of Object.entries(state.in)) if (!vs.includes(r[c])) return false;
            return true;
          });
          return Promise.resolve({ data: rows.slice(from, to + 1), error: null });
        },
      };
      return builder;
    },
  };
}

const SURVEY_6MO = {
  id: 'srv-6mo', slug: '6mo', trigger_type: 'tenure_months', trigger_value: 6,
  send_window_days: 1, resend_cooldown_days: 60, expires_days: 30,
  audience_filter: {},
};

test('selectCohort returns members whose begin_date matches the anniversary', async () => {
  const db = fakeDb({
    abc_members: [
      { member_id: 'M1', club_number: '30935', email: 'a@x.com', begin_date: '2026-02-18', is_active: true },
      { member_id: 'M2', club_number: '30935', email: 'b@x.com', begin_date: '2026-02-17', is_active: true },
    ],
    nps_invites: [],
  });

  const out = await selectCohort({ db, survey: SURVEY_6MO, now: new Date('2026-08-18T14:00:00Z') });

  assert.equal(out.candidates.length, 1);
  assert.equal(out.candidates[0].member.member_id, 'M1');
  assert.equal(out.candidates[0].targetDate, '2026-08-18');
});

test('selectCohort skips members with no email', async () => {
  const db = fakeDb({
    abc_members: [
      { member_id: 'M1', club_number: '30935', email: null, begin_date: '2026-02-18', is_active: true },
      { member_id: 'M2', club_number: '30935', email: '   ', begin_date: '2026-02-18', is_active: true },
    ],
    nps_invites: [],
  });

  const out = await selectCohort({ db, survey: SURVEY_6MO, now: new Date('2026-08-18T14:00:00Z') });

  assert.equal(out.candidates.length, 0);
  assert.equal(out.skipped.noEmail, 2);
});

test('selectCohort suppresses members invited inside the cooldown, across surveys', async () => {
  const db = fakeDb({
    abc_members: [
      { member_id: 'M1', club_number: '30935', email: 'a@x.com', begin_date: '2026-02-18', is_active: true },
    ],
    // A DIFFERENT survey invited this member recently.
    nps_invites: [{ member_id: 'M1', survey_id: 'srv-other', created_at: '2026-08-01T00:00:00Z' }],
  });

  const out = await selectCohort({ db, survey: SURVEY_6MO, now: new Date('2026-08-18T14:00:00Z') });

  assert.equal(out.candidates.length, 0);
  assert.equal(out.skipped.cooldown, 1);
});

test('selectCohort walks the whole send window and dedupes a member across days', async () => {
  const db = fakeDb({
    abc_members: [
      { member_id: 'M1', club_number: '30935', email: 'a@x.com', begin_date: '2026-02-18', is_active: true },
      { member_id: 'M2', club_number: '30935', email: 'b@x.com', begin_date: '2026-02-17', is_active: true },
    ],
    nps_invites: [],
  });

  const out = await selectCohort({
    db, survey: { ...SURVEY_6MO, send_window_days: 2 }, now: new Date('2026-08-18T14:00:00Z'),
  });

  // M1 matches 2026-08-18, M2 matches 2026-08-17. Both in, one each.
  assert.equal(out.candidates.length, 2);
  const ids = out.candidates.map(c => c.member.member_id).sort();
  assert.deepEqual(ids, ['M1', 'M2']);
});

test('selectCohort narrows to the audience club list when set', async () => {
  const db = fakeDb({
    abc_members: [
      { member_id: 'M1', club_number: '30935', email: 'a@x.com', begin_date: '2026-02-18', is_active: true },
      { member_id: 'M2', club_number: '7655', email: 'b@x.com', begin_date: '2026-02-18', is_active: true },
    ],
    nps_invites: [],
  });

  const out = await selectCohort({
    db, survey: { ...SURVEY_6MO, audience_filter: { club_numbers: ['7655'] } },
    now: new Date('2026-08-18T14:00:00Z'),
  });

  assert.equal(out.candidates.length, 1);
  assert.equal(out.candidates[0].member.club_number, '7655');
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd ghl-sync && node --test src/nps/npsCohort.test.js`
Expected: FAIL with `Cannot find module './npsCohort'`

- [ ] **Step 3: Write the implementation**

Create `ghl-sync/src/nps/npsCohort.js`:

```js
const { cohortFilters, targetDates, pacificToday, addDays } = require('./npsTriggers');

// Lazy so this module can be required in tests with no SUPABASE_URL set —
// db/supabase.js calls createClient() eagerly at import time.
let _defaultDb = null;
function getDefaultDb() {
  if (!_defaultDb) _defaultDb = require('../db/supabase');
  return _defaultDb;
}

const MEMBER_SELECT = [
  'member_id', 'club_number', 'email', 'first_name', 'last_name',
  'is_active', 'member_status', 'member_status_date',
  'begin_date', 'sign_date', 'since_date', 'membership_type',
].join(', ');

const PAGE_SIZE = 1000;

// Supabase caps .select() at 1000 rows by default. Every member read paginates
// or large clubs are silently truncated.
async function loadMembersFor({ db, filters, audienceFilter = {} }) {
  const rows = [];
  let from = 0;
  for (;;) {
    let q = db.from('abc_members').select(MEMBER_SELECT);
    if (filters.beginDate) q = q.eq('begin_date', filters.beginDate);
    if (filters.memberStatus) q = q.eq('member_status', filters.memberStatus);
    if (filters.memberStatusDate) q = q.eq('member_status_date', filters.memberStatusDate);
    if (filters.requireActive) q = q.eq('is_active', true);
    const clubs = audienceFilter.club_numbers;
    if (Array.isArray(clubs) && clubs.length) q = q.in('club_number', clubs);

    const { data, error } = await q.range(from, from + PAGE_SIZE - 1);
    if (error) throw new Error(`[NPS] failed to load abc_members: ${error.message}`);
    if (!data || data.length === 0) break;
    rows.push(...data);
    if (data.length < PAGE_SIZE) break;
    from += PAGE_SIZE;
  }
  return rows;
}

// Global suppression: any invite for this member, from ANY survey, inside the
// cooldown. Surveying someone twice in a month is how a feedback programme
// teaches members to ignore it.
async function loadCooldownMemberIds({ db, cooldownDays, now }) {
  const since = addDays(pacificToday(now), -Math.max(0, Number(cooldownDays) || 0));
  const ids = new Set();
  let from = 0;
  for (;;) {
    const { data, error } = await db
      .from('nps_invites')
      .select('member_id, created_at')
      .gte('created_at', `${since}T00:00:00Z`)
      .range(from, from + PAGE_SIZE - 1);
    if (error) throw new Error(`[NPS] failed to load nps_invites: ${error.message}`);
    if (!data || data.length === 0) break;
    for (const r of data) ids.add(r.member_id);
    if (data.length < PAGE_SIZE) break;
    from += PAGE_SIZE;
  }
  return ids;
}

function hasEmail(member) {
  return Boolean(member.email && String(member.email).trim());
}

/**
 * Candidate invites for one survey across its send window.
 * Returns at most one candidate per member even if two window days match.
 */
async function selectCohort({ db = getDefaultDb(), survey, now = new Date() }) {
  const today = pacificToday(now);
  const dates = targetDates(today, survey.send_window_days);
  const cooldownIds = await loadCooldownMemberIds({
    db, cooldownDays: survey.resend_cooldown_days, now,
  });

  const candidates = [];
  const seen = new Set();
  const skipped = { noEmail: 0, cooldown: 0 };

  for (const targetDate of dates) {
    const filters = cohortFilters(survey, targetDate);
    const members = await loadMembersFor({
      db, filters, audienceFilter: survey.audience_filter || {},
    });
    for (const member of members) {
      if (seen.has(member.member_id)) continue;
      if (!hasEmail(member)) { seen.add(member.member_id); skipped.noEmail++; continue; }
      if (cooldownIds.has(member.member_id)) { seen.add(member.member_id); skipped.cooldown++; continue; }
      seen.add(member.member_id);
      candidates.push({ member, targetDate });
    }
  }

  return { candidates, skipped };
}

module.exports = {
  MEMBER_SELECT, loadMembersFor, loadCooldownMemberIds, selectCohort,
};
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd ghl-sync && node --test src/nps/npsCohort.test.js`
Expected: PASS, 6 tests

- [ ] **Step 5: Commit**

```bash
git add ghl-sync/src/nps/npsCohort.js ghl-sync/src/nps/npsCohort.test.js
git commit -m "feat(nps): cohort selection with cooldown and email filters"
```

---

### Task 5: Job orchestration (dry run)

**Files:**
- Create: `ghl-sync/src/nps/npsJob.js`
- Test: `ghl-sync/src/nps/npsJob.test.js`

**Interfaces:**
- Consumes: `selectCohort` from `./npsCohort`, `buildInvite` from `./npsInvites`, `isJobTrigger` from `./npsTriggers`.
- Produces:
  - `loadActiveSurveys({ db }) => Promise<object[]>`
  - `insertInvites({ db, rows }) => Promise<object[]>` — returns only newly inserted rows
  - `runNpsSurvey(survey, { db, dryRun, now }) => Promise<summary>`
  - `runNpsAll({ db, dryRun, now }) => Promise<{ surveys: summary[] }>`

  `summary` is `{ slug, evaluated, created, skipped: { noEmail, cooldown, duplicate }, tagged, errors }`.

- [ ] **Step 1: Write the failing test**

Create `ghl-sync/src/nps/npsJob.test.js`:

```js
const test = require('node:test');
const assert = require('node:assert');
const { runNpsSurvey, runNpsAll } = require('./npsJob');

function fakeDb({ members = [], invites = [], surveys = [] } = {}) {
  const inserted = [];
  return {
    inserted,
    from(table) {
      const state = { table, eq: {}, in: {}, gte: null };
      const builder = {
        select() { return builder; },
        eq(c, v) { state.eq[c] = v; return builder; },
        in(c, v) { state.in[c] = v; return builder; },
        // Honoured, not ignored: the cooldown query is a gte on created_at, and
        // a fake that swallowed it would make the cooldown look like it caught
        // rows it never would in production — hiding whichever guard we meant
        // to test behind the wrong one.
        gte(c, v) { state.gte = [c, v]; return builder; },
        order() { return builder; },
        range(from, to) {
          const src = table === 'abc_members' ? members
            : table === 'nps_invites' ? invites
              : surveys;
          const rows = src.filter(r => {
            for (const [c, v] of Object.entries(state.eq)) if (r[c] !== v) return false;
            for (const [c, vs] of Object.entries(state.in)) if (!vs.includes(r[c])) return false;
            if (state.gte && !(String(r[state.gte[0]]) >= String(state.gte[1]))) return false;
            return true;
          });
          return Promise.resolve({ data: rows.slice(from, to + 1), error: null });
        },
        upsert(rows) {
          // Emulate ignoreDuplicates: only rows whose (survey_id, member_id,
          // trigger_date) is not already present come back.
          const fresh = rows.filter(r => !invites.some(i =>
            i.survey_id === r.survey_id && i.member_id === r.member_id && i.trigger_date === r.trigger_date));
          inserted.push(...fresh);
          return { select: () => Promise.resolve({ data: fresh, error: null }) };
        },
      };
      return builder;
    },
  };
}

const SURVEY_6MO = {
  id: 'srv-6mo', slug: '6mo', title: '6 Month Check-In', status: 'active',
  trigger_type: 'tenure_months', trigger_value: 6, send_window_days: 1,
  resend_cooldown_days: 60, expires_days: 30, audience_filter: {},
  ghl_tag: 'nps-6mo', ghl_field_key: 'contact.nps_survey_url',
};

const NOW = new Date('2026-08-18T14:00:00Z');

test('dry run creates invite rows and never touches GHL', async () => {
  const db = fakeDb({
    members: [{ member_id: 'M1', club_number: '30935', email: 'a@x.com', begin_date: '2026-02-18', is_active: true }],
  });
  let ghlCalls = 0;
  const put = async () => { ghlCalls++; };

  const summary = await runNpsSurvey(SURVEY_6MO, { db, dryRun: true, now: NOW, put });

  assert.equal(summary.created, 1);
  assert.equal(summary.tagged, 0);
  assert.equal(ghlCalls, 0);
  assert.equal(db.inserted.length, 1);
  assert.equal(db.inserted[0].dry_run, true);
  assert.equal(db.inserted[0].member_id, 'M1');
});

test('a rerun creates nothing when the invite already exists', async () => {
  const db = fakeDb({
    members: [{ member_id: 'M1', club_number: '30935', email: 'a@x.com', begin_date: '2026-02-18', is_active: true }],
    invites: [{ survey_id: 'srv-6mo', member_id: 'M1', trigger_date: '2026-08-18', created_at: '2000-01-01T00:00:00Z' }],
  });

  const summary = await runNpsSurvey(SURVEY_6MO, { db, dryRun: true, now: NOW, put: async () => {} });

  // The existing invite is dated 2000, far outside the 60-day cooldown, so the
  // cooldown does NOT catch this member. The row is built and offered to the
  // upsert, and the unique index is what rejects it. That is the guard under
  // test — if the cooldown swallowed it first this test would prove nothing.
  assert.equal(summary.evaluated, 1);
  assert.equal(summary.created, 0);
  assert.equal(summary.skipped.duplicate, 1);
  assert.equal(summary.skipped.cooldown, 0);
});

test('summary reports the skip reasons', async () => {
  const db = fakeDb({
    members: [
      { member_id: 'M1', club_number: '30935', email: null, begin_date: '2026-02-18', is_active: true },
      { member_id: 'M2', club_number: '30935', email: 'b@x.com', begin_date: '2026-02-18', is_active: true },
    ],
    invites: [{ member_id: 'M2', survey_id: 'srv-other', created_at: '2026-08-01T00:00:00Z' }],
  });

  const summary = await runNpsSurvey(SURVEY_6MO, { db, dryRun: true, now: NOW, put: async () => {} });

  assert.equal(summary.skipped.noEmail, 1);
  assert.equal(summary.skipped.cooldown, 1);
  assert.equal(summary.created, 0);
});

test('runNpsAll skips walkup and non-active surveys', async () => {
  const db = fakeDb({
    members: [{ member_id: 'M1', club_number: '30935', email: 'a@x.com', begin_date: '2026-02-18', is_active: true }],
    surveys: [
      SURVEY_6MO,
      { ...SURVEY_6MO, id: 'srv-qr', slug: 'feedback', trigger_type: 'walkup', trigger_value: null },
      { ...SURVEY_6MO, id: 'srv-draft', slug: 'draft', status: 'draft' },
    ],
  });

  const out = await runNpsAll({ db, dryRun: true, now: NOW, put: async () => {} });

  assert.equal(out.surveys.length, 1);
  assert.equal(out.surveys[0].slug, '6mo');
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd ghl-sync && node --test src/nps/npsJob.test.js`
Expected: FAIL with `Cannot find module './npsJob'`

- [ ] **Step 3: Write the implementation**

Create `ghl-sync/src/nps/npsJob.js`. This version has the GHL branch stubbed as a no-op; Task 7 fills it in.

```js
const { selectCohort } = require('./npsCohort');
const { buildInvite } = require('./npsInvites');
const { isJobTrigger } = require('./npsTriggers');

let _defaultDb = null;
function getDefaultDb() {
  if (!_defaultDb) _defaultDb = require('../db/supabase');
  return _defaultDb;
}

const PAGE_SIZE = 1000;

async function loadActiveSurveys({ db }) {
  const { data, error } = await db
    .from('nps_surveys')
    .select('*')
    .eq('status', 'active')
    .range(0, PAGE_SIZE - 1);
  if (error) throw new Error(`[NPS] failed to load nps_surveys: ${error.message}`);
  return (data || []).filter(s => isJobTrigger(s.trigger_type));
}

/**
 * Insert invite rows, letting the unique index absorb anything already sent.
 * ignoreDuplicates means .select() returns ONLY the rows actually inserted,
 * which is exactly the "what is new tonight" list the caller wants.
 */
async function insertInvites({ db, rows }) {
  if (!rows.length) return [];
  const { data, error } = await db
    .from('nps_invites')
    .upsert(rows, { onConflict: 'survey_id,member_id,trigger_date', ignoreDuplicates: true })
    .select();
  if (error) throw new Error(`[NPS] failed to insert nps_invites: ${error.message}`);
  return data || [];
}

/** Filled in by Task 7. Dry runs never reach it. */
async function applyGhlForInvites() {
  return { tagged: 0, errors: [] };
}

async function runNpsSurvey(survey, options = {}) {
  const {
    db = getDefaultDb(),
    dryRun = true,
    now = new Date(),
  } = options;

  const { candidates, skipped } = await selectCohort({ db, survey, now });

  const rows = candidates.map(({ member, targetDate }) =>
    buildInvite({ survey, member, targetDate, now, dryRun }));

  const created = await insertInvites({ db, rows });

  const summary = {
    slug: survey.slug,
    evaluated: candidates.length,
    created: created.length,
    skipped: { ...skipped, duplicate: rows.length - created.length },
    tagged: 0,
    errors: [],
  };

  if (!dryRun && created.length) {
    const ghl = await applyGhlForInvites(survey, created, { ...options, db, now });
    summary.tagged = ghl.tagged;
    summary.errors = ghl.errors;
  }

  return summary;
}

async function runNpsAll(options = {}) {
  const { db = getDefaultDb() } = options;
  const surveys = await loadActiveSurveys({ db });
  const results = [];
  for (const survey of surveys) {
    try {
      results.push(await runNpsSurvey(survey, { ...options, db }));
    } catch (err) {
      // One broken survey must never stop the others.
      console.error(`[NPS] survey ${survey.slug} failed:`, err.message);
      results.push({
        slug: survey.slug, evaluated: 0, created: 0,
        skipped: { noEmail: 0, cooldown: 0, duplicate: 0 },
        tagged: 0, errors: [err.message],
      });
    }
  }
  return { surveys: results };
}

module.exports = {
  loadActiveSurveys, insertInvites, applyGhlForInvites, runNpsSurvey, runNpsAll,
};
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd ghl-sync && node --test src/nps/npsJob.test.js`
Expected: PASS, 4 tests

- [ ] **Step 5: Run the whole nps suite**

Run: `cd ghl-sync && node --test src/nps/`
Expected: PASS, 24 tests total

- [ ] **Step 6: Commit**

```bash
git add ghl-sync/src/nps/npsJob.js ghl-sync/src/nps/npsJob.test.js
git commit -m "feat(nps): cohort job orchestration, dry run only"
```

---

### Task 6: Scheduler wiring

**Files:**
- Modify: `ghl-sync/src/scheduler.js`
- Create: `ghl-sync/docs/nps.md`

**Interfaces:**
- Consumes: `runNpsAll` from `./nps/npsJob`, `alertSyncFailed` from `./alerts`.
- Produces: nothing consumed by later tasks.

- [ ] **Step 1: Add the require at the top of scheduler.js**

In `ghl-sync/src/scheduler.js`, alongside the other requires at the top of the file, add:

```js
const { runNpsAll } = require('./nps/npsJob');
```

- [ ] **Step 2: Register the cron block**

In `ghl-sync/src/scheduler.js`, immediately after the lapsed check-in tagging block and **before** the closing `console.log` summary lines, insert:

```js
  // NPS lifecycle surveys — nightly, dark-launched behind NPS_ENABLED (default
  // off). Creates nps_invites rows for members hitting a milestone and tags
  // them in GHL so a workflow sends the email. Defaults to dry-run (invites
  // recorded, no GHL writes) until the rollout flips NPS_TAGGING_DRY_RUN=false.
  // See ghl-sync/src/nps/npsJob.js.
  if (process.env.NPS_ENABLED === 'true') {
    const npsHour = Number(process.env.NPS_HOUR || 7); // PST
    const npsHourUTC = (npsHour + 8) % 24;
    const npsDryRun = process.env.NPS_TAGGING_DRY_RUN !== 'false'; // default true
    let npsRunning = false;
    cron.schedule(`0 ${npsHourUTC} * * *`, async () => {
      if (npsRunning) {
        console.warn('[Scheduler] Previous NPS run still running — skipping');
        return;
      }
      npsRunning = true;
      console.log('[Scheduler] Starting NPS cohort job...');
      try {
        const summary = await runNpsAll({ dryRun: npsDryRun });
        console.log('[Scheduler] NPS results:', JSON.stringify(summary));
      } catch (err) {
        console.error('[Scheduler] NPS job failed:', err.message);
        await alertSyncFailed(err).catch(() => {});
      } finally {
        npsRunning = false;
      }
    });
    console.log(`[Scheduler] NPS scheduled daily at ${npsHour}:00 PST (${npsHourUTC}:00 UTC), dryRun=${npsDryRun}`);
  }
```

- [ ] **Step 3: Verify the module loads and the cron is not registered when disabled**

Run:

```bash
cd ghl-sync && NPS_ENABLED=false node -e "require('./src/scheduler'); console.log('loaded ok')"
```

Expected: prints `loaded ok` with no NPS scheduler line and no crash.

- [ ] **Step 4: Verify the enabled path logs the schedule**

Run:

```bash
cd ghl-sync && NPS_ENABLED=true node -e "require('./src/scheduler').startScheduler()" 2>&1 | grep NPS
```

Expected: a line reading `[Scheduler] NPS scheduled daily at 7:00 PST (15:00 UTC), dryRun=true`

Press Ctrl-C to stop; cron keeps the process alive.

- [ ] **Step 5: Write the operator doc**

Create `ghl-sync/docs/nps.md`:

```markdown
# NPS cohort job

Nightly job that finds members hitting a lifecycle milestone, records an
`nps_invites` row for each, and (when not dry running) tags them in GHL so a
workflow sends the survey email.

## Environment

| Variable | Default | Purpose |
| --- | --- | --- |
| `NPS_ENABLED` | unset (off) | Must be exactly `true` to register the cron |
| `NPS_HOUR` | `7` | Hour in US Pacific to run |
| `NPS_TAGGING_DRY_RUN` | `true` | Must be exactly `false` to enable GHL writes |
| `NPS_SURVEY_BASE_URL` | `https://survey.westcoaststrength.com` | Base for the tokenised link |

Dry run still writes `nps_invites` rows, flagged `dry_run = true`. That is
deliberate: it is how the cohorts get verified against real data before any
email exists.

## Verifying a dry run

```sql
select s.slug, i.dry_run, count(*), min(i.trigger_date), max(i.trigger_date)
from nps_invites i join nps_surveys s on s.id = i.survey_id
where i.created_at > now() - interval '1 day'
group by 1, 2 order by 1;
```

Sanity-check the counts against the expected daily volumes: roughly 39 new
joins, 16 cancels, 28 six-month and 11 one-year anniversaries per day.

## Going live

1. Confirm a few nights of dry-run cohorts look right.
2. Create the GHL tag and custom field for the survey, and set `ghl_tag` /
   `ghl_field_key` on the `nps_surveys` row.
3. Build the GHL workflow that triggers on the tag.
4. Set the survey's `audience_filter` to a single club to pilot.
5. Set `NPS_TAGGING_DRY_RUN=false`.
6. Widen the audience once delivery is confirmed.
```

- [ ] **Step 6: Commit**

```bash
git add ghl-sync/src/scheduler.js ghl-sync/docs/nps.md
git commit -m "feat(nps): schedule nightly cohort job behind NPS_ENABLED"
```

---

### Task 7: GHL tag and custom field write path

**Files:**
- Modify: `ghl-sync/src/nps/npsJob.js`
- Modify: `ghl-sync/src/nps/npsJob.test.js`

**Interfaces:**
- Consumes: `buildContactIndex`, `matchContact` from `../abc/contactIndex`; `get`, `put`, `sleep` from `../ghl/client`; `LOCATIONS` from `../config/locations`; `surveyUrl` from `./npsInvites`.
- Produces: a real `applyGhlForInvites(survey, invites, options) => Promise<{ tagged: number, errors: string[] }>` replacing the Task 5 stub.

- [ ] **Step 1: Write the failing test**

Append to `ghl-sync/src/nps/npsJob.test.js`:

```js
const { applyGhlForInvites } = require('./npsJob');

test('applyGhlForInvites writes the URL field before adding the tag', async () => {
  const order = [];
  const contacts = [
    { id: 'C1', email: 'a@x.com', first_name: 'Jo', last_name: 'Doe', tags: [], custom_fields: [] },
  ];
  const db = {
    from(table) {
      const builder = {
        select: () => builder,
        eq: () => builder,
        limit: () => Promise.resolve({ data: [], error: null }),
        range: () => Promise.resolve({
          data: table === 'ghl_contacts_v2' ? contacts : [], error: null,
        }),
        update: () => ({ eq: () => Promise.resolve({ error: null }) }),
      };
      return builder;
    },
  };

  const invites = [{
    id: 'INV1', member_id: 'M1', club_number: '30935',
    member_email: 'a@x.com', member_name: 'Jo Doe', token: 'tok123',
  }];
  const survey = { id: 'srv-6mo', slug: '6mo', ghl_tag: 'nps-6mo', ghl_field_key: 'contact.nps_survey_url' };

  const out = await applyGhlForInvites(survey, invites, {
    db,
    now: new Date('2026-08-18T14:00:00Z'),
    locations: [{ id: 'LOC1', name: 'Salem', slug: 'salem', clubNumber: '30935', apiKey: 'k' }],
    get: async () => ({ contact: { id: 'C1', tags: [] } }),
    put: async (path, body) => {
      // The workflow fires on the tag, so an empty URL field at tag time would
      // send a broken email. Record which landed first.
      if (body.customFields) order.push('field');
      if (body.tags) order.push('tag');
      return { contact: { id: 'C1' } };
    },
    sleepFn: async () => {},
    baseUrl: 'https://survey.westcoaststrength.com',
  });

  assert.equal(out.tagged, 1);
  assert.deepEqual(out.errors, []);
  assert.equal(order[0], 'field', 'custom field must be written before the tag');
  assert.equal(order[1], 'tag');
});

test('applyGhlForInvites records an error and keeps going when one contact fails', async () => {
  const contacts = [
    { id: 'C1', email: 'a@x.com', first_name: 'A', last_name: 'A', tags: [], custom_fields: [] },
    { id: 'C2', email: 'b@x.com', first_name: 'B', last_name: 'B', tags: [], custom_fields: [] },
  ];
  const db = {
    from(table) {
      const builder = {
        select: () => builder,
        eq: () => builder,
        limit: () => Promise.resolve({ data: [], error: null }),
        range: () => Promise.resolve({
          data: table === 'ghl_contacts_v2' ? contacts : [], error: null,
        }),
        update: () => ({ eq: () => Promise.resolve({ error: null }) }),
      };
      return builder;
    },
  };

  const invites = [
    { id: 'INV1', member_id: 'M1', club_number: '30935', member_email: 'a@x.com', token: 't1' },
    { id: 'INV2', member_id: 'M2', club_number: '30935', member_email: 'b@x.com', token: 't2' },
  ];
  const survey = { id: 's', slug: '6mo', ghl_tag: 'nps-6mo', ghl_field_key: 'contact.nps_survey_url' };

  const out = await applyGhlForInvites(survey, invites, {
    db,
    now: new Date('2026-08-18T14:00:00Z'),
    locations: [{ id: 'LOC1', name: 'Salem', slug: 'salem', clubNumber: '30935', apiKey: 'k' }],
    get: async () => ({ contact: { id: 'C1', tags: [] } }),
    put: async (path) => {
      if (path.includes('C2')) throw new Error('GHL 500');
      return { contact: {} };
    },
    sleepFn: async () => {},
    baseUrl: 'https://survey.westcoaststrength.com',
  });

  assert.equal(out.tagged, 1);
  assert.equal(out.errors.length, 1);
  assert.match(out.errors[0], /GHL 500/);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd ghl-sync && node --test src/nps/npsJob.test.js`
Expected: FAIL — `applyGhlForInvites` is still the stub, so `out.tagged` is `0` not `1`.

- [ ] **Step 3: Replace the stub**

In `ghl-sync/src/nps/npsJob.js`, add these requires at the top:

```js
const { buildContactIndex, matchContact } = require('../abc/contactIndex');
const { get: ghlGet, put: ghlPut, sleep: ghlSleep } = require('../ghl/client');
const DEFAULT_LOCATIONS = require('../config/locations');
const { surveyUrl } = require('./npsInvites');
```

Then replace the `applyGhlForInvites` stub with:

```js
/**
 * Write the survey URL to each invited member's GHL contact, then add the tag
 * that fires the sending workflow.
 *
 * Member->contact matching reuses ../abc/contactIndex, the same matcher the
 * lapsed-tagging job and reconcile.js use. Do not reinvent it: it handles the
 * ABC member-id custom field, email, phone and name fallbacks in a defined
 * precedence order.
 */
async function applyGhlForInvites(survey, invites, options = {}) {
  const {
    db = getDefaultDb(),
    now = new Date(),
    locations = DEFAULT_LOCATIONS,
    get: getFn = ghlGet,
    put: putFn = ghlPut,
    sleepFn = ghlSleep,
    baseUrl = process.env.NPS_SURVEY_BASE_URL || 'https://survey.westcoaststrength.com',
  } = options;

  const result = { tagged: 0, errors: [] };
  if (!survey.ghl_tag || !survey.ghl_field_key) {
    result.errors.push(`survey ${survey.slug} has no ghl_tag/ghl_field_key configured`);
    return result;
  }

  // Group the night's invites by club so each location's contacts load once.
  const byClub = new Map();
  for (const inv of invites) {
    if (!byClub.has(inv.club_number)) byClub.set(inv.club_number, []);
    byClub.get(inv.club_number).push(inv);
  }

  for (const [clubNumber, clubInvites] of byClub) {
    const location = locations.find(l => l.clubNumber === clubNumber);
    if (!location) {
      result.errors.push(`no GHL location configured for club ${clubNumber}`);
      continue;
    }

    const contacts = [];
    let from = 0;
    for (;;) {
      const { data, error } = await db
        .from('ghl_contacts_v2')
        .select('id, email, phone, first_name, last_name, tags, custom_fields')
        .eq('location_id', location.id)
        .range(from, from + PAGE_SIZE - 1);
      if (error) throw new Error(`[NPS] failed to load ghl_contacts_v2: ${error.message}`);
      if (!data || data.length === 0) break;
      contacts.push(...data);
      if (data.length < PAGE_SIZE) break;
      from += PAGE_SIZE;
    }

    const { data: fieldDefs } = await db
      .from('ghl_custom_field_defs')
      .select('id, field_key')
      .eq('location_id', location.id)
      .eq('field_key', 'contact.abc_member_id')
      .limit(1);

    const index = buildContactIndex(contacts, fieldDefs || []);

    for (const inv of clubInvites) {
      const match = matchContact(index, {
        member_id: inv.member_id,
        email: inv.member_email,
        primary_phone: null,
        mobile_phone: null,
        first_name: (inv.member_name || '').split(' ')[0] || null,
        last_name: (inv.member_name || '').split(' ').slice(1).join(' ') || null,
      });
      if (!match) {
        result.errors.push(`no GHL contact for member ${inv.member_id}`);
        await db.from('nps_invites')
          .update({ status: 'failed', ghl_error: 'no_ghl_contact' })
          .eq('id', inv.id);
        continue;
      }

      const url = surveyUrl(baseUrl, survey.slug, inv.token);
      try {
        // Field FIRST. The workflow triggers on the tag, so tagging before the
        // URL exists would send an email with an empty link.
        await putFn(`/contacts/${match.contact.id}`, {
          customFields: [{ key: survey.ghl_field_key, field_value: url }],
        }, location.apiKey);

        // Re-read so the tag write is a read-modify-write against live tags and
        // does not clobber tags added since the last sync.
        const live = await getFn(`/contacts/${match.contact.id}`, {}, location.apiKey);
        const existing = live?.contact?.tags ?? match.contact.tags ?? [];
        if (!existing.includes(survey.ghl_tag)) {
          await putFn(`/contacts/${match.contact.id}`, {
            tags: [...existing, survey.ghl_tag],
          }, location.apiKey);
        }

        await db.from('nps_invites').update({
          status: 'sent',
          ghl_contact_id: match.contact.id,
          sent_at: now.toISOString(),
          ghl_tag_applied_at: now.toISOString(),
          ghl_error: null,
        }).eq('id', inv.id);

        result.tagged++;
        await sleepFn(200);
      } catch (err) {
        // One member's failure must never abort the night.
        result.errors.push(`member ${inv.member_id}: ${err.message}`);
        await db.from('nps_invites')
          .update({ status: 'failed', ghl_error: err.message })
          .eq('id', inv.id);
      }
    }
  }

  return result;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd ghl-sync && node --test src/nps/npsJob.test.js`
Expected: PASS, 6 tests

- [ ] **Step 5: Run the whole nps suite plus the existing ghl-sync suite**

Run:

```bash
cd ghl-sync && node --test src/nps/ && node --test test/
```

Expected: all PASS. The existing `test/` suite must be unchanged — this task touched no shared module.

- [ ] **Step 6: Commit**

```bash
git add ghl-sync/src/nps/npsJob.js ghl-sync/src/nps/npsJob.test.js
git commit -m "feat(nps): GHL custom field and tag write path"
```

---

## Manual verification before opening the PR

- [ ] Run the full `ghl-sync` test suite: `cd ghl-sync && node --test src/ test/` — all pass.
- [ ] Confirm no module requires `db/supabase` at import time: `cd ghl-sync && node -e "require('./src/nps/npsJob'); console.log('ok')"` with no `SUPABASE_URL` set prints `ok`.
- [ ] Confirm the migration has not been applied to production. It is applied by hand at merge.
- [ ] Confirm `NPS_ENABLED` is not set in the Render worker environment, so merging changes nothing in production.

## PR notes

- Migration `108_nps_system.sql` must be applied by hand to the production
  Supabase project at merge time.
- The job ships dark: `NPS_ENABLED` unset means the cron is never registered.
- Even once enabled, `NPS_TAGGING_DRY_RUN` defaults to `true`, so the first
  live run records invites and sends nothing.

## Not in this plan

Phase 2 (public API + Cloudflare Worker), Phase 3 (admin UI + report),
Phase 4 (go-live), and Phase 5 (walk-up QR) each get their own plan and their
own PR. The `nps_responses`, `nps_response_scores`, `nps_metrics` and
`nps_club_qr` tables are created here but not written to until those phases.
