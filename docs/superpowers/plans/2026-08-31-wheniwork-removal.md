# WhenIWork Removal Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Remove the WhenIWork tile and every reference to the `wheniwork` key from the portal, the auth service, the seeds, the permission tables, and the Electron launcher.

**Architecture:** The `wheniwork` key is threaded through five layers that must all agree: a static tile definition (`tools.json`), a grant catalog the admin UI reads (`portalTiles.js`), a server-side allow-list (`admin.js`), three database tables (`permission_catalog`, `role_tool_visibility`, `staff_permission_overrides`) plus a `text[]` column (`staff.custom_tiles`), and the launcher's URL/label maps. Removal goes bottom-up: data first (a migration that strips granted keys), then the server allow-list, then the client, then the launcher. Doing it in that order means no intermediate commit leaves a user holding a grant for a key the server rejects.

**Tech Stack:** Node 20 + Express (auth), React 19 + Vite + Tailwind 4 (portal), Electron (launcher), Supabase Postgres. Tests are `node:test` — `node --test src/` in `auth/`, and `*.test.mjs` files run individually in `portal/`.

**Spec:** `docs/superpowers/specs/2026-08-31-portal-profile-appearance-design.md` (section 1)

## Global Constraints

- Migrations are **applied manually at merge time**, not by a runner. Number the new file `173_retire_wheniwork.sql` — verify `ls auth/migrations | sort -V | tail -1` is still `172_analytics_daily_series.sql` before naming it, and bump if not.
- `staff.custom_tiles` is `text[]`, **not** jsonb. Strip values with `array_remove`, never with a jsonb operator. Migration `105_ticketing_replaces_clickup_tickets.sql` documents what happens when this is got wrong.
- Stored WhenIWork credentials in the launcher vault are **left in place**. Removing a tile must not destroy a saved password.
- Do not reformat or reorder surrounding entries in the files being edited. Every change here is a deletion.
- No em-dashes in any user-facing copy added or edited.

---

### Task 1: Retire the `wheniwork` key from the database

**Files:**
- Create: `auth/migrations/173_retire_wheniwork.sql`

**Interfaces:**
- Consumes: nothing.
- Produces: a database with no `wheniwork` row in `permission_catalog`, `role_tool_visibility`, or `staff_permission_overrides`, and no `'wheniwork'` element in any `staff.custom_tiles` array. Later tasks assume the server allow-list can drop the key without orphaning a grant.

- [ ] **Step 1: Confirm the migration number is still free**

Run: `ls auth/migrations | sort -V | tail -3`

Expected: the highest is `172_analytics_daily_series.sql`. If something higher exists, use the next free number and adjust the filename everywhere below.

- [ ] **Step 2: Write the migration**

Create `auth/migrations/173_retire_wheniwork.sql`:

```sql
-- Retire the WhenIWork tile.
--
-- The `wheniwork` key was seeded into permission_catalog by
-- 062_catalog_builtin_apps.sql and could be granted three ways: per role
-- (role_tool_visibility), per person (staff_permission_overrides), and to a
-- custom-role member (staff.custom_tiles). All three are cleared here so no
-- account is left holding a grant for a tile that renders nothing.
--
-- Follows the pattern established by 105_ticketing_replaces_clickup_tickets.sql.

delete from permission_catalog         where perm_key = 'wheniwork';
delete from role_tool_visibility       where tool_key = 'wheniwork';
delete from staff_permission_overrides where perm_key = 'wheniwork';

-- staff.custom_tiles is a text[] (NOT jsonb), so strip the retired key with
-- array_remove. A jsonb operator would throw on any matching row.
update staff
   set custom_tiles = array_remove(custom_tiles, 'wheniwork')
 where custom_tiles is not null and 'wheniwork' = any(custom_tiles);
```

- [ ] **Step 3: Verify the SQL parses and is idempotent by inspection**

There is no local database and no migration runner, so this is a read-through, not an execution:

- Every statement is a `delete` or an `update` with a `where` guard, so running it twice is a no-op. Confirm that is true of what you wrote.
- Confirm `array_remove` (not `jsonb_array_elements` or `-`) is used against `custom_tiles`.
- Confirm all three table names match those in `057_rbac_v2_schema.sql` and `105_ticketing_replaces_clickup_tickets.sql`.

