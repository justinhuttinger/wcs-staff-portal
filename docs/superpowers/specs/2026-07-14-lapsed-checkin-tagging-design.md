# Lapsed Check-in Tagging — Design

**Date:** 2026-07-14
**Status:** Approved (design), pending implementation plan
**Author:** Justin + Claude

## Summary

A new nightly job in **ghl-sync** finds active gym members who have not checked
in for 10 / 21 / 30 days and applies an escalating tag to their GoHighLevel
(GHL) contact. The tags serve two purposes:

1. **Win-back / re-engagement** — each tag drives a GHL workflow (built on the
   WCS side) that texts/emails the member. Tags are removed automatically when
   the member checks in again, so they exit the workflow.
2. **Retention-risk visibility** — an Admin portal dashboard shows how many
   members sit in each tier per club, doubling the tag as a live at-risk report.

The feature reuses existing ghl-sync infrastructure: the per-member
`abc_members.last_check_in_timestamp` (already synced), the ABC-member → GHL
contact matching in `reconcile.js`, the per-location GHL API tokens, and the
`PUT /contacts/:id` tag writer. No new token infrastructure and no new
check-in table are required.

## Goals

- Tag active members lapsed 10 / 21 / 30 days with `lapsed-10d` / `lapsed-21d` /
  `lapsed-30d` (tag strings configurable).
- Remove all lapsed tags automatically when a member checks in again.
- Exclude members who should not be nagged (frozen, cancelled, new joins inside
  their grace window, and a configurable set of membership types).
- Give admins a portal page to (a) manage membership-type exclusions and
  (b) view the at-risk dashboard.
- Ship safely: dark-launched and dry-run-first, because this tags real people
  and triggers real outreach.

## Non-goals (v1)

- Winning back **cancelled / former** members (a different message + list; can be
  its own feature later).
- Individual per-member opt-outs in the UI (deferred to v1.1).
- Editing tier day-values / tag names from the UI (config/env for v1).
- Building the GHL win-back workflows themselves (done on the WCS/GHL side).

## Data sources (existing)

