# Speed to Lead KPI — Design

**Date:** 2026-06-03
**Status:** Approved, pending implementation plan
**Branch / worktree:** `feat/speed-to-lead` (`.claude/worktrees/speed-to-lead`)
**Spans:** `ghl-sync` (new sync) + `auth` (new report route) + `portal` (KPI tile)

## Summary

Add a **Speed to Lead** KPI to the experimental KPIs report. It measures how
fast a human first reaches a lead: the time from **opportunity creation** to the
**first human outbound contact** (a manually-sent SMS or a logged call), reported
as the **median minutes** for the period, compared to an admin-set "max minutes"
goal (lower is better).

Because WCS auto-texts new leads, "first outbound message" is not a reliable
human signal. The detection therefore reads the GHL **Conversations API**, which
exposes a per-message `source` field: `'app'` = sent manually by a human,
`'workflow'` = automation. First human contact = earliest **outbound** message
with `source === 'app'` (SMS or call).

This is the first KPI that needs its own synced data and report endpoint (the
other three reuse `/reports/membership`).

## Verified facts (probe + code exploration, 2026-06-03)

- GHL message objects expose: `direction` ('inbound'|'outbound'), `messageType`
  ('TYPE_SMS', 'TYPE_CALL', 'TYPE_EMAIL', 'TYPE_ACTIVITY_*'…), `dateAdded` (ISO),
  `userId`, and **`source`** with observed values `'app'` and `'workflow'`.
  Live Salem data showed automated nurture texts as `source:'workflow'` and
  manual sends as `source:'app'`. `userId` is present on both, so **`source`**
  (not `userId`) is the human-vs-automation signal.
- `ghl_opportunities_v2` has `contact_id` (nullable) and `created_at_ghl`
  (`ghl-sync/migrations/001_ghl_sync_schema.sql`). Opportunities link to a
  contact for the conversations lookup.
- GHL client: axios, base `https://services.leadconnectorhq.com`, headers
  `Authorization: Bearer <per-location apiKey>`, `Version: 2021-07-28`
  (`ghl-sync/src/ghl/client.js`); per-location keys from env
  (`ghl-sync/src/config/locations.js`).
- No Conversations API usage exists today.
- Sync state/log tables (`ghl_sync_state`, `ghl_sync_log`), the scheduler
  (delta every 10 min, full daily 3am UTC offset — `ghl-sync/src/scheduler.js`),
  and report helpers (`resolveLocationFilter`, `dateToMs`, `applyDateRange`,
  `applyLocationFilter` in `auth/src/routes/reports.js`) are all established.

## Definitions

- **Lead created** = `ghl_opportunities_v2.created_at_ghl` (opportunity creation).
- **First human contact** = the earliest GHL message for the opportunity's contact
  where `direction === 'outbound'` AND `source === 'app'` AND `messageType` in
  (`TYPE_SMS`, `TYPE_CALL`). (Calls: confirmed SMS during the probe; call shape
  to be verified in implementation and treated identically when `source:'app'`.)
- **Speed to lead (per opportunity)** = `first_human_contact_at − created_at_ghl`,
  in minutes. Only positive deltas count; if first contact predates opportunity
  creation (rare; e.g. contact existed first), clamp to 0 — see edge cases.
- **KPI value (period)** = the **median** of per-opportunity speeds for
  opportunities created in the selected range that have a first human contact.

## Goals / Non-Goals

### Goals
- Median minutes-to-first-human-contact per club, vs an admin "max minutes" goal.
- Reliable human detection via `source === 'app'` (ignores the auto-text).
- Fits the existing KPIs report: tile + monthly trend (single club) + per-club
  table (multi-club), consistent with the other three KPIs.
- Generalize the report's KPI model so a duration/lower-is-better metric is a
  first-class KPI, not a special case bolted on.

### Non-Goals (YAGNI)
- No syncing of full conversation history or message bodies — we store only the
  single computed `first_human_contact_at` per opportunity.
- No inbound-message or reply-time metrics.
- No per-rep speed leaderboard in v1 (endpoint may expose the data; UI later).
- No real-time; freshness follows the existing delta cycle (≤10 min).

## Data layer (`ghl-sync`)

