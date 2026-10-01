# Check-in Celebrations: Admin Settings + Time-Based Rules

Date: 2026-09-30. Builds on `2026-09-30-checkin-milestones-design.md` (lifetime
milestone alerts, live).

## Goal

1. Lifetime milestones become editable in Portal Admin instead of hardcoded.
2. Justin can add time-based celebration rules in the same admin page, in
   three types (each configurable, any number of days):
   - **Rolling:** X visits in any D days (e.g. 5 in 7, 12 in 30).
   - **New member:** X visits in the first D days after joining.
   - **Calendar month:** X visits in a calendar month.
3. Every celebration triggers the WCS ABC party cue (double fanfare and confetti).

## Settings (shared)

The settings live in `app_config` key `checkin_celebration_settings`, as a JSON text value:

```json
{
  "lifetime": { "enabled": true, "milestones": [10,25,50,100,150,200,250,300], "repeatEvery": 100 },
  "rules": [ { "id": "r1a2b3", "type": "rolling", "visits": 12, "days": 30, "enabled": true } ]
}
```

- `repeatEvery`: after the largest listed milestone, every N more visits is also a
  milestone. `0` turns it off.
- If the row is missing, the defaults apply. These match today's hardcoded behaviour
  and have no rules.
- One module, `celebrationSettings.js`, is kept as byte-identical copies in
  `auth/src/lib/` and `ghl-sync/src/abc/`, because they are separate Render
  deployables. A test in auth fails if the copies drift.
- The module exports:
  - `DEFAULT_SETTINGS`
  - `parseSettings(raw)`: tolerant; bad input gives the defaults.
  - `validateSettings(input)` returns `{ settings, errors }`; used when saving.
  - `isLifetimeMilestone(n, lifetime)`
  - `lifetimeText(n)`
  - `ruleText(rule)`
  - `ruleLabel(rule)`
- ABC alert text is at most 22 characters, using A-Z 0-9 space `,_!%+-@^`:

  | Rule type | Alert text | Example |
  |---|---|---|
  | lifetime | `CELEBRATE <n>TH VISIT!` | (unchanged) |
  | rolling | `<v> VISITS IN <d> DAYS!` | `12 VISITS IN 30 DAYS!` |
  | new_member | `<v> IN FIRST <d> DAYS!` | `8 IN FIRST 30 DAYS!` |
  | calendar_month | `<v> VISITS THIS MONTH!` | `15 VISITS THIS MONTH!` |

  - The `!` is dropped when needed to fit.
  - If the text still doesn't fit, `validateSettings` rejects the rule or milestone.

**Limits:**
- Milestones: integers 1-100000, de-duplicated and sorted.
- `visits`: 2-1000.
- `days`: 1-365. Ignored for calendar_month.
- At most 20 rules.
- No two enabled rules may share the same type, visits and days.

## Piece 1: editable lifetime milestones (PR A)

- **auth:** `routes/checkinCelebrations.js`, admin-only like Lapsed Check-Ins,
  mounted at `/admin/checkin-celebrations`. Routes:
  - `GET /settings` returns `{ settings, updated_at }`.
  - `PUT /settings` validates, upserts `app_config`, and returns the saved
    settings. A 400 response carries `errors[]`.
  - `GET /recent` returns the last 100 rows of `checkin_milestone_alerts` (later
    also rule alerts), with member name and club name.
- **portal:** `components/admin/CheckinCelebrations.jsx`, under Members & Sales:
  "Check-in Celebrations".
  - **Lifetime milestones card:**
    - number chips with x to remove, an add input, and "then every [N] after the
      last" (0 = off);
    - an enabled toggle;
    - a live ABC-text preview per chip, with red text if it's too long;
    - Save.
  - **Recent celebrations card:** a table of date, club, member, celebration.
  - Uses dark-backdrop cards (`bg-surface/95 backdrop-blur-sm`).
- **ghl-sync:** the job loads settings each run. `planAlert` uses
  `isLifetimeMilestone(n, settings.lifetime)`. With `lifetime.enabled=false`, it
  posts no lifetime alerts.

## Piece 2: daily check-in data (PR B)

