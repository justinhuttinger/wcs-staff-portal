# Check-in Milestone Alerts Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Members one visit short of a milestone get a show-once ABC alert. WCS ABC plays a party sound and shows a celebration banner when that alert appears on a check-in.

**Architecture:**
- **Nightly job (ghl-sync):** chained after the check-in months refresh.
  - Totals come from a new SQL function over `abc_member_checkin_months`.
  - Pure logic picks the candidates.
  - It posts to ABC `POST /{club}/members/alerts/{memberId}` and logs each alert in `checkin_milestone_alerts` so no alert is ever posted twice.
- **Launcher:** the sandboxed ABC preload (`abc-scraper.js`) detects the alert text on fresh check-in cards and triggers a new `'party'` level in `alert-sound.js`.

**Tech Stack:** Node (CommonJS), node:test, Supabase JS, axios, Postgres, Electron preload (sandboxed, no local requires), WebAudio.

**Spec:** `docs/superpowers/specs/2026-09-30-checkin-milestones-design.md`

## Global Constraints

- Milestones: 10, 25, 50, 100, 150, 200, 250, 300, then every 100 after (400, 500, ...).
- Alert text: `CELEBRATE <n>TH VISIT!`, with `!` dropped to fit. Max 22 characters, charset `A-Z 0-9 space ,_!%+-@^`, never `/`.
- Colour Green, fallback Blue once. NEVER Purple.
- `showOneTime: 'true'`, `acknowledge: 'false'`, no `expirationDate`.
- Eligible:
  - `is_active` and `member_status = 'Active'`.
  - Membership type not in `app_config.lapsed_checkin_excluded_types`.
  - Earliest non-blank of sign/begin/since date >= that club's `min(month)` in `abc_member_checkin_months`.
- Log row inserted only after ABC confirms via `abcOk` (a 200 with a failure status is a failure).
- Flags: `CHECKIN_MILESTONES_ENABLED` (must be `'true'` for the cron), `CHECKIN_MILESTONES_DRY_RUN` (dry unless `'false'`).
- No em-dashes in user-facing copy.
- PRs: (1) ghl-sync + migration 219, (2) launcher cue, (3) WCS ABC version bump. The migration is applied at merge.

## Review Focus

1. A member already alerted for a milestone who hasn't returned yet must NOT be re-alerted each night. Covered by the dedupe test in Task 3.
2. ABC returns 200 with `status.message` failure: no log row, member retried next night. Covered by the Task 3 test.
3. Member joined before the backfill start (or has no parseable join date): never alerted. Covered by the Task 2 eligibility tests.
4. Clubs over 1000 active members: totals must paginate past PostgREST's row cap. Covered by the Task 3 pagination test.
5. The same check-in card rescanned (pendingRecheck) must not play the party twice. Covered by the Task 5 `celebrated` set, checked manually.

---

### Task 1: Migration 219

**Files:** Create `auth/migrations/219_checkin_milestone_alerts.sql`

- [ ] Write the migration:

```sql
-- 219: check-in milestone alerts (ghl-sync checkinMilestonesJob.js).
-- One row per member per milestone we posted a show-once ABC alert for.
-- ABC alerts can't be listed or deleted through the API, so this is the only
-- thing that stops a member sitting on 9 visits getting a new alert nightly.
create table if not exists public.checkin_milestone_alerts (
  club_number  text not null,
  member_id    text not null,
  milestone    integer not null,
  visits       integer not null,           -- lifetime count when posted
  alert_text   text not null,
  color        text not null,
  posted_at    timestamptz not null default now(),
  abc_response jsonb,
  primary key (club_number, member_id, milestone)
);
create index if not exists checkin_milestone_alerts_posted
  on public.checkin_milestone_alerts (posted_at desc);
alter table public.checkin_milestone_alerts enable row level security;

-- Lifetime check-ins for a club's active members, summed across every club
-- they visited. Server-side so the job doesn't page ~400k month rows.
create or replace function public.checkin_milestone_totals(p_club text)
returns table (member_id text, visits bigint)
language sql stable
set search_path = public
as $$
  select m.member_id, sum(c.checkins)::bigint
  from abc_members m
  join abc_member_checkin_months c on c.member_id = m.member_id
  where m.club_number = p_club
    and m.is_active = true
    and m.member_status = 'Active'
  group by m.member_id
  order by m.member_id
$$;
revoke all on function public.checkin_milestone_totals(text) from public, anon, authenticated;

notify pgrst, 'reload schema';
```

