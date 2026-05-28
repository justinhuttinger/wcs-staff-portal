# Referral Rewards — Design

**Date:** 2026-05-28
**Branch:** `feat/referral-rewards`
**Status:** Approved design, pending spec review

## Summary

When a new member signs up having been referred by an existing member, automatically
zero out the **referring** member's next month of dues in ABC Financial and notify them
via a GoHighLevel SMS workflow ("your friend signed up, enjoy your next month on us").

The whole flow is driven off the existing ABC sync reconcile loop — every cycle we
already match active ABC members to their GHL contacts. We extend that to detect a
populated referral field, apply the ABC dues credit, and tag the referrer's contact so
a GHL workflow sends the SMS. Flagged edge cases (no dues invoice / no referrer contact)
surface in a new admin-only "Referral Rewards" page in the portal, not as an alert SMS.

## Goals

- Reward the **referrer** (not the new signup) with one free month of dues.
- Reward each referral **exactly once**, never re-charge or double-credit on the
  30-minute sync cadence.
- Never send the "free month" SMS unless the dues were actually zeroed first.
- Never reward the existing back-catalog of already-referred members on first deploy.
- Give admins a durable, queryable record of every referral and a way to resolve the
  manual-handling edge cases.

## Non-goals

- No new public/customer-facing UI. The referral field is captured upstream (signup
  form) and is out of scope here.
- No automated SMS sending from our code — GHL owns the message copy/sending.
- No reporting/analytics beyond the admin list (e.g. monthly referral counts) in v1.

## Inputs (confirmed)

- **Referrer identifier:** the new member's GHL contact custom field
  `contact.referred_by_abc_id` ("Referred By (ABC ID)") holds the referrer's **ABC
  member ID**.
- **ABC read endpoint:** `GET /{club}/members/{memberId}/agreements/invoices` returns
  upcoming invoices, each with `dueDate`, `profitCenterAbcCode`, `invoiceAmount`,
  `amountDue`.
- **ABC write endpoint:** `POST /{club}/members/{memberId}/agreements/invoiceadjustment`
  with body `{ startDate, profitCenterAbcCode, invoiceAmount, numberOfInvoices }`.
  - `startDate` = the `dueDate` of the invoice to adjust.
  - To zero a month: `{ startDate: <dueDate>, profitCenterAbcCode: "DUES",
    invoiceAmount: "0.00", numberOfInvoices: "1" }`.
- Both ABC endpoints are **club-scoped**, so the referrer must be a member of the same
  club as the new signup. This matches how referrals actually work in practice.

## Architecture

Three areas change:

1. **`ghl-sync/`** (Background/Web service) — detection + ABC calls + GHL tag write +
   write to the new `referral_rewards` table. This is where the work happens.
2. **`auth/`** (API) — a new admin-only `/referral-rewards` route: list + resolve.
3. **`portal/`** (React) — a new "Referral Rewards" admin tile + view.

### Data flow

```
ABC sync (every 30 min)
  └─ reconcileLocation(location)            [existing]
       ├─ match active ABC member → GHL contact   [existing]
       ├─ collect referral candidates              [new]
       │     candidate = active member whose matched GHL contact has a
       │       non-empty contact.referred_by_abc_id, sign_date >= PROGRAM_START_DATE,
       │       and no terminal referral_rewards row yet
       └─ after member loop: processReferralRewards(candidates, indexes)  [new]
             for each candidate:
               1. GET referrer invoices (same club)
               2. pick earliest future DUES invoice
               3a. none  → status no_dues_invoice → record row, no SMS  (admin flag)
               3b. found → POST invoiceadjustment to 0.00
                      success → write referral_friend_name + add 'referral reward' tag
                                to referrer's GHL contact  → GHL workflow sends SMS
                      no referrer GHL contact → status no_referrer_contact (admin flag)
                      ABC error → status error (retried next cycle)
               4. upsert referral_rewards row with status

Portal Admin → Referral Rewards tile
  └─ GET /referral-rewards  → list rows (needs-review highlighted)
  └─ POST /referral-rewards/:id/resolve  → mark a flagged row handled
```

## Components

### 1. `ghl-sync/src/config/referral.js` (new)

Central config so field keys / amounts aren't scattered:

```js
module.exports = {
  ENABLED: process.env.REFERRAL_REWARDS_ENABLED === 'true',
  PROGRAM_START_DATE: process.env.REFERRAL_PROGRAM_START_DATE || '2026-05-28',
  REFERRED_BY_FIELD_KEY: 'contact.referred_by_abc_id',
  FRIEND_NAME_FIELD_KEY: 'contact.referral_friend_name',
  REWARD_TAG: 'referral reward',
  DUES_PROFIT_CENTER: 'DUES',
  ADJUST_AMOUNT: '0.00',
  NUMBER_OF_INVOICES: '1',
};
```