- **`abc_members`** (Supabase, project `ybopxxydsuwlbwxiuzve`, populated by
  ghl-sync's ABC sync every ~30 min). Relevant columns:
  - `member_id`, `club_number`, `email`, `primary_phone`, `mobile_phone`,
    `first_name`, `last_name`
  - `is_active` (boolean), `member_status` (text: Active / Freeze / Cancelled /
    Pending Cancel / Return For Collection / Problem / Expired / …)
  - `membership_type` (text, ~40 distinct values), `membership_type_abc_code`
  - `last_check_in_timestamp` (text, raw ABC string, **Pacific** local),
    `total_check_in_count` (int), `first_check_in_timestamp` (text)
  - Join-date candidates: `sign_date`, `begin_date`, `since_date` (dates)
- **`ghl_contacts_v2`** — GHL contacts per location. ABC member id is stored in
  `custom_fields` under the `contact.abc_member_id` field def (not a column).
- **`app_config`** — key/value config, shared by both services.
- **`abc_sync_run_log`** — append log of tag actions (`add_tag` / `remove_tag` /
  etc.), reused for audit + dry-run output.
- **Locations** — `ghl-sync/src/config/locations.js`: 7 clubs, each tying
  `slug` ↔ GHL `locationId` + `apiKey` (pit token) ↔ ABC `clubNumber`.

## Tagging logic

### Days-since-last-activity

```
activityDate = last_check_in_timestamp, or (if null) the member's join date
               (sign_date ?? begin_date ?? since_date)
daysSince    = whole Pacific calendar days between activityDate and "today" (PT)
```

Using the join date as the floor gives the **grace period** for free: a member
who joined 5 days ago and has never checked in has `daysSince = 5`, so they
cannot reach the 10-day tag until they have been a member 10 days.

`last_check_in_timestamp` is raw ABC text in Pacific time. Parse and compare on
**Pacific calendar days** to avoid the AT-TIME-ZONE day-walk / PST-vs-PDT
off-by-one that has bitten other ABC date logic. Days-since math lives in a pure,
unit-tested helper.

### Tier selection (mutually exclusive)

| daysSince | Tag |
|-----------|-----|
| ≥ 30 | `lapsed-30d` (terminal — held until return or cancel) |
| 21–29 | `lapsed-21d` |
| 10–20 | `lapsed-10d` |
| < 10 | none (all lapsed tags removed) |

A member holds **exactly one** lapsed tag at a time. Each run recomputes the
desired tag and strips the other two. When the member checks in, `daysSince`
falls below 10 and all three tags are removed on the next run → they exit the
win-back workflow.

### Eligibility filter

A member is evaluated only if **all** hold:

- `is_active = true`
- `member_status = 'Active'` (excludes Freeze, Pending Cancel, Return For
  Collection, Problem, Expired, Cancelled, etc.)
- `membership_type` is **not** in the configured exclusion list (below)

### Membership-type exclusions (seed)

Stored in `app_config` (key `lapsed_checkin_excluded_types`, JSON array of exact
`membership_type` strings). Seeded with:

- **Non-members / staff / non-gym:** `NON-MEMBER`, `Employee`, `Employee FAO`,
  `STAFF`, `PT ONLY`, `CHILDCARE`, `Z. Deleting Individual`, `Standard M2M`
- **Third-party subsidized:** `Active and Fit Limited`, `Active and Fit All Access`,
  `Active and Fit Premium`, `GYMPASS - WELLHUB`
- **Reciprocal use:** `A2 RECIP USE -Active Adult Reciprocal Use`
- **Short-term / seasonal:** `SUMMER MEMBERSHIP`, `TEMPORARY SINGLE`,
  `TEMPORARY STUDENT`, `TEMPORARY COUPLE`, `EVENT ACCESS`
- **Corporate:** `CORP`, `Corporate Business`

Active-Adult **core/exec** types (`A2 CORE`, `A2 EXEC`, `A2 EXEC 247`) are
intentionally **not** excluded — only reciprocal-use is. The list is fully
editable in the admin UI, so new types that appear later can be toggled without a
deploy.

### Member → GHL contact resolution

Reuse the matching chain from `reconcile.js`: `contact.abc_member_id` custom
field → email (lowercased) → phone (last 10 digits). Skip a match already
claimed by a *different* `abc_member_id` (family-plan guard). If no GHL contact
is found, the member is skipped (logged `no_match`); this job does **not** create
contacts (that stays the ABC reconcile job's responsibility).

### Applying tags

Read-modify-write on the live contact: GET the contact for its current `tags`,
compute the new set (add the tier tag, remove the other lapsed tags, leave all
non-lapsed tags untouched), and if changed `PUT /contacts/:id` with the full
`tags` array via the existing rate-limited client (`Version: 2021-07-28`,
per-location pit token, `sleep(650)` between writes). Every add/remove is logged
to `abc_sync_run_log`. No write is issued when the tag set is unchanged.

## Scheduling

A new `node-cron` job in `ghl-sync/src/scheduler.js`, modeled on the existing
nightly attribution job (PST→UTC hour conversion + a `running` re-entrancy
guard). Runs once nightly (default ~4–5am PST, after the daily full sync). It
iterates the 7 locations, and per location runs the eligibility query → resolve →
tag pass.

## Config & feature flags (ghl-sync env)

- `LAPSED_TAGGING_ENABLED` (default `false`) — master switch. Merged code is
  inert until flipped.
- `LAPSED_TAGGING_DRY_RUN` (default `true` on first enable) — compute + log
  intended tags to `abc_sync_run_log`, but issue **no** GHL writes.
- `LAPSED_TAGGING_HOUR` — nightly run hour (PST), optional.
- Tag strings + tier day-values as constants (config), not env, for v1.

## Admin UI (portal)

New **Admin → "Lapsed Check-ins"** page, admin-only (gated like the Forms
module), served by new auth API endpoints.

### Exclusions tab
- Lists **every** distinct `membership_type` currently in `abc_members` (live),
  each with an Exclude toggle and its active-member count.
- Reads/writes the `app_config` exclusion array. Saving takes effect on the next
  nightly run.
- Pre-seeded checked state from the seed list above.

### At-risk dashboard tab
- Counts per club × tier (10 / 21 / 30), computed **live** from the same
  eligibility query the job uses (works independent of GHL state, and reflects
  reality even in dry-run).
- Drill-down to the member list per club/tier (name, membership type, days since
  last check-in, last check-in date).
- This is the retention-risk report.

### API (auth)
- `GET /admin/lapsed-checkins/types` — distinct membership types + counts +
  current excluded flags.
- `PUT /admin/lapsed-checkins/types` — save the exclusion array to `app_config`.
- `GET /admin/lapsed-checkins/dashboard` — per-club × tier counts.
- `GET /admin/lapsed-checkins/dashboard/:club/:tier` — member drill-down.
- All admin-gated.

## Error handling

- A failing location does not abort the others; each club is wrapped and logged.
- GHL 429s use the client's existing retry + token-bucket limiter.
- Unresolved members are logged `no_match` and skipped, not retried in a loop.
- Job failures raise via the existing `alertSyncFailed` SMS path.
- Re-entrancy guard prevents overlapping runs.

## Testing

Pure-function unit tests (`node --test`, matching the forms services' style):

- days-since / grace-period math across Pacific timezone edges (PST↔PDT, midnight
  boundaries, join-date fallback when `last_check_in_timestamp` is null)
- tier selection at boundaries (9/10, 20/21, 29/30 days)
- mutually-exclusive tag diffing (add tier tag, strip the other two, preserve
  unrelated tags, no-op when unchanged)
- eligibility filtering (status + membership-type exclusion)

GHL writes reuse already-tested helpers; the dashboard query is validated against
live counts during the dry-run window.

## Rollout

1. Merge dark (`LAPSED_TAGGING_ENABLED=false`) — code inert.
2. Enable with `LAPSED_TAGGING_DRY_RUN=true`. Review the dashboard + run-log
   counts per club for a night or two; confirm numbers are sane.
3. Build/enable the GHL win-back workflows on the WCS side.
4. Flip `LAPSED_TAGGING_DRY_RUN=false` to go live.

## Open items / future

- v1.1: individual per-member opt-out list in the UI.
- v1.1: edit tiers/tag names + master switch from the UI.
- Cancelled-member win-back as a separate feature.
- Cleanup of lapsed tags on members who cancel while tagged (interim: have the
  GHL workflow exit/untag on the `cancelled / past member` tag).
