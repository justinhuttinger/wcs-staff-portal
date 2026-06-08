# Membership Audit Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A desktop "Membership Audit" experimental report (corp/admin/director) that shows average monthly-equivalent dues and tenure overall and by membership type from the synced `abc_members` table, plus a "dues leaks" list of members on a paying plan whose dues are unusually low (or $0).

**Architecture:** Two Postgres RPCs aggregate `abc_members` (one per-type summary, one per-member leaks list); a new `auth` route `/reports/membership-audit` calls them and recombines member-weighted totals; a new portal `MembershipAuditReport.jsx` renders cards + a sortable by-type table + the leaks list with CSV export; registered in `ReportingView` as a standalone corp-only report with per-club pills.

**Tech Stack:** Postgres (Supabase RPC, applied via Supabase MCP), Node/Express (`auth`), React 19 + Vite + Tailwind (`portal`), `node:test` for the one pure JS helper.

**Spec:** `docs/superpowers/specs/2026-06-08-membership-audit-design.md`

**Working dir:** worktree `C:\Users\justi\wcs-staff-portal\.claude\worktrees\membership-audit`, branch `feat/membership-audit`. Windows / PowerShell. `node`/`pnpm` commands run from the noted subdirectory. Supabase project id: `ybopxxydsuwlbwxiuzve`.

---

## File Structure

- `auth/migrations/032_membership_audit.sql` (new) — `membership_audit_summary` + `membership_audit_anomalies` RPCs.
- `auth/src/lib/membershipAuditTotals.js` (new) — pure `recombineTotals(byType)` helper.
- `auth/src/lib/membershipAuditTotals.test.js` (new) — `node:test` for the helper.
- `auth/src/routes/reports.js` (modify) — add `GET /membership-audit`.
- `portal/src/lib/api.js` (modify) — `getMembershipAudit`.
- `portal/src/lib/reportInfo.js` (modify) — `membership-audit` popover copy.
- `portal/src/components/reports/MembershipAuditReport.jsx` (new) — the report UI.
- `portal/src/components/ReportingView.jsx` (modify) — register the report (tile, icon, role gating, pills, switch).

---

## Task 1: Migration 032 — aggregation RPCs

**Files:**
- Create: `auth/migrations/032_membership_audit.sql`

- [ ] **Step 1: Write the migration file**