Do **not** apply it against production. It is applied by hand at merge time.

- [ ] **Step 4: Commit**

```bash
git add auth/migrations/173_retire_wheniwork.sql
git commit -m "feat(auth): migration retiring the wheniwork permission key"
```

---

### Task 2: Drop `wheniwork` from the server allow-list and seeds

**Files:**
- Modify: `auth/src/routes/admin.js:45`
- Modify: `auth/seed/seed.js:19`
- Modify: `auth/seed/seed-help-center.js:33`

**Interfaces:**
- Consumes: Task 1's migration (the grants are gone, so rejecting the key strands nobody).
- Produces: `CUSTOM_TILE_KEYS` no longer contains `'wheniwork'`, so `PUT /admin/staff/:id` rejects it if a stale client sends it.

- [ ] **Step 1: Remove the key from `CUSTOM_TILE_KEYS`**

In `auth/src/routes/admin.js`, the set currently reads:

```js
const CUSTOM_TILE_KEYS = new Set([
  'grow', 'abc', 'wheniwork', 'paychex', 'gmail', 'drive', 'insights', 'notifications',
  'calendar', 'leaderboard', 'helpCenter', 'ordering', 'ticketing',
  'trainerAvail', 'reporting', 'forms',
])
```

Change the first line of the array to:

```js
  'grow', 'abc', 'paychex', 'gmail', 'drive', 'insights', 'notifications',
```

Leave the other two lines and the surrounding comment untouched.

- [ ] **Step 2: Remove the key from the seed tool list**

In `auth/seed/seed.js`, line 19 currently reads:

```js
const TOOLS = ['grow', 'abc', 'wheniwork', 'paychex', 'gmail', 'drive']
```

Change it to:

```js
const TOOLS = ['grow', 'abc', 'paychex', 'gmail', 'drive']
```

- [ ] **Step 3: Reword the Help Center seed copy**

In `auth/seed/seed-help-center.js`, line 33 currently reads:

```
Apps (left side): Quick links to external tools you use daily — Grow (CRM), ABC Financial, WhenIWork (scheduling), Paychex (payroll), Gmail, and Google Drive.
```

Replace it with (note: no em-dash, per the global constraints):

```
Apps (left side): Quick links to external tools you use daily: Grow (CRM), ABC Financial, Paychex (payroll), Gmail, and Google Drive.
```

- [ ] **Step 4: Verify no `wheniwork` remains under `auth/`**

Run: `grep -rn wheniwork auth/src auth/seed`

Expected: no output. (`auth/migrations/062` and `173` still mention it, which is correct — migrations are a historical record and must not be edited.)

- [ ] **Step 5: Run the auth test suite**

Run: `cd auth && npm test`

Expected: PASS, with no new failures against the pre-change baseline. If the suite is already red on `master`, record which tests were failing before your change and confirm the set is unchanged.

- [ ] **Step 6: Commit**

```bash
git add auth/src/routes/admin.js auth/seed/seed.js auth/seed/seed-help-center.js
git commit -m "feat(auth): drop wheniwork from the tile allow-list and seeds"
```

---

### Task 3: Drop the WhenIWork tile from the portal

**Files:**
- Modify: `portal/src/config/tools.json:16-22`
- Modify: `portal/src/config/portalTiles.js`
- Modify: `portal/src/components/SaveCredentialToast.jsx:6`

**Interfaces:**
- Consumes: Task 2's server allow-list (the client no longer offers a key the server would reject).
- Produces: a board with no WhenIWork tile, and a `PORTAL_TILE_CATALOG` whose keys are a subset of the server's `CUSTOM_TILE_KEYS`.

- [ ] **Step 1: Remove the tile from `tools.json`**

In `portal/src/config/tools.json`, delete this whole object, including the trailing comma of the preceding entry's closing brace as needed to keep the JSON valid:

```json
  {
    "id": "wheniwork",
    "label": "WhenIWork",
    "description": "Scheduling",
    "url": "https://app.wheniwork.com",
    "icon": "wheniwork"
  },
```

- [ ] **Step 2: Verify the JSON still parses**

Run: `node -e "console.log(require('./portal/src/config/tools.json').map(t=>t.id).join(','))"`

