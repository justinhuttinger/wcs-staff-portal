# Admin "View As" — Read-Only Impersonation for Permission Testing

**Date:** 2026-07-10
**Status:** Design — approved in brainstorm, pending spec review
**Repo:** wcs-staff-portal · **Supabase:** ybopxxydsuwlbwxiuzve

## Goal

Let an admin see the portal exactly as any other staff member sees it — their
tiles, reports, menus, data scope, location lock — to stress-test permissions
(e.g. verify the roles-grid changes). **View-only:** you can click and navigate
anywhere, but nothing can be written under the target's name.

## Decisions (from brainstorm)

- **View-only, enforced on the backend.** All mutating requests are rejected
  while impersonating. No risk of altering real data as someone else.
- **Web portal only.** Tile/report/marketing visibility + report data scope +
  location lock. Explicitly NOT the Electron credential-vault autofill.
- **Admin-only.** Only a real admin can impersonate. Every start is audit-logged.
- **No token minting.** The admin stays authenticated as themselves; impersonation
  is an overlay applied server-side, so the real identity is always known.

## Mechanism

The admin's real Supabase JWT is unchanged. Impersonation is a per-request
overlay keyed by a header, plus a start endpoint for validation + audit.

### Backend

**1. Refactor `auth/src/middleware/auth.js`.** Extract the staff+locations load
into a reusable helper:

```
async function buildStaffContext(staffId) -> req.staff-shaped object
```

`authenticate` uses it for the real user (unchanged output for the normal case).

**2. Impersonation overlay in `authenticate`.** After building the real staff
context:

- Read header `x-impersonate-staff-id`.
- If present AND `realStaff.role === 'admin'`:
  - `target = await buildStaffContext(headerId)`.
  - If `target` exists and is active → set
    `req.realStaff = realStaff`, `req.staff = target`,
    `req.impersonating = true`, `req.impersonatorId = realStaff.id`.
  - If target missing/inactive → ignore header, proceed as self (fail-safe;
    `/me` will report not-impersonating so the UI self-heals).
- If header present but `realStaff.role !== 'admin'` → ignore header, proceed as
  self (optionally log the attempt). Never trust the header without admin.

Everything downstream (`getVisibleTools`, `requireRole`, report location
scoping) now computes against `req.staff` = the target. That is what makes the
admin see precisely the target's portal.

**3. Read-only enforcement (single choke point).** Inside `authenticate`, after
the overlay: if `req.impersonating` and the method is not `GET/HEAD/OPTIONS`,
return `403 { error: 'read-only preview', impersonating: true }`. Because every
protected route runs `authenticate`, no authenticated write can bypass this.
Exiting impersonation is client-side only (clears the header), so it needs no
exception.

> **Caveat to verify during implementation:** the method-based guard assumes all
> data *reads* are `GET`. If any report/data endpoint reads via `POST` (complex
> filters), it would be over-blocked while impersonating and its view wouldn't
> render. The plan must audit read endpoints; if a POST-based read exists, add a
> small allowlist of read-only POST paths that bypass the guard. Fail-closed
> (over-block) is acceptable for v1 if none are found.

**4. Start endpoint + audit — `POST /admin/impersonate/:staffId`.** Guarded by
`requireRole('admin')` (runs as the real admin; no impersonation header yet).
Validates the target is a real, active staff member, inserts one row into
`impersonation_log`, and returns a small target summary
(`{ id, name, role }`). The frontend then stores the id and reloads.
(A `stop` endpoint is optional and omitted; exit is client-side.)

**5. `/me` additions.** When `req.impersonating`, include:

```
impersonating: {
  active: true,
  target: { name, role },
  by: <real admin email>,
}
```

so the frontend can render the banner and know the session is active. Absent /
`active:false` when not impersonating, so a stale client header self-heals.

### Frontend

**1. API client.** If `localStorage['impersonate_staff_id']` is set, attach
`X-Impersonate-Staff-Id` to every request. One place, all calls covered.

**2. "View as" button.** In Admin → Staff, each active staff row gets a
**View as** button → `POST /admin/impersonate/:id` → on success set
`localStorage['impersonate_staff_id']` and hard-reload to the portal home.
(Don't offer it for yourself.)

**3. Banner.** App shell reads `/me`. If `impersonating.active`, render a sticky
top bar: `👁 Viewing as <Name> (read-only) — Exit`. **Exit** clears the
localStorage key and hard-reloads → back to the admin's own session.

**4. Natural anti-nesting.** While impersonating, `/me` returns the target's
role, so the Admin panel (admin-gated) isn't rendered — there's no way to start
a nested impersonation. Exit is always available via the banner.

**5. Write attempts.** If any UI write slips through, the backend 403
`read-only preview` surfaces as a toast; the UI shouldn't crash. Optional: a
lightweight interceptor that shows "Read-only while viewing as X" on that 403.

## Data model (migration)

```
create table impersonation_log (
  id uuid primary key default gen_random_uuid(),
  actor_staff_id uuid not null references staff(id),
  target_staff_id uuid not null references staff(id),
  started_at timestamptz not null default now()
);
alter table impersonation_log enable row level security; -- service-role only, no policy
```

(Per project convention every public table has RLS enabled with no policy;
the API uses the service role.)

## Security review

- Header is only honored for a **verified admin** (role checked from the DB-loaded
  real staff, not from anything client-supplied).
- **No privilege escalation:** impersonation can only ever *reduce or change*
  what's visible to the equivalent of the target; and all writes are blocked, so
  even impersonating another admin cannot perform actions.
- **Auditable:** the real admin id is always on `req.realStaff`; every start is
  logged with actor + target + time.
- **Fail-safe:** invalid/inactive target or non-admin actor → silently proceed
  as self; never grants anything.

## Out of scope / follow-ups

- Electron credential-vault autofill impersonation (different, riskier; not
  needed for permission testing).
- Full "act-as" with writes (explicitly deferred; may add later behind heavier
  audit if a write-path repro is ever needed).
- Logging impersonation *end* / duration (only start is logged for v1).

## Testing / verification

- Unit: `authenticate` overlay — admin + valid header → `req.staff` is target,
  `impersonating` true; non-admin + header → stays self; admin + bad header →
  stays self. Read-only guard: impersonating + POST → 403; + GET → passes.
- Integration: `POST /admin/impersonate/:id` writes exactly one audit row and is
  403 for non-admins.
- Manual: as admin, View as a manager → see the manager's exact tiles/reports
  and location lock; attempt a Day One submit → blocked read-only; Exit → back to
  admin. Then use it to validate the roles-grid change (manager report list).

## Rollout

- One PR (auth middleware + start route + `/me` + migration + frontend button/
  banner/api-client), opened for owner review, not merged by the agent.
- Migration applied to Supabase after review / explicit consent.
- Ships before the roles-grid change so it can be used to validate it.
