# Tour Check-In Standalone Public App — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Convert the auth-gated mobile Tour Check-In tile into a standalone, login-free per-location iPad app with a Tour Member selector (ABC employees), a tightened outcome set, an in-app Book Day One step, an outbound webhook, and an admin page to manage per-location URL/webhook/Day One link.

**Architecture:** A new public (no-JWT) Express router on the auth service, gated by an unguessable per-location `public_token`, backs a new public React route `/tour/:token` rendered before the portal's auth gate. A new admin router + admin page manage per-location config. A migration adds `tour_location_config` and `tour_intakes.tour_member`.

**Tech Stack:** Express (auth service, CommonJS), React + Vite + Tailwind (portal, ESM), Supabase (service-role), `node:test` for pure-helper unit tests.

## Global Constraints

- **Worktree:** all work happens in `C:\Users\justi\wcs-staff-portal\.claude\worktrees\tour-standalone` on branch `feat/tour-checkin-standalone`.
- **Supabase project:** `wcs-staff-portal` = `ybopxxydsuwlbwxiuzve`. Apply migrations via Supabase MCP `apply_migration` (the repo's convention) — do NOT rely on a local migration runner.
- **RLS:** every new table gets `ENABLE ROW LEVEL SECURITY` with **no policy** (service-role only), matching `035_enable_rls_all_tables`.
- **DB access is 100% service-role** via `supabaseAdmin` from `auth/src/services/supabase`; the frontend never uses supabase-js.
- **No em-dashes** in any user-facing copy.
- **Copy buttons** must show a "Copied!" confirmation animation.
- **No local server testing** of wired endpoints (build the server-side solution directly; verify via deploy/manual). Unit tests apply only to pure helpers, run with `node --test <file>`.
- **Location → ABC club map** (lowercased location name → club_number), verified present in data:
  `salem=30935, keizer=31599, eugene=7655, springfield=31598, clackamas=31600, milwaukie=31601, medford=32073`.
- **API base** on the frontend is `import.meta.env.VITE_API_URL`. The portal `api()` wrapper attaches the Bearer token; public endpoints must use a **separate no-auth fetch helper**.
- **Token idiom:** `crypto.randomBytes(24).toString('base64url')` (as in `auth/src/routes/launcher.js`).
- **Commit after every task.** Use `git add <specific paths>` then commit. End commit messages with:
  `Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>`

---

### Task 1: Migration — `tour_location_config` + `tour_intakes.tour_member`

**Files:**
- Create: `auth/migrations/068_tour_location_config.sql`
- Apply via: Supabase MCP `apply_migration`

**Interfaces:**
- Produces: table `tour_location_config(location_id uuid PK, public_token text unique, webhook_url text, day_one_base_url text, active bool, created_at, updated_at)`; column `tour_intakes.tour_member text`.

- [ ] **Step 1: Write the migration file**

`auth/migrations/068_tour_location_config.sql`:
```sql
-- Per-location config for the standalone Tour Check-In app:
-- the secret URL token, an outbound webhook, and the Day One booking base link.
CREATE TABLE IF NOT EXISTS tour_location_config (
  location_id      uuid PRIMARY KEY REFERENCES locations(id),
  public_token     text NOT NULL UNIQUE,
  webhook_url      text,
  day_one_base_url text,
  active           boolean NOT NULL DEFAULT true,
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.tour_location_config ENABLE ROW LEVEL SECURITY;

-- The ABC employee who ran the tour (captured at save; no logged-in staffer).
ALTER TABLE tour_intakes ADD COLUMN IF NOT EXISTS tour_member text;

-- Seed a token for every existing location. encode(gen_random_bytes(24),'hex')
-- gives a 48-char unguessable token; pgcrypto is already available in Supabase.
INSERT INTO tour_location_config (location_id, public_token)
SELECT id, encode(gen_random_bytes(24), 'hex')
FROM locations
ON CONFLICT (location_id) DO NOTHING;
```

- [ ] **Step 2: Apply via Supabase MCP**

Call `apply_migration` with project_id `ybopxxydsuwlbwxiuzve`, name `tour_location_config`, and the SQL above.

- [ ] **Step 3: Verify the table, seed, and column**

Run via `execute_sql`:
```sql
select count(*) as locations_seeded,
       count(*) filter (where length(public_token) = 48) as valid_tokens
from tour_location_config;
select column_name from information_schema.columns
where table_name='tour_intakes' and column_name='tour_member';
```
Expected: `locations_seeded = 7`, `valid_tokens = 7`, and one row for `tour_member`.

- [ ] **Step 4: Commit**

```bash
git add auth/migrations/068_tour_location_config.sql
git commit -m "feat(tours): migration for tour_location_config + tour_member"
```

---

### Task 2: Pure helpers — club map + webhook payload (TDD)

**Files:**
- Create: `auth/src/config/clubMap.js`
- Create: `auth/src/lib/tourWebhook.js`
- Test: `auth/src/config/clubMap.test.js`
- Test: `auth/src/lib/tourWebhook.test.js`

**Interfaces:**
- Produces: `clubNumberForLocationName(name) -> string|null`; `buildTourWebhookPayload(location, intake) -> object`.

- [ ] **Step 1: Write the failing test for clubMap**

`auth/src/config/clubMap.test.js`:
```javascript
const test = require('node:test')
const assert = require('node:assert')
const { clubNumberForLocationName } = require('./clubMap')

test('maps location names (case-insensitive) to club numbers', () => {
  assert.equal(clubNumberForLocationName('Salem'), '30935')
  assert.equal(clubNumberForLocationName('medford'), '32073')
  assert.equal(clubNumberForLocationName('  Eugene '), '7655')
})

test('returns null for unknown names', () => {
  assert.equal(clubNumberForLocationName('Portland'), null)
  assert.equal(clubNumberForLocationName(''), null)
  assert.equal(clubNumberForLocationName(null), null)
})
```

- [ ] **Step 2: Run test, verify it fails**

Run: `node --test auth/src/config/clubMap.test.js`
Expected: FAIL (Cannot find module './clubMap').

- [ ] **Step 3: Implement clubMap**

`auth/src/config/clubMap.js`:
```javascript
// Lowercased WCS location name -> ABC club number. The locations table does not
// carry the club number, so this is the canonical mapping for ABC-scoped queries
// (e.g. abc_employees). Mirrors ghl-sync/src/config/locations.js.
const NAME_TO_CLUB = {
  salem: '30935',
  keizer: '31599',
  eugene: '7655',
  springfield: '31598',
  clackamas: '31600',
  milwaukie: '31601',
  medford: '32073',
}

function clubNumberForLocationName(name) {
  if (!name) return null
  return NAME_TO_CLUB[name.trim().toLowerCase()] || null
}

module.exports = { clubNumberForLocationName, NAME_TO_CLUB }
```

- [ ] **Step 4: Run test, verify it passes**

Run: `node --test auth/src/config/clubMap.test.js`
Expected: PASS (2 tests).

- [ ] **Step 5: Write the failing test for tourWebhook**

`auth/src/lib/tourWebhook.test.js`:
```javascript
const test = require('node:test')
const assert = require('node:assert')
const { buildTourWebhookPayload } = require('./tourWebhook')

test('builds a flat outcome payload from location + intake', () => {
  const payload = buildTourWebhookPayload(
    { id: 'loc1', name: 'Salem' },
    { id: 'i1', contact_name: 'Jane Doe', contact_email: 'j@x.com',
      contact_phone: '+1555', tour_member: 'John S', outcome: 'Membership Sale',
      notes: 'great', completed_at: '2026-06-27T00:00:00Z' }
  )
  assert.deepEqual(payload, {
    location_id: 'loc1', location_name: 'Salem', intake_id: 'i1',
    contact_name: 'Jane Doe', contact_email: 'j@x.com', contact_phone: '+1555',
    tour_member: 'John S', outcome: 'Membership Sale', notes: 'great',
    completed_at: '2026-06-27T00:00:00Z',
  })
})
```

- [ ] **Step 6: Run test, verify it fails**

Run: `node --test auth/src/lib/tourWebhook.test.js`
Expected: FAIL (Cannot find module './tourWebhook').

- [ ] **Step 7: Implement tourWebhook**

`auth/src/lib/tourWebhook.js`:
```javascript
// Shape of the outbound webhook fired when a tour outcome is saved.
function buildTourWebhookPayload(location, intake) {
  return {
    location_id: location.id,
    location_name: location.name,
    intake_id: intake.id,
    contact_name: intake.contact_name || null,
    contact_email: intake.contact_email || null,
    contact_phone: intake.contact_phone || null,
    tour_member: intake.tour_member || null,
    outcome: intake.outcome || null,
    notes: intake.notes || null,
    completed_at: intake.completed_at || null,
  }
}

module.exports = { buildTourWebhookPayload }
```

- [ ] **Step 8: Run test, verify it passes**

Run: `node --test auth/src/lib/tourWebhook.test.js`
Expected: PASS (1 test).

- [ ] **Step 9: Commit**

```bash
git add auth/src/config/clubMap.js auth/src/config/clubMap.test.js auth/src/lib/tourWebhook.js auth/src/lib/tourWebhook.test.js
git commit -m "feat(tours): club map + webhook payload helpers"
```

---

### Task 3: Public router (no-auth, token-gated)

**Files:**
- Create: `auth/src/routes/publicTour.js`
- Modify: `auth/src/index.js` (mount the router)
- Reference: `auth/src/routes/tourIntake.js` (SELECT_COLS + status validation), `auth/src/services/supabase` (supabaseAdmin)

**Interfaces:**
- Consumes: `clubNumberForLocationName` (Task 2), `buildTourWebhookPayload` (Task 2).
- Produces: `GET /public/tour/:token`, `GET /public/tour/:token/employees`, `PATCH /public/tour/:token/intake/:id`.

- [ ] **Step 1: Implement the public router**

`auth/src/routes/publicTour.js`:
```javascript
const { Router } = require('express')
const { supabaseAdmin } = require('../services/supabase')
const { clubNumberForLocationName } = require('../config/clubMap')
const { buildTourWebhookPayload } = require('../lib/tourWebhook')

const router = Router()

// NOTE: this router is intentionally NOT behind the authenticate middleware.
// Access is gated entirely by the unguessable per-location public_token.

const SELECT_COLS =
  'id, received_at, ghl_contact_id, contact_name, contact_email, contact_phone, ' +
  'photo_base64, location_id, status, outcome, notes, tour_member, completed_at'

const ALLOWED_OUTCOMES = ['Membership Sale', 'Started Trial', 'Started VIP Pass', 'Only Tour']

// Resolve a token -> active config row (+ location). Returns null if not found.
async function resolveToken(token) {
  if (!token) return null
  const { data: cfg } = await supabaseAdmin
    .from('tour_location_config')
    .select('location_id, day_one_base_url, webhook_url, active')
    .eq('public_token', token)
    .maybeSingle()
  if (!cfg || !cfg.active) return null
  const { data: loc } = await supabaseAdmin
    .from('locations')
    .select('id, name')
    .eq('id', cfg.location_id)
    .maybeSingle()
  if (!loc) return null
  return { cfg, location: loc }
}

// GET /public/tour/:token -> location name, day one link, ready + completed queues
router.get('/:token', async (req, res) => {
  try {
    const ctx = await resolveToken(req.params.token)
    if (!ctx) return res.status(404).json({ error: 'not found' })

    const base = supabaseAdmin
      .from('tour_intakes')
      .select(SELECT_COLS)
      .eq('location_id', ctx.location.id)
      .order('received_at', { ascending: false })
      .limit(200)

    const { data: ready } = await base.eq('status', 'ready')
    const { data: completed } = await supabaseAdmin
      .from('tour_intakes')
      .select(SELECT_COLS)
      .eq('location_id', ctx.location.id)
      .eq('status', 'completed')
      .order('received_at', { ascending: false })
      .limit(200)

    res.json({
      location_name: ctx.location.name,
      day_one_base_url: ctx.cfg.day_one_base_url || null,
      ready: ready || [],
      completed: completed || [],
    })
  } catch (err) {
    console.error('[public-tour] list failed:', err.message)
    res.status(500).json({ error: 'internal error' })
  }
})

// GET /public/tour/:token/employees -> active ABC employees for the club, A-Z
router.get('/:token/employees', async (req, res) => {
  try {
    const ctx = await resolveToken(req.params.token)
    if (!ctx) return res.status(404).json({ error: 'not found' })
    const club = clubNumberForLocationName(ctx.location.name)
    if (!club) return res.json({ employees: [] })

    const { data } = await supabaseAdmin
      .from('abc_employees')
      .select('employee_id, full_name, first_name, last_name')
      .eq('club_number', club)
      .eq('status', 'active')
    const employees = (data || [])
      .map(e => ({
        id: e.employee_id,
        name: e.full_name || [e.first_name, e.last_name].filter(Boolean).join(' '),
      }))
      .filter(e => e.name)
      .sort((a, b) => a.name.localeCompare(b.name))
    res.json({ employees })
  } catch (err) {
    console.error('[public-tour] employees failed:', err.message)
    res.status(500).json({ error: 'internal error' })
  }
})

// PATCH /public/tour/:token/intake/:id -> save outcome, complete, fire webhook
router.patch('/:token/intake/:id', async (req, res) => {
  try {
    const ctx = await resolveToken(req.params.token)
    if (!ctx) return res.status(404).json({ error: 'not found' })

    const { tour_member, outcome, notes, status } = req.body || {}
    const newStatus = status === 'cancelled' ? 'cancelled' : 'completed'
    if (newStatus === 'completed' && !ALLOWED_OUTCOMES.includes(outcome)) {
      return res.status(400).json({ error: 'invalid outcome' })
    }

    // Confirm the intake belongs to this token's location before mutating.
    const { data: existing } = await supabaseAdmin
      .from('tour_intakes')
      .select('id, location_id')
      .eq('id', req.params.id)
      .maybeSingle()
    if (!existing || existing.location_id !== ctx.location.id) {
      return res.status(404).json({ error: 'not found' })
    }

    const updates = {
      status: newStatus,
      tour_member: tour_member || null,
      outcome: newStatus === 'completed' ? outcome : null,
      notes: notes || null,
      completed_at: new Date().toISOString(),
    }
    const { data: updated, error } = await supabaseAdmin
      .from('tour_intakes')
      .update(updates)
      .eq('id', req.params.id)
      .select(SELECT_COLS)
      .single()
    if (error) {
      console.error('[public-tour] update failed:', error.message)
      return res.status(500).json({ error: 'failed to save' })
    }

    // Fire the per-location webhook if configured (non-fatal, fire-and-forget).
    if (ctx.cfg.webhook_url && newStatus === 'completed') {
      const payload = buildTourWebhookPayload(ctx.location, updated)
      fetch(ctx.cfg.webhook_url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      }).catch(e => console.error('[public-tour] webhook post failed:', e.message))
    }

    res.json({ tour_intake: updated })
  } catch (err) {
    console.error('[public-tour] patch error:', err.message)
    res.status(500).json({ error: 'internal error' })
  }
})

module.exports = router
```

- [ ] **Step 2: Mount the router in `index.js`**

In `auth/src/index.js`, alongside the other `app.use(...)` route mounts (near the `app.use('/tour-intake', ...)` line), add:
```javascript
app.use('/public/tour', require('./routes/publicTour'))
```

- [ ] **Step 3: Verify the file parses**

Run: `node -e "require('./auth/src/routes/publicTour.js'); console.log('ok')"`
Expected: prints `ok` (no syntax/require errors). Note: this loads the module; it does not start the server.

- [ ] **Step 4: Commit**

```bash
git add auth/src/routes/publicTour.js auth/src/index.js
git commit -m "feat(tours): public token-gated tour-intake router"
```

---

### Task 4: Admin router for per-location config

**Files:**
- Create: `auth/src/routes/tourAdmin.js`
- Modify: `auth/src/index.js` (mount the router)
- Reference: `auth/src/routes/admin.js` (authenticate + requireRole pattern), `auth/src/middleware/role` (requireRole), `auth/src/middleware/auth` (authenticate)

**Interfaces:**
- Produces: `GET /admin/tour-locations`, `PUT /admin/tour-locations/:locationId`, `POST /admin/tour-locations/:locationId/regenerate-token`.

- [ ] **Step 1: Implement the admin router**

`auth/src/routes/tourAdmin.js`:
```javascript
const { Router } = require('express')
const crypto = require('crypto')
const { supabaseAdmin } = require('../services/supabase')
const authenticate = require('../middleware/auth')
const { requireRole } = require('../middleware/role')

const router = Router()
router.use(authenticate)
router.use(requireRole('admin'))

function newToken() {
  return crypto.randomBytes(24).toString('base64url')
}

// GET /admin/tour-locations -> every location joined with its tour config
router.get('/', async (req, res) => {
  try {
    const { data: locations } = await supabaseAdmin
      .from('locations')
      .select('id, name')
      .order('name')
    const { data: configs } = await supabaseAdmin
      .from('tour_location_config')
      .select('location_id, public_token, webhook_url, day_one_base_url, active')
    const byLoc = Object.fromEntries((configs || []).map(c => [c.location_id, c]))

    const rows = (locations || []).map(loc => ({
      location_id: loc.id,
      name: loc.name,
      public_token: byLoc[loc.id]?.public_token || null,
      webhook_url: byLoc[loc.id]?.webhook_url || '',
      day_one_base_url: byLoc[loc.id]?.day_one_base_url || '',
      active: byLoc[loc.id]?.active ?? true,
    }))
    res.json({ locations: rows })
  } catch (err) {
    console.error('[tour-admin] list failed:', err.message)
    res.status(500).json({ error: 'Failed to load tour locations' })
  }
})

// PUT /admin/tour-locations/:locationId -> upsert webhook + day one link + active
router.put('/:locationId', async (req, res) => {
  try {
    const { webhook_url, day_one_base_url, active } = req.body || {}
    const patch = {
      location_id: req.params.locationId,
      webhook_url: webhook_url || null,
      day_one_base_url: day_one_base_url || null,
      active: active !== false,
      updated_at: new Date().toISOString(),
    }
    // Ensure a token exists for upsert (a location added after migration 068).
    const { data: existing } = await supabaseAdmin
      .from('tour_location_config')
      .select('public_token')
      .eq('location_id', req.params.locationId)
      .maybeSingle()
    if (!existing) patch.public_token = newToken()

    const { error } = await supabaseAdmin
      .from('tour_location_config')
      .upsert(patch, { onConflict: 'location_id' })
    if (error) return res.status(500).json({ error: 'Failed to save' })
    res.json({ message: 'Saved' })
  } catch (err) {
    console.error('[tour-admin] save failed:', err.message)
    res.status(500).json({ error: 'Failed to save' })
  }
})

// POST /admin/tour-locations/:locationId/regenerate-token -> new secret URL
router.post('/:locationId/regenerate-token', async (req, res) => {
  try {
    const token = newToken()
    const { error } = await supabaseAdmin
      .from('tour_location_config')
      .upsert(
        { location_id: req.params.locationId, public_token: token, updated_at: new Date().toISOString() },
        { onConflict: 'location_id' }
      )
    if (error) return res.status(500).json({ error: 'Failed to regenerate' })
    res.json({ public_token: token })
  } catch (err) {
    console.error('[tour-admin] regenerate failed:', err.message)
    res.status(500).json({ error: 'Failed to regenerate' })
  }
})

module.exports = router
```

- [ ] **Step 2: Mount in `index.js`**

In `auth/src/index.js`, near the other admin mount (`app.use('/admin', require('./routes/admin'))`), add AFTER it:
```javascript
app.use('/admin/tour-locations', require('./routes/tourAdmin'))
```
(Express matches the more specific path on this router first for its own routes; the existing `/admin` router has no `/tour-locations` route so there is no collision.)

- [ ] **Step 3: Verify the file parses**

Run: `node -e "require('./auth/src/routes/tourAdmin.js'); console.log('ok')"`
Expected: prints `ok`.

- [ ] **Step 4: Commit**

```bash
git add auth/src/routes/tourAdmin.js auth/src/index.js
git commit -m "feat(tours): admin router for per-location tour config"
```

---

### Task 5: Frontend API helpers

**Files:**
- Modify: `portal/src/lib/api.js`

**Interfaces:**
- Consumes the existing `API_URL` constant and `api()` wrapper in `api.js`.
- Produces: `publicTour.get(token)`, `publicTour.employees(token)`, `publicTour.saveOutcome(token, id, body)`; `tourAdmin.list()`, `tourAdmin.update(locationId, body)`, `tourAdmin.regenerate(locationId)`.

- [ ] **Step 1: Add a no-auth public fetch + public helpers**

Append to `portal/src/lib/api.js` (after the existing tour-intake helpers near line 927). `API_URL` is already defined at the top of the file:
```javascript
// --- Standalone Tour Check-In: PUBLIC endpoints (no auth token) ---
async function publicFetch(path, options = {}) {
  const headers = { 'Content-Type': 'application/json', ...(options.headers || {}) }
  const res = await fetch(API_URL + path, { ...options, headers })
  if (!res.ok) {
    let msg = 'Request failed'
    try { msg = (await res.json()).error || msg } catch {}
    throw new Error(msg)
  }
  return res.json()
}

export const publicTour = {
  get: (token) => publicFetch(`/public/tour/${token}`),
  employees: (token) => publicFetch(`/public/tour/${token}/employees`),
  saveOutcome: (token, id, body) =>
    publicFetch(`/public/tour/${token}/intake/${id}`, {
      method: 'PATCH',
      body: JSON.stringify(body),
    }),
}
```

- [ ] **Step 2: Add admin helpers (authed via existing `api()`)**

Append after the block from Step 1:
```javascript
// --- Tour Check-In admin (authed) ---
export const tourAdmin = {
  list: () => api('/admin/tour-locations'),
  update: (locationId, body) =>
    api('/admin/tour-locations/' + locationId, { method: 'PUT', body: JSON.stringify(body) }),
  regenerate: (locationId) =>
    api('/admin/tour-locations/' + locationId + '/regenerate-token', { method: 'POST' }),
}
```

- [ ] **Step 3: Verify the build is not broken**

Run: `cd portal && npm run build`
Expected: build succeeds (Vite produces `dist/` with no errors).

- [ ] **Step 4: Commit**

```bash
git add portal/src/lib/api.js
git commit -m "feat(tours): frontend public + admin API helpers"
```

---

### Task 6: Day One prefill util (frontend)

**Files:**
- Create: `portal/src/lib/dayOnePrefill.js`

**Interfaces:**
- Produces: `buildDayOneUrl(baseUrl, { name, email, phone, tourMember }) -> string`.

- [ ] **Step 1: Implement the prefill builder**

`portal/src/lib/dayOnePrefill.js`:
```javascript
// Append GHL booking-widget prefill params to a location's Day One base link.
// GHL reliably honors first_name/last_name/email/phone. The team-member param
// name is unconfirmed across calendars, so we pass a best-effort `team_member`
// AND the raw tour member as a query hint; harmless if ignored. Verify against a
// real Day One link once one is entered in the admin page (see plan known-unknowns).
export function buildDayOneUrl(baseUrl, { name, email, phone, tourMember } = {}) {
  if (!baseUrl) return ''
  let url
  try {
    url = new URL(baseUrl)
  } catch {
    return baseUrl
  }
  const parts = (name || '').trim().split(/\s+/).filter(Boolean)
  const first = parts[0] || ''
  const last = parts.length > 1 ? parts.slice(1).join(' ') : ''
  const set = (k, v) => { if (v) url.searchParams.set(k, v) }
  set('first_name', first)
  set('last_name', last)
  set('email', email)
  set('phone', phone)
  set('team_member', tourMember)
  return url.toString()
}
```

- [ ] **Step 2: Verify it parses via the build**

Run: `cd portal && npm run build`
Expected: build succeeds.

- [ ] **Step 3: Commit**

```bash
git add portal/src/lib/dayOnePrefill.js
git commit -m "feat(tours): Day One calendar prefill URL builder"
```

---

### Task 7: Standalone check-in app component

**Files:**
- Create: `portal/src/tour/TourCheckinApp.jsx`
- Reference: `portal/src/mobile/components/MobileTourCheckin.jsx` (avatar/initials/timeAgo helpers to reuse), `portal/src/lib/dayOnePrefill.js` (Task 6), `portal/src/lib/api.js` (`publicTour`, Task 5)

**Interfaces:**
- Consumes: `publicTour` (Task 5), `buildDayOneUrl` (Task 6).
- Produces: default-exported `TourCheckinApp({ token })` React component.

- [ ] **Step 1: Implement the component**

`portal/src/tour/TourCheckinApp.jsx`:
```jsx
import React, { useState, useEffect, useCallback, useRef } from 'react'
import { publicTour } from '../lib/api'
import { buildDayOneUrl } from '../lib/dayOnePrefill'

const OUTCOMES = ['Membership Sale', 'Started Trial', 'Started VIP Pass', 'Only Tour']
const REFRESH_MS = 20000

function capitalize(s) {
  if (!s) return ''
  return s.split(' ').map(w => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase()).join(' ')
}
function initials(name) {
  const p = (name || '').trim().split(/\s+/).filter(Boolean)
  if (!p.length) return '?'
  if (p.length === 1) return p[0][0].toUpperCase()
  return (p[0][0] + p[p.length - 1][0]).toUpperCase()
}
function timeAgo(iso) {
  if (!iso) return ''
  const m = Math.floor((Date.now() - new Date(iso).getTime()) / 60000)
  if (m < 1) return 'just now'
  if (m < 60) return `${m}m ago`
  const h = Math.floor(m / 60)
  if (h < 24) return `${h}h ago`
  return new Date(iso).toLocaleDateString()
}
const AVATAR_COLORS = ['bg-red-100 text-red-700','bg-blue-100 text-blue-700','bg-green-100 text-green-700','bg-purple-100 text-purple-700','bg-amber-100 text-amber-700','bg-teal-100 text-teal-700']
function avatarColor(name) {
  let h = 0
  for (let i = 0; i < (name || '').length; i++) h = (h * 31 + name.charCodeAt(i)) % AVATAR_COLORS.length
  return AVATAR_COLORS[h]
}
// Larger avatar than the old mobile tile (w-16 default) for readability on iPad.
function Avatar({ name, photo, size = 'w-16 h-16' }) {
  if (photo) return <img src={photo} alt={name || ''} className={`${size} rounded-full object-cover bg-gray-100`} />
  return <div className={`${size} rounded-full flex items-center justify-center font-bold text-xl ${avatarColor(name)}`}>{initials(name)}</div>
}

export default function TourCheckinApp({ token }) {
  const [data, setData] = useState({ location_name: '', day_one_base_url: null, ready: [], completed: [] })
  const [tab, setTab] = useState('ready')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [selected, setSelected] = useState(null)

  const load = useCallback(async (opts = {}) => {
    if (!opts.silent) setLoading(true)
    setError('')
    try {
      setData(await publicTour.get(token))
    } catch (e) {
      setError(e.message || 'Failed to load')
    } finally {
      setLoading(false)
    }
  }, [token])

  useEffect(() => { load() }, [load])
  const ref = useRef(load); ref.current = load
  useEffect(() => {
    const id = setInterval(() => ref.current({ silent: true }), REFRESH_MS)
    return () => clearInterval(id)
  }, [])

  const list = tab === 'ready' ? data.ready : data.completed

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Light header bar with dark text (fixes unreadable-on-dark title). */}
      <div className="bg-white border-b border-gray-200 px-5 py-4 sticky top-0 z-10">
        <h1 className="text-2xl font-bold text-gray-900">Tour Check-In</h1>
        <p className="text-sm text-gray-500">{data.location_name || 'Front desk'}</p>
      </div>

      <div className="px-5 py-5 max-w-2xl mx-auto">
        <div className="flex gap-1 bg-gray-200 rounded-lg p-1 mb-5">
          {['ready', 'completed'].map(t => (
            <button key={t} onClick={() => setTab(t)}
              className={`flex-1 px-3 py-2.5 rounded-md text-base font-medium capitalize transition-colors ${tab === t ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500'}`}>
              {t}{t === 'ready' && data.ready.length ? ` (${data.ready.length})` : ''}
            </button>
          ))}
        </div>

        {error && <p className="text-sm text-red-600 mb-3">{error}</p>}
        {loading && <p className="text-center text-gray-400 py-10">Loading…</p>}

        {!loading && list.length === 0 && (
          <div className="bg-white border border-gray-200 rounded-2xl p-10 text-center text-gray-400">
            {tab === 'ready' ? 'No one waiting for a tour right now.' : 'No completed tours yet.'}
          </div>
        )}

        {!loading && (
          <div className="space-y-4">
            {list.map(intake => (
              <button key={intake.id} onClick={() => setSelected(intake)}
                className="w-full text-left bg-white border border-gray-200 rounded-2xl p-5 flex items-center gap-5 active:scale-[0.99] transition-transform shadow-sm">
                <Avatar name={intake.contact_name} photo={intake.photo_base64} />
                <div className="flex-1 min-w-0">
                  <p className="font-semibold text-lg text-gray-900 truncate">{capitalize(intake.contact_name) || 'Unknown'}</p>
                  {intake.contact_phone && <p className="text-sm text-gray-500 truncate">{intake.contact_phone}</p>}
                  {intake.contact_email && <p className="text-sm text-gray-500 truncate">{intake.contact_email}</p>}
                </div>
                <div className="shrink-0 text-right">
                  {tab === 'ready'
                    ? <span className="inline-block px-3 py-1 rounded-full text-xs font-semibold bg-green-50 text-green-700 border border-green-200">Ready for a tour</span>
                    : intake.outcome && <span className="inline-block px-3 py-1 rounded-full text-xs font-semibold bg-gray-50 text-gray-700 border border-gray-200">{intake.outcome}</span>}
                  <p className="text-xs text-gray-400 mt-1">{timeAgo(intake.received_at)}</p>
                </div>
              </button>
            ))}
          </div>
        )}
      </div>

      {selected && (
        <OutcomeModal
          token={token}
          intake={selected}
          dayOneBaseUrl={data.day_one_base_url}
          readOnly={tab === 'completed'}
          onClose={() => setSelected(null)}
          onSaved={() => { setSelected(null); load({ silent: true }) }}
        />
      )}
    </div>
  )
}

