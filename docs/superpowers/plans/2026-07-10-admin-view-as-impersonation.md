# Admin "View As" (Read-Only Impersonation) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let an admin view the portal as any active staff member (read-only) to stress-test permissions.

**Architecture:** Impersonation is a per-request server-side overlay. The admin keeps their own Supabase JWT; a `X-Impersonate-Staff-Id` header (only trusted when the real user is admin) swaps the effective staff context for authorization + data scoping. All mutating requests are rejected while impersonating. A start endpoint validates + audit-logs; the frontend stores the target id and renders a persistent banner.

**Tech Stack:** Node/Express + Supabase (auth service); React 19 + Vite (portal). Backend tests use the built-in `node:test` runner.

## Global Constraints

- View-only: while impersonating, only `GET/HEAD/OPTIONS` are allowed; all other methods return `403 { error: 'read-only preview' }`. Enforced server-side.
- The impersonation header is honored ONLY when the real (JWT-resolved) staff role is `admin`. Never trust it otherwise.
- Web portal / auth-API only. Do NOT touch the Electron vault or the `prospectsApi` (prospects-documents) client.
- No new npm dependencies. Backend tests use `node:test` + `node:assert`.
- Every new public table gets `enable row level security` with no policy (service-role API).
- Do not merge the PR; open it for owner review. Apply the migration to Supabase only after explicit consent.

---

### Task 1: Impersonation decision helpers (pure, unit-tested)

Extract the trust/read-only logic into a pure module so it's testable without Supabase.

**Files:**
- Create: `auth/src/middleware/impersonation.js`
- Test: `auth/src/middleware/impersonation.test.js`

**Interfaces:**
- Produces:
  - `applyImpersonation({ realStaff, targetStaffId, loadStaffContext }) -> Promise<{ staff, realStaff, impersonating }>` — `loadStaffContext(id) -> Promise<staffCtx|null>` is injected.
  - `isImpersonatedWrite(method, impersonating, path, allowlist?) -> boolean`
  - `READONLY_POST_PATHS: string[]` — allowlist of POST paths that are actually reads (starts empty).

- [ ] **Step 1: Write the failing test**

```js
// auth/src/middleware/impersonation.test.js
const test = require('node:test')
const assert = require('node:assert')
const { applyImpersonation, isImpersonatedWrite } = require('./impersonation')

const admin = { id: 'a1', role: 'admin', email: 'a@x.com' }
const target = { id: 't1', role: 'manager', is_active: true }
const loadOK = async (id) => (id === 't1' ? target : null)

test('admin + valid target → impersonating', async () => {
  const r = await applyImpersonation({ realStaff: admin, targetStaffId: 't1', loadStaffContext: loadOK })
  assert.strictEqual(r.impersonating, true)
  assert.strictEqual(r.staff, target)
  assert.strictEqual(r.realStaff, admin)
})

test('no header → passthrough as self', async () => {
  const r = await applyImpersonation({ realStaff: admin, targetStaffId: undefined, loadStaffContext: loadOK })
  assert.strictEqual(r.impersonating, false)
  assert.strictEqual(r.staff, admin)
})

test('non-admin + header → ignored, stays self', async () => {
  const lead = { id: 'l1', role: 'lead' }
  const r = await applyImpersonation({ realStaff: lead, targetStaffId: 't1', loadStaffContext: loadOK })
  assert.strictEqual(r.impersonating, false)
  assert.strictEqual(r.staff, lead)
})

test('admin + missing/inactive target → stays self', async () => {
  const r1 = await applyImpersonation({ realStaff: admin, targetStaffId: 'nope', loadStaffContext: loadOK })
  assert.strictEqual(r1.impersonating, false)
  const loadInactive = async () => ({ id: 't1', role: 'manager', is_active: false })
  const r2 = await applyImpersonation({ realStaff: admin, targetStaffId: 't1', loadStaffContext: loadInactive })
  assert.strictEqual(r2.impersonating, false)
})

test('isImpersonatedWrite: blocks non-GET only while impersonating', () => {
  assert.strictEqual(isImpersonatedWrite('POST', true, '/x'), true)
  assert.strictEqual(isImpersonatedWrite('GET', true, '/x'), false)
  assert.strictEqual(isImpersonatedWrite('POST', false, '/x'), false)
  assert.strictEqual(isImpersonatedWrite('DELETE', true, '/x'), true)
})

test('isImpersonatedWrite: allowlisted POST read passes', () => {
  assert.strictEqual(isImpersonatedWrite('POST', true, '/reports/foo', ['/reports/foo']), false)
})
```