### 2. `ghl-sync/src/abc/client.js` (extend)

Add two functions alongside the existing `fetchAllABCMembers`:

- `fetchMemberInvoices(clubNumber, memberId)` → `GET .../agreements/invoices`,
  returns the `invoices` array. Uses the existing `app_id`/`app_key` headers.
- `adjustInvoice(clubNumber, memberId, body)` → `POST .../agreements/invoiceadjustment`.
  Returns `{ ok: boolean, status, data }`. (`client.js` is currently GET-only; this adds
  the first ABC write.)

### 3. `ghl-sync/src/abc/referralRewards.js` (new)

Owns the per-referral logic so `reconcile.js` (already ~595 lines) only collects and
delegates. Exports:

- `pickNextDuesInvoice(invoices, today)` — **pure**, unit-tested. Returns the earliest
  invoice where `profitCenterAbcCode === 'DUES'` and `dueDate >= today`, or `null`.
- `isEligibleCandidate({ abcMember, referredByValue, existingRow, programStartDate })`
  — **pure**, unit-tested. Encodes the eligibility + idempotency decision:
  - referredBy non-empty, member active, `sign_date >= programStartDate`
  - skip if `existingRow.dues_status` is `zeroed` (done) or `no_dues_invoice`
    (terminal, staff-handled); retry if `error` or no row.
- `processReferralReward({ location, runId, abcMember, referrerAbcId, referrerContact,
  fieldKeyToId, apiKey, dryRun })` — orchestrates GET invoices → adjust → tag → record.
- `processReferralRewards(...)` — loops candidates, applies the 650ms write rate-limit
  between ABC/GHL writes, returns a summary `{ rewarded, flagged, errors }`.

**Ordering guarantee (the "SMS only after zero" requirement):** `adjustInvoice` is
awaited first; the GHL tag write (the only thing that triggers the SMS) physically comes
after a success check. A throw or non-success short-circuits before the tag is ever
written. The friend-name field and the tag are written in the **same** GHL `PUT`, so the
tag can never exist without the credit having been applied.

### 4. `ghl-sync/src/abc/reconcile.js` (extend)

- While matching active members, when `referral.ENABLED`, read
  `cf[referredByFieldId]` (look up `contact.referred_by_abc_id`'s field id the same way
  the existing fields are resolved) and push eligible candidates to a local array.
