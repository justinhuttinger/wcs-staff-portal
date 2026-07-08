# WCS Form Builder Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Internal Jotform replacement: flat form builder in the staff portal, public renderer at forms.westcoaststrength.com, submissions to Google Sheets with Supabase backup, sharing model + append-only audit trail.

**Architecture:** Backend lives in `auth/` (Express, CommonJS, Supabase service-role only): migration 078, three services (schema validation, permissions, Sheets), an authed router and a public router. Builder UI lives in `portal/` (React 19, Tailwind 4 theme tokens, no router: App.jsx state machine). Public renderer is a separate tiny Vite React app in a new repo deployed to Cloudflare Pages.

**Tech Stack:** Node/Express (CommonJS) + `node:test`, Supabase (service role, RLS-on/no-policy), hand-rolled `fetch` to Google Sheets/Drive REST using the Google Business OAuth token (`getAccessToken` from `auth/src/routes/googleBusiness.js`), React 19 + Vite + Tailwind 4, `qrcode` npm package (client-side only).

**Working directory:** `C:\Users\justi\wcs-staff-portal\.claude\worktrees\form-builder` (branch `feat/form-builder`). The renderer repo is created at `C:\Users\justi\Desktop\wcs-forms-renderer`.

**Spec:** `docs/superpowers/specs/2026-07-08-form-builder-design.md` — read it before starting any task.

## Global Constraints

- **No em dashes** anywhere in UI copy, labels, placeholder text, or generated text (including Sheets headers and renderer copy). Use commas, periods, or the word "to".
- `auth/` is CommonJS (`require`/`module.exports`); `portal/` is ESM/JSX. Match surrounding style exactly (no semicolon-free vs semicolon churn; auth uses no semicolons sparingly, match per-file).
- Tests: colocated `*.test.js` using `const test = require('node:test')` + `node:assert`. Run with `node --test <file>`.
- Package manager is **pnpm** everywhere. Never npm/yarn. Never `Remove-Item -Recurse` a worktree.
- Supabase access is service-role only via `supabaseAdmin`; every new table gets `ALTER TABLE ... ENABLE ROW LEVEL SECURITY;` and NO policies.
- All Google API calls are hand-rolled `fetch` (no googleapis package). Every Drive files call must carry `supportsAllDrives=true`.
- New portal dependencies allowed: `qrcode` only. New auth dependencies: none (express-rate-limit already present).
- Migration file is `auth/migrations/078_form_builder.sql`. Do NOT apply it to Supabase; Justin applies/consents separately.
- Location identifier everywhere = `locations.id` uuid. Staff identifier = `staff.id` uuid.
- Commit after every task (small, conventional messages, `Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>` footer).
- Do not touch files outside the listed paths; other sessions may work in the main checkout (we are in a worktree; never `cd` out of it).

---

### Task 1: Migration 078

**Files:**
- Create: `auth/migrations/078_form_builder.sql`

**Interfaces:**
- Produces: tables `forms`, `form_submissions`, `form_shares`, `form_audit_log`; RBAC catalog row `forms`; every later task's queries depend on these exact column names.

- [ ] **Step 1: Write the migration**

```sql
-- Form Builder module: internal Jotform replacement.
-- Tables are service-role only (RLS enabled, no policies), matching migration 035 convention.

create table if not exists forms (
  id uuid primary key default gen_random_uuid(),
  slug text unique not null,
  title text not null,
  description text,
  schema jsonb not null default '[]'::jsonb,
  owner_id uuid not null references staff(id),
  location_id uuid not null references locations(id),
  visibility text not null default 'private' check (visibility in ('private','location','shared')),
  location_can_edit boolean not null default false,
  status text not null default 'draft' check (status in ('draft','published','archived')),
  sheet_id text,
  sheet_tab text,
  sheet_columns jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists form_submissions (
  id uuid primary key default gen_random_uuid(),
  form_id uuid not null references forms(id),
  data jsonb not null,
  submitted_at timestamptz not null default now(),
  synced_to_sheet boolean not null default false,
  sync_error text
);
create index if not exists idx_form_submissions_form on form_submissions (form_id, submitted_at desc);
create index if not exists idx_form_submissions_unsynced on form_submissions (form_id) where synced_to_sheet = false;

create table if not exists form_shares (
  id uuid primary key default gen_random_uuid(),
  form_id uuid not null references forms(id) on delete cascade,
  staff_id uuid not null references staff(id) on delete cascade,
  permission text not null check (permission in ('viewer','editor')),
  granted_by uuid references staff(id),
  created_at timestamptz not null default now(),
  unique (form_id, staff_id)
);

-- Append-only audit trail. form_id intentionally has NO foreign key so audit
-- rows survive a hard-deleted draft. Never UPDATE or DELETE rows here.
create table if not exists form_audit_log (
  id uuid primary key default gen_random_uuid(),
  form_id uuid not null,
  actor_id uuid,
  action text not null check (action in (
    'created','edited','published','archived','deleted','shared','unshared',
    'permission_changed','visibility_changed','submission_received','sheet_retry')),
  detail jsonb,
  created_at timestamptz not null default now()
);
create index if not exists idx_form_audit_form on form_audit_log (form_id, created_at desc);
create index if not exists idx_form_audit_actor on form_audit_log (actor_id, created_at desc);

-- The service role bypasses RLS, so append-only must be enforced by trigger.
create or replace function form_audit_log_immutable() returns trigger as $$
begin
  raise exception 'form_audit_log is append-only';
end;
$$ language plpgsql;

drop trigger if exists trg_form_audit_immutable on form_audit_log;
create trigger trg_form_audit_immutable
  before update or delete on form_audit_log
  for each row execute function form_audit_log_immutable();

alter table forms enable row level security;
alter table form_submissions enable row level security;
alter table form_shares enable row level security;
alter table form_audit_log enable row level security;

-- RBAC v2: make the Forms tool grantable to custom roles / individuals.
insert into permission_catalog (perm_key, label, category, min_tier) values
  ('forms', 'Forms', 'Tools', 'lead')
on conflict (perm_key) do nothing;

-- Seed the built-in role toggles so manager+ see the tile by default.
insert into role_tool_visibility (role, tool_key, visible)
select r, 'forms', true from unnest(array['manager','corporate','admin']) as r
on conflict (role, tool_key) do update set visible = true;
```

- [ ] **Step 2: Sanity-check the seed statements against reality**

Run: `grep -n "insert into permission_catalog" auth/migrations/062_catalog_builtin_apps.sql` and `grep -n "role_tool_visibility" auth/migrations/057_rbac_v2_schema.sql auth/migrations/0*.sql | head`
Confirm `permission_catalog` columns are `(perm_key, label, category, min_tier)` and `role_tool_visibility` has unique `(role, tool_key)` with a `visible` boolean. If `role_tool_visibility`'s conflict target differs (check its migration/seed for the actual unique constraint), adjust the ON CONFLICT clause to match. Do not guess: read the earlier migration that created it.

- [ ] **Step 3: Commit**

```bash
git add auth/migrations/078_form_builder.sql
git commit -m "feat(forms): migration 078, form builder tables + append-only audit + RBAC seed"
```

---

### Task 2: Field schema validation service

**Files:**
- Create: `auth/src/services/formsSchema.js`
- Test: `auth/src/services/formsSchema.test.js`

**Interfaces:**
- Produces:
  - `FIELD_TYPES` — array of all 11 type strings.
  - `INPUT_TYPES` — array excluding `header`,`description`.
  - `validateSchema(schema) -> { ok: boolean, error?: string }`
  - `validateSubmission(schema, data) -> { ok: boolean, errors: { [fieldId]: string }, cleaned: { [fieldId]: string|string[] } }`
  - `makeSlug(title) -> string` (lowercase alnum/hyphen + '-' + 4 random base36 chars)
- Consumed by Tasks 5, 6, 7.

- [ ] **Step 1: Write the failing tests**

```js
const test = require('node:test')
const assert = require('node:assert')
const { validateSchema, validateSubmission, makeSlug, INPUT_TYPES, FIELD_TYPES } = require('./formsSchema')

const SCHEMA = [
  { id: 'f_head1', type: 'header', label: 'Event Signup' },
  { id: 'f_name', type: 'short_text', label: 'Your name', required: true },
  { id: 'f_email', type: 'email', label: 'Email', required: true },
  { id: 'f_phone', type: 'phone', label: 'Phone', required: false },
  { id: 'f_count', type: 'number', label: 'Guests', required: false },
  { id: 'f_shirt', type: 'dropdown', label: 'Shirt size', required: true, options: ['S', 'M', 'L'] },
  { id: 'f_days', type: 'checkbox', label: 'Days attending', required: false, options: ['Sat', 'Sun'] },
  { id: 'f_date', type: 'date', label: 'Birth date', required: false },
]

test('FIELD_TYPES covers all 11 types', () => {
  assert.strictEqual(FIELD_TYPES.length, 11)
  assert.ok(FIELD_TYPES.includes('header') && FIELD_TYPES.includes('description'))
  assert.strictEqual(INPUT_TYPES.length, 9)
})

test('validateSchema accepts a good schema', () => {
  assert.deepStrictEqual(validateSchema(SCHEMA), { ok: true })
})

test('validateSchema rejects non-array, bad type, dup ids, empty label, missing options', () => {
  assert.strictEqual(validateSchema({}).ok, false)
  assert.strictEqual(validateSchema([{ id: 'f_x', type: 'file', label: 'x' }]).ok, false)
  assert.strictEqual(validateSchema([SCHEMA[1], SCHEMA[1]]).ok, false)
  assert.strictEqual(validateSchema([{ id: 'f_x', type: 'short_text', label: '' }]).ok, false)
  assert.strictEqual(validateSchema([{ id: 'f_x', type: 'radio', label: 'Pick', options: [] }]).ok, false)
})

test('header block does not need a label to be non-empty options etc', () => {
  assert.strictEqual(validateSchema([{ id: 'f_h', type: 'description', label: '', help_text: 'welcome' }]).ok, true)
})

test('validateSubmission happy path cleans values', () => {
  const r = validateSubmission(SCHEMA, {
    f_name: '  Justin ', f_email: 'j@x.com', f_shirt: 'M', f_days: ['Sat'], f_count: '3',
  })
  assert.strictEqual(r.ok, true)
  assert.strictEqual(r.cleaned.f_name, 'Justin')
  assert.deepStrictEqual(r.cleaned.f_days, ['Sat'])
})

test('validateSubmission enforces required, formats, option membership, unknown ids', () => {
  const r = validateSubmission(SCHEMA, {
    f_email: 'not-an-email', f_shirt: 'XXL', f_days: ['Mon'], f_count: 'abc',
    f_date: 'yesterday', f_phone: '12', f_bogus: 'x',
  })
  assert.strictEqual(r.ok, false)
  assert.ok(r.errors.f_name)   // required missing
  assert.ok(r.errors.f_email)  // bad email
  assert.ok(r.errors.f_shirt)  // not an option
  assert.ok(r.errors.f_days)   // bad option in array
  assert.ok(r.errors.f_count)  // not a number
  assert.ok(r.errors.f_date)   // bad date
  assert.ok(r.errors.f_phone)  // too short
  assert.ok(r.errors.f_bogus)  // unknown field
})

test('display blocks are ignored by validateSubmission', () => {
  const r = validateSubmission(SCHEMA, { f_name: 'A', f_email: 'a@b.co', f_shirt: 'S' })
  assert.strictEqual(r.ok, true)
  assert.strictEqual('f_head1' in r.cleaned, false)
})

test('makeSlug: lowercase, hyphenated, 4-char suffix, distinct per call', () => {
  const s = makeSlug('Summer Bash 2026!')
  assert.match(s, /^summer-bash-2026-[a-z0-9]{4}$/)
  assert.notStrictEqual(makeSlug('Summer Bash 2026!'), s)
})
```