Expected: `grow,abc,paychex,gmail,drive` — five ids, no `wheniwork`, and no parse error.

- [ ] **Step 3: Remove the entry from the grant catalog**

In `portal/src/config/portalTiles.js`, delete this line from `PORTAL_TILE_CATALOG`:

```js
  { key: 'wheniwork',     label: 'WhenIWork',         desc: 'Scheduling',    group: 'apps' },
```

- [ ] **Step 4: Remove the launcher toast label**

In `portal/src/components/SaveCredentialToast.jsx`, the map at line 3 currently reads:

```js
const SERVICE_NAMES = {
  abc: 'ABC Financial',
  ghl: 'Grow (GHL)',
  wheniwork: 'WhenIWork',
  paychex: 'Paychex',
}
```

Delete the `wheniwork` line.

- [ ] **Step 5: Write a test asserting the two catalogs agree**

The invariant that actually matters here is the one the comment at the top of `portalTiles.js` states: its keys must stay in sync with the server's `CUSTOM_TILE_KEYS`. Nothing enforced that until now, which is why the key could rot in two places.

Create `portal/src/config/portalTiles.test.mjs`:

```js
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { PORTAL_TILE_CATALOG } from './portalTiles.js'

const tools = JSON.parse(readFileSync(new URL('./tools.json', import.meta.url)))

// The server's allow-list, scraped rather than imported: auth/ is a separate
// CommonJS package and admin.js pulls in Supabase on import, which a unit test
// must not do. Scraping is brittle if the declaration is reformatted, hence
// the explicit failure message.
function serverTileKeys() {
  const src = readFileSync(new URL('../../../auth/src/routes/admin.js', import.meta.url), 'utf8')
  const m = src.match(/const CUSTOM_TILE_KEYS = new Set\(\[([\s\S]*?)\]\)/)
  assert.ok(m, 'could not find CUSTOM_TILE_KEYS in auth/src/routes/admin.js — was it renamed or reformatted?')
  return new Set([...m[1].matchAll(/'([^']+)'/g)].map(x => x[1]))
}

test('wheniwork is gone from both portal catalogs', () => {
  assert.equal(tools.find(t => t.id === 'wheniwork'), undefined)
  assert.equal(PORTAL_TILE_CATALOG.find(t => t.key === 'wheniwork'), undefined)
})

test('every grantable tile key is one the server accepts', () => {
  const allowed = serverTileKeys()
  const orphans = PORTAL_TILE_CATALOG.map(t => t.key).filter(k => !allowed.has(k))
  assert.deepEqual(orphans, [], `catalog keys the server would reject: ${orphans.join(', ')}`)
})
```

- [ ] **Step 6: Run the test**

Run: `node --test portal/src/config/portalTiles.test.mjs`

Expected: PASS, 2 tests. If `every grantable tile key is one the server accepts` fails, that is a real pre-existing mismatch between the two lists — report it rather than deleting the test.

- [ ] **Step 7: Verify the portal still builds**

Run: `cd portal && npm run build`

Expected: build succeeds. This is the only check that catches a JSON syntax error or a dangling import.

- [ ] **Step 8: Commit**

```bash
git add portal/src/config/tools.json portal/src/config/portalTiles.js portal/src/config/portalTiles.test.mjs portal/src/components/SaveCredentialToast.jsx
git commit -m "feat(portal): remove the WhenIWork tile"
```

---

### Task 4: Drop WhenIWork from the launcher

**Files:**
- Modify: `launcher/src/config.js:47`
- Modify: `launcher/src/main.js:356`
- Modify: `launcher/src/main.js:486`
- Modify: `launcher/src/credential-capture.js:9`
- Modify: `launcher/src/credential-capture.js:108`

**Interfaces:**
- Consumes: Task 3 (the portal no longer links to WhenIWork, so the launcher has nothing left to open).
- Produces: a launcher that neither names WhenIWork nor offers to capture its credentials.

- [ ] **Step 1: Remove the tool URL**

In `launcher/src/config.js`, the `TOOLS` map reads:

```js
  TOOLS: {
    grow: 'https://app.westcoaststrength.com',
    wheniwork: 'https://app.wheniwork.com',
    paychex: 'https://myapps.paychex.com',
  },
```