- [ ] **Step 2: Run test to verify it fails**

Run (from `auth/`): `node --test src/middleware/impersonation.test.js`
Expected: FAIL — `Cannot find module './impersonation'`.

- [ ] **Step 3: Write minimal implementation**

```js
// auth/src/middleware/impersonation.js
// Pure impersonation-decision helpers. No Supabase here so they stay unit-
// testable; auth.js wires them to the real staff loader.

const READONLY_POST_PATHS = [] // POST endpoints that are actually reads; extend if any are found.

async function applyImpersonation({ realStaff, targetStaffId, loadStaffContext }) {
  const passthrough = { staff: realStaff, realStaff: null, impersonating: false }
  if (!targetStaffId) return passthrough
  if (!realStaff || realStaff.role !== 'admin') return passthrough
  const target = await loadStaffContext(targetStaffId)
  if (!target || target.is_active === false) return passthrough
  return { staff: target, realStaff, impersonating: true }
}

function isImpersonatedWrite(method, impersonating, path, allowlist = READONLY_POST_PATHS) {
  if (!impersonating) return false
  const m = String(method || 'GET').toUpperCase()
  if (m === 'GET' || m === 'HEAD' || m === 'OPTIONS') return false
  if (allowlist.some(p => path.startsWith(p))) return false
  return true
}

module.exports = { applyImpersonation, isImpersonatedWrite, READONLY_POST_PATHS }
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test src/middleware/impersonation.test.js`
Expected: PASS (6 tests).

- [ ] **Step 5: Commit**

```bash
git add auth/src/middleware/impersonation.js auth/src/middleware/impersonation.test.js
git commit -m "feat(auth): pure impersonation-decision helpers with tests"
```

---

### Task 2: Wire impersonation into `authenticate`

Refactor the staff+locations load into a reusable helper and apply the overlay + read-only guard.

**Files:**
- Modify: `auth/src/middleware/auth.js`

**Interfaces:**
- Consumes: `applyImpersonation`, `isImpersonatedWrite` (Task 1).
- Produces: `buildStaffContext(staffId) -> Promise<staffCtx|null>` (exported for reuse); on `req`: `req.staff` (effective), `req.realStaff` (admin when impersonating, else null), `req.impersonating` (bool).

- [ ] **Step 1: Refactor the loader out and export it**

Replace the body of `auth/src/middleware/auth.js` with:

```js
const { supabaseAdmin } = require('../services/supabase')
const { applyImpersonation, isImpersonatedWrite } = require('./impersonation')

// Load a staff member's full request context (profile + location scoping).
// Returns null if the row does not exist. Shared by the real-user path and
// the impersonation-target path.
async function buildStaffContext(staffId) {
  const { data: staff, error } = await supabaseAdmin
    .from('staff')
    .select('id, email, display_name, first_name, last_name, role, is_active, must_change_password, marketing_addon, marketing_locations, marketing_types, custom_tiles, custom_reports')
    .eq('id', staffId)
    .single()
  if (error || !staff) return null

  const { data: staffLocs } = await supabaseAdmin
    .from('staff_locations')
    .select('location_id, is_primary, can_sign_in, can_view_reports')
    .eq('staff_id', staffId)

  return {
    ...staff,
    location_ids: (staffLocs || []).map(sl => sl.location_id),
    sign_in_location_ids: (staffLocs || []).filter(sl => sl.can_sign_in !== false).map(sl => sl.location_id),
    report_location_ids: (staffLocs || []).filter(sl => sl.can_view_reports !== false).map(sl => sl.location_id),
    primary_location_id: (staffLocs || []).find(sl => sl.is_primary)?.location_id || null,
  }
}

async function authenticate(req, res, next) {
  const header = req.headers.authorization
  if (!header || !header.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Missing or invalid authorization header' })
  }
  const token = header.slice(7)

  try {
    const { data: { user }, error: authError } = await supabaseAdmin.auth.getUser(token)
    if (authError || !user) {
      return res.status(401).json({ error: 'Invalid or expired token' })
    }

    const realStaff = await buildStaffContext(user.id)
    if (!realStaff) {
      return res.status(401).json({ error: 'Staff account not found' })
    }

    // Impersonation overlay — only trusted when the real user is admin.
    const targetStaffId = req.headers['x-impersonate-staff-id']
    const { staff, realStaff: actor, impersonating } = await applyImpersonation({
      realStaff, targetStaffId, loadStaffContext: buildStaffContext,
    })
    req.staff = staff
    req.realStaff = actor
    req.impersonating = impersonating

    // View-only: block any write while impersonating.
    if (isImpersonatedWrite(req.method, impersonating, req.path)) {
      return res.status(403).json({ error: 'read-only preview', impersonating: true })
    }

    next()
  } catch (err) {
    return res.status(401).json({ error: 'Invalid or expired token' })
  }
}

module.exports = authenticate
module.exports.buildStaffContext = buildStaffContext
```

