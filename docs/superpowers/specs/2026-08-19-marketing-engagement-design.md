# Marketing Engagement Report — Design

**Date:** 2026-08-19
**Status:** Approved design, ready for implementation planning
**Branch:** `feat/marketing-engagement`

## Goal

Give WCS per-location visibility into how automated outreach performs:

- **Email** — open rate, click rate, reply rate, bounce/unsubscribe, for both one-time campaigns and evergreen workflow automations.
- **SMS** — reply rate, delivery failures, opt-outs, and time-to-reply, broken out per automated text so an underperforming message is identifiable.

Both channels land in a single **Marketing Engagement** report with Email and SMS tabs sharing one location filter and one date range.

## Current state

`ghl-sync` already syncs GHL email campaign stats (migration `011_email_stats`, PR #391) across all three GHL segments — `emails`, `bulk-actions`, and `workflows` — into the `email_stats` table. The Email Marketing report (`auth/src/routes/emailMarketing.js`, `portal/src/components/reports/EmailMarketingReport.jsx`) reads that table.

There is no SMS engagement data anywhere. `auth/src/routes/smsHistory.js` reads Twilio for the portal's own alert number and is unrelated.

## Verified API findings

Live read-only probes against the per-location PIT tokens in `ghl-sync/.env`, 2026-08-19.

### Workflow emails are synced but invisible

Workflow campaign list records carry **no `completedAt`** — they are evergreen automations, not dated sends. `transformRow` therefore writes `completed_at = null`, and the report route filters `.gte('completed_at', start)` / `.lte('completed_at', end)`. Because the UI always sends a date range, every workflow row is silently dropped. The route already documents this behaviour as intentional; it is the bug reported as "email only does bulk".

The underlying data is real:

| Location | Workflow | Sent | Delivered | Opened | Open rate |
|---|---|---:|---:|---:|---:|
| Eugene | C. New Sale Flow | 54 | 54 | 17 | 31.48% |
| Eugene | Z. COLD LEAD FLOW | 159 | 158 | 36 | 22.78% |
| Eugene | B. Trial-Expired Call | 136 | 134 | 25 | 18.66% |
| Springfield | B. Trial-Expired Call | 160 | 156 | 24 | 15.38% |
| Salem | B. Trial-Expired Call | 184 | 180 | 22 | 12.22% |

### Workflow email stats are lifetime-cumulative

`GET /emails/public/v2/locations/{loc}/campaigns/stats/workflow-campaigns/{sourceId}` returns one running total per automation with **no date dimension**. Period figures are not obtainable from the API; they must be derived by snapshotting the cumulative counters and diffing.

### SMS messages expose `source`, but never a workflow id

`GET /conversations/{id}/messages` returns outbound SMS shaped like:

```json
{
  "id": "eqNUp1GHIzScnd0Muage",
  "direction": "outbound",
  "status": "delivered",
  "messageType": "TYPE_SMS",
  "source": "workflow",
  "body": "Hi Shaun!\n\nWelcome to your free week at ...",
  "contactId": "sOpFiwalhEIahJlDicFz",
  "conversationId": "Bc4DbIg9xicdna2IPfyi",
  "dateAdded": "2026-08-19T06:04:31.925Z",
  "from": "+19713965622",
  "to": "+15039319485"
}
```

`source` cleanly separates automated (`workflow`, `bulk_actions`) from staff-typed (`app`) — the same discriminator `ghl-sync/src/ghl/firstContactPick.js` already relies on. But **no workflow id or name appears on the message**, so per-automation grouping is only possible by clustering on the message body.

Conversation volume: Salem reports `total: 6244` from `/conversations/search`. `lastMessageDate` on each conversation record allows a watermark-based delta, but note it is **epoch milliseconds (a number)**, not an ISO string.

### Conversation pagination uses `startAfterDate`, nothing else

Verified live 2026-08-19. `/conversations/search` does **not** use the meta dual cursor that contacts and opportunities use, and it is not offset-based. `startAfterId`, `page`, `skip`, and `offset` are all silently ignored and return page 1 again. The only working cursor is `startAfterDate`, set to the epoch-ms `lastMessageDate` of the last row on the previous page. A four-page walk with it returned 80 unique conversations, zero duplicates, strictly decreasing dates.

Non-SMS rows (`TYPE_ACTIVITY_*`, `TYPE_CALL`) share the same feed and must be filtered out.

## Design

### Piece A — Email: split campaigns from automations

**Snapshot table.** New `ghl-sync` migration `014_email_stats_daily.sql`:

```
email_stats_daily(
  location text, source text, source_id text, snapshot_date date,
  sent, accepted, delivered, opened, clicked, unsubscribed,
  complained, permanent_fail, temporary_fail, rejected, failed, replied,  -- all int
  name text, subject text,
  primary key (location, source_id, snapshot_date)
)
```

Rows are whole-row upserts, never partial — a partial upsert always fails the NOT NULL columns (the #473/#474 trap). `emailStatsSync` writes one snapshot row per campaign per run, keyed on today's date, alongside its existing `email_stats` upsert. Repeated runs the same day overwrite that day's row, so the last run of the day wins.

Retention: unbounded for now. One row per campaign per day across seven locations is on the order of 400 rows/day; a prune job is not worth building until that changes.

**Period derivation.** For a range `[start, end]`, a workflow's period figure for counter `c` is:

```
value(latest snapshot with snapshot_date <= end)
  - value(latest snapshot with snapshot_date < start)
```

If no snapshot exists before `start`, the baseline is absent and the row is returned with `is_lifetime: true` rather than a fabricated period number. Rates are recomputed from the diffed counters, not carried over from GHL's precomputed lifetime rates — a lifetime `openRate` is meaningless for a period.

Counters can go backwards if GHL restates; a negative diff clamps to 0 and logs a warning.

**Route.** `auth/src/routes/emailMarketing.js` gains a second handler, `GET /email-marketing/automations?location_slug=&start_date=&end_date=`, returning `{ automations, totals, baseline_date }`. `baseline_date` is the snapshot date used as the baseline, so the UI can be honest about coverage. The existing `/campaigns` handler is unchanged except that it now explicitly filters to `source IN ('bulk-actions','email-campaigns')` rather than relying on the null-`completed_at` accident.

**UI.** The Email tab renders two tables: **Campaigns** (existing) and **Automations** (new). Automation rows without a baseline render their figures with a "lifetime to date" badge instead of period numbers.

### Piece B — SMS engagement

**Message store.** New `ghl-sync` migration `015_ghl_sms_messages.sql`:

```
ghl_sms_messages(
  id text primary key,                 -- GHL message id
  location text not null,
  location_id text not null,
  conversation_id text not null,
  contact_id text,
  direction text not null,             -- inbound | outbound
  source text,                         -- workflow | bulk_actions | app | null
  status text,                         -- delivered | failed | undelivered | ...
  body text,
  template_key text,                   -- null for inbound
  date_added timestamptz not null
)
index on (location, date_added)
index on (contact_id, date_added)
index on (template_key, date_added)
```

```
sms_templates(
  location text not null,
  template_key text not null,
  label text,                          -- human-assigned friendly name, nullable
  sample_body text not null,           -- first body seen, for identification
  first_seen_at timestamptz not null,
  last_seen_at timestamptz not null,
  primary key (location, template_key)
)
```

RLS enabled with no policy on both (service-role only, per house rule).

**Fingerprinting.** `template_key` is the first 16 hex characters of a SHA-256 over the normalized body:

1. Lowercase.
2. Strip URLs (`https?://\S+`), phone numbers, and all digit runs.
3. Strip a leading greeting token: `^(hi|hey|hello)[ ,!]+\S+` collapses to the greeting word alone, removing the merged first name.
4. Collapse whitespace and punctuation runs to a single space; trim.
5. Truncate to the first 160 characters.

Fingerprinting lives in its own pure module, `ghl-sync/src/sms/templateKey.js`, with unit tests covering: two sends differing only by first name collide; two different templates do not; a link-bearing template collides across differing short links.

Because copy edits produce a new key, `sms_templates.label` exists so a renamed or lightly edited template can be given the same human label. The report groups by `COALESCE(label, template_key)` within a location.

**Sync job.** `ghl-sync/src/sync/smsStatsSync.js`:

1. Read the per-location watermark from `sync_run_log` (last successful `sms-messages` run start, minus a 2h safety overlap).
2. Page `/conversations/search?locationId=&limit=&sortBy=last_message_date&sort=desc`, stopping at the first conversation whose `lastMessageDate` predates the watermark.
3. For each touched conversation, fetch messages via the existing `fetchAllMessages` pagination in `ghl-sync/src/ghl/conversations.js` — exported for reuse rather than duplicated.
4. Keep only `messageType === 'TYPE_SMS'`. Compute `template_key` for outbound. Upsert whole rows on `id`.
5. Upsert `sms_templates` (insert if absent, always bump `last_seen_at`).
6. Write a `sync_run_log` entry with `sync_type: 'sms-messages'`.

Scheduled from `ghl-sync/src/index.js` at `SMS_STATS_INTERVAL_MINUTES` (default 60), with `POST /api/sync/sms-messages[/:slug]` for manual runs, mirroring the email-stats wiring.

Rate limiting reuses `sleep(STATS_DELAY_MS)` between message fetches, keeping under GHL's ~100 req/min per location.

**Backfill.** A one-time `ghl-sync/scripts/backfillSmsMessages.js` runs the same walk with a fixed 180-day floor instead of a watermark. Estimated ~1 hour total across seven locations. It is idempotent (upsert on message id) and safe to re-run or resume.

**Reply attribution.** Computed in JavaScript at sync time and stored in an `sms_replies` table (`inbound_id` PK, `send_id`, `location`, `reply_minutes`, `is_opt_out`).

This is a change from the original query-time plan, made while writing the implementation plan. Query-time attribution would need the whole join expressed in SQL, which cannot be unit tested in this repo; sync-time attribution makes the rule a pure, fully tested JavaScript function and reduces the report query to a plain aggregate. The cost is that changing `SMS_REPLY_WINDOW_HOURS` requires re-running the sync over the affected window rather than taking effect instantly. The window is not expected to change often.

Attribution reloads each touched contact's messages from the database rather than attributing only the freshly fetched page, so a reply that arrives in a later sync run than its send still links correctly.

For each inbound SMS, the attributed send is the most recent outbound SMS to the same `contact_id` strictly before it, within `SMS_REPLY_WINDOW_HOURS` (default 72). An outbound send counts as replied if at least one inbound message attributes to it; multiple inbounds to one send count once.

Opt-outs: an inbound body matching `^\s*(stop|stopall|unsubscribe|cancel|end|quit)\b`, case-insensitive, attributed to the same send.

The report reads this through a Postgres function `sms_engagement_by_template(p_location, p_start, p_end, p_kind)` created by the migration and called via `supabase.rpc(...)`, matching the existing `revenue_summary` / `speed_to_lead_business` pattern. supabase-js cannot express GROUP BY, so an RPC is required regardless.

**Route.** New `auth/src/routes/smsMarketing.js`:

`GET /sms-marketing/templates?location_slug=&start_date=&end_date=&kind=` where `kind` is `automated` (default, `source IN ('workflow','bulk_actions')`), `staff` (`source = 'app'`), or `all`. Returns `{ templates, totals }` with, per template: `label`, `sample_body`, `sends`, `delivered`, `failed`, `replies`, `reply_rate`, `opt_outs`, `opt_out_rate`, `median_reply_minutes`.

Date filtering is on the **send** date, so a send late in the range whose reply arrives after `end_date` still counts its reply — the attribution window, not the report range, bounds attribution.

Gated `requireReportAccess('corporate', ['marketing-engagement'])`, matching the Meta Ads and Email Marketing pattern.

A second handler, `PATCH /sms-marketing/templates/:key?location_slug=`, sets `label`. Admin only. The location is required because labels are per location.

### Piece C — Report shell

`portal/src/components/reports/MarketingEngagementReport.jsx` owns the location pills, the date range, and an Email/SMS tab switch, rendering `EmailMarketingReport` (extended with the Automations table) and a new `SmsMarketingReport` beneath it.

Registration follows the existing path exactly:

- `portal/src/components/ReportingView.jsx` — icon, catalog entry `{ key: 'marketing-engagement', label: 'Marketing Engagement', desc: 'Email + SMS Performance' }`, added to the Marketing group's `reports` array, and the render branch.
- `portal/src/config/portalTiles.js` — `CUSTOM_REPORT_CATALOG` entry.
- Admin `CUSTOM_REPORT_KEYS`.
- `portal/src/lib/api.js` — `getSmsMarketingTemplates`, `getEmailAutomations`, `setSmsTemplateLabel` wrappers.
- Portal migration `auth/migrations/111_marketing_engagement_grant.sql` adding the report grant, applied by hand at merge (there is no migration runner).

The existing `email-marketing` report key stays registered and functional so nothing breaks for anyone holding that grant; Marketing Engagement supersedes it in the catalog.

Every content block sits in a `bg-surface` card for dark-backdrop legibility, and both tables omit templates and campaigns with zero sends in range entirely rather than rendering empty rows.

## Data flow

```
GHL Conversations API ─┐
                       ├─> ghl-sync smsStatsSync ──> ghl_sms_messages ─┐
                       │                             sms_templates      ├─> sms_engagement view
GHL Email Stats API ───┴─> ghl-sync emailStatsSync ─> email_stats       │
                                                      email_stats_daily ┘
                                                             │
                                          auth /sms-marketing, /email-marketing
                                                             │
                                              portal MarketingEngagementReport
```

## Error handling

- A location whose conversation walk fails is logged to `sync_run_log` and skipped; other locations still complete. Matches `emailStatsSync` behaviour.
- A single conversation whose message fetch fails is skipped and counted, not fatal to the location.
- The watermark only advances on a successful location run, so a failed run re-walks the same window next time rather than leaving a hole.
- Snapshot diffs that go negative clamp to 0 and log a warning.
- Missing baseline snapshots return `is_lifetime: true`, never a guessed number.

## Testing

Unit tests, colocated, matching repo convention:

- `ghl-sync/src/sms/templateKey.test.js` — the normalization and collision cases above.
- `ghl-sync/src/sms/replyAttribution.test.js` — pure attribution helper over fixture message lists: reply inside window, reply outside window, two inbounds to one send counted once, inbound with no preceding outbound ignored, opt-out detection.
- `ghl-sync/src/sync/emailSnapshotDiff.test.js` — period diff with baseline, without baseline, and with a restated (negative) counter.

Route tests follow the existing `auth` route test pattern with a stubbed Supabase client.

Manual verification before merge: run `POST /api/sync/sms-messages/springfield` (lowest volume), confirm row counts and that Springfield's known automated texts cluster into sensible templates.

## Rollout

1. Apply the `014` and `015` migrations by hand to prod.
2. Deploy `ghl-sync`; confirm the first scheduled `sms-messages` run in `sync_run_log`.
3. Run the 180-day backfill once, off-hours, one location at a time.
4. Deploy `auth` and `portal`; grant `marketing-engagement` to the corporate tier.
5. Email Automations shows "lifetime to date" until two snapshot days exist.

## Out of scope

- Attributing SMS replies to a specific GHL workflow. Impossible: no workflow id on the message.
- Sharing the snapshot-diff math between `ghl-sync` and `auth` as one module. The two packages have separate dependency roots, so `auth` carries a deliberate duplicate (`auth/src/routes/emailAutomationMath.js`) that must be changed alongside its `ghl-sync` twin.
- Revenue or conversion attribution from a reply.
- Any change to `smsHistory.js` or the Twilio alert-number feed.
- Retention and pruning for `ghl_sms_messages` or `email_stats_daily`.
