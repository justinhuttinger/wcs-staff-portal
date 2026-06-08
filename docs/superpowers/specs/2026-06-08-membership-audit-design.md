# Membership Audit — Design

**Date:** 2026-06-08
**Status:** Approved direction, pending user spec review → implementation plan
**Branch / worktree:** `feat/membership-audit` (`.claude/worktrees/membership-audit`)
**Spans:** `auth` (migration with RPCs + report route) + `portal` (new Experimental report)

## Summary

A new **Membership Audit** report in the Experimental group of the portal Reporting
view (corp + admin, desktop), built entirely from the already-synced `abc_members`
table — **no live ABC API call, no new sync**. It answers: across current members,
what are the average dues and average tenure, overall and **by membership type**, and
it flags a real problem — **members on a paying plan whose dues are $0** (a revenue
leak), distinct from legitimately non-dues members (insurance / comp / paid-in-full).

## Data source (verified 2026-06-08)

`abc_members` (Supabase project `ybopxxydsuwlbwxiuzve`), refreshed by the existing ABC
sync (`last_sync_at`). 98,848 rows total; **20,335 active**; 7 clubs; 49 membership
types. Fields used:

- Dues: `next_due_amount` (numeric), `payment_frequency` (`Monthly` | `Bi-Weekly` |
  `Annually` | null), `payment_plan`.
- Type: `membership_type`, `membership_type_abc_code`.
- Tenure: `begin_date` (date).
- Status/scope: `member_status`, `is_active`, `club_number`.
- Identity (for the anomaly list): `member_id`, `first_name`, `last_name`.

## Definitions

- **Current member** = `member_status ILIKE 'active'` (the 20,335).
- **Monthly-equivalent dues** (normalize so frequencies compare apples-to-apples):
  - `Monthly` → `next_due_amount`
  - `Bi-Weekly` → `next_due_amount * 26.0/12.0`
  - `Annually` → `next_due_amount / 12.0`
  - null / unknown frequency → `next_due_amount` (treated as monthly; the vast majority
    of null-frequency members are $0 anyway)
- **Dues-paying** = monthly-equivalent dues > 0. **Non-dues** = 0 (or null).
- **Insurance subset tag** = `membership_type ILIKE 'A2%' OR ILIKE '%active and fit%'`
  (same classification as the Cancels report). Used as a label/badge only; the primary
  split is dues-paying vs non-dues.
- **Tenure** = `(today − begin_date)` in **months** (`days / 30.44`). Members with null
  `begin_date` are excluded from tenure averages (counted, but not averaged).
- **Paying-plan type** (auto-detected) = a `membership_type` where the share of active
  members who are dues-paying is **≥ `PAYING_PLAN_THRESHOLD`** (default **0.50**). The
  data shows a wide gap — real plans 78–98% paying, comp/insurance plans 0–20% — so the
  threshold is robust. Examples: paying-plan = SINGLE, FAMILY, PREMIUM, COUPLE, STUDENT,
  SENIOR; non-paying = CORP, A2 *, Employee, GYMPASS, TEMPORARY SINGLE.
- **$0-on-paying-plan anomaly** = an active member on a **paying-plan type** whose
  monthly-equivalent dues = 0. These are the revenue leaks (e.g. SINGLE has 496).

## Report layout (`portal`)

A single report block (consistent with the one-block report style), corp + admin,
desktop, with the standard **per-club pill** (All + 7 clubs) like Audits/KPIs, plus a
**dues pill: All / Dues-paying / Non-dues** (mirrors the Cancels plan-type pill).

1. **Headline cards** (respect both pills):
   - Active Members (in current filter)
   - Avg Monthly Dues (over dues-paying members)
   - Total Monthly Dues (sum of monthly-equivalent, dues-paying)
   - Avg Tenure (months)
   - **$0 on Paying Plan** (anomaly count) — tappable, jumps to the anomalies section.

2. **By Membership Type table** (the core): one row per `membership_type`, sortable by
   any column:
   - Type (with an "Insurance" / "Comp/Non-dues" badge where applicable)
   - Members · % of members
   - Avg Monthly Dues · Total Monthly Dues
   - Avg Tenure (months)
   - $0 count (anomalies) for paying-plan types

3. **"$0 on a Paying Plan" anomalies section (the leaks list)**: a table of the flagged
   members — **Name · Agreement # · Dues** (monthly-equivalent, $0 for a pure leak) ·
   Membership Type · Club · Tenure (months) · Begin Date — sorted longest-tenure first
   (longest-running leak first). Count shown per club. CSV export (matches other reports'
   export affordance). The Dues column is shown even though it's $0 for strict leaks so
   the list reads as an actionable account list and so it can later widen to
   "unusually-low dues" without changing the layout.

## Backend (`auth`)

### Migration `auth/migrations/032_membership_audit.sql` — two Postgres RPCs

Aggregation over ~20k active rows is done in Postgres (fast, single round-trip), the
same pattern as the existing trends RPCs (migration 025/026).