### New table `ghl_first_contact` (migration `ghl-sync/migrations/00X_first_contact.sql`)
```sql
CREATE TABLE IF NOT EXISTS ghl_first_contact (
  opportunity_id          TEXT PRIMARY KEY REFERENCES ghl_opportunities_v2(id),
  contact_id              TEXT,
  location_id             TEXT NOT NULL,
  opportunity_created_at  TIMESTAMPTZ,            -- snapshot for fast report math
  first_human_contact_at  TIMESTAMPTZ,            -- null until found
  first_contact_kind      TEXT,                   -- 'sms' | 'call'
  checked_at              TIMESTAMPTZ DEFAULT now(),
  resolved                BOOLEAN DEFAULT false   -- true once first contact found (frozen)
);
CREATE INDEX IF NOT EXISTS idx_first_contact_location ON ghl_first_contact(location_id);
CREATE INDEX IF NOT EXISTS idx_first_contact_oppcreated ON ghl_first_contact(opportunity_created_at);
```

### Fetcher `ghl-sync/src/ghl/conversations.js`
- `fetchFirstHumanContact(locationId, apiKey, contactId)`:
  - `GET /conversations/search?locationId=&contactId=&limit=...` to find the
    contact's conversation(s).
  - For each conversation, `GET /conversations/{id}/messages`; scan for the
    earliest message with `direction==='outbound' && source==='app' &&
    messageType in (TYPE_SMS, TYPE_CALL)`. Return `{ at, kind }` or null.
  - Reuse the axios client pattern + `Version: 2021-07-28`; honor rate limits
    (sequential per contact, small concurrency cap across contacts).

### Compute step `ghl-sync/src/sync/computeFirstContact.js`
- Select candidate opportunities to (re)check: those in the **Trial pipeline**
  with `contact_id NOT NULL` and either no `ghl_first_contact` row, or a row with
  `resolved = false` AND `opportunity_created_at >= now() - 30 days`.
  (Once `resolved=true`, never re-checked — first contact never changes.)
- For each candidate, call `fetchFirstHumanContact`; upsert a row:
  - found → `first_human_contact_at`, `first_contact_kind`, `resolved=true`.
  - not found → row with `first_human_contact_at=null`, `resolved=false`,
    `checked_at=now()` (will be retried next cycle while within the window).
- Bounded: a per-cycle cap (e.g. max N contacts) with `log()` of how many were
  deferred, so a backlog can't blow the API budget. Writes a `ghl_sync_log` row
  (`entity: 'first_contact'`).
- Registered in `deltaSync` (after opportunities) and runnable standalone for the
  initial backfill.

### Backfill
- A one-off invocation (or repeated delta cycles) walks existing Trial-pipeline
  opportunities within a chosen historical window to populate `ghl_first_contact`.
  Document the manual trigger; respect the per-cycle cap.

## Report layer (`auth`)

### `GET /reports/speed-to-lead`
- Params: `start_date`, `end_date`, `location_slug` (single | comma list | 'all'),
  matching the other report routes. Uses `resolveLocationFilter` + `dateToMs`.
- Query `ghl_first_contact` joined by `opportunity_created_at` in range and
  `location_id` filter, where `first_human_contact_at IS NOT NULL`.
- Compute per-row minutes = `(first_human_contact_at − opportunity_created_at)/60000`,
  clamped to ≥ 0. Return:
  ```json
  {
    "median_minutes": 12,
    "contacted_count": 84,
    "uncontacted_count": 9,        // opps in range with no human contact yet
    "total_opportunities": 93
  }
  ```
- Median computed in JS over the result set (consistent with how other routes
  aggregate in JS), or via a Postgres `percentile_cont` RPC if the row count is
  large — decide in the plan; JS is fine for expected volumes.
- Location filtering supports per-club calls (multi-club view fans out like the
  other KPIs) and 'all'.

## UI layer (`portal`) — generalize the KPI model

`KPI_DEFS` entries gain optional fields so a duration/lower-is-better KPI is
first-class:
```js
{
  key: 'speed',
  label: 'Speed to Lead',
  goalKey: 'kpi_goal_speed',
  source: 'speed-to-lead',     // which fetch feeds it (vs 'membership')
  format: 'minutes',           // 'percent' (default) | 'minutes'
  lowerIsBetter: true,         // default false
  derive: d => (d?.contacted_count ? d.median_minutes : null),
}
```