- [ ] Commit: `feat(milestones): migration 219 checkin_milestone_alerts + totals fn`

### Task 2: Pure logic `ghl-sync/src/abc/checkinMilestones.js`

**Produces:** `isMilestone(n) -> bool`, `alertText(n) -> string|null`, `earliestJoin(member) -> 'YYYY-MM-DD'|null`, `isEligible(member, excludedTypes:Set, backfillStart:'YYYY-MM-DD') -> bool`, `planAlert({member, visits, excludedTypes, backfillStart}) -> {milestone, text}|null`.

- [ ] Write the tests in `ghl-sync/src/abc/checkinMilestones.test.js`:
  - `isMilestone`:
    - true for 10/25/50/100/150/200/250/300/400/1000/1500.
    - false for 9/11/350/450/0/-10/NaN.
  - `alertText`:
    - `CELEBRATE 10TH VISIT!`
    - `CELEBRATE 100TH VISIT!` (22 characters)
    - `CELEBRATE 1000TH VISIT` (no `!`)
    - `null` at 10000.
    - Every milestone from 1 to 9999 is <=22 characters and matches `^[A-Z0-9 ,_!%+\-@^]+$`.
  - `earliestJoin`:
    - Picks the earliest of the three dates.
    - Skips blank strings and unparseable values.
    - Returns null when there's none.
  - `isEligible` is false when:
    - the member is inactive,
    - the status is `'Inactive'`,
    - the type is excluded,
    - the join date is before the backfill start,
    - there's no join date,
    - or there's no backfill start.
  - `isEligible` is true when joined on the backfill start day.
  - `planAlert`:
    - visits 9 gives `{milestone:10, text}`.
    - visits 10 gives null.
    - visits 399 gives 400.
    - An ineligible member gives null.
- [ ] Run `cd ghl-sync && node --test src/abc/checkinMilestones.test.js`. Expect FAIL (module missing).
- [ ] Implement:

```js
// Check-in milestone alerts: which members get a "CELEBRATE 10TH VISIT!"
// show-once ABC alert tonight. Pure; the job is checkinMilestonesJob.js.
const FIXED = [10, 25, 50, 100, 150, 200, 250, 300]

function isMilestone(n) {
  return Number.isInteger(n) && (FIXED.includes(n) || (n > 300 && n % 100 === 0))
}

// ABC caps alert text at 22 chars (alpha, numeric, spaces, ,_!%+-@^; no "/").
// Every milestone ends in 0 or 5, so the suffix is always TH.
const MAX_TEXT = 22
function alertText(n) {
  const full = `CELEBRATE ${n}TH VISIT!`
  if (full.length <= MAX_TEXT) return full
  const bare = full.slice(0, -1)
  return bare.length <= MAX_TEXT ? bare : null
}

function ymd(v) {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(v || '').trim())
  return m ? `${m[1]}-${m[2]}-${m[3]}` : null
}

// Earliest, not first: a rejoin's newer sign_date must not hide an older
// since_date, or someone whose history predates the backfill slips in with a
// short count and gets celebrated late.
function earliestJoin(member) {
  const dates = [member.sign_date, member.begin_date, member.since_date].map(ymd).filter(Boolean).sort()
  return dates[0] || null
}

function isEligible(member, excludedTypes, backfillStart) {
  if (member.is_active !== true || member.member_status !== 'Active') return false
  if (excludedTypes.has(member.membership_type)) return false
  const join = earliestJoin(member)
  return Boolean(join && backfillStart && join >= backfillStart)
}

function planAlert({ member, visits, excludedTypes, backfillStart }) {
  const next = Number(visits) + 1
  if (!isMilestone(next) || !isEligible(member, excludedTypes, backfillStart)) return null
  const text = alertText(next)
  return text ? { milestone: next, text } : null
}

module.exports = { isMilestone, alertText, earliestJoin, isEligible, planAlert, MAX_TEXT }
```

- [ ] Run the tests. Expect PASS.
- [ ] Commit: `feat(milestones): milestone + eligibility logic`

### Task 3: Job `ghl-sync/src/abc/checkinMilestonesJob.js`

**Consumes:** Task 2 exports, `loadExcludedTypes(db)` from `./lapsedConfig`, the RPC `checkin_milestone_totals(p_club)` from Task 1.
**Produces:** `runCheckinMilestonesForClub(clubNumber, opts) -> summary`, `runCheckinMilestonesAll({dryRun}) -> summary[]`, `postAbcAlert(club, memberId, payload) -> {ok, data, error}`, `abcOk(data) -> bool`.