function OutcomeModal({ token, intake, dayOneBaseUrl, readOnly, onClose, onSaved }) {
  const [employees, setEmployees] = useState([])
  const [tourMember, setTourMember] = useState('')        // asked every tour
  const [outcome, setOutcome] = useState(intake.outcome || '')
  const [notes, setNotes] = useState(intake.notes || '')
  const [showDayOne, setShowDayOne] = useState(false)
  const [iframeFailed, setIframeFailed] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    if (readOnly) return
    publicTour.employees(token).then(r => setEmployees(r.employees || [])).catch(() => {})
  }, [token, readOnly])

  const dayOneUrl = buildDayOneUrl(dayOneBaseUrl, {
    name: intake.contact_name, email: intake.contact_email,
    phone: intake.contact_phone, tourMember,
  })

  async function save() {
    setSaving(true); setError('')
    try {
      await publicTour.saveOutcome(token, intake.id, { tour_member: tourMember, outcome, notes, status: 'completed' })
      onSaved()
    } catch (e) {
      setError(e.message || 'Failed to save'); setSaving(false)
    }
  }

  return (
    <div className="fixed inset-0 bg-white z-[60] flex flex-col">
      <div className="flex items-center gap-3 px-5 py-4 border-b border-gray-200">
        <Avatar name={intake.contact_name} photo={intake.photo_base64} size="w-12 h-12" />
        <div className="flex-1 min-w-0">
          <h2 className="text-lg font-semibold text-gray-900 truncate">{capitalize(intake.contact_name) || 'Unknown'}</h2>
          {intake.contact_phone && <p className="text-xs text-gray-500 truncate">{intake.contact_phone}</p>}
        </div>
        <button onClick={onClose} className="w-10 h-10 flex items-center justify-center rounded-lg active:bg-gray-100" aria-label="Close">
          <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor" className="w-5 h-5 text-gray-900"><path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" /></svg>
        </button>
      </div>

      <div className="flex-1 overflow-y-auto px-5 py-6 space-y-6 max-w-2xl mx-auto w-full">
        {!readOnly && (
          <div>
            <label className="block text-sm font-semibold text-gray-900 mb-2">Tour member</label>
            <select value={tourMember} onChange={e => setTourMember(e.target.value)}
              className="w-full rounded-xl border border-gray-300 bg-white px-3 py-3 text-base text-gray-900 focus:outline-none focus:border-red-500">
              <option value="">Select who gave the tour…</option>
              {employees.map(e => <option key={e.id} value={e.name}>{e.name}</option>)}
            </select>
          </div>
        )}

        <div>
          <label className="block text-sm font-semibold text-gray-900 mb-2">Tour outcome</label>
          <div className="grid grid-cols-2 gap-2">
            {OUTCOMES.map(o => (
              <button key={o} disabled={readOnly} onClick={() => setOutcome(o)}
                className={`px-3 py-3 rounded-xl text-sm font-medium border transition-colors ${outcome === o ? 'bg-red-600 text-white border-red-600' : 'bg-white text-gray-700 border-gray-300'} ${readOnly ? 'opacity-70' : 'active:scale-95'}`}>
                {o}
              </button>
            ))}
          </div>
        </div>

        {!readOnly && dayOneBaseUrl && (
          <div>
            <label className="block text-sm font-semibold text-gray-900 mb-2">Book Day One</label>
            <button onClick={() => { setShowDayOne(true); setIframeFailed(false) }}
              className="w-full py-3 rounded-xl border border-red-300 text-red-600 font-medium active:scale-[0.99]">
              Open Day One calendar
            </button>
          </div>
        )}

        <div>
          <label className="block text-sm font-semibold text-gray-900 mb-2">Notes</label>
          <textarea value={notes} onChange={e => setNotes(e.target.value)} readOnly={readOnly} rows={5}
            placeholder="Questions they had, follow-ups, anything worth remembering…"
            className="w-full rounded-xl border border-gray-300 bg-white px-3 py-2 text-base text-gray-900 placeholder:text-gray-400 focus:outline-none focus:border-red-500" />
        </div>

        {error && <p className="text-sm text-red-600">{error}</p>}
      </div>

      {!readOnly && (
        <div className="border-t border-gray-200 p-4" style={{ paddingBottom: 'calc(env(safe-area-inset-bottom, 0px) + 1rem)' }}>
          <button onClick={save} disabled={saving || !outcome}
            className="w-full py-3.5 rounded-xl bg-red-600 text-white font-semibold disabled:opacity-50 active:scale-[0.99]">
            {saving ? 'Saving…' : 'Save & complete tour'}
          </button>
        </div>
      )}

      {showDayOne && (
        <div className="fixed inset-0 bg-black/40 z-[70] flex flex-col justify-end">
          <div className="bg-white rounded-t-2xl h-[88vh] flex flex-col">
            <div className="flex items-center justify-between px-4 py-3 border-b border-gray-200">
              <span className="font-semibold text-gray-900">Book Day One</span>
              <div className="flex items-center gap-3">
                <a href={dayOneUrl} target="_blank" rel="noreferrer" className="text-sm text-red-600 font-medium">Open in new tab</a>
                <button onClick={() => setShowDayOne(false)} className="text-sm text-gray-500">Done</button>
              </div>
            </div>
            {iframeFailed
              ? <div className="flex-1 flex items-center justify-center text-center text-gray-500 px-6">
                  <p>This calendar can't be embedded. Use <a href={dayOneUrl} target="_blank" rel="noreferrer" className="text-red-600 underline">Open in new tab</a>.</p>
                </div>
              : <iframe title="Day One" src={dayOneUrl} className="flex-1 w-full" onError={() => setIframeFailed(true)} />}
          </div>
        </div>
      )}
    </div>
  )
}
```

- [ ] **Step 2: Verify the build**

Run: `cd portal && npm run build`
Expected: build succeeds.

- [ ] **Step 3: Commit**

```bash
git add portal/src/tour/TourCheckinApp.jsx
git commit -m "feat(tours): standalone Tour Check-In app component"
```

---

### Task 8: Public route wiring + remove the mobile tile

**Files:**
- Modify: `portal/src/App.jsx` (mount `/tour/:token` before the auth gate)
- Modify: `portal/src/mobile/MobileApp.jsx` (remove `tour-checkin` case + unused `TourIcon`)
- Modify: `portal/src/mobile/components/HomeScreen.jsx` (remove the tile)
- Delete: `portal/src/mobile/components/MobileTourCheckin.jsx`

**Interfaces:**
- Consumes: `TourCheckinApp` (Task 7).

- [ ] **Step 1: Mount the public route in `App.jsx`**

At the very top of the `App` component's render logic, BEFORE the `if (!user)` auth gate (around App.jsx line 269), add a public-path short-circuit. Add the import at the top of the file:
```jsx
import TourCheckinApp from './tour/TourCheckinApp'
```
Then, before any auth/`getMe` gating returns, add:
```jsx
// Public, login-free Tour Check-In app: /tour/:token. Must short-circuit before
// the auth gate so it never requires a logged-in staffer.
const tourMatch = window.location.pathname.match(/^\/tour\/([^/]+)\/?$/)
if (tourMatch) {
  return <TourCheckinApp token={tourMatch[1]} />
}
```
Place this near the start of the render (it must execute regardless of `user`/token state). If the auth bootstrap runs in a `useEffect` that calls `getMe()` on mount, also guard that effect so it does not run on the `/tour/` path:
```jsx
if (window.location.pathname.startsWith('/tour/')) return
```
(Add that guard as the first line inside the mount effect that calls `getMe()`.)

- [ ] **Step 2: Remove the mobile route case + icon**

In `portal/src/mobile/MobileApp.jsx`:
- Delete the route case (around line 495):
```jsx
case 'tour-checkin': return <MobileTourCheckin user={user} />
```
- Delete the `MobileTourCheckin` import at the top of the file.
- Delete the `TourIcon` function (around lines 101-107) and confirm via search it is not referenced elsewhere:
  Run: `grep -rn "TourIcon" portal/src` → expected: no remaining references after deletion.

- [ ] **Step 3: Remove the Home tile**

In `portal/src/mobile/components/HomeScreen.jsx`, delete the tile entry (around line 153):
```jsx
{ label: 'Tour Check-In', icon: <TourIcon />, route: 'tour-checkin', desc: 'Front-desk tour queue' },
```
If `TourIcon` was imported/defined here too, remove it. Run `grep -rn "tour-checkin" portal/src` → expected: no remaining references.

- [ ] **Step 4: Delete the old component**

```bash
git rm portal/src/mobile/components/MobileTourCheckin.jsx
```

- [ ] **Step 5: Verify the build**

Run: `cd portal && npm run build`
Expected: build succeeds with no unresolved imports.

- [ ] **Step 6: Commit**

```bash
git add portal/src/App.jsx portal/src/mobile/MobileApp.jsx portal/src/mobile/components/HomeScreen.jsx
git commit -m "feat(tours): mount public /tour/:token route; remove mobile tile"
```

---

### Task 9: Admin page UI

**Files:**
- Create: `portal/src/components/admin/TourCheckinLocations.jsx`
- Modify: the admin panel that renders admin sub-pages (locate via `grep -rn "OnlineJoinLocations" portal/src` — register the new page the same way, e.g. a nav entry + route/section)
- Reference: `portal/src/components/admin/OnlineJoinLocations.jsx` (structure), `portal/src/lib/api.js` (`tourAdmin`, Task 5)

**Interfaces:**
- Consumes: `tourAdmin` (Task 5).

- [ ] **Step 1: Implement the admin page**

`portal/src/components/admin/TourCheckinLocations.jsx`:
```jsx
import React, { useState, useEffect } from 'react'
import { tourAdmin } from '../../lib/api'