- [ ] **Step 2: Verify nothing imports the old shape differently**

Run (from repo root): search for other importers of the middleware.
Run: `grep -rn "require(.*middleware/auth')" auth/src | head`
Expected: importers use it as `const authenticate = require('../middleware/auth')` (default function). The added `.buildStaffContext` property does not affect them.

- [ ] **Step 3: Sanity-check the service boots**

Run (from `auth/`): `node -e "require('./src/middleware/auth'); console.log('ok')"`
Expected: prints `ok` (module loads; note this needs env for supabase — if it throws on env, instead run `node --check src/middleware/auth.js` and expect no output = syntax OK).

- [ ] **Step 4: Commit**

```bash
git add auth/src/middleware/auth.js
git commit -m "feat(auth): apply read-only impersonation overlay in authenticate"
```

---

### Task 3: Start endpoint + audit table migration

**Files:**
- Create: `auth/migrations/082_impersonation_log.sql` (verify 082 is the next unused number at implementation time)
- Modify: `auth/src/routes/admin.js`

**Interfaces:**
- Consumes: `authenticate`, `requireRole` (existing middleware), `supabaseAdmin`.
- Produces: `POST /admin/impersonate/:staffId` → `200 { target: { id, name, role } }` or `404 { error }`.

- [ ] **Step 1: Write the migration**

```sql
-- auth/migrations/082_impersonation_log.sql
create table if not exists impersonation_log (
  id uuid primary key default gen_random_uuid(),
  actor_staff_id uuid not null references staff(id),
  target_staff_id uuid not null references staff(id),
  started_at timestamptz not null default now()
);
alter table impersonation_log enable row level security;
```

- [ ] **Step 2: Confirm the admin router mount + imports**

Run: `grep -n "require('../middleware/role')\|requireRole\|router.post\|module.exports" auth/src/routes/admin.js | head`
Confirm `admin.js` already imports `authenticate` and `requireRole` and is mounted at `/admin` in `auth/src/index.js` (verify with: `grep -n "routes/admin" auth/src/index.js`). If `requireRole` is not yet imported in admin.js, add: `const { requireRole } = require('../middleware/role')`.

- [ ] **Step 3: Add the endpoint**

Add to `auth/src/routes/admin.js` (near other routes; adjust the local names for `router`/`supabaseAdmin` to match the file):

```js
// POST /admin/impersonate/:staffId — start a read-only "view as" session.
// Runs as the real admin (no impersonation header yet). Validates the target
// and writes one audit row. The frontend then stores the id and reloads.
router.post('/impersonate/:staffId', authenticate, requireRole('admin'), async (req, res) => {
  const { staffId } = req.params
  const { data: target, error } = await supabaseAdmin
    .from('staff')
    .select('id, display_name, first_name, last_name, role, is_active')
    .eq('id', staffId)
    .single()
  if (error || !target || target.is_active === false) {
    return res.status(404).json({ error: 'Staff member not found or inactive' })
  }
  await supabaseAdmin.from('impersonation_log').insert({
    actor_staff_id: req.staff.id,
    target_staff_id: target.id,
  })
  const name = target.display_name || [target.first_name, target.last_name].filter(Boolean).join(' ')
  res.json({ target: { id: target.id, name, role: target.role } })
})
```