- Look up the `contact.referral_friend_name` field id and add it to `fieldKeyToId`.
- After the member loop, call `processReferralRewards(...)`, passing the in-scope
  `byMemberId` index (to resolve the referrer's GHL contact) and `apiKey`.
- Fold the referral summary into the returned `reconcileLocation` summary for logging.
- Respects the existing `DRY_RUN` flag — dry runs log intended actions and write nothing
  to ABC, GHL, or `referral_rewards`.

### 5. `referral_rewards` table (new migration)

```sql
create table if not exists referral_rewards (
  id                    uuid primary key default gen_random_uuid(),
  club_number           text not null,
  location_id           text,
  new_member_id         text not null,          -- ABC member id of the signup
  new_member_name       text,
  referrer_abc_id       text not null,          -- value of contact.referred_by_abc_id
  referrer_ghl_contact_id text,
  dues_invoice_due_date date,                    -- the invoice we zeroed
  dues_status           text not null,           -- 'zeroed' | 'no_dues_invoice' | 'error'
  sms_status            text not null,           -- 'tagged' | 'skipped' | 'no_referrer_contact' | 'error'
  needs_review          boolean not null default false,
  resolved_at           timestamptz,
  resolved_by           text,
  dry_run               boolean not null default false,
  error                 text,
  created_at            timestamptz not null default now()
);

-- Idempotency: one live (non-dry-run) reward per new signup.
create unique index if not exists referral_rewards_new_member_uniq
  on referral_rewards (new_member_id) where dry_run = false;

create index if not exists referral_rewards_needs_review_idx
  on referral_rewards (needs_review) where needs_review = true;
```

- `needs_review = true` for `no_dues_invoice` and `no_referrer_contact`. Cleared when an
  admin clicks "Mark resolved" (sets `resolved_at` / `resolved_by`, `needs_review=false`).
- `dues_status='error'` rows are **not** terminal — they are retried next cycle (transient
  ABC failures), so they are written but `needs_review=false`.

### 6. `auth/src/routes/referralRewards.js` (new) + mount in `auth/src/index.js`

```
router.use(authenticate)
router.use(requireRole('admin'))            // admin-only, per decision

GET  /referral-rewards            → list rows, newest first; ?needs_review=true filter
POST /referral-rewards/:id/resolve → set resolved_at=now, resolved_by=<user>, needs_review=false
```

Reads/writes via `supabaseAdmin`, matching the existing `abcSync.js` / `syncStatus.js`
route style.

### 7. Portal: `portal/src/components/admin/ReferralRewardsAdmin.jsx` (new)

- Registered as a `TECHNICAL_TILES` entry `{ key: 'referral-rewards', label: 'Referral
  Rewards', desc: 'Free-Month Credits', icon: <gift/heart svg> }` in `AdminPanel.jsx`,
  with a render branch `{activeSection === 'referral-rewards' && <ReferralRewardsAdmin />}`
  and the import.
- `api.js` gains `getReferralRewards({ needsReview })` and `resolveReferralReward(id)`.
- UI: a "Needs Review" section at top (rows where `needs_review`) with a **Mark resolved**
  button per row, then a recent-rewards table (member, referrer, club, dues status, SMS
  status, date). Follows the existing `SyncStatusTile` / admin-tab visual patterns
  (`bg-surface`, `border-border`, status pills). Admin-gated by the route.

## Edge cases & how they're handled

| Case | dues_status | sms_status | needs_review | Notes |
|------|-------------|------------|--------------|-------|
| Happy path | `zeroed` | `tagged` | false | SMS fires via GHL tag workflow |
| Referrer has no upcoming DUES invoice (e.g. PIF) | `no_dues_invoice` | `skipped` | **true** | No credit applied, no SMS (no false promise). Admin handles manually. Terminal. |
| Dues zeroed but referrer has no GHL contact | `zeroed` | `no_referrer_contact` | **true** | Credit applied; admin texts manually. |
| ABC GET/POST fails (network/5xx) | `error` | `skipped` | false | Retried next cycle. Not terminal. |
| ABC zero ok, GHL tag write fails | `zeroed` | `error` | **true** | Safe direction (member got credit). Admin texts manually / retry. |
| Member referred but signed before PROGRAM_START_DATE | — | — | — | Not a candidate. Back-catalog never rewarded. |
| Already rewarded | — | — | — | Skipped via `zeroed` row. |
| Self-referral (referredBy == own member id) | — | — | — | Skipped in eligibility check. |

## Manual setup owned by Justin (GHL, one-time, per sub-account)

1. Custom field **"Referral Friend Name"** → confirm/create key
   `contact.referral_friend_name` in all 7 sub-accounts.
2. Tag **`referral reward`**.
3. Workflow: trigger on tag added `referral reward` → Send SMS using
   `{{contact.first_name}}` + `{{contact.referral_friend_name}}` → (optionally remove the
   tag afterward so a future referral can re-trigger).
4. `contact.referred_by_abc_id` already exists. ✓

## Configuration / env (ghl-sync)

- `REFERRAL_REWARDS_ENABLED` — master on/off (default off; ship dark, enable after GHL
  workflow is built).
- `REFERRAL_PROGRAM_START_DATE` — back-catalog fence (default `2026-05-28`).
- `DRY_RUN` — existing flag; dry runs write nothing.

## Testing (TDD)

Unit tests (node:test, mocking the ABC client) for the pure logic:

- `pickNextDuesInvoice` — picks earliest future DUES; skips ANNUALFEE; ignores past
  due dates; returns null when none; handles the exact sample payload from ABC.
- `isEligibleCandidate` — empty referredBy, inactive member, sign_date before start,
  self-referral, each `existingRow.dues_status` (zeroed/no_dues_invoice/error/none).
- Adjustment body builder — produces `{ startDate, profitCenterAbcCode: 'DUES',
  invoiceAmount: '0.00', numberOfInvoices: '1' }`.

Integration-ish (mocked client + supabase) for `processReferralReward`:
ordering (no tag on ABC failure), no_dues_invoice path, no_referrer_contact path.

## Rollout

1. Ship behind `REFERRAL_REWARDS_ENABLED=false` with `DRY_RUN=true`.
2. Justin builds the GHL field/tag/workflow.
3. Set `DRY_RUN=false` but keep rewards disabled; confirm reconcile unaffected.
4. Set `REFERRAL_REWARDS_ENABLED=true`; watch the admin Referral Rewards page + logs for
   the first live referrals.

## Open items

- Confirm `contact.referral_friend_name` is the field key Justin creates (or adjust
  config to match).
- Confirm the ABC `invoiceadjustment` success response shape (status/messageCode) so
  `adjustInvoice` can reliably detect success vs. a 200-with-error-body (ABC has a known
  habit of 200-ing failures — see the document-upload filename gotcha).