Create `auth/migrations/032_membership_audit.sql`:
```sql
-- 032: Membership Audit RPCs over abc_members (current = member_status ILIKE 'active').
-- Monthly-equivalent dues normalize payment frequency. A membership_type is a
-- "paying plan" when >= 50% of its active members pay (>0). A "leak" is an active
-- member on a paying plan whose monthly-equivalent dues are below 50% of that
-- type's median paying dues ($0 always qualifies). Both thresholds are inline
-- literals (50 for pct_paying, 0.5 for the median fraction).

CREATE OR REPLACE FUNCTION membership_audit_summary(p_club_numbers text[] DEFAULT NULL)
RETURNS TABLE (
  membership_type     text,
  members             bigint,
  paying              bigint,
  non_dues            bigint,
  median_monthly_dues numeric,
  avg_monthly_dues    numeric,
  total_monthly_dues  numeric,
  avg_tenure_months   numeric,
  tenure_sum_months   numeric,
  tenure_count        bigint,
  tenure_sum_paying   numeric,
  tenure_count_paying bigint,
  pct_paying          numeric,
  is_insurance        boolean,
  is_paying_plan      boolean,
  leaks               bigint
)
LANGUAGE sql STABLE AS $$
  WITH active AS (
    SELECT
      m.membership_type,
      CASE lower(coalesce(m.payment_frequency, ''))
        WHEN 'monthly'   THEN m.next_due_amount
        WHEN 'bi-weekly' THEN m.next_due_amount * 26.0 / 12.0
        WHEN 'annually'  THEN m.next_due_amount / 12.0
        ELSE m.next_due_amount
      END AS mdue,
      (m.membership_type ILIKE 'A2%' OR m.membership_type ILIKE '%active and fit%') AS is_ins,
      CASE WHEN m.begin_date IS NULL THEN NULL
           ELSE (CURRENT_DATE - m.begin_date) / 30.44 END AS tenure_m
    FROM abc_members m
    WHERE m.member_status ILIKE 'active'
      AND (p_club_numbers IS NULL
           OR array_length(p_club_numbers, 1) IS NULL
           OR m.club_number = ANY (p_club_numbers))
  ),
  typ AS (
    SELECT
      a.membership_type,
      count(*)                                                              AS members,
      count(*) FILTER (WHERE coalesce(a.mdue, 0) > 0)                       AS paying,
      count(*) FILTER (WHERE coalesce(a.mdue, 0) = 0)                       AS non_dues,
      (percentile_cont(0.5) WITHIN GROUP (ORDER BY a.mdue)
        FILTER (WHERE a.mdue > 0))::numeric                                AS median_due,  -- percentile_cont returns double; cast so round()/comparisons stay numeric
      avg(a.mdue) FILTER (WHERE a.mdue > 0)                                 AS avg_due,
      sum(a.mdue) FILTER (WHERE a.mdue > 0)                                 AS total_due,
      avg(a.tenure_m)                                                       AS avg_ten,
      sum(a.tenure_m)                                                       AS ten_sum,
      count(a.tenure_m)                                                     AS ten_cnt,
      sum(a.tenure_m) FILTER (WHERE a.mdue > 0)                             AS ten_sum_pay,
      count(a.tenure_m) FILTER (WHERE a.mdue > 0)                           AS ten_cnt_pay,
      bool_or(a.is_ins)                                                     AS is_ins
    FROM active a
    GROUP BY a.membership_type
  )
  SELECT
    t.membership_type,
    t.members,
    t.paying,
    t.non_dues,
    round(t.median_due, 2),
    round(t.avg_due, 2),
    round(t.total_due, 2),
    round(t.avg_ten, 1),
    round(t.ten_sum, 1),
    t.ten_cnt,
    round(t.ten_sum_pay, 1),
    t.ten_cnt_pay,
    round(100.0 * t.paying / nullif(t.members, 0), 1) AS pct_paying,
    t.is_ins,
    (100.0 * t.paying / nullif(t.members, 0)) >= 50   AS is_paying_plan,
    CASE WHEN (100.0 * t.paying / nullif(t.members, 0)) >= 50
         THEN (SELECT count(*) FROM active a
                WHERE a.membership_type = t.membership_type
                  AND coalesce(a.mdue, 0) < 0.5 * t.median_due)
         ELSE 0 END AS leaks
  FROM typ t
  ORDER BY t.members DESC;
$$;

CREATE OR REPLACE FUNCTION membership_audit_anomalies(p_club_numbers text[] DEFAULT NULL)
RETURNS TABLE (
  member_id         text,
  agreement_number  text,
  first_name        text,
  last_name         text,
  club_number       text,
  membership_type   text,
  next_due_amount   numeric,
  monthly_dues      numeric,
  type_median_dues  numeric,
  pct_of_typical    numeric,
  begin_date        date,
  tenure_months     numeric
)
LANGUAGE sql STABLE AS $$
  WITH active AS (
    SELECT m.*,
      CASE lower(coalesce(m.payment_frequency, ''))
        WHEN 'monthly'   THEN m.next_due_amount
        WHEN 'bi-weekly' THEN m.next_due_amount * 26.0 / 12.0
        WHEN 'annually'  THEN m.next_due_amount / 12.0
        ELSE m.next_due_amount
      END AS mdue
    FROM abc_members m
    WHERE m.member_status ILIKE 'active'
      AND (p_club_numbers IS NULL
           OR array_length(p_club_numbers, 1) IS NULL
           OR m.club_number = ANY (p_club_numbers))
  ),
  typ AS (
    SELECT
      a.membership_type,
      count(*)                                       AS members,
      count(*) FILTER (WHERE coalesce(a.mdue,0) > 0) AS paying,
      (percentile_cont(0.5) WITHIN GROUP (ORDER BY a.mdue)
        FILTER (WHERE a.mdue > 0))::numeric          AS median_due
    FROM active a
    GROUP BY a.membership_type
  )
  SELECT
    a.member_id,
    a.agreement_number,
    a.first_name,
    a.last_name,
    a.club_number,
    a.membership_type,
    a.next_due_amount,
    round(a.mdue, 2)                                    AS monthly_dues,
    round(t.median_due, 2)                              AS type_median_dues,
    round(coalesce(a.mdue, 0) / nullif(t.median_due, 0), 3) AS pct_of_typical,
    a.begin_date,
    CASE WHEN a.begin_date IS NULL THEN NULL
         ELSE round((CURRENT_DATE - a.begin_date) / 30.44, 1) END AS tenure_months
  FROM active a
  JOIN typ t ON t.membership_type = a.membership_type
  WHERE (100.0 * t.paying / nullif(t.members, 0)) >= 50
    AND coalesce(a.mdue, 0) < 0.5 * t.median_due
  ORDER BY pct_of_typical ASC NULLS FIRST
  LIMIT 1000;
$$;
```

- [ ] **Step 2: Apply via Supabase MCP**

Use the Supabase MCP `apply_migration` tool: `project_id: ybopxxydsuwlbwxiuzve`, `name: "032_membership_audit"`, and the SQL above. Expected: success.

- [ ] **Step 3: Verify the summary RPC against known aggregates**

