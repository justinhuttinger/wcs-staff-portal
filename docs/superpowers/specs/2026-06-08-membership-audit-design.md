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
- **Type median dues** = the median monthly-equivalent dues of the **dues-paying**
  members of a membership type (e.g. SINGLE median = $50; note the median sits below the
  mean because higher plans pull the mean up).
- **Dues leak (anomaly)** = an active member on a **paying-plan type** whose
  monthly-equivalent dues are **below `LOW_DUES_PCT × type_median_dues`** (default
  `LOW_DUES_PCT` = **0.50**, i.e. under half the typical due for their plan). $0 is always
  a leak; this also catches members paying suspiciously little (e.g. a SINGLE paying $20
  vs a $50 median). On real data this flags ~1,400 members across 19 paying-plan types
  (1,079 of them strictly $0). Both thresholds (`PAYING_PLAN_THRESHOLD`, `LOW_DUES_PCT`)
  are constants in the SQL, easy to tune.

## Report layout (`portal`)

A single report block (consistent with the one-block report style), corp + admin,
desktop, with the standard **per-club pill** (All + 7 clubs) like Audits/KPIs, plus a
**dues pill: All / Dues-paying / Non-dues** (mirrors the Cancels plan-type pill).

1. **Headline cards** (respect both pills):
   - Active Members (in current filter)
   - Avg Monthly Dues (over dues-paying members)
   - Total Monthly Dues (sum of monthly-equivalent, dues-paying)
   - Avg Tenure (months)
   - **Dues Leaks** (low/zero-due members on paying plans, ~1,400) — tappable, jumps to
     the leaks section.

2. **By Membership Type table** (the core): one row per `membership_type`, sortable by
   any column:
   - Type (with an "Insurance" / "Comp/Non-dues" badge where applicable)
   - Members · % of members
   - Median Monthly Dues (the type's typical) · Avg Monthly Dues · Total Monthly Dues
   - Avg Tenure (months)
   - Leaks count (low/zero-due members) for paying-plan types

3. **Dues Leaks section (the leaks list)**: a table of the flagged members —
   **Name · Agreement # · Dues** (monthly-equivalent) **· Typical** (the type median)
   **· % of Typical** · Membership Type · Club · Tenure (months) · Begin Date — sorted by
   most severe first (lowest % of typical), so $0s and the biggest underpayers surface at
   the top. Count shown per club. CSV export (matches other reports' export affordance).
   The "% of Typical" makes severity obvious (e.g. SINGLE paying $20 vs $50 median = 40%).

## Backend (`auth`)

### Migration `auth/migrations/032_membership_audit.sql` — two Postgres RPCs

Aggregation over ~20k active rows is done in Postgres (fast, single round-trip), the
same pattern as the existing trends RPCs (migration 025/026).

- `membership_audit_summary(club_numbers text[])` → one row **per membership_type**:
  `membership_type`, `members`, `paying`, `non_dues`, `median_monthly_dues` (paying),
  `avg_monthly_dues` (paying), `total_monthly_dues` (paying), `avg_tenure_months`,
  `tenure_sum_months` + `tenure_count` (members with non-null `begin_date`, so the route
  can recombine a correct member-weighted overall average), `pct_paying`, `is_insurance`,
  `is_paying_plan` (pct_paying ≥ threshold), `leaks` (count of low/zero-due members on
  this type when it's a paying plan). The function computes monthly-equivalent dues +
  tenure inline. `club_numbers` empty/null = all clubs.
- `membership_audit_anomalies(club_numbers text[])` → one row **per flagged member**
  (active, on a paying-plan type, monthly dues `< LOW_DUES_PCT × type_median`):
  `member_id`, `agreement_number`, `first_name`, `last_name`, `club_number`,
  `membership_type`, `next_due_amount`, `monthly_dues`, `type_median_dues`,
  `pct_of_typical` (monthly_dues / type_median), `begin_date`, `tenure_months`. Ordered by
  `pct_of_typical` asc (most severe first). Bounded (e.g. LIMIT 1000) with a returned
  `truncated` signal if needed.

The `PAYING_PLAN_THRESHOLD` (0.50) and `LOW_DUES_PCT` (0.50) constants and the per-type
`pct_paying` + `type_median` live in a shared CTE, so both RPCs use one definition of
"paying plan" and "leak". Note: a paying plan's `type_median` is computed over its
**paying** members (so a plan with many $0s still has a sensible typical due).

### Route `GET /reports/membership-audit`

- Params: `location_slug` (single | comma list | 'all', via `resolveLocationFilter`),
  and `include_anomalies` (bool, default true). No date range — it's a current-state
  snapshot of active members.
- Resolves slugs → `club_number[]`, calls both RPCs, returns:
  ```json
  {
    "by_type": [ { membership_type, members, paying, non_dues, median_monthly_dues,
                   avg_monthly_dues, total_monthly_dues, avg_tenure_months, pct_paying,
                   is_insurance, is_paying_plan, leaks } ],
    "totals": { active_members, paying_members, non_dues_members,
                avg_monthly_dues, total_monthly_dues, avg_tenure_months,
                leak_count },
    "anomalies": [ { member_id, agreement_number, name, club, membership_type,
                     next_due_amount, monthly_dues, type_median_dues, pct_of_typical,
                     begin_date, tenure_months } ],
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
- A leak now includes **unusually-low, not just $0**: a paying-plan member below
  `LOW_DUES_PCT × type_median` is flagged; at/above it is not. (Tune `LOW_DUES_PCT` to
  widen/narrow.)
- `type_median` for a paying plan is taken over its **paying** members; a plan with very
  few paying members has a noisier median (acceptable for v1 — a `min_paying_members`
  guard before trusting a type's median is a possible follow-up).
- `dues_filter = Non-dues` view: avg/total dues are $0 by definition; the value of that
  view is the member **count** and **tenure** of non-dues members (and the insurance badge).
- Club filter 'all' vs single vs comma list → handled by `resolveLocationFilter`.

## Testing

- **RPC** (SQL, seeded fixture rows): per-type aggregates correct; monthly-equivalent
  math for each frequency; `type_median` over paying members; `is_paying_plan` threshold
  boundary; `leaks` counts; anomalies list returns exactly the paying-plan members below
  `LOW_DUES_PCT × type_median` (incl. $0), ordered by `pct_of_typical`; club filter.
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