function checkinUrl(token) {
  return token ? `${window.location.origin}/tour/${token}` : ''
}

export default function TourCheckinLocations() {
  const [rows, setRows] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  async function load() {
    setLoading(true); setError('')
    try {
      const r = await tourAdmin.list()
      setRows(r.locations || [])
    } catch (e) {
      setError(e.message || 'Failed to load')
    } finally {
      setLoading(false)
    }
  }
  useEffect(() => { load() }, [])

  if (loading) return <p className="text-text-muted text-sm p-4">Loading…</p>
  if (error) return <p className="text-wcs-red text-sm p-4">{error}</p>

  return (
    <div className="space-y-4 p-4">
      <div>
        <h2 className="text-xl font-bold text-text-primary">Tour Check-In</h2>
        <p className="text-sm text-text-muted">Per-location check-in app link, outbound webhook, and Day One calendar link.</p>
      </div>
      {rows.map(row => (
        <LocationCard key={row.location_id} row={row} onChanged={load} />
      ))}
    </div>
  )
}

function LocationCard({ row, onChanged }) {
  const [webhook, setWebhook] = useState(row.webhook_url || '')
  const [dayOne, setDayOne] = useState(row.day_one_base_url || '')
  const [token, setToken] = useState(row.public_token)
  const [saving, setSaving] = useState(false)
  const [copied, setCopied] = useState(false)
  const [msg, setMsg] = useState('')

  const url = checkinUrl(token)

  async function copy() {
    try {
      await navigator.clipboard.writeText(url)
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    } catch {}
  }
  async function save() {
    setSaving(true); setMsg('')
    try {
      await tourAdmin.update(row.location_id, { webhook_url: webhook, day_one_base_url: dayOne, active: true })
      setMsg('Saved')
      setTimeout(() => setMsg(''), 1500)
    } catch (e) {
      setMsg(e.message || 'Failed')
    } finally { setSaving(false) }
  }
  async function regenerate() {
    if (!window.confirm('Regenerate this location\'s check-in link? The old URL will stop working.')) return
    try {
      const r = await tourAdmin.regenerate(row.location_id)
      setToken(r.public_token)
      onChanged()
    } catch (e) { setMsg(e.message || 'Failed') }
  }

  return (
    <div className="bg-surface border border-border rounded-2xl p-4 space-y-3">
      <h3 className="font-semibold text-text-primary">{row.name}</h3>

      <div>
        <label className="block text-xs font-medium text-text-muted mb-1">Check-in app URL</label>
        <div className="flex gap-2">
          <input readOnly value={url} className="flex-1 rounded-lg border border-border bg-bg px-3 py-2 text-sm text-text-primary" />
          <button onClick={copy} className="px-3 py-2 rounded-lg bg-wcs-red text-white text-sm font-medium min-w-[84px]">
            {copied ? 'Copied!' : 'Copy'}
          </button>
          <button onClick={regenerate} className="px-3 py-2 rounded-lg border border-border text-text-muted text-sm">Regenerate</button>
        </div>
      </div>

      <div>
        <label className="block text-xs font-medium text-text-muted mb-1">Day One base calendar link</label>
        <input value={dayOne} onChange={e => setDayOne(e.target.value)} placeholder="https://…/widget/booking/…"
          className="w-full rounded-lg border border-border bg-surface px-3 py-2 text-sm text-text-primary" />
      </div>

      <div>
        <label className="block text-xs font-medium text-text-muted mb-1">Outbound webhook URL (optional)</label>
        <input value={webhook} onChange={e => setWebhook(e.target.value)} placeholder="https://…"
          className="w-full rounded-lg border border-border bg-surface px-3 py-2 text-sm text-text-primary" />
      </div>

      <div className="flex items-center gap-3">
        <button onClick={save} disabled={saving} className="px-4 py-2 rounded-lg bg-wcs-red text-white text-sm font-semibold disabled:opacity-50">
          {saving ? 'Saving…' : 'Save'}
        </button>
        {msg && <span className="text-sm text-text-muted">{msg}</span>}
      </div>
    </div>
  )
}
```

- [ ] **Step 2: Register the page in the admin panel**

Run: `grep -rn "OnlineJoinLocations" portal/src` to find where admin sub-pages are imported and rendered (an admin nav list + a switch/section render). Add `TourCheckinLocations` the same way: import it, add a nav entry labeled "Tour Check-In", and render `<TourCheckinLocations />` in the matching section. Mirror the exact pattern used for `OnlineJoinLocations` in that file.

- [ ] **Step 3: Verify the build**

Run: `cd portal && npm run build`
Expected: build succeeds.

- [ ] **Step 4: Commit**

```bash
git add portal/src/components/admin/TourCheckinLocations.jsx <admin panel file modified in step 2>
git commit -m "feat(tours): admin page for per-location tour config"
```

---

### Task 10: Docs + final verification

**Files:**
- Modify: `docs/tour-checkin-module.md`

- [ ] **Step 1: Update the module doc**

Rewrite `docs/tour-checkin-module.md` to describe the standalone app: the `/tour/:token` public URL model, the new outcome set, the Tour Member dropdown (ABC employees by club), the Book Day One step, the outbound webhook, and the admin page. Note migration 068 is applied. Remove now-inaccurate statements about the in-portal mobile tile.

- [ ] **Step 2: Full frontend build check**

Run: `cd portal && npm run build`
Expected: build succeeds.

- [ ] **Step 3: Run all backend unit tests**

Run: `node --test auth/src/config/clubMap.test.js auth/src/lib/tourWebhook.test.js`
Expected: all PASS.

- [ ] **Step 4: Module-load check for new routers**

Run: `node -e "require('./auth/src/routes/publicTour.js'); require('./auth/src/routes/tourAdmin.js'); console.log('ok')"`
Expected: prints `ok`.

- [ ] **Step 5: Commit**

```bash
git add docs/tour-checkin-module.md
git commit -m "docs(tours): document standalone Tour Check-In app"
```

- [ ] **Step 6: Push branch and open PR**

```bash
git push -u origin feat/tour-checkin-standalone
gh pr create --base master --head feat/tour-checkin-standalone \
  --title "feat(tours): standalone public Tour Check-In app" \
  --body "See docs/superpowers/specs/2026-06-27-tour-checkin-standalone-design.md"