- [ ] **Step 4: Manual verification (after migration applied to a dev/live project with consent)**

As a real admin token: `POST /admin/impersonate/<a real staff id>` → `200` with target summary; a row appears in `impersonation_log`. As a non-admin token → `403` (from `requireRole`). Unknown id → `404`.

- [ ] **Step 5: Commit**

```bash
git add auth/migrations/082_impersonation_log.sql auth/src/routes/admin.js
git commit -m "feat(auth): view-as start endpoint + impersonation_log migration"
```

---

### Task 4: Expose impersonation state on `/me`

**Files:**
- Modify: `auth/src/routes/auth.js` (the `GET /me` handler, ~line 284–316)

**Interfaces:**
- Produces: `/me` response gains `impersonating: { active: true, target: { name, role }, by }` when `req.impersonating`; omitted otherwise.

- [ ] **Step 1: Add impersonation info to the response**

In the `res.json({ ... })` of `GET /me`, add a sibling key after `visible_tools`:

```js
    visible_tools,
    ...(req.impersonating ? {
      impersonating: {
        active: true,
        target: {
          name: req.staff.display_name || [req.staff.first_name, req.staff.last_name].filter(Boolean).join(' '),
          role: req.staff.role,
        },
        by: req.realStaff?.email || null,
      },
    } : {}),
```

- [ ] **Step 2: Syntax check**

Run (from `auth/`): `node --check src/routes/auth.js`
Expected: no output (valid).

- [ ] **Step 3: Commit**

```bash
git add auth/src/routes/auth.js
git commit -m "feat(auth): surface impersonation state on /me"
```

---

### Task 5: Frontend API client — header injection + helpers

**Files:**
- Modify: `portal/src/lib/api.js`

**Interfaces:**
- Consumes: `POST /admin/impersonate/:id` (Task 3).
- Produces: `getImpersonateId()`, `setImpersonateId(id)`, `startImpersonation(staffId)`; `X-Impersonate-Staff-Id` auto-attached to every `api()` request when set.

- [ ] **Step 1: Add storage helpers**

Near the token helpers (after `getToken`, ~line 70), add:

```js
const IMPERSONATE_KEY = 'wcs_impersonate_id'
export function getImpersonateId() {
  try { return localStorage.getItem(IMPERSONATE_KEY) } catch { return null }
}
export function setImpersonateId(id) {
  try {
    if (id) localStorage.setItem(IMPERSONATE_KEY, id)
    else localStorage.removeItem(IMPERSONATE_KEY)
  } catch {}
}
```

- [ ] **Step 2: Inject the header in the one auth path**

In `fetchWithAuthAndRetry`, right after the `if (authToken) { headers['Authorization'] = ... }` block (~line 169), add:

```js
  const impersonateId = getImpersonateId()
  if (impersonateId) headers['X-Impersonate-Staff-Id'] = impersonateId
```

(The 401-retry path builds `retryHeaders` by spreading `headers`, so it carries the impersonation header automatically — no change needed there.)

- [ ] **Step 3: Add the start helper**

Near `createStaff` (~line 361), add:

```js
export async function startImpersonation(staffId) {
  return api('/admin/impersonate/' + staffId, { method: 'POST' })
}
```

- [ ] **Step 4: Verify build compiles**