- **Migration:** `abc_member_checkin_days (club_number, member_id, day date,
  checkins int, fetched_at)`, primary key `(club_number, member_id, day)`, RLS on.
- **ghl-sync** `src/abc/checkinDays.js`, `refreshCheckinDays({ days })`:
  - For each club and each Pacific day, it calls ABC
    `/members/checkins/summaries` with that one-day `checkInTimestampRange`
    (Pacific local, per the reference notes), paged at size 5000, and upserts
    the rows.
  - The nightly run re-fetches the last 3 days plus today so far, so late posts
    are caught.
  - It runs in the 5:15am cron after the months refresh and before the
    celebrations.
- Rows older than 400 days are pruned nightly.
- **Backfill:** `scripts/backfill-checkin-days.js <days>`, run once for 365 days.
  That is about 2,555 requests, roughly 15-20 minutes.

## Piece 3: time-based rules (PR C, then WCS ABC 0.0.12)

**Timing:** the job runs at about 5:15am Pacific on day T. "Visits so far" means
check-ins in the window from `abc_member_checkin_days` (including any already on
day T). A member qualifies when they are exactly one short and a visit today would
still land inside the window:

| Type | Window for a visit on day T | Candidate if |
|---|---|---|
| rolling (v, d) | `[T-d+1, T]` | visits in `[T-d+1, T]` == v-1 |
| new_member (v, d) | `[J, J+d-1]` (J = earliest join date) | `T <= J+d-1` and visits since J == v-1 |
| calendar_month (v) | the 1st of T's month to T | visits this month == v-1 |

- **Eligibility:** active, `Active` status, and not in the excluded types. This is
  the same base rule as lifetime milestones, without the backfill-join limit.
  - new_member also requires `J >= the daily data start`, so the first days are
    actually counted.
- **ABC alert:** `showOneTime:'true'`, Green (Blue fallback),
  `expirationDate = T` (YYYY-MM-DD). An unused alert lapses at the end of the day,
  and the job checks again the next morning.
- **Log table** `checkin_rule_alerts` (migration):
  - Columns:
    - `id`
    - `club_number`, `member_id`
    - `rule_key` (`type:visits:days`)
    - `alert_date` (= T)
    - `alert_text`, `color`
    - `posted_at`, `abc_response`
    - `earned_on` (date, null until confirmed)
  - Unique on `(club_number, member_id, rule_key, alert_date)`.
  - The job never posts the same rule to the same member twice on one date.
- **Earned check:**
  - Each run first marks any earlier row whose `alert_date` now has check-ins in
    the daily table, setting `earned_on = alert_date`.
  - **Once per window:** skip the member when the same `rule_key` has
    `earned_on > T - d` (rolling), any `earned_on` (new_member), or `earned_on` in
    T's month (calendar_month).
- **Admin:** a "Time-based celebrations" card in the same page. Each rule row has:
  - a type select, a visits field and a days field (days hidden for month);
  - an enabled toggle and delete;
  - a live ABC-text preview.
  - "Add rule" appends a row.
- **Recent card:** includes rule alerts. It shows Earned / Expired / Today status.
- **WCS ABC** `abc-scraper.js`:
  - `parseCelebration(text)` returns `{ label }` or null and recognises all four
    patterns.
  - The banner shows the label:
    - "10th visit!"
    - "12 visits in 30 days!"
    - "8 visits in first 30 days!"
    - "15 visits this month!"
  - The cue is the same double fanfare and confetti.
  - Ships as 0.0.12.

## Error handling

- ABC failures follow the lifetime job: nothing is logged, so the member is retried
  the next day; rule alerts are re-evaluated daily anyway.
- A settings parse failure in the job falls back to the defaults and logs a warning.
  It never throws, so the lifetime alerts keep working.

## Testing

- `celebrationSettings`:
  - every text fits;
  - validation limits and duplicate rules;
  - the drift check between the two copies.
- The job (time rules) uses a fake db, covering:
  - window maths for each type, including month boundaries;
  - the once-per-window block;
  - earned marking;
  - `expirationDate`.
- `checkinDays`: Pacific day range strings, paging, and the upsert shape.
- Launcher: parsing for all four texts.
