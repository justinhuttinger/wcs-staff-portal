# Roles Grid as the Source of Truth for Report + Marketing Visibility

**Date:** 2026-07-10
**Status:** Implemented (desktop) 2026-07-10.

**Scope note (2026-07-10 implementation):** Shipped for the **desktop** reporting UI + the data seed + marketing. **Mobile deferred**: `ReportsHome.jsx` keys the Meta Ads report as `'marketing'` (desktop uses `'meta-ads'`) and lacks `pos-sales`/`till`/`email-marketing` tiles — normalizing that is its own PR. Mobile keeps its hardcoded defaults for now (no regression; it already unions grid grants on top). Also: the canonical Operational-Compliance report key on current master is **`compliance`**, not `operations` — the seed uses `compliance`.
**Repo:** wcs-staff-portal · **Supabase:** ybopxxydsuwlbwxiuzve

## Problem

The Admin → Roles page renders a grid of checkboxes (Apps, Tools, Reports,
Marketing, Marketing Types) that *looks* like it controls what each role can
see. It does not. For Reports and Marketing the checkboxes are largely
cosmetic:

- **Report visibility** is actually driven by hard-coded per-role lists in the
  frontend — `defaultReportKeysForRole()` in `portal/src/components/ReportingView.jsx`
  (desktop) and `defaultTileKeysForRole()` in
  `portal/src/mobile/components/reports/ReportsHome.jsx` (mobile). The grid's
  `report:<key>` toggles are only **unioned on top** of those lists, so a
  checkbox can *add* a report but can never *remove* one the hard-coded list
  grants.
- **Marketing** capability is gated on a corporate+ tier fast-path
  (`marketingAccess.js` `isFullTier`), so corporate/admin/director/marketing
  see all marketing tiles regardless of the boxes.

Symptoms the owner observed:
1. Managers can open ~15–18 reports, yet every Report box shows **unchecked**
   on the manager roles page (managers have zero `report:*` rows in the DB).
2. Managers appear to have "Facebook" and "Google" enabled but cannot open the
   Meta Ads / Google Marketing reports. Those checked boxes are custom **link
   tiles** literally named "Facebook" and "Google" — not the marketing reports,
   which are excluded from the manager hard-coded list. (Naming collision.)

Additional latent inconsistencies found while scoping:
- Desktop and mobile use **different** hard-coded manager report sets, so a
  manager sees a different report list on phone vs desktop.
- The Reports **permission_catalog** has only 18 keys but the app renders **22**
  report tiles. Missing catalog keys: `pos-sales`, `till`, `operations`,
  `email-marketing`, `audits`. These reports cannot be represented as grid
  checkboxes today. (`daily-snapshot` exists in the catalog but has no tile.)
- The `director` built-in role has **zero** `role_tool_visibility` rows; it
  currently gets all reports purely from the hard-coded default.

## Decision (from brainstorm)

- **"Unchecked" = hide the tile (UI gate).** The backend keeps its existing
  tier-based gates (`requireReportAccess` short-circuits by tier) as a safety
  net. This work does not change backend authorization. There is therefore no
  hard-lockout risk: a high tier could still reach data via direct API, and the
  Roles page itself is gated by `requireRole('admin')`, independent of the grid.
- **Scope = Reports + Marketing + Marketing Types** all become genuine
  visibility drivers.
- **Approach = seed-then-read.** Seed each role's *current* effective
  visibility into `role_tool_visibility` first (zero-change for existing users),
  then delete the frontend hard-coded lists and the corporate+ marketing
  fast-path so the grid is the sole frontend driver.

## Architecture

```
role_tool_visibility (seeded)  ──► getEffectivePermissions() ──► /me visible_tools
                                                                      │
                                       ┌──────────────────────────────┤
                                       ▼                              ▼
                        ReportingView.getReportTilesForRole   marketingAccess()
                        ReportsHome.getTilesForRole           (grid-driven)
                        (grid-driven, no hard-coded defaults)
```

Backend `requireReportAccess` / `marketingContext` are **unchanged** (tier
short-circuit remains the safety net).

## Work items

### 1. Catalog reconciliation (migration)