Use Supabase MCP `execute_sql` (`project_id: ybopxxydsuwlbwxiuzve`):
```sql
select
  sum(paying) paying, sum(non_dues) non_dues,
  round(sum(total_monthly_dues)/nullif(sum(paying),0),2) avg_dues,
  sum(leaks) leaks,
  (select round(median_monthly_dues,2) from membership_audit_summary() where membership_type='SINGLE') single_median
from membership_audit_summary();
```
Expected (matches the spec's verified figures): `paying ≈ 11771`, `non_dues ≈ 8564`, `avg_dues ≈ 76.14`, `leaks ≈ 1400`, `single_median ≈ 50.00`.

- [ ] **Step 4: Verify the anomalies RPC**

```sql
select count(*) total,
       count(*) filter (where monthly_dues = 0) zeros,
       min(pct_of_typical) lowest
from membership_audit_anomalies();
```
Expected: `total` ≈ 1400 (capped at 1000 if more — note the LIMIT), `zeros` ≈ the strictly-$0 share, `lowest` = 0 (a $0 member). Also spot check a single club:
```sql
select count(*) from membership_audit_anomalies(array['30935']); -- Salem only
```
Expected: a smaller nonzero count.

- [ ] **Step 5: Commit**

```powershell
cd C:\Users\justi\wcs-staff-portal\.claude\worktrees\membership-audit
git add auth/migrations/032_membership_audit.sql
git commit -m "feat: migration 032 - membership audit RPCs (summary + leaks)"
```

---

## Task 2: Auth route + totals helper (TDD on the helper)

**Files:**
- Create: `auth/src/lib/membershipAuditTotals.js`
- Test: `auth/src/lib/membershipAuditTotals.test.js`
- Modify: `auth/src/routes/reports.js`

- [ ] **Step 1: Write the failing test for `recombineTotals`**

Create `auth/src/lib/membershipAuditTotals.test.js`:
```js
const test = require('node:test')
const assert = require('node:assert')
const { recombineTotals } = require('./membershipAuditTotals')

test('recombines member-weighted totals across types', () => {
  const byType = [
    { members: 100, paying: 90, non_dues: 10, total_monthly_dues: 6750, tenure_sum_months: 1800, tenure_count: 100, leaks: 5 },
    { members:  50, paying: 10, non_dues: 40, total_monthly_dues:  500, tenure_sum_months:  500, tenure_count:  40, leaks: 0 },
  ]
  const t = recombineTotals(byType)
  assert.equal(t.active_members, 150)
  assert.equal(t.paying_members, 100)
  assert.equal(t.non_dues_members, 50)
  assert.equal(t.total_monthly_dues, 7250)
  // avg dues = total over PAYING members only: 7250 / 100 = 72.5
  assert.equal(t.avg_monthly_dues, 72.5)
  // avg tenure = sum / count of members WITH begin_date: 2300 / 140 = 16.4 (1dp)
  assert.equal(t.avg_tenure_months, 16.4)
  assert.equal(t.leak_count, 5)
})

test('empty input yields zeros, no divide-by-zero', () => {
  const t = recombineTotals([])
  assert.equal(t.active_members, 0)
  assert.equal(t.avg_monthly_dues, 0)
  assert.equal(t.avg_tenure_months, 0)
})
```

- [ ] **Step 2: Run it, verify it fails**

From `auth/`: `node --test src/lib/membershipAuditTotals.test.js`
Expected: FAIL (module not found).

- [ ] **Step 3: Implement the helper**

Create `auth/src/lib/membershipAuditTotals.js`:
```js
// Recombine per-membership-type rows from membership_audit_summary into overall
// totals. Averages must be member-weighted (not an average of per-type averages):
// avg dues = sum(total_monthly_dues) / sum(paying); avg tenure = sum(tenure) /
// count(members with begin_date).
function recombineTotals(byType) {
  let active = 0, paying = 0, nonDues = 0, totalDues = 0, tenSum = 0, tenCnt = 0, leaks = 0
  for (const r of byType || []) {
    active    += Number(r.members) || 0
    paying    += Number(r.paying) || 0
    nonDues   += Number(r.non_dues) || 0
    totalDues += Number(r.total_monthly_dues) || 0
    tenSum    += Number(r.tenure_sum_months) || 0
    tenCnt    += Number(r.tenure_count) || 0
    leaks     += Number(r.leaks) || 0
  }
  return {
    active_members:     active,
    paying_members:     paying,
    non_dues_members:   nonDues,
    avg_monthly_dues:   paying ? Math.round((totalDues / paying) * 100) / 100 : 0,
    total_monthly_dues: Math.round(totalDues * 100) / 100,
    avg_tenure_months:  tenCnt ? Math.round((tenSum / tenCnt) * 10) / 10 : 0,
    leak_count:         leaks,
  }
}

module.exports = { recombineTotals }
```

- [ ] **Step 4: Run it, verify it passes**

From `auth/`: `node --test src/lib/membershipAuditTotals.test.js`
Expected: PASS (2/2).

- [ ] **Step 5: Add the route to `reports.js`**

In `auth/src/routes/reports.js`, add the require near the other top-of-file requires (after the existing `require` lines, e.g. below `const { requireRole } = require('../middleware/role')`):
```js
const { recombineTotals } = require('../lib/membershipAuditTotals')
```
Then add this route. Place it immediately after the existing `router.get('/speed-to-lead/audit', ...)` handler closes (so it sits with the other report routes; `supabaseAdmin`, `resolveLocationFilter`, `SLUG_CLUB_MAP`, and `CLUB_SLUG_MAP` are already in module scope):
```js
// ---------------------------------------------------------------------------
// GET /reports/membership-audit
// Current-state snapshot of active members from abc_members: per-type dues +
// tenure aggregates, recombined totals, and the dues-leak list. No date range.
// Query params: location_slug (single | comma list | 'all'), include_anomalies.
// ---------------------------------------------------------------------------
router.get('/membership-audit', async (req, res) => {
  try {
    const locationFilter = await resolveLocationFilter(req.query)
    let clubNumbers = []
    if (locationFilter) {
      clubNumbers = locationFilter.values.map(s => SLUG_CLUB_MAP[s]).filter(Boolean)
    }
    const pClubs = clubNumbers.length > 0 ? clubNumbers : null
    const includeAnomalies = req.query.include_anomalies !== 'false'

    const { data: byType, error: e1 } = await supabaseAdmin
      .rpc('membership_audit_summary', { p_club_numbers: pClubs })
    if (e1) return res.status(500).json({ error: 'Failed to fetch membership audit summary', detail: e1.message })

    let anomalies = []
    let truncated = false
    if (includeAnomalies) {
      const { data: an, error: e2 } = await supabaseAdmin
        .rpc('membership_audit_anomalies', { p_club_numbers: pClubs })
      if (e2) return res.status(500).json({ error: 'Failed to fetch membership audit anomalies', detail: e2.message })
      anomalies = (an || []).map(r => ({
        member_id:        r.member_id,
        agreement_number: r.agreement_number,
        name:             `${r.first_name || ''} ${r.last_name || ''}`.trim(),
        club:             CLUB_SLUG_MAP[r.club_number] || r.club_number,
        membership_type:  r.membership_type,
        next_due_amount:  r.next_due_amount,
        monthly_dues:     r.monthly_dues,
        type_median_dues: r.type_median_dues,
        pct_of_typical:   r.pct_of_typical,
        begin_date:       r.begin_date,
        tenure_months:    r.tenure_months,
      }))
      truncated = anomalies.length >= 1000
    }

    return res.json({
      by_type: byType || [],
      totals: recombineTotals(byType || []),
      anomalies,
      anomalies_truncated: truncated,
    })
  } catch (err) {
    return res.status(500).json({ error: err.message })
  }
})
```

- [ ] **Step 6: Verify the route compiles**

From `auth/`: `node --check src/routes/reports.js`
Expected: no output (valid). If the `auth` server is runnable locally with env, optionally `node -e "require('./src/routes/reports.js')"` to confirm the new require resolves.

- [ ] **Step 7: Commit**

```powershell
cd C:\Users\justi\wcs-staff-portal\.claude\worktrees\membership-audit
git add auth/src/lib/membershipAuditTotals.js auth/src/lib/membershipAuditTotals.test.js auth/src/routes/reports.js
git commit -m "feat: /reports/membership-audit route + member-weighted totals helper"
```

---

## Task 3: `api.js` helper + `MembershipAuditReport.jsx`

**Files:**
- Modify: `portal/src/lib/api.js`
- Create: `portal/src/components/reports/MembershipAuditReport.jsx`

- [ ] **Step 1: Add the api helper**

In `portal/src/lib/api.js`, add immediately after the existing `getSpeedToLeadAudit` function (around line 486):
```js
export async function getMembershipAudit(params = {}, options = {}) {
  const qs = new URLSearchParams(params).toString()
  return api('/reports/membership-audit' + (qs ? '?' + qs : ''), options)
}
```

- [ ] **Step 2: Create the report component**

Create `portal/src/components/reports/MembershipAuditReport.jsx`:
```jsx
import { useState, useMemo } from 'react'
import { getMembershipAudit } from '../../lib/api'
import { useCancellableFetch } from '../../hooks/useCancellableFetch'
import DesktopLoading from '../DesktopLoading'
import { StatBlock, StatCell, ReportBlock } from './StatBlock'

const DUES_PILLS = [
  { key: 'all', label: 'All' },
  { key: 'paying', label: 'Dues-paying' },
  { key: 'non_dues', label: 'Non-dues' },
]

function money(n) {
  if (n == null) return '—'
  return `$${Number(n).toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`
}
function money2(n) {
  if (n == null) return '—'
  return `$${Number(n).toFixed(2)}`
}
function months(n) {
  if (n == null) return '—'
  return `${Number(n).toFixed(1)} mo`
}
function pct(n) {
  if (n == null) return '—'
  return `${Math.round(Number(n) * 100)}%`
}

// CSV download for the leaks list.
function downloadLeaksCsv(rows) {
  const header = ['Name', 'Agreement #', 'Dues (monthly)', 'Typical', '% of Typical', 'Type', 'Club', 'Tenure (mo)', 'Begin Date']
  const lines = rows.map(r => [
    r.name, r.agreement_number, r.monthly_dues, r.type_median_dues,
    r.pct_of_typical != null ? Math.round(r.pct_of_typical * 100) + '%' : '',
    r.membership_type, r.club, r.tenure_months, r.begin_date,
  ].map(v => `"${String(v ?? '').replace(/"/g, '""')}"`).join(','))
  const csv = [header.join(','), ...lines].join('\n')
  const blob = new Blob([csv], { type: 'text/csv' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = 'membership-dues-leaks.csv'
  a.click()
  URL.revokeObjectURL(url)
}

const SORT_COLS = [
  { key: 'membership_type', label: 'Type', align: 'left' },
  { key: 'members', label: 'Members', align: 'right' },
  { key: 'median_monthly_dues', label: 'Median Dues', align: 'right' },
  { key: 'avg_monthly_dues', label: 'Avg Dues', align: 'right' },
  { key: 'total_monthly_dues', label: 'Total Dues', align: 'right' },
  { key: 'avg_tenure_months', label: 'Avg Tenure', align: 'right' },
  { key: 'leaks', label: 'Leaks', align: 'right' },
]

export default function MembershipAuditReport({ locationSlug }) {
  const [dues, setDues] = useState('all')
  const [sort, setSort] = useState({ col: 'members', dir: 'desc' })
  const [showLeaks, setShowLeaks] = useState(false)

  const { data, loading, error } = useCancellableFetch(
    (signal) => {
      const params = {}
      if (locationSlug && locationSlug !== 'all') params.location_slug = locationSlug
      return getMembershipAudit(params, { signal })
    },
    [locationSlug]
  )

  // Apply the dues pill to the by-type rows (cards + table aggregate over the
  // selected subset). Counts, dues, AND tenure are recomputed for the subset —
  // tenure uses the paying/non-dues split the RPC returns so toggling the pill
  // shows the correct average for that subset.
  const rows = useMemo(() => {
    const all = data?.by_type || []
    return all
      .map(r => {
        if (dues === 'paying') {
          return {
            ...r,
            members: r.paying,
            non_dues: 0,
            tenure_sum_months: Number(r.tenure_sum_paying) || 0,
            tenure_count: Number(r.tenure_count_paying) || 0,
            avg_tenure_months: r.tenure_count_paying ? r.tenure_sum_paying / r.tenure_count_paying : null,
          }
        }
        if (dues === 'non_dues') {
          const ndSum = (Number(r.tenure_sum_months) || 0) - (Number(r.tenure_sum_paying) || 0)
          const ndCnt = (Number(r.tenure_count) || 0) - (Number(r.tenure_count_paying) || 0)
          return {
            ...r,
            members: r.non_dues,
            paying: 0,
            avg_monthly_dues: 0,
            total_monthly_dues: 0,
            median_monthly_dues: 0,
            tenure_sum_months: ndSum,
            tenure_count: ndCnt,
            avg_tenure_months: ndCnt ? ndSum / ndCnt : null,
          }
        }
        return r // 'all'
      })
      .filter(r => r.members > 0)
  }, [data, dues])

  const sortedRows = useMemo(() => {
    const arr = [...rows]
    const { col, dir } = sort
    arr.sort((a, b) => {
      const av = a[col], bv = b[col]
      if (typeof av === 'string') return dir === 'asc' ? String(av).localeCompare(bv) : String(bv).localeCompare(av)
      return dir === 'asc' ? (Number(av) || 0) - (Number(bv) || 0) : (Number(bv) || 0) - (Number(av) || 0)
    })
    return arr
  }, [rows, sort])

  // Headline numbers recomputed from the (pill-filtered) rows so the cards match
  // the table. avg dues = total/paying; avg tenure = sum/count.
  const totals = useMemo(() => {
    let members = 0, paying = 0, nonDues = 0, totalDues = 0, tenSum = 0, tenCnt = 0
    for (const r of rows) {
      members += Number(r.members) || 0
      paying += Number(r.paying) || 0
      nonDues += Number(r.non_dues) || 0
      totalDues += Number(r.total_monthly_dues) || 0
      tenSum += Number(r.tenure_sum_months) || 0
      tenCnt += Number(r.tenure_count) || 0
    }
    return {
      members,
      avgDues: paying ? totalDues / paying : 0,
      totalDues,
      avgTenure: tenCnt ? tenSum / tenCnt : 0,
      leaks: data?.totals?.leak_count || 0,
    }
  }, [rows, data])

  if (loading) return <DesktopLoading variant="report" />
  if (error) return <p className="text-wcs-red text-sm py-4">{error.message || String(error)}</p>
  if (!data) return null

  const anomalies = data.anomalies || []

  function setSortCol(col) {
    setSort(s => s.col === col ? { col, dir: s.dir === 'asc' ? 'desc' : 'asc' } : { col, dir: 'desc' })
  }

  return (
    <ReportBlock>
      {/* Dues pill */}
      <div className="px-5 sm:px-6 pt-4 flex items-center gap-1.5">
        {DUES_PILLS.map(p => (
          <button
            key={p.key}
            type="button"
            onClick={() => setDues(p.key)}
            className={`px-3 py-1.5 rounded-full text-xs font-medium border transition-colors ${
              dues === p.key ? 'bg-wcs-red text-white border-wcs-red' : 'bg-bg text-text-muted border-border hover:text-text-primary'
            }`}
          >
            {p.label}
          </button>
        ))}
      </div>

      {/* Headline cards */}
      <StatBlock cols={5} flush>
        <StatCell label="Members" value={totals.members.toLocaleString()} />
        <StatCell label="Avg Monthly Dues" value={money2(totals.avgDues)} />
        <StatCell label="Total Monthly Dues" value={money(totals.totalDues)} />
        <StatCell label="Avg Tenure" value={months(totals.avgTenure)} />
        <StatCell
          label="Dues Leaks"
          value={totals.leaks.toLocaleString()}
          valueClassName={totals.leaks > 0 ? 'text-wcs-red' : undefined}
        />
      </StatBlock>

      {/* By membership type table */}
      <div className="px-5 sm:px-6 py-5 overflow-x-auto">
        <p className="text-xs font-semibold text-text-muted uppercase tracking-wide mb-3">By Membership Type</p>
        <table className="w-full text-sm">
          <thead>
            <tr className="text-[11px] uppercase tracking-wide text-text-muted border-b border-border">
              {SORT_COLS.map(c => (
                <th
                  key={c.key}
                  onClick={() => setSortCol(c.key)}
                  className={`py-2 font-semibold cursor-pointer select-none ${c.align === 'right' ? 'text-right' : 'text-left'}`}
                >
                  {c.label}{sort.col === c.key ? (sort.dir === 'asc' ? ' ▲' : ' ▼') : ''}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {sortedRows.map(r => (
              <tr key={r.membership_type} className="border-b border-border/60">
                <td className="py-1.5 text-text-primary">
                  {r.membership_type}
                  {r.is_insurance && <span className="ml-2 text-[10px] uppercase tracking-wide text-blue-600">insurance</span>}
                  {!r.is_paying_plan && !r.is_insurance && <span className="ml-2 text-[10px] uppercase tracking-wide text-text-muted">non-dues</span>}
                </td>
                <td className="py-1.5 text-right tabular-nums">{Number(r.members).toLocaleString()}</td>
                <td className="py-1.5 text-right tabular-nums text-text-muted">{r.median_monthly_dues ? money2(r.median_monthly_dues) : '—'}</td>
                <td className="py-1.5 text-right tabular-nums text-text-muted">{r.avg_monthly_dues ? money2(r.avg_monthly_dues) : '—'}</td>
                <td className="py-1.5 text-right tabular-nums text-text-primary">{r.total_monthly_dues ? money(r.total_monthly_dues) : '—'}</td>
                <td className="py-1.5 text-right tabular-nums text-text-muted">{months(r.avg_tenure_months)}</td>
                <td className={`py-1.5 text-right tabular-nums font-semibold ${r.leaks > 0 ? 'text-wcs-red' : 'text-text-muted'}`}>{r.leaks || 0}</td>
              </tr>
            ))}
            {sortedRows.length === 0 && (
              <tr><td colSpan={SORT_COLS.length} className="py-6 text-center text-text-muted text-xs">No members for this filter.</td></tr>
            )}
          </tbody>
        </table>
      </div>

      {/* Dues leaks */}
      <div className="px-5 sm:px-6 py-5 border-t border-border">
        <div className="flex items-center gap-3 mb-3">
          <p className="text-xs font-semibold text-text-muted uppercase tracking-wide">
            Dues Leaks — {anomalies.length}{data.anomalies_truncated ? '+ (capped)' : ''} members on a paying plan paying $0 or unusually low
          </p>
          <div className="ml-auto flex items-center gap-2">
            <button onClick={() => setShowLeaks(s => !s)} className="text-xs font-semibold text-wcs-red hover:text-wcs-red/80">
              {showLeaks ? 'Hide' : 'Show'}
            </button>
            {anomalies.length > 0 && (
              <button onClick={() => downloadLeaksCsv(anomalies)} className="text-xs font-semibold text-text-muted hover:text-text-primary">
                Export CSV
              </button>
            )}
          </div>
        </div>
        {showLeaks && (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-[11px] uppercase tracking-wide text-text-muted border-b border-border">
                  <th className="text-left font-semibold py-2">Name</th>
                  <th className="text-left font-semibold py-2">Agreement #</th>
                  <th className="text-right font-semibold py-2">Dues</th>
                  <th className="text-right font-semibold py-2">Typical</th>
                  <th className="text-right font-semibold py-2">% of Typical</th>
                  <th className="text-left font-semibold py-2 pl-3">Type</th>
                  <th className="text-left font-semibold py-2">Club</th>
                  <th className="text-right font-semibold py-2">Tenure</th>
                </tr>
              </thead>
              <tbody>
                {anomalies.map((r, i) => (
                  <tr key={i} className="border-b border-border/60">
                    <td className="py-1.5 text-text-primary">{r.name}</td>
                    <td className="py-1.5 text-text-muted tabular-nums">{r.agreement_number}</td>
                    <td className="py-1.5 text-right tabular-nums text-wcs-red font-semibold">{money2(r.monthly_dues)}</td>
                    <td className="py-1.5 text-right tabular-nums text-text-muted">{money2(r.type_median_dues)}</td>
                    <td className="py-1.5 text-right tabular-nums">{pct(r.pct_of_typical)}</td>
                    <td className="py-1.5 pl-3 text-text-muted">{r.membership_type}</td>
                    <td className="py-1.5 text-text-muted capitalize">{r.club}</td>
                    <td className="py-1.5 text-right tabular-nums text-text-muted">{months(r.tenure_months)}</td>
                  </tr>
                ))}
                {anomalies.length === 0 && (
                  <tr><td colSpan={8} className="py-6 text-center text-text-muted text-xs">No dues leaks for this filter.</td></tr>
                )}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </ReportBlock>
  )
}
```

> NOTE on the dues pill + leaks: the leaks list is independent of the dues pill (always the paying-plan low/zero set for the selected club), per the spec. The cards' "Dues Leaks" uses the unfiltered `data.totals.leak_count` for the same reason.

- [ ] **Step 3: (API reference — already verified)**

`StatBlock.jsx` exports `StatBlock` (supports `cols={5}` → `grid-cols-2 sm:grid-cols-5`), `StatCell` (props `label`, `value`, `sub`, `valueClassName`, `className`), and `ReportBlock` — exactly as used above. No change needed; this step is just the confirmation that the imports/props are correct.

- [ ] **Step 4: Commit**

```powershell
cd C:\Users\justi\wcs-staff-portal\.claude\worktrees\membership-audit
git add portal/src/lib/api.js portal/src/components/reports/MembershipAuditReport.jsx
git commit -m "feat: MembershipAuditReport component + getMembershipAudit api helper"
```

---

## Task 4: Register the report in `ReportingView` + `reportInfo`

**Files:**
- Modify: `portal/src/components/ReportingView.jsx`
- Modify: `portal/src/lib/reportInfo.js`

- [ ] **Step 1: Import the component**

In `portal/src/components/ReportingView.jsx`, add after the `import AuditsReport from './reports/AuditsReport'` line:
```jsx
import MembershipAuditReport from './reports/MembershipAuditReport'
```

- [ ] **Step 2: Add the tile icon**

In the `REPORT_ICONS` object, add (any entry is fine; reuse the membership icon path):
```jsx
  'membership-audit': 'M9.568 3H5.25A2.25 2.25 0 0 0 3 5.25v4.318c0 .597.237 1.17.659 1.591l9.581 9.581c.699.699 1.78.872 2.607.33a18.095 18.095 0 0 0 5.223-5.223c.542-.827.369-1.908-.33-2.607L11.16 3.66A2.25 2.25 0 0 0 9.568 3Z M6 6h.008v.008H6V6Z',
```

- [ ] **Step 3: Add the tile + make it standalone + corp-only**

In `ALL_REPORT_TILES`, add after the `audits` entry:
```jsx
  { key: 'membership-audit', label: 'Membership Audit', desc: 'Dues & Leaks' },
```
In `STANDALONE_REPORTS`, add the key so it leads the nav like KPIs:
```jsx
const STANDALONE_REPORTS = ['kpis', 'membership-audit']
```
In `getReportTilesForRole`, the `marketing` case excludes experimental reports — add `membership-audit` to that exclusion so only corporate/admin/director (the `default` case) see it:
```jsx
    case 'marketing':
      // Marketing: marketing tiles + broader reports per REPORT_ACCESS, minus
      // the experimental reports (corp+admin only).
      return ALL_REPORT_TILES.filter(t => t.key !== 'kpis' && t.key !== 'audits' && t.key !== 'membership-audit')
```
(The `lead` and `manager` cases use explicit allow-lists that already omit `membership-audit`, so no change needed there; `default` returns all → corporate/admin/director get it.)

- [ ] **Step 4: Hide the date controls and the dropdown; show per-club pills (with All)**

In the `showDateControls` expression (around line 387), append `&& activeReport !== 'membership-audit'`:
```jsx
          const showDateControls = activeReport !== 'pt-roster' && activeReport !== 'operations' && activeReport !== 'payroll' && activeReport !== 'session-frequency' && activeReport !== 'meta-ads' && activeReport !== 'google-marketing' && activeReport !== 'audits' && activeReport !== 'membership-audit'
```
In the dropdown guard (around line 428), add `membership-audit` so the dropdown is suppressed:
```jsx
                  {['kpis', 'audits', 'operations', 'membership-audit'].includes(activeReport) ? null : showLocation ? (
```
In the location-pills guard (around line 483), add `membership-audit` so the pills render:
```jsx
              {['kpis', 'audits', 'operations', 'membership-audit'].includes(activeReport) && showLocation && (
```
The pill builder at line 485 keeps the **All** pill for everything except `audits` (`activeReport !== 'audits'`), so `membership-audit` correctly gets `All + clubs`. No change needed there.

- [ ] **Step 5: Add the component to the render switch**

In the report content block, add after the `audits` case (around line 572):
```jsx
          {activeReport === 'membership-audit' && (
            <MembershipAuditReport locationSlug={locationSlug} />
          )}
```

- [ ] **Step 6: Add the reportInfo popover copy**

In `portal/src/lib/reportInfo.js`, add an entry to the `REPORT_INFO` object (after the `cancels` entry):
```js
  'membership-audit': {
    title: 'Membership Audit',
    sections: [
      {
        heading: 'Who\'s in it',
        body:
          'All current (active) members from ABC. Dues are normalized to a monthly equivalent so monthly, bi-weekly, and annual plans compare fairly. Tenure runs from the membership begin date.',
      },
      {
        heading: 'How filters work',
        body: [
          'Location — All or one club (pills).',
          'Dues — All / Dues-paying / Non-dues. Non-dues are members with $0 recurring dues (insurance, comp, paid-in-full).',
        ],
      },
      {
        heading: 'Dues Leaks',
        body:
          'Members on a "paying plan" whose monthly dues are below half their plan type\'s median (including $0). A plan type counts as a paying plan when at least half its members pay, so legitimately-free plans (CORP, insurance, Employee, GymPass) are not flagged.',
      },
    ],
  },
```

- [ ] **Step 7: Build the portal to verify everything compiles**

From `portal/`:
```powershell
pnpm install
pnpm build
```
Expected: build succeeds (modules transformed; desktop + mobile bundles emitted). The only acceptable warning is the pre-existing chunk-size warning.

- [ ] **Step 8: Commit**

```powershell
cd C:\Users\justi\wcs-staff-portal\.claude\worktrees\membership-audit
git add portal/src/components/ReportingView.jsx portal/src/lib/reportInfo.js
git commit -m "feat: register Membership Audit report (standalone, corp-only, per-club pills)"
```

---

## Task 5: End-to-end verification + PR

- [ ] **Step 1: Confirm the helper test still passes**

From `auth/`: `node --test src/lib/membershipAuditTotals.test.js`
Expected: PASS (2/2).

- [ ] **Step 2: Confirm the portal build is clean**

From `portal/`: `pnpm build`
Expected: success.

- [ ] **Step 3: Manual smoke (have the user check in the running portal)**

As corporate/admin: open Reporting — **Membership Audit** appears as a standalone item at the top of the nav. Confirm:
- Cards show ~20,335 members / ~$76 avg dues / ~$896k total / ~31.5mo tenure / ~1,400 leaks at "All".
- The dues pill (All / Dues-paying / Non-dues) changes the cards + table.
- The by-type table sorts on each column; SINGLE/FAMILY/PREMIUM show leaks, CORP/A2 show none.
- The per-club pills filter; the Dues Leaks "Show" reveals the list with Name · Agreement # · Dues · Typical · % of Typical, and Export CSV downloads it.
- A `lead`/`manager` login does NOT see the report.

- [ ] **Step 4: Push the branch**

```powershell
cd C:\Users\justi\wcs-staff-portal\.claude\worktrees\membership-audit
git push -u origin feat/membership-audit
```

- [ ] **Step 5: Open a PR (do NOT merge — Justin merges)**

```powershell
gh pr create --title "Membership Audit report (dues, tenure, leaks)" --body @'
## What
A desktop, corp-only "Membership Audit" experimental report built from the synced `abc_members` table (no live ABC API): average monthly-equivalent dues and tenure overall and by membership type, with a 3-way dues pill (All / Dues-paying / Non-dues) and a "Dues Leaks" list — members on a paying plan paying $0 or unusually low (< 50% of their type median).

## How
- Migration 032 adds two RPCs: `membership_audit_summary` (per-type aggregates) and `membership_audit_anomalies` (the leaks list). Monthly-equivalent normalizes payment frequency; a type is a "paying plan" when >=50% of its active members pay; a leak is a paying-plan member below 50% of the type median (incl. $0).
- `GET /reports/membership-audit` resolves slugs -> club_numbers (mirrors Cancels), calls both RPCs, and recombines member-weighted totals (`auth/src/lib/membershipAuditTotals.js`, unit-tested).
- `MembershipAuditReport.jsx` renders cards + a sortable by-type table + the leaks list with CSV export. Registered in `ReportingView` as a standalone corp/admin/director report with per-club pills (desktop only).

## Verification
- `node --test src/lib/membershipAuditTotals.test.js` (auth) — passes.
- `pnpm build` (portal) — clean.
- RPC figures match the spec: ~11,771 paying / ~8,564 non-dues / ~$76.14 avg / ~1,400 leaks / SINGLE median $50.

Spec: `docs/superpowers/specs/2026-06-08-membership-audit-design.md`
Plan: `docs/superpowers/plans/2026-06-08-membership-audit.md`

🤖 Generated with [Claude Code](https://claude.com/claude-code)
'@
```