- [ ] **Step 2: Run to verify failure**

Run: `node --test auth/src/services/formsSchema.test.js`
Expected: FAIL, cannot find module './formsSchema'

- [ ] **Step 3: Implement**

```js
const crypto = require('crypto')

// Single-point registry: adding file-upload/signature later means adding a
// type here plus a renderer case. Do not add them now.
const DISPLAY_TYPES = ['header', 'description']
const INPUT_TYPES = ['short_text', 'long_text', 'email', 'phone', 'number', 'dropdown', 'radio', 'checkbox', 'date']
const FIELD_TYPES = [...INPUT_TYPES, ...DISPLAY_TYPES]
const OPTION_TYPES = ['dropdown', 'radio', 'checkbox']

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/

function validateSchema(schema) {
  if (!Array.isArray(schema)) return { ok: false, error: 'schema must be an array' }
  const seen = new Set()
  for (const f of schema) {
    if (!f || typeof f !== 'object') return { ok: false, error: 'field must be an object' }
    if (typeof f.id !== 'string' || !/^f_[a-z0-9]{4,12}$/i.test(f.id)) {
      return { ok: false, error: `invalid field id: ${f.id}` }
    }
    if (seen.has(f.id)) return { ok: false, error: `duplicate field id: ${f.id}` }
    seen.add(f.id)
    if (!FIELD_TYPES.includes(f.type)) return { ok: false, error: `invalid field type: ${f.type}` }
    const isDisplay = DISPLAY_TYPES.includes(f.type)
    if (!isDisplay && (typeof f.label !== 'string' || !f.label.trim())) {
      return { ok: false, error: `field ${f.id} needs a label` }
    }
    if (OPTION_TYPES.includes(f.type)) {
      const opts = f.options
      if (!Array.isArray(opts) || opts.length === 0 || opts.some(o => typeof o !== 'string' || !o.trim())) {
        return { ok: false, error: `field ${f.id} needs at least one option` }
      }
    }
  }
  return { ok: true }
}

function isBlank(v) {
  return v == null || (typeof v === 'string' && !v.trim()) || (Array.isArray(v) && v.length === 0)
}

function validateSubmission(schema, data) {
  const errors = {}
  const cleaned = {}
  const body = data && typeof data === 'object' ? data : {}
  const inputs = (schema || []).filter(f => INPUT_TYPES.includes(f.type))
  const known = new Set(inputs.map(f => f.id))

  for (const key of Object.keys(body)) {
    if (!known.has(key)) errors[key] = 'Unknown field'
  }

  for (const f of inputs) {
    const raw = body[f.id]
    if (isBlank(raw)) {
      if (f.required) errors[f.id] = 'This field is required'
      continue
    }
    if (f.type === 'checkbox') {
      const arr = Array.isArray(raw) ? raw.map(String) : [String(raw)]
      if (arr.some(v => !f.options.includes(v))) { errors[f.id] = 'Invalid selection'; continue }
      cleaned[f.id] = arr
      continue
    }
    const v = String(raw).trim()
    if (v.length > 5000) { errors[f.id] = 'Too long'; continue }
    switch (f.type) {
      case 'email':
        if (!EMAIL_RE.test(v)) { errors[f.id] = 'Enter a valid email address'; continue }
        break
      case 'phone': {
        const digits = v.replace(/\D/g, '')
        if (digits.length < 7 || digits.length > 15) { errors[f.id] = 'Enter a valid phone number'; continue }
        break
      }
      case 'number':
        if (!Number.isFinite(Number(v))) { errors[f.id] = 'Enter a number'; continue }
        break
      case 'date':
        if (!/^\d{4}-\d{2}-\d{2}$/.test(v) || Number.isNaN(Date.parse(v))) { errors[f.id] = 'Enter a valid date'; continue }
        break
      case 'dropdown':
      case 'radio':
        if (!f.options.includes(v)) { errors[f.id] = 'Invalid selection'; continue }
        break
    }
    cleaned[f.id] = v
  }
  return { ok: Object.keys(errors).length === 0, errors, cleaned }
}

function makeSlug(title) {
  const base = String(title || 'form').toLowerCase()
    .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60) || 'form'
  const suffix = crypto.randomBytes(3).readUIntBE(0, 3).toString(36).padStart(4, '0').slice(-4)
  return `${base}-${suffix}`
}

module.exports = { FIELD_TYPES, INPUT_TYPES, OPTION_TYPES, DISPLAY_TYPES, validateSchema, validateSubmission, makeSlug }
```

- [ ] **Step 4: Run tests**

Run: `node --test auth/src/services/formsSchema.test.js`
Expected: all PASS

- [ ] **Step 5: Commit**

```bash
git add auth/src/services/formsSchema.js auth/src/services/formsSchema.test.js
git commit -m "feat(forms): field schema + submission validation service"
```

---

### Task 3: Permission service

**Files:**
- Create: `auth/src/services/formsPermissions.js`
- Test: `auth/src/services/formsPermissions.test.js`

**Interfaces:**
- Consumes: `roleLevel`, `ROLE_HIERARCHY` from `../middleware/role`; `getEffectivePermissions` from `./permissions` (lazy-required, same style as `requireReportAccess` in `auth/src/middleware/role.js:179`).
- Produces:
  - `canAccessForm(staff, form, shares) -> { view: boolean, edit: boolean }` — staff is the `req.staff` shape (`id`, `role`, `location_ids: uuid[]`); form is a `forms` row; shares is this form's `form_shares` rows.
  - `requireFormsBuilder(req, res, next)` — async Express middleware: passes manager+ tier OR effective `forms` permission; 403 otherwise. Mounted AFTER `authenticate`.

- [ ] **Step 1: Write the failing tests**

```js
const test = require('node:test')
const assert = require('node:assert')
const { canAccessForm } = require('./formsPermissions')

const FORM = {
  id: 'F1', owner_id: 'OWNER', location_id: 'LOC-A',
  visibility: 'private', location_can_edit: false,
}
const staff = (over = {}) => ({ id: 'ME', role: 'manager', location_ids: ['LOC-A'], ...over })

test('corporate and admin short-circuit to full access on any form', () => {
  for (const role of ['corporate', 'director', 'admin']) {
    const r = canAccessForm(staff({ role, location_ids: [] }), { ...FORM, visibility: 'private' }, [])
    assert.deepStrictEqual(r, { view: true, edit: true }, role)
  }
})

test('owner gets full access regardless of visibility', () => {
  const r = canAccessForm(staff({ id: 'OWNER' }), FORM, [])
  assert.deepStrictEqual(r, { view: true, edit: true })
})

test('private form: same-location peer gets nothing', () => {
  assert.deepStrictEqual(canAccessForm(staff(), FORM, []), { view: false, edit: false })
})

test('location visibility: peer views, edit follows location_can_edit', () => {
  const loc = { ...FORM, visibility: 'location' }
  assert.deepStrictEqual(canAccessForm(staff(), loc, []), { view: true, edit: false })
  assert.deepStrictEqual(canAccessForm(staff(), { ...loc, location_can_edit: true }, []), { view: true, edit: true })
})

test('location visibility: staff at another location gets nothing', () => {
  const loc = { ...FORM, visibility: 'location', location_can_edit: true }
  assert.deepStrictEqual(canAccessForm(staff({ location_ids: ['LOC-B'] }), loc, []), { view: false, edit: false })
})

test('multi-location staff match any assigned location', () => {
  const loc = { ...FORM, visibility: 'location' }
  assert.strictEqual(canAccessForm(staff({ location_ids: ['LOC-B', 'LOC-A'] }), loc, []).view, true)
})

test('explicit share: viewer views, editor edits, non-share gets nothing', () => {
  const shared = { ...FORM, visibility: 'shared' }
  const shares = [{ staff_id: 'ME', permission: 'viewer' }]
  assert.deepStrictEqual(canAccessForm(staff(), shared, shares), { view: true, edit: false })
  shares[0].permission = 'editor'
  assert.deepStrictEqual(canAccessForm(staff(), shared, shares), { view: true, edit: true })
  assert.deepStrictEqual(canAccessForm(staff({ id: 'OTHER' }), shared, shares), { view: false, edit: false })
})

test('share row is honored even when visibility is location (spec order, branch 4)', () => {
  const loc = { ...FORM, visibility: 'location' }
  const r = canAccessForm(staff({ location_ids: ['LOC-B'] }), loc, [{ staff_id: 'ME', permission: 'editor' }])
  assert.deepStrictEqual(r, { view: true, edit: true })
})

test('lead below manager tier still resolves via location/share branches only', () => {
  assert.deepStrictEqual(canAccessForm(staff({ role: 'lead' }), { ...FORM, visibility: 'location' }, []), { view: true, edit: false })
})

test('missing staff or form is no access', () => {
  assert.deepStrictEqual(canAccessForm(null, FORM, []), { view: false, edit: false })
  assert.deepStrictEqual(canAccessForm(staff(), null, []), { view: false, edit: false })
})
```

- [ ] **Step 2: Run to verify failure**

Run: `node --test auth/src/services/formsPermissions.test.js`
Expected: FAIL, cannot find module

- [ ] **Step 3: Implement**

```js
const { roleLevel, ROLE_HIERARCHY } = require('../middleware/role')

const CORPORATE_LEVEL = ROLE_HIERARCHY.indexOf('corporate')
const MANAGER_LEVEL = ROLE_HIERARCHY.indexOf('manager')

// Single access function for the builder/management side, evaluated in spec
// order (docs/superpowers/specs/2026-07-08-form-builder-design.md). The public
// renderer never calls this; published forms are world-readable by slug.
function canAccessForm(staff, form, shares = []) {
  const none = { view: false, edit: false }
  if (!staff || !form) return none
  // 1. corporate (director alias) and admin see and edit everything.
  if (roleLevel(staff.role) >= CORPORATE_LEVEL) return { view: true, edit: true }
  // 2. owner.
  if (staff.id === form.owner_id) return { view: true, edit: true }
  // 3. location visibility.
  if (form.visibility === 'location' && (staff.location_ids || []).includes(form.location_id)) {
    return { view: true, edit: !!form.location_can_edit }
  }
  // 4. explicit share.
  const share = (shares || []).find(s => s.staff_id === staff.id)
  if (share) return { view: true, edit: share.permission === 'editor' }
  return none
}

// Builder gate: who may create forms and open the builder at all. Manager tier
// and up, or an effective 'forms' permission (RBAC v2 role toggle / override).
// Mirrors the requireReportAccess pattern in middleware/role.js.
async function requireFormsBuilder(req, res, next) {
  if (!req.staff) return res.status(401).json({ error: 'Authentication required' })
  if (roleLevel(req.staff.role) >= MANAGER_LEVEL) return next()
  try {
    const { getEffectivePermissions } = require('./permissions')
    const perms = await getEffectivePermissions(req.staff)
    if (perms.includes('forms')) return next()
  } catch (err) {
    console.error('[forms] effective-perm check failed:', err.message)
  }
  return res.status(403).json({ error: 'Forms access requires manager or a forms grant' })
}

module.exports = { canAccessForm, requireFormsBuilder }
```