Add the 5 missing report keys to `permission_catalog` (category `Reports`) so
every real report tile is representable as a checkbox:
`report:pos-sales`, `report:till`, `report:operations`,
`report:email-marketing`, `report:audits`. Leave `report:daily-snapshot` as-is
(harmless; no tile). Set a sensible `min_tier` per key (informational only —
catalog `min_tier` no longer clamps anything post RBAC-v2 ceiling removal).

Canonical report universe (22 keys) = the union of desktop `ALL_REPORT_TILES`.

### 2. Data seed (idempotent SQL, run once)

Insert `visible=true` rows into `role_tool_visibility` reproducing today's
behavior. `ON CONFLICT (role, tool_key) DO UPDATE SET visible=true`.

**Reports per role (seed matrix):**

| Role | Reports seeded |
|------|----------------|
| team_member | *(none)* |
| lead | membership, cancels, pt, pt-roster, checkins, pt-sessions, pt-new-clients, session-frequency, deactivated-pt, pt-health |
| manager | *(union of desktop+mobile)* membership, cancels, pt, club-health, pt-roster, checkins, pt-sessions, pt-new-clients, session-frequency, deactivated-pt, pt-health, payroll, operations, revenue, pos-sales, till, kpis, audits, **pt-projections** |
| marketing | all 22 **except** kpis, audits |
| corporate | all 22 |
| director | all 22 |
| admin | all 22 |

`custom` role is not seeded here — it keeps reading per-person `custom_reports`.

**Marketing seed** (caps + all 10 types) for roles that have full marketing
today: `corporate`, `admin`, `director`, `marketing`. Keys:
`marketing:tracker`, `marketing:needs`, `marketing:research`, and all
`marketing_type:*`. (corporate + admin already seeded 2026-07-10; add director +
marketing.)

**Behavior change (only one), pre-approved:** managers gain, in the UI,
`pt-projections` on desktop and `kpis, audits, pos-sales, till, pt-projections`
on mobile. All are reports managers are already tier-authorized for on the
backend; this only makes desktop/mobile consistent.

### 3. Frontend — desktop (`ReportingView.jsx`)

- Delete `defaultReportKeysForRole()`.
- `getReportTilesForRole(role, customReports, visibleTools)` becomes:
  allowed = (`role === 'custom'` ? `customReports` : `[]`) ∪
  {`k.slice('report:'.length)` for `k` in `visibleTools` starting `report:`}.
- team_member → empty set → existing "No reports available" state. Unchanged.

### 4. Frontend — mobile (`ReportsHome.jsx`)

- Delete `defaultTileKeysForRole()`; apply the same grid-only derivation as
  desktop so both platforms read one source.

### 5. Frontend — marketing (`marketingAccess.js`)

- Remove the corporate+ `isFullTier` fast-path for **visibility** so the three
  caps and the type list derive from `visible_tools` grants (now seeded).
- Keep the shape of the returned object identical. Backend `marketingContext`
  fast-path stays (safety net), so this is a UI-visibility change only.

### 6. Roles admin page (`AdminRolesV2Tab.jsx`)

No logic change required. After the catalog + seed, the grid naturally shows the
correct checked state for every role. Verify the 5 new report rows render under
the Reports category.

## Out of scope / follow-ups

- **Not doing:** renaming the confusing "Facebook"/"Google" custom link tiles
  (offered as a separate tiny change if wanted).
- **Not doing:** any backend authorization change. `requireReportAccess`,
  `requireMarketing`, `REPORT_ACCESS`, and tier gates are untouched.
- The custom link tiles named "Marketing"/"Reporting"/etc. remain apps tiles,
  unaffected.

## Testing / verification

- Unit: `getReportTilesForRole` / mobile equivalent — team_member empty; a role
  with seeded `report:*` returns exactly those tiles; a `report:*` override adds
  one.
- Data: after seed, query `role_tool_visibility` and assert each role's report
  set equals the matrix above; assert marketing rows for the 4 full-marketing
  roles.
- Manual (post-deploy): log in as a manager → Reports list matches the union on
  both desktop and mobile; corporate → all 22; team_member → none. Uncheck a
  report on a role in the Roles page → that role stops seeing the tile.

## Rollout

- One PR (frontend + migration), opened for owner review, **not merged** by the
  agent. Migration applied to Supabase only after PR review / explicit consent.
- The data seed is a production write; exact row list shown for approval before
  running. Reversible (rows can be flipped/deleted).