- `membership_audit_summary(club_numbers text[])` → one row **per membership_type**:
  `membership_type`, `members`, `paying`, `non_dues`, `avg_monthly_dues` (paying),
  `total_monthly_dues` (paying), `avg_tenure_months`, `tenure_sum_months` +
  `tenure_count` (members with non-null `begin_date`, so the route can recombine a
  correct member-weighted overall average), `pct_paying`, `is_insurance`,
  `is_paying_plan` (pct_paying ≥ threshold), `zero_on_paying_plan` (count). The function
  computes monthly-equivalent dues + tenure inline. `club_numbers` empty/null = all clubs.
- `membership_audit_anomalies(club_numbers text[])` → one row **per flagged member**
  (active, paying-plan type, $0): `member_id`, `agreement_number`, `first_name`,
  `last_name`, `club_number`, `membership_type`, `next_due_amount`, `monthly_dues`,
  `begin_date`, `tenure_months`. Ordered by tenure desc. Bounded (e.g. LIMIT 1000) with a
  returned `truncated` signal if needed.

The 0.50 threshold lives in the SQL (a CTE computing per-type `pct_paying`), so both RPCs
share one definition of "paying plan."

### Route `GET /reports/membership-audit`

- Params: `location_slug` (single | comma list | 'all', via `resolveLocationFilter`),
  and `include_anomalies` (bool, default true). No date range — it's a current-state
  snapshot of active members.
- Resolves slugs → `club_number[]`, calls both RPCs, returns:
  ```json
  {
    "by_type": [ { membership_type, members, paying, non_dues, avg_monthly_dues,
                   total_monthly_dues, avg_tenure_months, pct_paying, is_insurance,
                   is_paying_plan, zero_on_paying_plan } ],
    "totals": { active_members, paying_members, non_dues_members,
                avg_monthly_dues, total_monthly_dues, avg_tenure_months,
                anomaly_count },
    "anomalies": [ { member_id, agreement_number, name, club, membership_type,
                     next_due_amount, monthly_dues, begin_date, tenure_months } ],
    "anomalies_truncated": false
  }
  ```
  `totals` are derived from `by_type` server-side (members/dues weighted correctly; avg
  tenure is a member-weighted average, so the RPC returns the tenure **sum + count** per
  type to recombine accurately — not a naive average-of-averages).
- Role gate: corp + admin (matches KPI/Audits reports).

### `portal` `api.js`
- `getMembershipAudit(params)` helper.

## UI components (`portal`)

| Unit | Responsibility |
| --- | --- |
| `portal/src/components/reports/MembershipAuditReport.jsx` | Fetch + render cards, by-type table (sortable), anomalies table; two pills (club + dues) |
| `ReportingView` (edit) | Register "Membership Audit" in the Experimental group branch (corp+admin, desktop) |
| `portal/src/lib/reportInfo.js` (edit) | Popover copy: definitions (monthly-equivalent, paying-plan heuristic, $0 anomaly) |
| `portal/src/lib/api.js` (edit) | `getMembershipAudit` |

The dues pill drives which members the cards/table aggregate over (All / Dues-paying /
Non-dues); the anomalies section is independent of the dues pill (always paying-plan $0).

## Permissions / scope

- Corp + admin, **desktop only** (consistent with KPI + Audits experimental reports). No
  mobile variant in v1.
- Snapshot of **active** members only.

## Edge cases

- Null `begin_date` → member counted but excluded from tenure averages.
- Null/unknown `payment_frequency` → monthly-equivalent = raw amount (monthly assumption).
- Tiny types (e.g. 1–2 members): `pct_paying` still computed; a 1-member $0 type is
  non-paying (0% paying) → not flagged. Acceptable (a single-member type can't be
  confidently called a "paying plan").
- A paying-plan member with a small but nonzero due is **not** an anomaly (only $0 flags).
- `dues_filter = Non-dues` view: avg/total dues are $0 by definition; the value of that
  view is the member **count** and **tenure** of non-dues members (and the insurance badge).
- Club filter 'all' vs single vs comma list → handled by `resolveLocationFilter`.

## Testing

- **RPC** (SQL, seeded fixture rows): per-type aggregates correct; monthly-equivalent
  math for each frequency; `is_paying_plan` threshold boundary; `zero_on_paying_plan`
  counts; anomalies list returns exactly the paying-plan $0 members; club filter.
- **Route**: shape + totals recombination (member-weighted tenure, summed dues); role gate.
- **UI** (manual): cards update with both pills; table sorts; anomalies table + count
  match the headline; CSV export; corp-only visibility.

## Out of scope (YAGNI / follow-ups)

- No live ABC API (synced table is the source).
- No mobile variant in v1.
- No manual per-type "is this a paying plan" override (auto-threshold for v1; admin
  override is a clean follow-up if the heuristic ever miscategorizes a niche type).
- No historical trend (snapshot only); a month-over-month tenure/dues trend could come later.
- No deep-link from an anomaly member into ABC/GHL (CSV export + member_id is enough to
  investigate for v1).