- [ ] **Step 4: Run tests**

Run: `node --test auth/src/services/formsPermissions.test.js`
Expected: all PASS (note: `director` resolves via ROLE_ALIASES to corporate; no DB needed)

- [ ] **Step 5: Commit**

```bash
git add auth/src/services/formsPermissions.js auth/src/services/formsPermissions.test.js
git commit -m "feat(forms): canAccessForm permission function + builder gate"
```

---

### Task 4: Sheets service

**Files:**
- Create: `auth/src/services/formsSheets.js`
- Test: `auth/src/services/formsSheets.test.js` (pure mapping functions only)

**Interfaces:**
- Consumes: `getAccessToken` from `../routes/googleBusiness` (module.exports.getAccessToken, line 347); `supabaseAdmin` from `./supabase`; `INPUT_TYPES` from `./formsSchema`; app_config key `forms_drive_folder_id`.
- Produces:
  - `computeColumns(schema, existing) -> { [fieldId]: number }` — 1-based column indexes. Column 1 is always `Submitted At`; input fields start at column 2 in schema order on first computation; on later calls existing mappings are NEVER changed, new fields get max+1, max+2, ...
  - `buildHeaderRow(schema, columns) -> string[]` — dense array sized to max column; `Submitted At` first; removed fields keep their old header slot as '' only when unknown (callers only use this on first publish or to write single new header cells).
  - `buildRowValues(columns, cleaned, submittedAtPacific) -> (string|number)[]` — dense row; checkbox arrays joined with ', '.
  - `pacificTimestamp(date) -> string` like `07/08/2026 14:05:33`.
  - `async ensureSheet(form) -> { sheet_id, sheet_tab, sheet_columns }` — first publish: create spreadsheet + move to folder + header row; republish: sync new columns. Persists the three fields on the forms row and returns them.
  - `async appendSubmission(form, submissionRow)` — appends to the sheet, flips `synced_to_sheet`, records `sync_error` on failure. Throws on failure after recording.
  - `start()` — 10-minute `setInterval(...).unref()` retry sweep, guarded by `FORMS_SHEETS_DISABLED !== '1'`.
  - `async retryFormSync(formId) -> { retried, failed }` — used by the manual retry route and the sweep.

- [ ] **Step 1: Write the failing tests for the pure functions**

```js
const test = require('node:test')
const assert = require('node:assert')
const { computeColumns, buildHeaderRow, buildRowValues, pacificTimestamp } = require('./formsSheets')

const SCHEMA = [
  { id: 'f_h', type: 'header', label: 'Welcome' },
  { id: 'f_name', type: 'short_text', label: 'Name' },
  { id: 'f_days', type: 'checkbox', label: 'Days', options: ['Sat', 'Sun'] },
]

test('computeColumns: first pass assigns 2..N in schema order, skips display blocks', () => {
  const cols = computeColumns(SCHEMA, {})
  assert.deepStrictEqual(cols, { f_name: 2, f_days: 3 })
})

test('computeColumns: existing mappings never move; new fields append after max', () => {
  const existing = { f_name: 2, f_days: 3 }
  const grown = [...SCHEMA, { id: 'f_email', type: 'email', label: 'Email' }]
  assert.deepStrictEqual(computeColumns(grown, existing), { f_name: 2, f_days: 3, f_email: 4 })
  // removed field keeps its column reserved
  const shrunk = [SCHEMA[0], SCHEMA[2], { id: 'f_new', type: 'date', label: 'Date' }]
  assert.deepStrictEqual(computeColumns(shrunk, existing), { f_name: 2, f_days: 3, f_new: 4 })
})

test('buildHeaderRow: Submitted At first, labels at their columns', () => {
  const cols = { f_name: 2, f_days: 3 }
  assert.deepStrictEqual(buildHeaderRow(SCHEMA, cols), ['Submitted At', 'Name', 'Days'])
})

test('buildRowValues: dense row, checkbox joined, blanks for missing', () => {
  const cols = { f_name: 2, f_days: 3, f_gone: 4 }
  const row = buildRowValues(cols, { f_name: 'Justin', f_days: ['Sat', 'Sun'] }, '07/08/2026 09:00:00')
  assert.deepStrictEqual(row, ['07/08/2026 09:00:00', 'Justin', 'Sat, Sun', ''])
})

test('pacificTimestamp formats a fixed instant in America/Los_Angeles', () => {
  const s = pacificTimestamp(new Date('2026-07-08T20:05:33Z'))
  assert.match(s, /^07\/08\/2026 13:05:33$/)
})
```

- [ ] **Step 2: Run to verify failure**

Run: `node --test auth/src/services/formsSheets.test.js`
Expected: FAIL, cannot find module

- [ ] **Step 3: Implement**

Follow the fetch/error style of `auth/src/services/googleSheets.js` (its `googleJson` helper is a good local copy target; do not import it, copy the small helper so this service stands alone). Complete implementation:

```js
const { supabaseAdmin } = require('./supabase')
const { INPUT_TYPES } = require('./formsSchema')

const SHEETS_BASE = 'https://sheets.googleapis.com/v4/spreadsheets'
const DRIVE_BASE = 'https://www.googleapis.com/drive/v3/files'
const TAB = 'Submissions'

async function googleJson(url, accessToken, init = {}) {
  const res = await fetch(url, {
    ...init,
    headers: { Authorization: 'Bearer ' + accessToken, 'Content-Type': 'application/json', ...(init.headers || {}) },
  })
  const text = await res.text()
  let body
  try { body = text ? JSON.parse(text) : {} } catch { body = { _raw: text } }
  if (!res.ok) throw new Error(`Google API ${res.status}: ${body.error?.message || body._raw || res.status}`)
  return body
}

function inputFields(schema) {
  return (schema || []).filter(f => INPUT_TYPES.includes(f.type))
}

// Column 1 is always Submitted At. Existing field->column mappings are never
// changed or reused; new fields append after the current max. This is what
// keeps historical Sheet rows aligned when the form changes.
function computeColumns(schema, existing = {}) {
  const cols = { ...existing }
  let max = Math.max(1, ...Object.values(cols))
  for (const f of inputFields(schema)) {
    if (!cols[f.id]) { max += 1; cols[f.id] = max }
  }
  return cols
}

function buildHeaderRow(schema, columns) {
  const labels = {}
  for (const f of inputFields(schema)) labels[f.id] = f.label
  const max = Math.max(1, ...Object.values(columns))
  const row = new Array(max).fill('')
  row[0] = 'Submitted At'
  for (const [fieldId, col] of Object.entries(columns)) {
    row[col - 1] = labels[fieldId] || row[col - 1] || ''
  }
  return row
}

function buildRowValues(columns, cleaned, submittedAtPacific) {
  const max = Math.max(1, ...Object.values(columns))
  const row = new Array(max).fill('')
  row[0] = submittedAtPacific
  for (const [fieldId, col] of Object.entries(columns)) {
    const v = cleaned[fieldId]
    if (v == null) continue
    row[col - 1] = Array.isArray(v) ? v.join(', ') : v
  }
  return row
}

function pacificTimestamp(date = new Date()) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/Los_Angeles', hour12: false,
    month: '2-digit', day: '2-digit', year: 'numeric',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
  }).formatToParts(date).reduce((m, p) => (m[p.type] = p.value, m), {})
  return `${parts.month}/${parts.day}/${parts.year} ${parts.hour}:${parts.minute}:${parts.second}`
}

async function getFolderId() {
  const { data } = await supabaseAdmin.from('app_config').select('value').eq('key', 'forms_drive_folder_id').maybeSingle()
  return data?.value || null
}

async function getToken() {
  // Lazy require: routes/googleBusiness exports getAccessToken (Business
  // account OAuth, refresh token in app_config.google_business_tokens).
  const { getAccessToken } = require('../routes/googleBusiness')
  return getAccessToken()
}

function colLetter(n) {
  let s = ''
  while (n > 0) { s = String.fromCharCode(65 + ((n - 1) % 26)) + s; n = Math.floor((n - 1) / 26) }
  return s
}

// First publish: create the spreadsheet, move it into the configured shared
// drive folder (supportsAllDrives is REQUIRED for shared drives), write the
// header row. Republish after schema changes: append headers for new columns
// only. Persists sheet_id / sheet_tab / sheet_columns on the form row.
async function ensureSheet(form) {
  const token = await getToken()
  let { sheet_id, sheet_tab } = form
  const columns = computeColumns(form.schema, form.sheet_columns || {})

  if (!sheet_id) {
    const create = await googleJson(SHEETS_BASE, token, {
      method: 'POST',
      body: JSON.stringify({
        properties: { title: form.title },
        sheets: [{ properties: { sheetId: 0, title: TAB, gridProperties: { frozenRowCount: 1 } } }],
      }),
    })
    sheet_id = create.spreadsheetId
    sheet_tab = TAB
    const folderId = await getFolderId()
    if (folderId) {
      const meta = await googleJson(`${DRIVE_BASE}/${sheet_id}?fields=parents&supportsAllDrives=true`, token)
      const params = new URLSearchParams({ addParents: folderId, supportsAllDrives: 'true' })
      const removeParents = (meta.parents || []).join(',')
      if (removeParents) params.set('removeParents', removeParents)
      await googleJson(`${DRIVE_BASE}/${sheet_id}?${params}`, token, { method: 'PATCH', body: JSON.stringify({}) })
    }
    const header = buildHeaderRow(form.schema, columns)
    await googleJson(
      `${SHEETS_BASE}/${sheet_id}/values/${encodeURIComponent(`${sheet_tab}!A1:${colLetter(header.length)}1`)}?valueInputOption=RAW`,
      token,
      { method: 'PUT', body: JSON.stringify({ values: [header] }) }
    )
  } else {
    // Write headers for any newly appended columns (label edits also land here).
    const header = buildHeaderRow(form.schema, columns)
    const prevMax = Math.max(1, ...Object.values(form.sheet_columns || {}))
    const newMax = header.length
    if (newMax >= prevMax) {
      await googleJson(
        `${SHEETS_BASE}/${sheet_id}/values/${encodeURIComponent(`${sheet_tab}!A1:${colLetter(newMax)}1`)}?valueInputOption=RAW`,
        token,
        { method: 'PUT', body: JSON.stringify({ values: [header] }) }
      )
    }
  }

  const { error } = await supabaseAdmin.from('forms')
    .update({ sheet_id, sheet_tab, sheet_columns: columns })
    .eq('id', form.id)
  if (error) throw error
  return { sheet_id, sheet_tab, sheet_columns: columns }
}

async function appendSubmission(form, submission) {
  try {
    const token = await getToken()
    const row = buildRowValues(form.sheet_columns, submission.data, pacificTimestamp(new Date(submission.submitted_at)))
    await googleJson(
      `${SHEETS_BASE}/${form.sheet_id}/values/${encodeURIComponent(`${form.sheet_tab}!A1`)}:append?valueInputOption=USER_ENTERED&insertDataOption=INSERT_ROWS`,
      token,
      { method: 'POST', body: JSON.stringify({ values: [row] }) }
    )
    await supabaseAdmin.from('form_submissions')
      .update({ synced_to_sheet: true, sync_error: null }).eq('id', submission.id)
  } catch (err) {
    await supabaseAdmin.from('form_submissions')
      .update({ sync_error: String(err.message).slice(0, 500) }).eq('id', submission.id)
    throw err
  }
}

// Re-append every unsynced submission for one form, oldest first.
async function retryFormSync(formId) {
  const { data: form } = await supabaseAdmin.from('forms').select('*').eq('id', formId).single()
  if (!form || !form.sheet_id) return { retried: 0, failed: 0 }
  const { data: rows } = await supabaseAdmin.from('form_submissions')
    .select('*').eq('form_id', formId).eq('synced_to_sheet', false)
    .order('submitted_at', { ascending: true }).limit(200)
  let retried = 0, failed = 0
  for (const sub of rows || []) {
    try { await appendSubmission(form, sub); retried++ } catch { failed++; break }
  }
  return { retried, failed }
}

// Background sweep: every 10 minutes retry all forms with unsynced rows.
function start() {
  if (process.env.FORMS_SHEETS_DISABLED === '1') return
  const sweep = async () => {
    try {
      const { data } = await supabaseAdmin.from('form_submissions')
        .select('form_id').eq('synced_to_sheet', false).limit(500)
      const formIds = [...new Set((data || []).map(r => r.form_id))]
      for (const id of formIds) {
        const { retried, failed } = await retryFormSync(id)
        if (retried || failed) {
          console.log(`[formsSheets] retry form ${id}: ${retried} synced, ${failed} failed`)
          const formsAudit = require('./formsAudit')
          formsAudit.record(id, null, 'sheet_retry', { retried, failed })
        }
      }
    } catch (err) {
      console.error('[formsSheets] sweep failed:', err.message)
    }
  }
  setInterval(sweep, 10 * 60 * 1000).unref()
}

module.exports = {
  computeColumns, buildHeaderRow, buildRowValues, pacificTimestamp,
  ensureSheet, appendSubmission, retryFormSync, start,
}
```

