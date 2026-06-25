# Custom Roles & Permissions (RBAC v2) — Design

**Status:** Approved design, pending spec review → implementation plan.
**Date:** 2026-06-25

## Goal

Let an admin create and name their own roles, control which tiles/pages/reports
each role can see via on/off toggles, and override permissions for an individual
person on top of their assigned role — without weakening any existing
server-side data protection.

## Scope

**This project (visibility-first, "scope C"):** configurable, admin-named roles
that govern *visibility* of tiles, apps, and reports, plus per-person
add/remove overrides. The data model is built so that granular **action-level**
permissions (e.g. "can complete a Day One that isn't theirs", "can edit
inventory cost") can be layered in later as new catalog rows, without a rewrite.

**Explicitly out of scope for now (future "scope B"):** turning individual
backend operations into independently-toggleable permissions. Tier-gated APIs
(HR, payroll, revenue, ABC push) stay governed by the trust tier in this phase.

## Key decisions

1. **Visibility-first, B-ready** (option C). Ship configurable visibility roles
   now; structure the model so action permissions are a drop-in extension.
2. **Named roles anchor to a trust tier** (option A). Each role picks one of the
   existing tiers (`team_member`/`lead`/`manager`/`corporate`/`admin`) as its
   server-side ceiling. The existing 5 roles remain built-in tiers; admins
   create named roles on top. This reuses every existing server gate.
3. **Per-person overrides are add *and* remove**, constrained to the person's
   tier ceiling — an override can reveal anything inside the tier, never grant
   data access above it.

## Existing plumbing this builds on

- `role_tool_visibility (role, tool_key, visible)` — per-role tile/app toggles.
- `staff.role` (text), `staff.custom_tiles`, `staff.custom_reports` — the
  per-person grants used today by the `custom` role.
- `REPORT_ACCESS` matrix + `requireReportAccess()` + `requireRole(tier)` in
  `auth/src/middleware/role.js` — server gates keyed on tier.
- `auth/src/routes/auth.js` `/me` — computes `visible_tools` (the array the
  frontend `ToolGrid`/mobile consume).
- Admin role-visibility matrix backed by `/config/role-visibility`.

## Data model

### `roles` (new)
| column      | type | notes |
|-------------|------|-------|
| id          | uuid pk | |
| name        | text unique | e.g. "Front Desk Plus" |
| base_tier   | text | `team_member`\|`lead`\|`manager`\|`corporate`\|`admin` |
| is_builtin  | bool | true for seeded tiers; can't rename/delete or change tier |
| created_at, updated_at | timestamptz | |

Built-ins are seeded for every role string in use today, each mapped to a
canonical `base_tier`:

| seeded role | base_tier | rationale |
|-------------|-----------|-----------|
| `team_member` | team_member | |
| `front_desk` | team_member | existing alias |
| `personal_trainer` | team_member | existing alias |
| `lead` | lead | |
| `custom` | lead | today's `custom` reaches lead-tier endpoints, blocked from manager+ |
| `manager` | manager | |
| `corporate` | corporate | |
| `director` | corporate | existing alias |
| `marketing` | corporate | legacy role; passes corporate gates today |
| `admin` | admin | |

`base_tier` is always one of the five canonical tiers
(`team_member`/`lead`/`manager`/`corporate`/`admin`); the alias/legacy strings
exist only as seeded role names that resolve to one of those tiers.

### `role_tool_visibility` (reuse, lightly migrated)
Unchanged shape. The `role` text column now references `roles.name`. Built-in
names match today's role strings, so **existing rows keep working**. `tool_key`
already covers apps (`grow`) and tiles (`tile:<id>`); extended to reports
(`report:<key>`).

### `staff_permission_overrides` (new)
| column   | type | notes |
|----------|------|-------|
| staff_id | uuid -> staff.id | |
| perm_key | text | same key space as `tool_key` |
| visible  | bool | true = force-on, false = force-off |

Primary key `(staff_id, perm_key)`.

### `permission_catalog` (new)
| column   | type | notes |
|----------|------|-------|
| perm_key | text pk | `tile:<id>`, `grow`, `report:club-health`, … |
| label    | text | "Reporting", "Club Health Report" |
| category | text | `Apps`\|`Tools`\|`Reports` (later: `Actions`) |
| min_tier | text | lowest tier ever allowed to hold this (the ceiling guard) |

Makes the admin UI self-describing and makes scope B a drop-in (action perms =
new rows with `category = 'Actions'`).

## Server enforcement

Named roles never weaken server guards because everything resolves to
`base_tier`.

1. **Role → tier resolution.** Extend `resolveRole()`/`roleLevel()` with a
   cached lookup of `roles.name → base_tier` (small table, in-memory TTL cache
   like the GHL location config). `requireRole(tier)` and the report-access
   matrix keep operating on tiers, unchanged.
2. **Effective-permission compute** (replaces the current branch in `auth.js`
   `/me`, and is reused by the report gate):
   1. Start from `role_tool_visibility` rows for the person's role where
      `visible = true`.
   2. Apply `staff_permission_overrides` (force-on adds, force-off removes).
   3. **Clamp to ceiling:** drop any key whose `permission_catalog.min_tier`
      exceeds the person's `base_tier`. This is what makes "add" safe.

   Result is the same `visible_tools` array the frontend already consumes — so
   `ToolGrid`/mobile need **zero changes**.
3. **Data endpoints consult the same set.** `requireReportAccess()` (already
   honoring `custom_reports`) is extended to accept a `report:<key>` present in
   the person's effective permissions, within the tier ceiling. Tier-gated APIs
   (HR, payroll, revenue, ABC push) stay on `requireRole(tier)` — never governed
   by a visibility toggle in this phase.

## Admin UI

All under the existing Admin panel, behind an `RBAC_V2_ENABLED` flag; all writes
go through `requireRole('admin')` endpoints.

1. **Roles manager.** Lists built-in tiers (locked name/tier) and custom roles.
   "+ New role" → name + base-tier picker. Custom roles renamable/deletable;
   delete blocked while anyone is assigned (prompt to reassign first).
2. **Permission grid (per role).** Matrix grouped by Apps / Tools / Reports
   (from `permission_catalog.category`), each row an on/off toggle. Permissions
   above the role's tier ceiling render greyed-out/locked with a tooltip. A
   future "Actions" group slots in unchanged.
3. **Per-person override editor.** Staff edit screen: role dropdown now lists
   every role; an expander shows the catalog with three-state controls —
   **Inherit** / **Force on** / **Force off**. Only rows within the person's
   tier ceiling are editable.

Copy follows house style (no em-dashes).

## Migration & rollout

Rule: **migrate to exact parity first, change behavior second.** No one's access
changes on day one.

1. Create the three new tables; keep `role_tool_visibility`.
2. Seed `roles` (one built-in per role string in use, mapped to a canonical
   `base_tier` per the table above).
3. Seed `permission_catalog` from today's surfaces (tiles, apps, reports) with
   `min_tier` set from the current gate (HR/payroll = manager, Meta Ads/Google =
   corporate, standard reports = lead, etc.).
4. Seed report toggles (`report:<key>`) into `role_tool_visibility` matching
   the current `REPORT_ACCESS` matrix.
5. Migrate `custom`-role users: convert `custom_tiles`/`custom_reports` into
   `staff_permission_overrides` (force-on); keep old columns readable during
   transition.

**Parity gate:** automated check that, for every staff member, the new computed
`visible_tools` equals the pre-migration value. That's the green light.

### Rollout (separate PRs, one concern each)
- **PR 1** — schema + seed + switch `visible_tools`/report gate to the new
  compute, behind parity. No UI, no visible change.
- **PR 2** — Admin roles manager + per-role permission grid.
- **PR 3** — per-person override editor.
- **PR 4** — retire `custom_tiles`/`custom_reports` columns once overrides are
  proven.

New Admin UI sits behind `RBAC_V2_ENABLED`; PR 1's parity compute ships safely
underneath.

## Testing

- **Parity:** per-staff computed `visible_tools` matches pre-migration.
- **Ceiling:** an override cannot grant a perm whose `min_tier` exceeds the
  person's `base_tier` (compute-level and endpoint-level).
- **Override semantics:** force-on adds, force-off removes, inherit follows role.
- **Report gate:** a `report:<key>` granted via role toggle or override unlocks
  the report endpoint; tier-gated APIs remain blocked regardless of toggles.

## Sequencing note

Build after PRs #341–#343 are merged so we are not stacking on unmerged work.