The options object is `{ dryRun=true, db, postAlert=postAbcAlert, sleepFn }`.

The summary is `{ club, backfillStart, members, candidates, alreadySent, posted, failed, planned: [{member_id, name, visits, milestone, text}] }`.

- [ ] Write the tests in `checkinMilestonesJob.test.js` with a fake `db`:
  - The fake is a chainable builder recording calls, returning canned `{data, error}` per table/rpc, and supporting `.range(from, to)` slicing.
  - Cases:
    - (a) dry run: planned lists the 9-visit member, `postAlert` is never called, nothing is inserted.
    - (b) live: `postAlert` is called with `{clubNumber, text, color:'Green', showOneTime:'true', acknowledge:'false'}`, and one row is inserted with `color:'Green'`.
    - (c) the member already has a row for that milestone: skipped, `alreadySent` = 1, no post.
    - (d) Green fails `abcOk` then Blue succeeds: the row is inserted with `color:'Blue'`.
    - (e) both fail: no insert, `failed` = 1.
    - (f) totals for 1500 members come back across two pages (the fake enforces a 1000 cap), and the member on page 2 is planned.
    - (g) no backfill start row: nothing is planned.
    - (h) `abcOk` is false for `{status:{message:'Invalid value'}}` and for `{status:{count:'0'}}`, and true for `{status:{message:'success'}}` and for `{}`.
- [ ] Run and expect FAIL.
- [ ] Implement:

```js
const axios = require('axios')
const { planAlert } = require('./checkinMilestones')
const { loadExcludedTypes } = require('./lapsedConfig')

// Lazy default client: see lapsedTaggingJob.js (db/supabase connects at import).
let _defaultDb = null
function getDefaultDb() {
  if (!_defaultDb) _defaultDb = require('../db/supabase')
  return _defaultDb
}

const ABC_BASE_URL = process.env.ABC_BASE_URL || 'https://api.abcfinancial.com/rest'
const PAGE = 1000
const COLORS = ['Green', 'Blue'] // Never Purple: that's staff alerts (blocking ack flow).

// ABC answers 200 with a failure in the body (prospects services/waiver/abc.js).
function abcOk(data) {
  const status = (data && data.status) || {}
  const message = String(status.message || '').toLowerCase()
  if (message && message !== 'success') return false
  if (status.count !== undefined && String(status.count) === '0') return false
  return true
}

async function postAbcAlert(clubNumber, memberId, payload) {
  try {
    const res = await axios.post(`${ABC_BASE_URL}/${clubNumber}/members/alerts/${memberId}`, payload, {
      headers: { app_id: process.env.ABC_APP_ID, app_key: process.env.ABC_APP_KEY, 'Content-Type': 'application/json', Accept: 'application/json' },
      timeout: 20000,
    })
    return abcOk(res.data) ? { ok: true, data: res.data } : { ok: false, data: res.data, error: (res.data.status || {}).message }
  } catch (err) {
    return { ok: false, error: (err.response && err.response.data) || err.message }
  }
}

async function pageAll(makeQuery, label) {
  const rows = []
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await makeQuery().range(from, from + PAGE - 1)
    if (error) throw new Error(`[Milestones] ${label}: ${error.message}`)
    if (!data || !data.length) break
    rows.push(...data)
    if (data.length < PAGE) break
  }
  return rows
}

async function runCheckinMilestonesForClub(clubNumber, options = {}) {
  const { dryRun = true, db = getDefaultDb(), postAlert = postAbcAlert, sleepFn = ms => new Promise(r => setTimeout(r, ms)) } = options
  const summary = { club: clubNumber, backfillStart: null, members: 0, candidates: 0, alreadySent: 0, posted: 0, failed: 0, planned: [] }

  const { data: first, error: firstErr } = await db.from('abc_member_checkin_months')
    .select('month').eq('club_number', clubNumber).order('month', { ascending: true }).limit(1)
  if (firstErr) throw new Error(`[Milestones] ${clubNumber}: backfill start: ${firstErr.message}`)
  summary.backfillStart = first && first[0] ? String(first[0].month).slice(0, 10) : null
  if (!summary.backfillStart) return summary

  const excludedTypes = await loadExcludedTypes(db)
  const members = await pageAll(() => db.from('abc_members')
    .select('member_id, first_name, last_name, is_active, member_status, membership_type, sign_date, begin_date, since_date')
    .eq('club_number', clubNumber).eq('is_active', true).eq('member_status', 'Active')
    .order('member_id'), `${clubNumber} members`)
  summary.members = members.length
  const totals = await pageAll(() => db.rpc('checkin_milestone_totals', { p_club: clubNumber }), `${clubNumber} totals`)
  const visitsById = new Map(totals.map(t => [t.member_id, Number(t.visits)]))

  const candidates = []
  for (const member of members) {
    const visits = visitsById.get(member.member_id) || 0
    const plan = planAlert({ member, visits, excludedTypes, backfillStart: summary.backfillStart })
    if (plan) candidates.push({ member, visits, ...plan })
  }
  summary.candidates = candidates.length
  if (!candidates.length) return summary

  const sent = new Set()
  const ids = candidates.map(c => c.member.member_id)
  for (let i = 0; i < ids.length; i += 200) {
    const { data, error } = await db.from('checkin_milestone_alerts')
      .select('member_id, milestone').eq('club_number', clubNumber).in('member_id', ids.slice(i, i + 200))
    if (error) throw new Error(`[Milestones] ${clubNumber}: sent lookup: ${error.message}`)
    for (const r of data || []) sent.add(`${r.member_id}:${r.milestone}`)
  }

  for (const c of candidates) {
    const id = c.member.member_id
    if (sent.has(`${id}:${c.milestone}`)) { summary.alreadySent++; continue }
    const name = `${c.member.first_name || ''} ${c.member.last_name || ''}`.trim()
    summary.planned.push({ member_id: id, name, visits: c.visits, milestone: c.milestone, text: c.text })
    if (dryRun) continue

    let result = null
    let color = null
    for (const col of COLORS) {
      result = await postAlert(clubNumber, id, { clubNumber, text: c.text, color: col, showOneTime: 'true', acknowledge: 'false' })
      if (result.ok) { color = col; break }
    }
    if (!color) {
      summary.failed++
      console.error(`[Milestones] ${clubNumber}: alert failed for ${id}: ${JSON.stringify(result.error)}`)
    } else {
      const { error } = await db.from('checkin_milestone_alerts').insert({
        club_number: clubNumber, member_id: id, milestone: c.milestone, visits: c.visits,
        alert_text: c.text, color, abc_response: result.data || null,
      })
      if (error) console.error(`[Milestones] ${clubNumber}: log insert failed for ${id}: ${error.message}`)
      summary.posted++
    }
    await sleepFn(250)
  }
  return summary
}

async function runCheckinMilestonesAll({ dryRun = true } = {}) {
  const clubs = require('../config/clubs.json').clubs.filter(c => c.active).map(c => c.clubNumber)
  const out = []
  for (const club of clubs) {
    try {
      const s = await runCheckinMilestonesForClub(club, { dryRun })
      console.log(`[Milestones] ${club}${dryRun ? ' (dry run)' : ''}: ${s.candidates} candidates, ${s.alreadySent} already sent, ${s.posted} posted, ${s.failed} failed`)
      for (const p of s.planned) console.log(`[Milestones]   ${club} ${p.name} (${p.member_id}) ${p.visits} visits -> ${p.text}`)
      out.push(s)
    } catch (err) {
      console.error(`[Milestones] ${club}: run failed: ${err.message}`)
      out.push({ club, error: err.message })
    }
  }
  return out
}

module.exports = { runCheckinMilestonesForClub, runCheckinMilestonesAll, postAbcAlert, abcOk }
```

- [ ] Run the tests. Expect PASS. Then run the full suite: `cd ghl-sync && npm test`.
- [ ] Commit: `feat(milestones): nightly milestone alert job`

### Task 4: Wire the scheduler + API route

**Files:** modify `ghl-sync/src/scheduler.js` (the check-in months cron, ~line 178) and `ghl-sync/src/app.js` (after the `/api/lapsed-tagging/run` route).

- [ ] In the check-in months cron, after the "Check-in months refreshed" log, inside the same try:

```js
      // Milestone alerts need tonight's counts, so they run only after a
      // successful refresh. Dark until CHECKIN_MILESTONES_ENABLED=true.
      if (process.env.CHECKIN_MILESTONES_ENABLED === 'true') {
        const { runCheckinMilestonesAll } = require('./abc/checkinMilestonesJob');
        const dryRun = process.env.CHECKIN_MILESTONES_DRY_RUN !== 'false';
        await runCheckinMilestonesAll({ dryRun });
      }
```

- [ ] Add the route in app.js:

```js
// POST /api/checkin-milestones/run: on-demand milestone alert pass (same
// shape as /api/lapsed-tagging/run). Body { dryRun?: boolean }, default from
// CHECKIN_MILESTONES_DRY_RUN (dry unless 'false'). Returns the per-club
// summaries including the planned list.
app.post('/api/checkin-milestones/run', requireSecret, async (req, res) => {
  try {
    const defaultDryRun = process.env.CHECKIN_MILESTONES_DRY_RUN !== 'false';
    const dryRun = typeof req.body?.dryRun === 'boolean' ? req.body.dryRun : defaultDryRun;
    const { runCheckinMilestonesAll } = require('./abc/checkinMilestonesJob');
    const summary = await runCheckinMilestonesAll({ dryRun });
    res.json({ dryRun, summary });
  } catch (err) {
    console.error('[API] Check-in milestones run failed:', err.message);
    res.status(500).json({ error: err.message });
  }
});
```

- [ ] Run `node -e "require('./src/abc/checkinMilestonesJob')"` in ghl-sync, then `npm test`.
- [ ] Commit: `feat(milestones): run after check-in refresh + manual route`. Push and open PR 1.

### Task 5: Launcher party cue (PR 2, new branch off master)

**Files:** modify `launcher/src/alert-sound.js`, `launcher/src/abc-scraper.js`. Create `launcher/src/milestone-cue.test.js`.

- [ ] Write the test. It extracts `function parseCelebration` from the scraper source, because the preload is sandboxed and can't be required:

```js
const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('fs')
const path = require('path')
const src = fs.readFileSync(path.join(__dirname, 'abc-scraper.js'), 'utf8')
const fnSrc = /function parseCelebration\([\s\S]*?\n}\n/.exec(src)[0]
const parseCelebration = new Function(fnSrc + 'return parseCelebration')()

test('reads the milestone from the ABC alert text', () => {
  assert.equal(parseCelebration('CELEBRATE 10TH VISIT!'), 10)
  assert.equal(parseCelebration('  celebrate 1000th visit '), 1000)
  assert.equal(parseCelebration('CELEBRATE 250TH VISIT!'), 250)
})
test('ignores everything else', () => {
  assert.equal(parseCelebration('PAYMENT OVERDUE 12 DAYS'), null)
  assert.equal(parseCelebration('PASS ACTIVE TO 09-04'), null)
  assert.equal(parseCelebration(''), null)
})
test('celebration alerts never trigger the purple lookup', () => {
  assert.match(src, /SYSTEM_ALERT_RE = \/[^\n]*celebrate/)
})
```

- [ ] Run `cd launcher && node --test src/milestone-cue.test.js`. Expect FAIL.
- [ ] In `alert-sound.js`:
  - Add `'party'` to the allowed levels in `play()`.
  - In `PAGE`'s `playCue`, add a party note list:
    - A triangle-wave arpeggio C5-E5-G5-C6: `[0,523,.16],[.11,659,.16],[.22,784,.16],[.33,1047,.45]`.
    - Then a sine sparkle: `[.55,1568,.12],[.63,2093,.12],[.71,2637,.3]`.
    - Peak 0.8.
  - Update the header comment.
- [ ] In `abc-scraper.js`:
  - Add `celebrate` to `SYSTEM_ALERT_RE`.
  - Add `parseCelebration(text)`, which returns the number or null.
  - Add `celebrated = new Set()`.
  - In `scanCheckinFeed`, for each fresh card, read `.datatrak-alert` texts through `parseCelebration`. If any hit and the cilid isn't already in `celebrated`, add it and queue `{name, n}`.
  - After the loop: if there is a party, call `showPartyCue(party, Boolean(worst))`, delayed 1.6s when `worst`, so the red beep plays first.
  - `showPartyCue`:
    - Uses its own closed shadow host.
    - Gold gradient banner at the top, pushed below the alert banner when one is showing.
    - Name line `🎉 <Name>`, sub line `<n>th visit! Give them a shout-out`.
    - 40 CSS confetti pieces, about 2.2s.
    - Click hides it. Auto-hides after 12s.
    - Calls `playCue('party')`.
- [ ] Run the test. Expect PASS. Then run `node --test src/` in the launcher.
- [ ] Commit, push, and open PR 2.

### Task 6: WCS ABC version bump (PR 3, after PR 2 merges)

- [ ] Set `launcher/electron-builder.abc.yml` `version` to 0.0.11 on a branch off master once PR 2 is merged. Justin builds and releases to R2 per the release steps.