- [ ] **Step 4: Run tests**

Run: `node --test auth/src/services/formsSheets.test.js`
Expected: all PASS (pure functions only; nothing network-touching runs at import because supabase is only used inside functions. If `require('./supabase')` throws without env at import time, move it to lazy `require` inside each function that needs it, matching the lazy pattern in `middleware/role.js:41`).

- [ ] **Step 5: Create the audit helper**

Create `auth/src/services/formsAudit.js`:

```js
const { supabaseAdmin } = require('./supabase')

// Fire-and-forget, mirrors services/auditLog.js. Never await on user paths,
// never throw. form_audit_log is append-only (enforced by trigger).
async function record(formId, actorId, action, detail = null) {
  try {
    const { error } = await supabaseAdmin.from('form_audit_log').insert({
      form_id: formId, actor_id: actorId || null, action, detail,
    })
    if (error) console.error('[formsAudit] insert failed:', error.message)
  } catch (err) {
    console.error('[formsAudit] record threw:', err.message)
  }
}

module.exports = { record }
```

- [ ] **Step 6: Commit**

```bash
git add auth/src/services/formsSheets.js auth/src/services/formsSheets.test.js auth/src/services/formsAudit.js
git commit -m "feat(forms): Google Sheets service (business token, shared drive, append + retry) and audit writer"
```

---

### Task 5: Authed forms router

**Files:**
- Create: `auth/src/routes/forms.js`
- Modify: `auth/src/index.js` (mount + start sweep + CORS origin)

**Interfaces:**
- Consumes: `authenticate` middleware; `requireFormsBuilder`, `canAccessForm`; `validateSchema`, `makeSlug`; `ensureSheet`, `retryFormSync`; `formsAudit.record`; `supabaseAdmin`.
- Produces the API the portal consumes (Task 7): routes below, all JSON. Every form object returned to the client carries `access: { view, edit }` for the caller plus `owner_name`, `location_name`, `submission_count` on list rows.

Routes (all after `router.use(authenticate)`):
- `GET /forms` (no builder gate: viewers with shares may not be managers) — list visible forms.
- `GET /forms/staff-directory` (builder gate) — `[{ id, display_name, role }]` for the share picker. DECLARE BEFORE `/:id`.
- `GET /forms/audit/all?staff_id=&form_id=` — corporate/admin only (`requireRole('corporate')`), latest 500. DECLARE BEFORE `/:id`.
- `POST /forms` (builder gate) — create.
- `GET /forms/:id` — view access; includes `shares` (with staff display names) when caller has edit.
- `PATCH /forms/:id` — edit access + last-write check on `known_updated_at`.
- `POST /forms/:id/publish`, `POST /forms/:id/archive` — edit access.
- `DELETE /forms/:id` — owner or corporate/admin; drafts with zero submissions only, else 409.
- `POST /forms/:id/shares`, `DELETE /forms/:id/shares/:staffId` — edit access.
- `GET /forms/:id/audit` — view access.
- `GET /forms/:id/submissions?limit=&offset=` — view access.
- `POST /forms/:id/retry-sync` — edit access.

- [ ] **Step 1: Implement the router**