```

---

## Post-merge manual steps (do NOT skip)

1. **Deploy** the auth service and portal (Render auto-deploys on master merge).
2. In **Admin → Tour Check-In**, paste each location's **Day One base link** and copy its **check-in URL** onto that gym's iPad.
3. **Verify the Day One team-member prefill param** against a real Day One link; if GHL uses a different field name than `team_member`, adjust `buildDayOneUrl` in `portal/src/lib/dayOnePrefill.js` (same approach used to confirm the photo field).
4. If a Day One calendar refuses to embed (blank iframe), the **Open in new tab** fallback is already present; no code change needed.

## Self-Review notes (completed)

- **Spec coverage:** access model (Task 1/3/8), Tour Member from ABC employees (Task 3 employees endpoint + Task 7 dropdown), outcome set (Task 3 ALLOWED_OUTCOMES + Task 7 OUTCOMES), Book Day One iframe + fallback (Task 6/7), webhook on save (Task 2/3), remove mobile tile (Task 8), admin page incl. URL/regenerate/webhook/Day One (Task 4/9), readable header + larger tiles (Task 7). All covered.
- **Type consistency:** `publicTour.get/employees/saveOutcome`, `tourAdmin.list/update/regenerate`, `buildDayOneUrl`, `buildTourWebhookPayload`, `clubNumberForLocationName` used consistently across tasks.
- **Known-unknowns** (Day One param name, iframe embedding) are isolated to `buildDayOneUrl` + the iframe fallback and documented as post-merge steps.
