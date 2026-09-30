# Check-in Milestone Alerts: Design

Date: 2026-09-30. Status: approved in chat, awaiting spec review.

## Goal

The front desk celebrates members on their milestone visits (10th, 25th, 50th, ...).
Two parts:

1. **ABC alert (nightly, ghl-sync).** A member one visit short of a milestone gets a
   show-once ABC alert, so it appears on the check-in card of their milestone visit.
2. **WCS ABC party cue (launcher).** When a check-in card carries that alert, WCS ABC
   plays a party sound and shows a celebration banner.

## Milestones

10, 25, 50, 100, 150, 200, 250, 300, then every 100 after (400, 500, 600, ...).

`isMilestone(n)`: n in {10, 25, 50, 100, 150, 200, 250, 300} or (n >= 300 and n % 100 == 0).

## Part 1: nightly job (ghl-sync)

**Where:** `ghl-sync/src/abc/checkinMilestones.js` (pure logic) and
`ghl-sync/src/abc/checkinMilestonesJob.js` (DB + ABC, injectable for tests). It runs
inside the existing 5:15am PST check-in months cron, **after** `refreshRecentMonths`
succeeds, so counts are current. There is also a manual trigger,
`POST /api/checkin-milestones/run` (SYNC_SECRET), like the lapsed job.

**Count:** lifetime visits = `sum(checkins)` from `abc_member_checkin_months` for the
member at their club.

**Eligibility.** All of these must hold:
- `abc_members.is_active = true` and `member_status = 'Active'`.
- Not a NON-MEMBER record. The same membership-type exclusion list as lapsed tagging
  (`app_config.lapsed_checkin_excluded_types`) is reused.
- **Joined on or after the backfill start.**
  - Backfill start is `min(month)` in `abc_member_checkin_months` for that club.
  - Join date is the earliest non-blank of `sign_date` / `begin_date` / `since_date`.
  - Using the earliest date means a rejoin can't sneak in with truncated history.
  - Members with no parseable join date are skipped.

**Target:** the member qualifies when `count + 1` is a milestone. They then need an
alert for milestone `count + 1`.

**Dedupe:** new table `checkin_milestone_alerts`:

```
club_number text, member_id text, milestone int,
alert_text text, posted_at timestamptz default now(),
abc_response jsonb,
primary key (club_number, member_id, milestone)
```

- A member already logged for that milestone is skipped. ABC alerts cannot be
  listed or deleted through the API. Without this table, someone sitting on 9 visits
  who doesn't come back for a week would get a new alert every night.
- The row is inserted only after ABC confirms the write (`abcOk`: HTTP 200 alone is
  not success).
- RLS is enabled with no policies (service role only), matching the other sync tables.

**ABC write:** `POST /{club}/members/alerts/{memberId}`, using the same payload shape
as `addMemberAlert` in prospects---documents:

```
{ clubNumber, text, color: 'Green', showOneTime: 'true', acknowledge: 'false' }
```

- There is no `expirationDate`. The show-once alert waits for the next visit however
  long that takes.
- `text` is `CELEBRATE <n><suffix> VISIT!`, with the `!` dropped when needed to stay
  within ABC's 22-character limit. ABC allows alpha, numeric, spaces and `,_!%+-@^`,
  and no `/`.
  - `CELEBRATE 10TH VISIT!` is 21 characters.
  - `CELEBRATE 100TH VISIT!` is 22.
  - `CELEBRATE 1000TH VISIT` is 22, with the `!` dropped.
- The suffix is always `TH` for this milestone list.
- If ABC rejects `Green`, the fallback is to try `Blue` once. The job must never use
  Purple, because purple is reserved for staff alerts.
- Writes are throttled to one every ~250ms. If a write fails, that member is logged
  and the job moves on, and nothing is inserted, so the next night retries.

**Flags (dark launch):**
- `CHECKIN_MILESTONES_ENABLED`: the job does nothing unless this is `true`.
- `CHECKIN_MILESTONES_DRY_RUN`: default `true`. The job logs the full would-post list
  (club, member, count, text) and writes nothing to ABC or the table.
- Go-live means setting `DRY_RUN=false` once Justin has seen a dry-run list.

**Known gaps (accepted):**
- A member who goes from 8 to 10 in one day (two check-ins) skips that milestone.
- A check-in landing between the refresh and the alert post can shift the count by
  one. This is rare.

## Part 2: WCS ABC party cue (launcher)

**Detection** happens in `abc-scraper.js` `scanCheckinFeed`.
- A fresh card's `.datatrak-alert` text matching `/CELEBRATE\s+(\d+)\s*TH\s+VISIT/i`
  is a celebration.
- It is handled separately from the red/blue cue:
  - A card with both a red alert and a celebration plays red first, then the party cue.
  - The banners stack: celebration below.
- The same `seenCheckins` / `isFreshCheckin` / `pendingRecheck` rules apply, so
  older cards loaded by scrolling never cue.

**Sound:** a new `'party'` level in `alert-sound.js`, synthesized with the
existing WebAudio code. It is a quick rising major arpeggio (C-E-G-C) plus a
short sparkle, about 1.2s, with peak loudness matched to the blue chime. The volume
guard applies as for the other cues.

**Banner:** gold/amber, with a closed shadow root like the existing cue.
- Text: `🎉 <Name>: <n>th visit!` plus the hint "Give them a shout-out".
- A CSS-only confetti burst, about 2s.
- It auto-hides after 12s or on click, and never blocks the screen.

**Purple interplay:** add `celebrate` to `SYSTEM_ALERT_RE`, so the celebration
alert never triggers the member-alerts lookup once purple alerts launch.

**Release:** WCS ABC version bump in its own PR. Justin releases it to R2.

## Testing

- ghl-sync `node:test`:
  - `isMilestone` and the next-milestone logic.
  - Alert text length and characters for every milestone up to 3000.
  - Eligibility (join date vs backfill start, earliest-date rule, excluded types,
    inactive).
  - The job with a fake db and ABC: dedupe skip, insert only on `abcOk`, no insert on
    failure, dry-run writes nothing, disabled does nothing.
- Launcher:
  - Unit test for the celebration regex and milestone parse (pure helper
    exported for tests).
  - A manual check against a fake card in a dev build.

## PRs

One concern per PR:
1. ghl-sync job + migration 219 (`checkin_milestone_alerts`).
2. Launcher party cue.
3. WCS ABC version bump, after 2 merges.

The migration is applied at merge, not before.