```js
const { Router } = require('express')
const { supabaseAdmin } = require('../services/supabase')
const authenticate = require('../middleware/auth')
const { requireRole, roleLevel, ROLE_HIERARCHY } = require('../middleware/role')
const { canAccessForm, requireFormsBuilder } = require('../services/formsPermissions')
const { validateSchema, makeSlug } = require('../services/formsSchema')
const formsSheets = require('../services/formsSheets')
const formsAudit = require('../services/formsAudit')

const router = Router()
router.use(authenticate)

const CORPORATE_LEVEL = ROLE_HIERARCHY.indexOf('corporate')
const isCorporate = (staff) => roleLevel(staff.role) >= CORPORATE_LEVEL

// Load a form + its shares and resolve the caller's access in one place.
async function loadFormAccess(req, formId) {
  const { data: form, error } = await supabaseAdmin.from('forms').select('*').eq('id', formId).maybeSingle()
  if (error) throw error
  if (!form) return { form: null, shares: [], access: { view: false, edit: false } }
  const { data: shares } = await supabaseAdmin.from('form_shares').select('*').eq('form_id', formId)
  return { form, shares: shares || [], access: canAccessForm(req.staff, form, shares || []) }
}

// GET /forms — every form the caller can see.
router.get('/', async (req, res) => {
  try {
    const { data: forms, error } = await supabaseAdmin.from('forms')
      .select('*').neq('status', 'deleted').order('updated_at', { ascending: false })
    if (error) throw error
    const all = forms || []
    let visible
    if (isCorporate(req.staff)) {
      visible = all.map(f => ({ f, access: { view: true, edit: true } }))
    } else {
      const ids = all.map(f => f.id)
      const { data: shareRows } = ids.length
        ? await supabaseAdmin.from('form_shares').select('*').eq('staff_id', req.staff.id).in('form_id', ids)
        : { data: [] }
      const sharesByForm = {}
      for (const s of shareRows || []) (sharesByForm[s.form_id] ||= []).push(s)
      visible = all
        .map(f => ({ f, access: canAccessForm(req.staff, f, sharesByForm[f.id] || []) }))
        .filter(x => x.access.view)
    }
    const visibleIds = visible.map(x => x.f.id)
    // Owner names, location names, submission counts in three cheap queries.
    const ownerIds = [...new Set(visible.map(x => x.f.owner_id))]
    const locIds = [...new Set(visible.map(x => x.f.location_id))]
    const [{ data: owners }, { data: locs }] = await Promise.all([
      ownerIds.length ? supabaseAdmin.from('staff').select('id, display_name').in('id', ownerIds) : { data: [] },
      locIds.length ? supabaseAdmin.from('locations').select('id, name').in('id', locIds) : { data: [] },
    ])
    const counts = {}
    if (visibleIds.length) {
      const { data: subs } = await supabaseAdmin.from('form_submissions').select('form_id').in('form_id', visibleIds)
      for (const s of subs || []) counts[s.form_id] = (counts[s.form_id] || 0) + 1
    }
    const ownerName = Object.fromEntries((owners || []).map(o => [o.id, o.display_name]))
    const locName = Object.fromEntries((locs || []).map(l => [l.id, l.name]))
    res.json({
      forms: visible.map(({ f, access }) => ({
        ...f, access,
        owner_name: ownerName[f.owner_id] || '',
        location_name: locName[f.location_id] || '',
        submission_count: counts[f.id] || 0,
      })),
    })
  } catch (err) {
    console.error('[forms] list failed:', err.message)
    res.status(500).json({ error: 'Failed to load forms' })
  }
})

// GET /forms/staff-directory — share picker. Must be declared before /:id.
router.get('/staff-directory', requireFormsBuilder, async (req, res) => {
  try {
    const { data, error } = await supabaseAdmin.from('staff')
      .select('id, display_name, role').order('display_name')
    if (error) throw error
    res.json({ staff: (data || []).filter(s => s.id !== req.staff.id) })
  } catch (err) {
    res.status(500).json({ error: 'Failed to load staff' })
  }
})

// GET /forms/audit/all — cross-form audit for corporate/admin. Before /:id.
router.get('/audit/all', requireRole('corporate'), async (req, res) => {
  try {
    let q = supabaseAdmin.from('form_audit_log').select('*').order('created_at', { ascending: false }).limit(500)
    if (req.query.staff_id) q = q.eq('actor_id', req.query.staff_id)
    if (req.query.form_id) q = q.eq('form_id', req.query.form_id)
    const { data, error } = await q
    if (error) throw error
    res.json({ events: data || [] })
  } catch (err) {
    res.status(500).json({ error: 'Failed to load audit log' })
  }
})

// POST /forms — create.
router.post('/', requireFormsBuilder, async (req, res) => {
  try {
    const { title, description, location_id } = req.body || {}
    if (!title || !String(title).trim()) return res.status(400).json({ error: 'Title is required' })
    let loc = location_id
    const myLocs = req.staff.location_ids || []
    if (!isCorporate(req.staff)) {
      if (!loc) loc = req.staff.primary_location_id || myLocs[0]
      if (!loc || !myLocs.includes(loc)) return res.status(403).json({ error: 'You can only create forms for your own location' })
    } else if (!loc) {
      loc = req.staff.primary_location_id || myLocs[0]
      if (!loc) return res.status(400).json({ error: 'location_id is required' })
    }
    const row = {
      slug: makeSlug(title), title: String(title).trim(),
      description: description || null, owner_id: req.staff.id, location_id: loc,
    }
    const { data, error } = await supabaseAdmin.from('forms').insert(row).select('*').single()
    if (error) throw error
    formsAudit.record(data.id, req.staff.id, 'created', { title: data.title, location_id: loc })
    res.json({ form: { ...data, access: { view: true, edit: true } } })
  } catch (err) {
    console.error('[forms] create failed:', err.message)
    res.status(500).json({ error: 'Failed to create form' })
  }
})

// GET /forms/:id — for the builder.
router.get('/:id', async (req, res) => {
  try {
    const { form, shares, access } = await loadFormAccess(req, req.params.id)
    if (!form || !access.view) return res.status(form ? 403 : 404).json({ error: form ? 'No access' : 'Not found' })
    let shareList
    if (access.edit) {
      const ids = shares.map(s => s.staff_id)
      const { data: staffRows } = ids.length
        ? await supabaseAdmin.from('staff').select('id, display_name').in('id', ids) : { data: [] }
      const names = Object.fromEntries((staffRows || []).map(s => [s.id, s.display_name]))
      shareList = shares.map(s => ({ ...s, display_name: names[s.staff_id] || '' }))
    }
    res.json({ form: { ...form, access }, shares: shareList })
  } catch (err) {
    res.status(500).json({ error: 'Failed to load form' })
  }
})

// PATCH /forms/:id — save with last-write protection.
router.patch('/:id', async (req, res) => {
  try {
    const { form, access } = await loadFormAccess(req, req.params.id)
    if (!form || !access.edit) return res.status(form ? 403 : 404).json({ error: form ? 'No access' : 'Not found' })
    const { known_updated_at, title, description, schema, visibility, location_can_edit } = req.body || {}
    if (!known_updated_at) return res.status(400).json({ error: 'known_updated_at is required' })
    if (new Date(form.updated_at).getTime() > new Date(known_updated_at).getTime()) {
      return res.status(409).json({
        error: 'This form changed since you opened it. Reload to get the latest version.',
        server_updated_at: form.updated_at,
      })
    }
    const patch = { updated_at: new Date().toISOString() }
    const detail = {}
    if (title !== undefined) {
      if (!String(title).trim()) return res.status(400).json({ error: 'Title is required' })
      patch.title = String(title).trim(); detail.title = patch.title
    }
    if (description !== undefined) { patch.description = description || null; detail.description = true }
    if (schema !== undefined) {
      const v = validateSchema(schema)
      if (!v.ok) return res.status(400).json({ error: v.error })
      patch.schema = schema; detail.field_count = schema.length
    }
    if (visibility !== undefined) {
      if (!['private', 'location', 'shared'].includes(visibility)) return res.status(400).json({ error: 'Invalid visibility' })
      patch.visibility = visibility
    }
    if (location_can_edit !== undefined) patch.location_can_edit = !!location_can_edit
    const { data, error } = await supabaseAdmin.from('forms').update(patch).eq('id', form.id).select('*').single()
    if (error) throw error
    // Published forms with a sheet get new columns appended right away.
    if (patch.schema && data.sheet_id) {
      try { await formsSheets.ensureSheet(data) } catch (e) { console.error('[forms] column sync failed:', e.message) }
    }
    if (patch.visibility !== undefined || patch.location_can_edit !== undefined) {
      formsAudit.record(form.id, req.staff.id, 'visibility_changed', {
        visibility: data.visibility, location_can_edit: data.location_can_edit,
      })
    }
    if (patch.title || patch.schema || detail.description) {
      formsAudit.record(form.id, req.staff.id, 'edited', detail)
    }
    const fresh = await loadFormAccess(req, form.id)
    res.json({ form: { ...fresh.form, access: fresh.access } })
  } catch (err) {
    console.error('[forms] update failed:', err.message)
    res.status(500).json({ error: 'Failed to save form' })
  }
})

// POST /forms/:id/publish — creates/syncs the Google Sheet.
router.post('/:id/publish', async (req, res) => {
  try {
    const { form, access } = await loadFormAccess(req, req.params.id)
    if (!form || !access.edit) return res.status(form ? 403 : 404).json({ error: form ? 'No access' : 'Not found' })
    const inputCount = (form.schema || []).filter(f => !['header', 'description'].includes(f.type)).length
    if (inputCount === 0) return res.status(400).json({ error: 'Add at least one input field before publishing' })
    let sheet = { sheet_id: form.sheet_id, sheet_tab: form.sheet_tab, sheet_columns: form.sheet_columns }
    let sheetError = null
    try {
      sheet = await formsSheets.ensureSheet(form)
    } catch (err) {
      // Publish anyway; submissions are backed up in Supabase and the retry
      // sweep will fail loudly. Surface the warning to the UI.
      sheetError = err.message
      console.error('[forms] sheet create failed on publish:', err.message)
    }
    const { data, error } = await supabaseAdmin.from('forms')
      .update({ status: 'published', updated_at: new Date().toISOString() })
      .eq('id', form.id).select('*').single()
    if (error) throw error
    formsAudit.record(form.id, req.staff.id, 'published', { sheet_id: sheet.sheet_id || null, sheet_error: sheetError })
    res.json({ form: { ...data, access }, sheet_error: sheetError })
  } catch (err) {
    console.error('[forms] publish failed:', err.message)
    res.status(500).json({ error: 'Failed to publish form' })
  }
})

// POST /forms/:id/archive
router.post('/:id/archive', async (req, res) => {
  try {
    const { form, access } = await loadFormAccess(req, req.params.id)
    if (!form || !access.edit) return res.status(form ? 403 : 404).json({ error: form ? 'No access' : 'Not found' })
    const { data, error } = await supabaseAdmin.from('forms')
      .update({ status: 'archived', updated_at: new Date().toISOString() })
      .eq('id', form.id).select('*').single()
    if (error) throw error
    formsAudit.record(form.id, req.staff.id, 'archived', null)
    res.json({ form: { ...data, access } })
  } catch (err) {
    res.status(500).json({ error: 'Failed to archive form' })
  }
})

// DELETE /forms/:id — drafts with zero submissions only.
router.delete('/:id', async (req, res) => {
  try {
    const { form, access } = await loadFormAccess(req, req.params.id)
    if (!form) return res.status(404).json({ error: 'Not found' })
    const mayDelete = access.edit && (form.owner_id === req.staff.id || isCorporate(req.staff))
    if (!mayDelete) return res.status(403).json({ error: 'Only the owner or a director can delete a form' })
    const { count } = await supabaseAdmin.from('form_submissions')
      .select('id', { count: 'exact', head: true }).eq('form_id', form.id)
    if (form.status !== 'draft' || (count || 0) > 0) {
      return res.status(409).json({ error: 'Forms with submissions cannot be deleted. Archive it instead.' })
    }
    formsAudit.record(form.id, req.staff.id, 'deleted', { title: form.title })
    await supabaseAdmin.from('form_shares').delete().eq('form_id', form.id)
    const { error } = await supabaseAdmin.from('forms').delete().eq('id', form.id)
    if (error) throw error
    res.json({ ok: true })
  } catch (err) {
    res.status(500).json({ error: 'Failed to delete form' })
  }
})

// POST /forms/:id/shares — upsert one person's access.
router.post('/:id/shares', async (req, res) => {
  try {
    const { form, shares, access } = await loadFormAccess(req, req.params.id)
    if (!form || !access.edit) return res.status(form ? 403 : 404).json({ error: form ? 'No access' : 'Not found' })
    const { staff_id, permission } = req.body || {}
    if (!staff_id || !['viewer', 'editor'].includes(permission)) {
      return res.status(400).json({ error: 'staff_id and permission (viewer or editor) required' })
    }
    const existing = shares.find(s => s.staff_id === staff_id)
    const { error } = await supabaseAdmin.from('form_shares').upsert(
      { form_id: form.id, staff_id, permission, granted_by: req.staff.id },
      { onConflict: 'form_id,staff_id' }
    )
    if (error) throw error
    formsAudit.record(form.id, req.staff.id, existing ? 'permission_changed' : 'shared', { staff_id, permission })
    res.json({ ok: true })
  } catch (err) {
    res.status(500).json({ error: 'Failed to share form' })
  }
})

// DELETE /forms/:id/shares/:staffId
router.delete('/:id/shares/:staffId', async (req, res) => {
  try {
    const { form, access } = await loadFormAccess(req, req.params.id)
    if (!form || !access.edit) return res.status(form ? 403 : 404).json({ error: form ? 'No access' : 'Not found' })
    const { error } = await supabaseAdmin.from('form_shares')
      .delete().eq('form_id', form.id).eq('staff_id', req.params.staffId)
    if (error) throw error
    formsAudit.record(form.id, req.staff.id, 'unshared', { staff_id: req.params.staffId })
    res.json({ ok: true })
  } catch (err) {
    res.status(500).json({ error: 'Failed to remove share' })
  }
})

// GET /forms/:id/audit — per-form timeline.
router.get('/:id/audit', async (req, res) => {
  try {
    const { form, access } = await loadFormAccess(req, req.params.id)
    if (!form || !access.view) return res.status(form ? 403 : 404).json({ error: form ? 'No access' : 'Not found' })
    const { data, error } = await supabaseAdmin.from('form_audit_log')
      .select('*').eq('form_id', form.id).order('created_at', { ascending: false }).limit(300)
    if (error) throw error
    const actorIds = [...new Set((data || []).map(e => e.actor_id).filter(Boolean))]
    const { data: actors } = actorIds.length
      ? await supabaseAdmin.from('staff').select('id, display_name').in('id', actorIds) : { data: [] }
    const names = Object.fromEntries((actors || []).map(a => [a.id, a.display_name]))
    res.json({ events: (data || []).map(e => ({ ...e, actor_name: e.actor_id ? (names[e.actor_id] || 'Unknown') : 'Public' })) })
  } catch (err) {
    res.status(500).json({ error: 'Failed to load audit log' })
  }
})

// GET /forms/:id/submissions — in-portal peek; Sheets is the primary surface.
router.get('/:id/submissions', async (req, res) => {
  try {
    const { form, access } = await loadFormAccess(req, req.params.id)
    if (!form || !access.view) return res.status(form ? 403 : 404).json({ error: form ? 'No access' : 'Not found' })
    const limit = Math.min(parseInt(req.query.limit, 10) || 50, 200)
    const offset = parseInt(req.query.offset, 10) || 0
    const { data, error, count } = await supabaseAdmin.from('form_submissions')
      .select('id, data, submitted_at, synced_to_sheet, sync_error', { count: 'exact' })
      .eq('form_id', form.id).order('submitted_at', { ascending: false })
      .range(offset, offset + limit - 1)
    if (error) throw error
    res.json({ submissions: data || [], total: count || 0 })
  } catch (err) {
    res.status(500).json({ error: 'Failed to load submissions' })
  }
})

// POST /forms/:id/retry-sync — manual retry of unsynced submissions.
router.post('/:id/retry-sync', async (req, res) => {
  try {
    const { form, access } = await loadFormAccess(req, req.params.id)
    if (!form || !access.edit) return res.status(form ? 403 : 404).json({ error: form ? 'No access' : 'Not found' })
    const result = await formsSheets.retryFormSync(form.id)
    formsAudit.record(form.id, req.staff.id, 'sheet_retry', result)
    res.json(result)
  } catch (err) {
    res.status(500).json({ error: 'Retry failed' })
  }
})

module.exports = router
```

- [ ] **Step 2: Mount in index.js**

In `auth/src/index.js`:
1. Add to the routes block (after line 113 `app.use('/audit-log', ...)`):
```js
app.use('/forms', require('./routes/forms'))
app.use('/public/forms', require('./routes/publicForms'))
```
(The publicForms router is created in Task 6; to keep the server bootable after this task, add only `/forms` now and add `/public/forms` in Task 6.)
2. Add the renderer origin to `ALLOWED_ORIGINS` (line 15-19):
```js
const ALLOWED_ORIGINS = [
  process.env.PORTAL_URL || 'https://portal.wcstrength.com',
  'https://forms.westcoaststrength.com',
  'http://localhost:3000',
  'http://localhost:5173',
]
```
3. In the `app.listen` callback, after the kpiSnapshot block, start the retry sweep:
```js
  // Forms module: Google Sheets retry sweep. Opt out via FORMS_SHEETS_DISABLED=1.
  try {
    require('./services/formsSheets').start()
  } catch (err) {
    console.error('[formsSheets] failed to start:', err.message)
  }
```