Delete the `wheniwork` line.

- [ ] **Step 2: Remove the credential service name**

In `launcher/src/main.js` near line 353, `SERVICE_NAMES` reads:

```js
  const SERVICE_NAMES = {
    abc: 'ABC Financial',
    ghl: 'Grow (GHL)',
    wheniwork: 'WhenIWork',
    paychex: 'Paychex',
  }
```

Delete the `wheniwork` line.

- [ ] **Step 3: Remove the tab-name mapping**

In `launcher/src/main.js` near line 482, `URL_TAB_NAMES` contains:

```js
    'wheniwork.com': 'WhenIWork',
```

Delete that line. Leave every other host mapping alone.

- [ ] **Step 4: Remove the capture host and label**

In `launcher/src/credential-capture.js`, delete `'wheniwork.com': 'wheniwork',` from `DOMAIN_SERVICE_MAP` (near line 9) and `wheniwork: 'WhenIWork',` from `SERVICE_LABELS` (near line 108).

- [ ] **Step 5: Verify nothing references the key anywhere**

Run: `grep -rn wheniwork portal/src auth/src auth/seed launcher/src`

Expected: no output.

Then, case-insensitively, to catch the display name:

Run: `grep -rni wheniwork portal/src auth/src auth/seed launcher/src`

Expected: no output.

- [ ] **Step 6: Verify the launcher's changed files still parse**

Run: `node --check launcher/src/config.js && node --check launcher/src/main.js && node --check launcher/src/credential-capture.js`

Expected: no output, exit 0. (`node --check` parses without executing, which is what is wanted — `main.js` requires Electron and cannot be run outside it.)

- [ ] **Step 7: Commit**

```bash
git add launcher/src/config.js launcher/src/main.js launcher/src/credential-capture.js
git commit -m "feat(launcher): drop WhenIWork from tool URLs and credential capture"
```

---

### Task 5: Open the PR

**Files:** none.

**Interfaces:**
- Consumes: Tasks 1-4.
- Produces: an open PR. Do **not** merge it; that is Justin's call.

- [ ] **Step 1: Confirm the full diff is deletions only**

Run: `git diff origin/master --stat`

Expected: eight files touched (one migration added, one test added, six modified), and the modified files show deletions only apart from the Help Center copy reword.

- [ ] **Step 2: Re-run both test suites**

Run: `cd auth && npm test; cd ../portal && node --test src/config/portalTiles.test.mjs && npm run build`

Expected: auth suite at its baseline, the catalog test passes, the portal builds.

- [ ] **Step 3: Push and open the PR**

```bash
git push -u origin feat/wheniwork-removal
gh pr create --title "Remove the WhenIWork tile" --body "$(cat <<'EOF'
Removes the `wheniwork` key from every layer it was wired into: the portal board and grant catalog, the server allow-list, the seeds, the permission tables, and the Electron launcher's URL/tab/credential-capture maps.

Adds `173_retire_wheniwork.sql`, which clears the key from `permission_catalog`, `role_tool_visibility`, `staff_permission_overrides` and `staff.custom_tiles` so no account is left holding a grant for a tile that renders nothing. It follows the pattern of `105_ticketing_replaces_clickup_tickets.sql`, including using `array_remove` against `custom_tiles` (a `text[]`, not jsonb).

**Apply `173_retire_wheniwork.sql` by hand at merge.**

Stored WhenIWork credentials in the launcher vault are deliberately left alone: removing a tile should not destroy a saved password.

Also adds `portalTiles.test.mjs`, which asserts the portal grant catalog is a subset of the server's `CUSTOM_TILE_KEYS`. That invariant was only a comment until now, which is how the key came to live in two places that could drift.

Anyone holding a WhenIWork pin in the Press nav loses that tab quietly on next load: the pin resolver already drops keys it cannot resolve.

🤖 Generated with [Claude Code](https://claude.com/claude-code)

https://claude.ai/code/session_016YuAnkYK88gn8NemE11p4H
EOF
)"
```

Note the branch name: this work belongs on its own branch off `origin/master`, **not** on `feat/portal-profile-appearance`, which carries the design docs and the profile work. Create it with `git switch -c feat/wheniwork-removal origin/master` before Task 1 if you have not already.