- **Fetch routing:** KPIs whose `source === 'membership'` read the existing
  combined membership response (as today). KPIs with another `source` (e.g.
  `'speed-to-lead'`) fetch their own endpoint. The report fetches each distinct
  source once per location/period and per trend month.
- **Formatting:** `format: 'minutes'` renders e.g. `12m` (or `1h 3m`); `percent`
  unchanged. The trend chart y-axis and point labels use the formatter.
- **Goal/gap direction:** `gapInfo` gains a `lowerIsBetter` mode — when true,
  actual ≤ goal is "above"/green (on target), actual > goal is red. Goal value is
  minutes. The on-goal counter in multi-club mode uses the same comparison.
- **Goal storage:** `kpi_goal_speed_<slug>` (minutes). `KpiGoalsAdmin` `GOAL_FIELDS`
  gains `{ prefix: 'kpi_goal_speed', label: 'Speed to Lead Goal (min)' }`.
- **Trend (single club):** median minutes per month over the comparison range —
  fetched per month from `/reports/speed-to-lead` (mirrors the membership trend
  fan-out). Months with no contacted opps are gaps.
- **Multi-club:** per-club median vs goal table (Hit/Missed by lowerIsBetter) +
  "X/Y clubs on goal" counter, identical pattern to the other KPIs.
- **reportInfo:** extend the KPIs popover to describe Speed to Lead, including the
  human-vs-automation detection and the "from opportunity creation" baseline.

## Components / responsibilities

| Unit | Responsibility |
| --- | --- |
| `ghl-sync/src/ghl/conversations.js` | Find first `source:'app'` outbound (SMS/call) for a contact |
| `ghl-sync/src/sync/computeFirstContact.js` | Pick candidates, call fetcher, upsert `ghl_first_contact`, bounded + logged |
| migration `00X_first_contact.sql` | `ghl_first_contact` table |
| `deltaSync` (edit) | Register the compute step |
| `auth` `/reports/speed-to-lead` | Median minutes + counts, location/date filtered |
| `portal` `api.js` (edit) | `getSpeedToLead(params)` helper |
| `portal` `kpiMath.js` (edit) | `gapInfo` gains `lowerIsBetter`; minutes formatter |
| `portal` `KpiReport.jsx` (edit) | KPI_DEFS gains source/format/lowerIsBetter; multi-source fetch; formatter in tiles/trend/table |
| `portal` `KpiGoalsAdmin.jsx` (edit) | Speed to Lead goal (min) field |
| `portal` `reportInfo.js` (edit) | Speed to Lead copy |

## Edge cases
- Opportunity with `contact_id = null` → excluded (cannot look up conversations).
- No human contact yet → counts toward `uncontacted_count`, excluded from median;
  stays `resolved=false` and is retried while inside the 30-day window, then aged
  out (stops being re-checked).
- First contact predates opportunity creation → clamp minutes to 0.
- `total_memberships`-style zero set (no contacted opps in range) → median `null`
  → tile shows "n/a".
- Multi-club 'all' / comma list → per-club fan-out, same as other KPIs.
- API errors per contact → skip that contact this cycle (no row poisoning), retry
  next cycle; surfaced in `ghl_sync_log.errors`.

## Testing
- Unit (`node --test`): `gapInfo` `lowerIsBetter` mode (≤ goal good, > goal bad,
  goal-met); minutes formatter; median helper (odd/even/empty).
- Unit: first-contact selection logic (given a list of messages, pick earliest
  outbound `source:'app'` SMS/call; ignore `workflow`/inbound/email/activity).
- Backend: `/reports/speed-to-lead` median + counts on a seeded set; location and
  date filtering.
- Manual: backfill a small window, verify a known lead's speed against GHL;
  confirm the auto-text is ignored and a manual text/call is picked.

## Rollout / safety
- The sync compute step is additive and bounded; if it errors it logs and the
  rest of the sync continues (per existing try/catch-per-entity pattern).
- The KPI tile only appears once `/reports/speed-to-lead` returns data; with an
  empty `ghl_first_contact` table it shows "n/a" (no crash), so it can ship before
  the backfill completes.

## Open follow-ups (not v1)
- Per-rep speed leaderboard.
- Include inbound-reply or answered-call nuance.
- Postgres `percentile_cont` RPC if volumes grow.
- Widen beyond the Trial pipeline if desired.