- [ ] **Step 3: Boot check**

Run: `cd auth && node -e "require('./src/routes/forms')" 2>&1 | head -5`
Expected: exits clean OR throws only about missing SUPABASE env (acceptable: the module-level `require('../services/supabase')` needs env). If it throws on env, verify instead with `node --test src/services/formsPermissions.test.js` still passing and a `node --check src/routes/forms.js` syntax pass.

- [ ] **Step 4: Commit**

```bash
git add auth/src/routes/forms.js auth/src/index.js
git commit -m "feat(forms): authed forms API (CRUD, shares, audit, publish with sheet creation)"
```

---

### Task 6: Public forms router

**Files:**
- Create: `auth/src/routes/publicForms.js`
- Modify: `auth/src/index.js` (add the `/public/forms` mount from Task 5 step 2 if not already added)

**Interfaces:**
- Consumes: `validateSubmission` (Task 2), `formsSheets.appendSubmission` (Task 4), `formsAudit.record`.
- Produces (consumed by the renderer, Task 12):
  - `GET /public/forms/:slug` -> `{ form: { slug, title, description, schema, location_name } }`, 404 when not published.
  - `POST /public/forms/:slug/submit` body `{ data: { [fieldId]: value } }` -> `{ ok: true }` or `400 { errors: { [fieldId]: message } }`.

- [ ] **Step 1: Implement**

```js
const { Router } = require('express')
const rateLimit = require('express-rate-limit')
const { supabaseAdmin } = require('../services/supabase')
const { validateSubmission } = require('../services/formsSchema')
const formsSheets = require('../services/formsSheets')
const formsAudit = require('../services/formsAudit')

// Public form renderer endpoints. Intentionally NOT behind authenticate:
// anyone with the URL can view and submit a published form (spec section 7).
// Drafts and archived forms 404. The builder/management API stays in
// routes/forms.js behind auth.
const router = Router()

const submitLimiter = rateLimit({
  windowMs: 60 * 1000,
  limit: 20, // express-rate-limit v8: 'limit', not the deprecated 'max'
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many submissions. Try again in a minute.' },
})

async function loadPublished(slug) {
  const { data } = await supabaseAdmin.from('forms')
    .select('*').eq('slug', slug).eq('status', 'published').maybeSingle()
  return data || null
}

// GET /public/forms/:slug — published schema for rendering.
router.get('/:slug', async (req, res) => {
  try {
    const form = await loadPublished(req.params.slug)
    if (!form) return res.status(404).json({ error: 'This form is not available' })
    const { data: loc } = await supabaseAdmin.from('locations').select('name').eq('id', form.location_id).maybeSingle()
    res.json({
      form: {
        slug: form.slug, title: form.title, description: form.description,
        schema: form.schema, location_name: loc?.name || '',
      },
    })
  } catch (err) {
    console.error('[publicForms] fetch failed:', err.message)
    res.status(500).json({ error: 'Something went wrong. Try again.' })
  }
})

// POST /public/forms/:slug/submit — validate, back up in Supabase, then Sheets.
router.post('/:slug/submit', submitLimiter, async (req, res) => {
  try {
    const form = await loadPublished(req.params.slug)
    if (!form) return res.status(404).json({ error: 'This form is not available' })
    const result = validateSubmission(form.schema, (req.body || {}).data)
    if (!result.ok) return res.status(400).json({ errors: result.errors })

    // 1. Supabase backup first. A Sheets outage never loses a submission.
    const { data: submission, error } = await supabaseAdmin.from('form_submissions')
      .insert({ form_id: form.id, data: result.cleaned }).select('*').single()
    if (error) throw error
    formsAudit.record(form.id, null, 'submission_received', { submission_id: submission.id })

    // 2. Sheets append. Failure is recorded on the row and retried later; the
    // submitter still gets a success.
    if (form.sheet_id) {
      try { await formsSheets.appendSubmission(form, submission) } catch (err) {
        console.error('[publicForms] sheet append failed (backed up):', err.message)
      }
    }
    res.json({ ok: true })
  } catch (err) {
    console.error('[publicForms] submit failed:', err.message)
    res.status(500).json({ error: 'Something went wrong. Try again.' })
  }
})

module.exports = router
```

- [ ] **Step 2: Verify the mount exists**

`grep -n "public/forms" auth/src/index.js` — expect `app.use('/public/forms', require('./routes/publicForms'))`. Add it if Task 5 did not.

- [ ] **Step 3: Syntax check**

Run: `node --check auth/src/routes/publicForms.js`
Expected: no output

- [ ] **Step 4: Commit**

```bash
git add auth/src/routes/publicForms.js auth/src/index.js
git commit -m "feat(forms): public schema fetch + rate-limited submission endpoint"
```

---

### Task 7: Portal API client + tile registration

**Files:**
- Modify: `portal/src/lib/api.js` (add `forms` namespace near the other namespaced objects like `tourAdmin`)
- Modify: `portal/src/config/portalTiles.js` (add `forms` to PORTAL_TILE_CATALOG tools group)
- Modify: `auth/src/routes/admin.js` (add `'forms'` to `CUSTOM_TILE_KEYS`, line 44 set)
- Modify: `portal/package.json` (add `qrcode` dependency)

**Interfaces:**
- Produces (consumed by Tasks 8-11): `forms.*` client. Exact shape:

```js
export const forms = {
  list: () => api('/forms'),
  get: (id) => api(`/forms/${id}`),
  create: (body) => api('/forms', { method: 'POST', body: JSON.stringify(body) }),
  update: (id, body) => api(`/forms/${id}`, { method: 'PATCH', body: JSON.stringify(body) }),
  publish: (id) => api(`/forms/${id}/publish`, { method: 'POST' }),
  archive: (id) => api(`/forms/${id}/archive`, { method: 'POST' }),
  remove: (id) => api(`/forms/${id}`, { method: 'DELETE' }),
  addShare: (id, body) => api(`/forms/${id}/shares`, { method: 'POST', body: JSON.stringify(body) }),
  removeShare: (id, staffId) => api(`/forms/${id}/shares/${staffId}`, { method: 'DELETE' }),
  audit: (id) => api(`/forms/${id}/audit`),
  auditAll: (params = {}) => api(`/forms/audit/all?` + new URLSearchParams(params)),
  submissions: (id, offset = 0) => api(`/forms/${id}/submissions?offset=${offset}`),
  retrySync: (id) => api(`/forms/${id}/retry-sync`, { method: 'POST' }),
  staffDirectory: () => api('/forms/staff-directory'),
}
```

Before writing it, open `portal/src/lib/api.js`, find the `tourAdmin` or `onlineJoin` namespace object, and match its exact call style (some namespaces pass plain objects and rely on the wrapper to stringify; if `api()` auto-stringifies object bodies, drop the JSON.stringify calls to match).