Run (from `portal/`): `npx vite build` (or the repo's build script) — or, if a full build is heavy, `node --check` is not valid for JSX; instead run `npm run lint` if present. Minimum: ensure no syntax error by running the dev server briefly: `npm run dev` and confirm it starts without a parse error, then stop it.

- [ ] **Step 5: Commit**

```bash
git add portal/src/lib/api.js
git commit -m "feat(portal): attach impersonation header + start-impersonation helper"
```

---

### Task 6: "View as" button in the Staff admin

**Files:**
- Modify: `portal/src/components/AdminStaffTab.jsx`

**Interfaces:**
- Consumes: `startImpersonation`, `setImpersonateId` (Task 5).

- [ ] **Step 1: Import the helpers**

In the import from `'../lib/api'` (line 2), add `startImpersonation, setImpersonateId`.

- [ ] **Step 2: Add a handler**

Inside the component, add:

```js
async function handleViewAs(member) {
  try {
    await startImpersonation(member.id)
    setImpersonateId(member.id)
    // Hard reload to the portal home so the whole app re-renders as the target.
    window.location.assign('/')
  } catch (e) {
    alert(e.message || 'Could not start view-as')
  }
}
```

- [ ] **Step 3: Render the button per active staff row**

In the staff list row rendering (next to the existing Edit action), add for active members:

```jsx
<button
  type="button"
  onClick={() => handleViewAs(member)}
  className="text-xs font-semibold text-wcs-red hover:underline"
>
  View as
</button>
```

(Place it alongside the row's existing action buttons. If the row variable is named differently than `member`, use that name.)

- [ ] **Step 4: Manual verification**

Load the portal as admin → Admin → Staff → each active row shows "View as".

- [ ] **Step 5: Commit**

```bash
git add portal/src/components/AdminStaffTab.jsx
git commit -m "feat(portal): View as button in Staff admin"
```

---

### Task 7: Impersonation banner in the app shell

**Files:**
- Modify: `portal/src/App.jsx`

**Interfaces:**
- Consumes: `/me` `impersonating` field (Task 4); `setImpersonateId` (Task 5); `user` state (App.jsx:45).

- [ ] **Step 1: Import the helper**

Ensure `App.jsx` imports `setImpersonateId` from `'./lib/api'` (add to the existing api import).

- [ ] **Step 2: Add an exit handler**

Inside `App()`:

```js
function exitImpersonation() {
  setImpersonateId(null)
  window.location.assign('/')
}
```

- [ ] **Step 3: Render the sticky banner**

At the top of the app's returned JSX (before the main content), add:

```jsx
{user?.impersonating?.active && (
  <div className="sticky top-0 z-[100] flex items-center justify-center gap-3 bg-wcs-red text-white text-sm font-semibold px-4 py-2">
    <span>👁 Viewing as {user.impersonating.target.name} ({user.impersonating.target.role}) — read-only</span>
    <button
      type="button"
      onClick={exitImpersonation}
      className="underline font-bold"
    >
      Exit
    </button>
  </div>
)}
```

- [ ] **Step 4: Manual verification (full end-to-end)**

1. As admin, Admin → Staff → "View as" a manager.
2. App reloads; red banner shows "Viewing as <manager> (manager) — read-only".
3. Reports/tiles now match that manager's access exactly (their location lock applies).
4. Attempt any write (e.g. submit a Day One) → blocked; backend returns `read-only preview`.
5. Click "Exit" → back to your admin session, banner gone, admin panel visible again.
6. Confirm one row was written to `impersonation_log` for the session.

- [ ] **Step 5: Commit**

```bash
git add portal/src/App.jsx
git commit -m "feat(portal): read-only impersonation banner with exit"
```

---

## Verification checklist (whole feature)

- [ ] `node --test src/middleware/impersonation.test.js` passes (from `auth/`).
- [ ] Non-admin sending `X-Impersonate-Staff-Id` is ignored (still sees own portal).
- [ ] While impersonating, a POST/PUT/PATCH/DELETE returns 403 `read-only preview`.
- [ ] Audit `POST /reports/*` route definitions are GET-based reads; if any real report READ is a POST, add its path to `READONLY_POST_PATHS` in `impersonation.js`. Run: `grep -rn "router.post" auth/src/routes/*eport*.js auth/src/routes/*.js | grep -i report`.
- [ ] "View as" → banner → correct scoped view → Exit round-trips cleanly.

## Notes for the owner / rollout

- Open one PR for the branch; do not merge.
- The migration `082_impersonation_log.sql` is applied to Supabase only after explicit consent.
- Ships before the roles-grid change so it can validate that work.