- [ ] **Step 1: Add the namespace to api.js** (code above, adjusted to the wrapper's body convention)

- [ ] **Step 2: Add the tile catalog entry**

In `portal/src/config/portalTiles.js`, tools group, after the `reporting` entry:
```js
  { key: 'forms',           label: 'Forms',            desc: 'Signups',       group: 'tools' },
```

- [ ] **Step 3: Add the server allow-list key**

In `auth/src/routes/admin.js` find `const CUSTOM_TILE_KEYS = new Set([` (line 44) and add `'forms',` to the set, keeping the existing formatting.

- [ ] **Step 4: Add qrcode**

Run: `cd portal && pnpm add qrcode`
Expected: `qrcode` in dependencies (it ships its own types-free ESM build; import as `import QRCode from 'qrcode'`).

- [ ] **Step 5: Commit**

```bash
git add portal/src/lib/api.js portal/src/config/portalTiles.js auth/src/routes/admin.js portal/package.json portal/pnpm-lock.yaml
git commit -m "feat(forms): portal api namespace, tile catalog key, qrcode dep"
```

---

### Task 8: App wiring + Forms list view

**Files:**
- Create: `portal/src/components/forms/FormsView.jsx` (list + create modal + view switch to builder)
- Modify: `portal/src/App.jsx` (state, reset blocks, render branch, prop)
- Modify: `portal/src/components/ToolGrid.jsx` (tile)

**Interfaces:**
- Consumes: `forms` client (Task 7).
- Produces: `<FormsView onBack={fn} />` self-contained view; internally manages list vs builder vs panels. Builder component (Task 9) is imported as `./FormBuilder` with props `{ formId, onBack, onChanged }`.

- [ ] **Step 1: Wire App.jsx**

Mirror the `showInventory` wiring EXACTLY. Find every occurrence: `grep -n "showInventory" portal/src/App.jsx`. For each occurrence add the equivalent `showForms` line:
- `const [showForms, setShowForms] = useState(false)`
- include `!showForms` in the `isHome` computation
- reset `setShowForms(false)` in `handleBackToPortal`, `handleLogout`, `handleLogin`, `onAuthExpired`, and the Electron `onSignOut`/`onNavigate` handlers (wherever showInventory is reset)
- log effect: `useEffect(() => { if (showForms) logEvent('view.forms') }, [showForms])`
- render branch in the main ternary chain: `showForms ? <FormsView onBack={handleBackToPortal} /> :`
- pass `onForms={() => setShowForms(true)}` into `<ToolGrid ... />`
- import: `import FormsView from './components/forms/FormsView'`

- [ ] **Step 2: Add the tile in ToolGrid.jsx**

Find how the Inventory or Reporting tile is rendered and gated (`grep -n "onInventory\|ROLE_LEVELS.manager" portal/src/components/ToolGrid.jsx`). Add to the Tools grid, gated manager+ OR granted key, matching how other grantable tools handle the custom role (`visibleTools`/custom layout section around line 264-327):
```jsx
{(roleIdx >= ROLE_LEVELS.manager || visibleTools.includes('forms')) && (
  <SvgTileButton
    onClick={onForms}
    iconPath={TILE_ICONS.forms}
    label="Forms"
    desc="Signups"
  />
)}
```
Add a `forms` icon path to the icon map used by SvgTileButton (Heroicons outline "clipboard-document-list": `M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z` or the existing icon-map convention; read how TILE_ICONS/LABEL_ICONS are declared and match it). Accept `onForms` in ToolGrid's props. Also add the tile to the custom-role layout section if that section renders grantable tiles from `visibleTools` (mirror how `tickets` appears there).

- [ ] **Step 3: Build FormsView.jsx**

Complete component. Match portal tokens exactly (`bg-surface/95 backdrop-blur-sm rounded-xl border border-border`, buttons `bg-wcs-red text-white rounded-lg`, inputs `bg-bg border border-border rounded-lg focus:ring-2 focus:ring-wcs-red`). Structure:

```jsx
import { useEffect, useMemo, useState } from 'react'
import { forms as formsApi, getMe } from '../../lib/api'
import FormBuilder from './FormBuilder'

const STATUS_STYLES = {
  draft: 'bg-gray-100 border border-gray-200 text-gray-600',
  published: 'bg-green-50 border border-green-200 text-green-700',
  archived: 'bg-amber-50 border border-amber-200 text-amber-700',
}

export default function FormsView({ onBack }) {
  const [items, setItems] = useState(null)
  const [error, setError] = useState('')
  const [openFormId, setOpenFormId] = useState(null)
  const [showCreate, setShowCreate] = useState(false)
  const [me, setMe] = useState(null)

  async function load() {
    try {
      const res = await formsApi.list()
      setItems(res.forms || [])
    } catch (err) { setError(err.message) }
  }
  useEffect(() => { load() }, [])
  useEffect(() => { getMe().then(r => setMe(r.staff)).catch(() => {}) }, [])

  if (openFormId) {
    return <FormBuilder formId={openFormId} onBack={() => { setOpenFormId(null); load() }} />
  }

  return (
    <div className="max-w-5xl mx-auto px-4 py-6 space-y-4">
      <div className="bg-surface/95 backdrop-blur-sm rounded-xl border border-border p-5 flex items-center justify-between">
        <div>
          <h2 className="text-lg font-bold text-text-primary">Forms</h2>
          <p className="text-xs text-text-muted">Build signup forms, share them with a QR code, and collect responses in Google Sheets</p>
        </div>
        <button
          onClick={() => setShowCreate(true)}
          className="px-4 py-2 text-sm font-medium bg-wcs-red text-white rounded-lg hover:opacity-90 transition-opacity"
        >New Form</button>
      </div>
      {error && <div className="bg-red-50 border border-red-200 text-wcs-red rounded-xl px-4 py-3 text-sm">{error}</div>}
      {items === null ? (
        <div className="loading-card" />
      ) : items.length === 0 ? (
        <div className="bg-surface rounded-xl border border-border p-10 text-center text-sm text-text-muted">
          No forms yet. Create your first one.
        </div>
      ) : (
        <div className="bg-surface rounded-xl border border-border divide-y divide-border">
          {items.map(f => (
            <button key={f.id} onClick={() => setOpenFormId(f.id)}
              className="w-full flex items-center gap-4 px-5 py-4 text-left hover:bg-bg transition-colors">
              <div className="flex-1 min-w-0">
                <div className="text-sm font-semibold text-text-primary truncate">{f.title}</div>
                <div className="text-xs text-text-muted">{f.owner_name} · {f.location_name}</div>
              </div>
              <div className="text-xs text-text-muted">{f.submission_count} submissions</div>
              <span className={`px-2.5 py-1 rounded-full text-[11px] font-semibold ${STATUS_STYLES[f.status]}`}>
                {f.status.charAt(0).toUpperCase() + f.status.slice(1)}
              </span>
            </button>
          ))}
        </div>
      )}
      {showCreate && (
        <CreateFormModal me={me} onClose={() => setShowCreate(false)}
          onCreated={(form) => { setShowCreate(false); setOpenFormId(form.id) }} />
      )}
    </div>
  )
}

function CreateFormModal({ me, onClose, onCreated }) {
  const [title, setTitle] = useState('')
  const [description, setDescription] = useState('')
  const [locationId, setLocationId] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const locations = me?.locations || []
  const needsPicker = locations.length > 1
  useEffect(() => { if (locations.length === 1) setLocationId(locations[0].id) }, [locations])

  async function submit() {
    if (!title.trim()) { setError('Title is required'); return }
    setSaving(true); setError('')
    try {
      const body = { title, description }
      if (locationId) body.location_id = locationId
      const res = await formsApi.create(body)
      onCreated(res.form)
    } catch (err) { setError(err.message); setSaving(false) }
  }

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50" onClick={onClose}>
      <div className="bg-surface rounded-2xl border border-border w-full max-w-lg p-6" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-5">
          <h3 className="text-lg font-bold text-text-primary">New Form</h3>
          <button onClick={onClose} className="text-text-muted hover:text-text-primary text-2xl leading-none">&times;</button>
        </div>
        {error && <div className="bg-red-50 border border-red-200 text-wcs-red rounded-xl px-4 py-3 text-sm mb-4">{error}</div>}
        <div className="space-y-4">
          <div>
            <label className="block text-xs font-semibold text-text-muted mb-1">Title</label>
            <input value={title} onChange={e => setTitle(e.target.value)} placeholder="Summer Bash Signup"
              className="w-full px-3 py-2 bg-bg border border-border rounded-lg text-sm text-text-primary focus:outline-none focus:ring-2 focus:ring-wcs-red" />
          </div>
          <div>
            <label className="block text-xs font-semibold text-text-muted mb-1">Intro text (optional)</label>
            <textarea value={description} onChange={e => setDescription(e.target.value)} rows={2}
              className="w-full px-3 py-2 bg-bg border border-border rounded-lg text-sm text-text-primary focus:outline-none focus:ring-2 focus:ring-wcs-red" />
          </div>
          {needsPicker && (
            <div>
              <label className="block text-xs font-semibold text-text-muted mb-1">Location</label>
              <select value={locationId} onChange={e => setLocationId(e.target.value)}
                className="w-full px-3 py-2 bg-bg border border-border rounded-lg text-sm text-text-primary focus:outline-none focus:ring-2 focus:ring-wcs-red">
                <option value="">Choose a location</option>
                {locations.map(l => <option key={l.id} value={l.id}>{l.name}</option>)}
              </select>
            </div>
          )}
        </div>
        <div className="flex justify-end gap-2 mt-6">
          <button onClick={onClose} className="px-4 py-2 text-sm text-text-muted border border-border rounded-lg hover:text-text-primary transition-colors">Cancel</button>
          <button onClick={submit} disabled={saving}
            className="px-4 py-2 text-sm font-medium bg-wcs-red text-white rounded-lg hover:opacity-90 transition-opacity disabled:opacity-50">
            {saving ? 'Creating...' : 'Create Form'}
          </button>
        </div>
      </div>
    </div>
  )
}
```

IMPORTANT verifications while implementing: check `getMe` exists in api.js and what shape `staff.locations` has (`/auth/me` returns `staff.locations` array per auth/src/routes/auth.js:299-315; confirm items are `{ id, name }`). If the app already holds the me/user object in App.jsx state, pass it down as a prop instead of refetching; read App.jsx and do whichever matches the codebase.

- [ ] **Step 4: Build check**

Run: `cd portal && pnpm build 2>&1 | tail -5`
Expected: build succeeds (FormBuilder.jsx must exist as a stub for the import; create `portal/src/components/forms/FormBuilder.jsx` exporting a placeholder that Task 9 replaces:
`export default function FormBuilder({ formId, onBack }) { return null }`)

- [ ] **Step 5: Commit**

```bash
git add portal/src/App.jsx portal/src/components/ToolGrid.jsx portal/src/components/forms/
git commit -m "feat(forms): Forms tile, view wiring, list + create modal"
```

---

### Task 9: Form builder editor

**Files:**
- Replace: `portal/src/components/forms/FormBuilder.jsx`
- Create: `portal/src/components/forms/FieldEditor.jsx`
- Create: `portal/src/components/forms/FormPreview.jsx`

**Interfaces:**
- Consumes: `forms` client; form object shape from `GET /forms/:id` (`{ form: {..., access}, shares }`).
- Produces: `<FormBuilder formId onBack />`. Also `<FormPreview schema title description />` (reused nowhere else but keep it standalone; the public renderer mirrors its markup). Tab bar switches: Build, Share, QR, Audit (Share/QR/Audit panels are Tasks 10-11; import them; create placeholder null-returning stubs now so the build passes: `FormSharePanel.jsx`, `FormQrPanel.jsx`, `FormAuditPanel.jsx`).

Key behaviors (all must be implemented):
- Field list left pane, settings for the selected field right pane (AdminRolesV2Tab two-pane pattern).
- Add-field menu with the 11 types, labeled: Short Text, Long Text, Email, Phone, Number, Dropdown, Radio Buttons, Checkboxes, Date, Section Header, Paragraph Text.
- New field ids generated client-side: `'f_' + Math.random().toString(36).slice(2, 8)`.
- Reorder with up/down arrow buttons (disabled at ends). No drag library.
- Required toggle per input field; hidden for header/description.
- Options editor (one per line textarea) for dropdown/radio/checkbox.
- Save button: `forms.update(id, { known_updated_at: form.updated_at, title, description, schema })`. On a thrown error whose message includes 'changed since you opened it', show a warning banner with a Reload button that refetches (the api wrapper throws `Error(data.error)`, so the 409 arrives as that message).
- Publish button (draft or archived -> published): calls publish, then shows the QR tab. If response contains `sheet_error`, show an amber warning: "Form published. Google Sheet could not be created yet: <msg>. Submissions are safe and will sync once the sheet connects."
- Archive button for published forms; Delete button only for drafts with 0 submissions.
- Status pill + public URL display once published: `https://forms.westcoaststrength.com/f/<slug>` with the standard copy button pattern (`copiedField` state + `animate-pulse` "Copied!", copy from `CommunicationNotesView.jsx:93`).
- Unsaved-changes indicator (compare JSON of loaded vs current), confirm before leaving via onBack when dirty (plain `window.confirm`).
- Field-id immutability: never regenerate an existing field's id on edit.

FormPreview renders the schema read-only in public-renderer styling (white card, label + input mocks, red submit button, `required` asterisks). Complete markup for every field type (text/textarea/select/radio group/checkbox group/date input disabled).

This is the largest UI task; write the full components (no placeholders inside them) following the class strings shown in Task 8. Trim scope only by keeping the visuals simple, never by omitting a behavior above.

- [ ] **Step 1: Implement the three components** (full code, portal tokens)
- [ ] **Step 2: Build check** — `cd portal && pnpm build 2>&1 | tail -5`, expect success
- [ ] **Step 3: Commit**

```bash
git add portal/src/components/forms/
git commit -m "feat(forms): builder editor with reorder arrows, options editor, publish flow, last-write warning"
```

---

### Task 10: Sharing panel + audit timeline

**Files:**
- Replace: `portal/src/components/forms/FormSharePanel.jsx`
- Replace: `portal/src/components/forms/FormAuditPanel.jsx`

**Interfaces:**
- Consumes: `forms.addShare/removeShare/update/staffDirectory/audit/auditAll`.
- Produces: `<FormSharePanel form shares onChanged />` and `<FormAuditPanel form isCorporate />` used by FormBuilder's tabs.

Share panel behaviors:
- Visibility radio group: Private ("Only you and directors"), My location ("Everyone at <location_name> can view"), Specific people ("Only people you add"). Saving visibility calls `forms.update(form.id, { known_updated_at, visibility })`.
- When visibility = location: "Allow location teammates to edit" toggle -> `location_can_edit`.
- When visibility = shared: staff picker (searchable select fed by `staffDirectory()`), permission select (Viewer/Editor), Add button -> `addShare`; list of current shares with permission dropdown (change -> addShare upsert) and Remove button -> `removeShare`.
- All copy without em dashes.

Audit panel behaviors:
- Timeline list: timestamp (locale string), actor_name, action label (human copy: created -> "Created the form", edited -> "Edited fields", published -> "Published", shared -> "Shared with <detail.staff_id resolved when present in detail>", submission_received -> "Received a submission", sheet_retry -> "Retried Sheet sync"), detail rendered as small muted JSON summary when present.
- For corporate/admin when opened from a form: a "View all forms activity" toggle that switches to `auditAll()` with optional form/staff filter inputs.

- [ ] **Step 1: Implement both components** (full code, following Task 8's class strings; modal-free, they render inside FormBuilder's tab area)
- [ ] **Step 2: Build check** — `cd portal && pnpm build 2>&1 | tail -5`
- [ ] **Step 3: Commit**

```bash
git add portal/src/components/forms/FormSharePanel.jsx portal/src/components/forms/FormAuditPanel.jsx
git commit -m "feat(forms): sharing panel and audit timeline"
```

---

### Task 11: QR panel

**Files:**
- Replace: `portal/src/components/forms/FormQrPanel.jsx`

**Interfaces:**
- Consumes: `qrcode` package; `portal/public/wcs-logo.png` (exists; confirm with `ls portal/public`).
- Produces: `<FormQrPanel form />` — shown when `form.status === 'published'`.

Behaviors:
- Public URL: `const PUBLIC_FORMS_BASE = import.meta.env.VITE_PUBLIC_FORMS_URL || 'https://forms.westcoaststrength.com'`; URL = `${PUBLIC_FORMS_BASE}/f/${form.slug}`. Display it with the standard copy button.
- On mount, render the QR to a canvas at 1024px, error correction H, then draw `wcs-logo.png` centered at 20% width over a white rounded square pad:

```jsx
import { useEffect, useRef, useState } from 'react'
import QRCode from 'qrcode'

async function drawQrCanvas(canvas, url) {
  await QRCode.toCanvas(canvas, url, { errorCorrectionLevel: 'H', width: 1024, margin: 2 })
  const ctx = canvas.getContext('2d')
  const logo = new Image()
  await new Promise((resolve, reject) => {
    logo.onload = resolve; logo.onerror = reject; logo.src = '/wcs-logo.png'
  })
  const size = canvas.width * 0.2
  const x = (canvas.width - size) / 2
  const pad = size * 0.12
  ctx.fillStyle = '#ffffff'
  ctx.beginPath()
  ctx.roundRect(x - pad, x - pad, size + pad * 2, size + pad * 2, pad)
  ctx.fill()
  ctx.drawImage(logo, x, x, size, size)
}
```

- PNG download: `canvas.toDataURL('image/png')` -> anchor click, filename `${form.slug}-qr.png`.
- SVG download: `QRCode.toString(url, { type: 'svg', errorCorrectionLevel: 'H', margin: 2 })`, then before the closing `</svg>` inject a centered logo: white `<rect>` pad plus `<image href="${logoDataUrl}" ...>` where `logoDataUrl` is the PNG logo read into a data URL via canvas. Compute the 20% geometry from the SVG's viewBox. Filename `${form.slug}-qr.svg`.
- Show the on-screen preview canvas at ~256px CSS size inside a bg-surface card, with both download buttons and a note: "Print the PNG. Use the SVG for OptiSigns and large signage."

- [ ] **Step 1: Implement** (full component)
- [ ] **Step 2: Build check** — `cd portal && pnpm build 2>&1 | tail -5` (verify `roundRect` usage builds; it is supported in all modern runtimes, no polyfill)
- [ ] **Step 3: Commit**

```bash
git add portal/src/components/forms/FormQrPanel.jsx
git commit -m "feat(forms): QR panel with logo overlay, PNG and SVG downloads"
```

---

### Task 12: Public renderer repo

**Files (new repo at `C:\Users\justi\Desktop\wcs-forms-renderer`):**
- Create: `package.json`, `vite.config.js`, `index.html`, `public/_redirects`, `src/main.jsx`, `src/App.jsx`, `src/FormPage.jsx`, `src/styles.css`, `README.md`, `.gitignore`

**Interfaces:**
- Consumes: `GET /public/forms/:slug` and `POST /public/forms/:slug/submit` (Task 6 shapes). API base: `import.meta.env.VITE_FORMS_API_URL || 'https://wcs-auth-api.onrender.com'`.

- [ ] **Step 1: Scaffold**

```bash
cd /c/Users/justi/Desktop && mkdir wcs-forms-renderer && cd wcs-forms-renderer
```
Hand-write the files (do not run create-vite; it is interactive). `package.json`:
```json
{
  "name": "wcs-forms-renderer",
  "private": true,
  "version": "1.0.0",
  "type": "module",
  "scripts": { "dev": "vite", "build": "vite build", "preview": "vite preview" },
  "dependencies": { "react": "^19.0.0", "react-dom": "^19.0.0" },
  "devDependencies": { "@vitejs/plugin-react": "^4.3.0", "vite": "^6.0.0" }
}
```
`vite.config.js`:
```js
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
export default defineConfig({ plugins: [react()] })
```
`public/_redirects`:
```
/* /index.html 200
```
Then `pnpm install`.

- [ ] **Step 2: App + FormPage**

`src/App.jsx` parses the path: `const match = window.location.pathname.match(/^\/f\/([a-z0-9-]+)$/i)`; renders `<FormPage slug={match[1]} />` or a not-found card. `src/FormPage.jsx` (complete behaviors):
- Fetch schema on mount; states: loading spinner, unavailable ("This form is not available"), form, submitting, success ("Thanks, you're signed up."), network error with a Try Again button.
- Render every field type: short_text/email/phone/number/date as `<input>` (type email/tel/number/date), long_text as textarea, dropdown as select, radio as radio group, checkbox as checkbox group (array state), header as an `<h2>`, description as a paragraph (plain text, render newlines).
- Required asterisk in red; client-side required check before submit; server `errors` map rendered inline under fields.
- Submit: `POST { data }`; disable button while submitting.
- Copy: no em dashes anywhere.

Styling in `src/styles.css` (plain CSS, no Tailwind): page background `#f6f6f4`; centered column max-width 560px; white card `border-radius: 16px; box-shadow: 0 8px 32px rgba(0,0,0,0.08); padding: 32px`; WCS wordmark header ("WEST COAST STRENGTH" text in 700 weight, letter-spacing, `#1a1a2e`, with a red accent bar); Inter via Google Fonts `<link>` in index.html; labels 600 weight 14px; inputs full-width, `border: 1px solid #e2e4e8; border-radius: 10px; padding: 10px 12px; font-size: 15px`, focus ring `#e53e3e`; primary button full-width `background: #e53e3e; color: white; border-radius: 10px; padding: 12px; font-weight: 600` hover `#c53030`; error text `#e53e3e` 13px. Mobile-first: the card is edge-to-edge with 16px gutters under 480px.

- [ ] **Step 3: Verify locally**

Run: `pnpm build` — expect a clean `dist/`. Then `pnpm preview` and load `http://localhost:4173/f/anything` — expect the unavailable card (API 404s), proving SPA path routing works.

- [ ] **Step 4: Git init + push**

```bash
git init -b main && git add -A && git commit -m "feat: WCS public form renderer (Cloudflare Pages)

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
gh repo create justinhuttinger/wcs-forms-renderer --private --source . --push
```
README must document: Cloudflare Pages settings (framework Vite, build `pnpm build`, output `dist`), env var `VITE_FORMS_API_URL`, custom domain `forms.westcoaststrength.com`, and that the auth API's ALLOWED_ORIGINS already includes that origin.

- [ ] **Step 5: Commit** (already committed in step 4)

---

### Task 13: Forms admin panel (drive folder setting + sync health)

**Files:**
- Create: `portal/src/components/admin/FormsAdmin.jsx`
- Modify: `portal/src/components/AdminPanel.jsx` (register the tile)
- Modify: `portal/src/lib/api.js` (only if `getAppSettings`/`saveAppSettings` helpers do not already exist; they do per api.js:1481, reuse them)

**Interfaces:**
- Consumes: `getAppSettings('forms_')` / `saveAppSettings({ forms_drive_folder_id })` (admin-only PUT); `forms.list()` + `forms.retrySync(id)`.
- Produces: admin section `forms` inside AdminPanel's Setup tiles.

Behaviors:
- Google Drive folder setting: text input accepting a pasted folder URL or raw ID; on save, extract the ID client-side with the same regex as `extractFolderId` (`/folders\/([a-zA-Z0-9_-]+)/`), store via `saveAppSettings({ forms_drive_folder_id: id })`. Help text: "Paste the WCS shared drive folder where form spreadsheets should be created. The Google Business account must have access."
- Sync health: list published forms where any submissions are unsynced (derive from `forms.list()` rows by calling `forms.submissions(id)`? No: keep it cheap, add nothing to the API; instead show all published forms with a Retry Sync button each and surface the returned `{ retried, failed }` inline).
- Register in AdminPanel: add `{ key: 'forms', label: 'Forms', desc: 'Drive folder + sync', icon: <same icon convention as other SETUP_TILES entries> }` to the SETUP_TILES array, an entry in CATEGORIES if required, and `{activeSection === 'forms' && <FormsAdmin />}` in the section switch. Read AdminPanel.jsx first and mirror an existing tile exactly.

- [ ] **Step 1: Implement FormsAdmin.jsx + registration**
- [ ] **Step 2: Build check** — `cd portal && pnpm build 2>&1 | tail -5`
- [ ] **Step 3: Commit**

```bash
git add portal/src/components/admin/FormsAdmin.jsx portal/src/components/AdminPanel.jsx
git commit -m "feat(forms): admin panel for drive folder setting and sheet sync retry"
```

---

### Task 14: Full test pass, self-review, PR

- [ ] **Step 1: Run every auth test**

Run: `cd auth && node --test src/services/*.test.js src/utils/*.test.js 2>&1 | tail -15`
Expected: all pass including the 3 new test files; zero regressions in existing tests.

- [ ] **Step 2: Portal production build**

Run: `cd portal && pnpm build 2>&1 | tail -5` — clean build.

- [ ] **Step 3: Em-dash sweep**

Run: `grep -rn $'—' portal/src/components/forms auth/src/routes/forms.js auth/src/routes/publicForms.js auth/src/services/forms*.js portal/src/components/admin/FormsAdmin.jsx /c/Users/justi/Desktop/wcs-forms-renderer/src`
Expected: no matches. Fix any hit.

- [ ] **Step 4: Acceptance criteria review**

Re-read spec section "Testing" and the original acceptance criteria; walk each one against the code (not by running, by reading). Fix any gap found. Pay specific attention to: private form invisible to same-location peers (canAccessForm branch order), sheet columns append-only (computeColumns), 409 warning copy, submission backup before Sheets append.

- [ ] **Step 5: Push + PR (do NOT merge; Justin merges)**

```bash
git push -u origin feat/form-builder
gh pr create --title "Form Builder: internal Jotform replacement (builder, public renderer API, Sheets sync, sharing + audit)" --body "<summary per repo convention, listing migration 078 apply step, Render env note (none new), Cloudflare/DNS ops steps, and the wcs-forms-renderer repo>

🤖 Generated with [Claude Code](https://claude.com/claude-code)"
```

Post-merge ops checklist to include in the PR body (Justin's steps):
1. Apply `auth/migrations/078_form_builder.sql` to Supabase project `ybopxxydsuwlbwxiuzve` (or ask Claude to, with consent).
2. Create/choose the shared drive folder, paste into Admin -> Forms.
3. Connect `justinhuttinger/wcs-forms-renderer` to Cloudflare Pages (Vite preset, `pnpm build`, output `dist`), set `VITE_FORMS_API_URL=https://wcs-auth-api.onrender.com`, attach domain `forms.westcoaststrength.com`.
4. Run one real event signup end to end at one location before wider rollout.
