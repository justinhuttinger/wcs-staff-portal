# WCS Marketing Mastermind — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the ClickUp-driven Marketing Mastermind described in `docs/superpowers/specs/2026-05-21-wcs-marketing-mastermind-design.md`. Phase 1 MVP delivers webhook + queue + processor + the `Draft` mode end-to-end so a real ClickUp task can round-trip. Subsequent sections add remaining modes, rhythms, dashboard, and provisioning.

**Architecture:** ClickUp webhook → `wcs-staff-portal/auth` Express endpoint → Supabase `mastermind_queue` table → in-process Node.js polling worker (lives inside auth, started by `node-cron`) → posts back to ClickUp via API. Single repo, single Render service. Anthropic API access via `@anthropic-ai/sdk` (new dependency).

**Tech Stack:** Express 4 (existing), `@supabase/supabase-js` (existing), `@anthropic-ai/sdk` (new), `node-cron` (existing), Supabase Postgres (existing — schema via Supabase MCP `apply_migration`), ClickUp REST API v2.

**Conventions in this codebase (verified during planning):**
- No automated test framework exists in `auth/`. Verification is via manual smoke tests against the running service plus Codex code review after builds (per Justin's workflow).
- Routes are file-per-feature under `auth/src/routes/`. Mounted in `auth/src/index.js`.
- Database access uses `supabaseAdmin` from `auth/src/services/supabase.js`.
- Auth middleware: `auth/src/middleware/auth.js` + `auth/src/middleware/role.js`.
- Webhook endpoints (no JWT) live alongside other public webhooks already mounted at `/webhooks` (e.g., `metaCapi.js`).

**Plan structure:** Sections 0–9 deliver the MVP (webhook → queue → processor → Draft mode round-trip). Sections 10–18 extend to full spec scope. Execute in order; do not skip ahead unless a step is clearly noted as deferrable.

**What this plan does NOT do (manual steps for Justin):**
1. Create the ClickUp "WCS Marketing" space (or run the provisioning script in Section 18 against production)
2. Generate a dedicated `wcs-mastermind` Anthropic API key
3. Register ClickUp webhooks pointing at production
4. Flip `MASTERMIND_ENABLED=true` on the Render auth service
5. Open / merge any PRs produced by this plan (Justin is merger of record)

---

## Section 0 — Setup

### Task 0.1: Add `@anthropic-ai/sdk` dependency to auth service

**Files:**
- Modify: `auth/package.json`

- [ ] **Step 1: Inspect current dependencies block**

Run from worktree root:
```bash
cd auth && cat package.json | grep -A1 "anthropic"
```
Expected: no match (dependency not present).

- [ ] **Step 2: Install the SDK**

```bash
cd auth && pnpm add @anthropic-ai/sdk
```
Expected: `package.json` now contains `"@anthropic-ai/sdk": "^x.y.z"` under dependencies; `pnpm-lock.yaml` updated.

- [ ] **Step 3: Verify it loads**

```bash
cd auth && node -e "const Anthropic = require('@anthropic-ai/sdk'); console.log(typeof Anthropic.default)"
```
Expected: `function`.

- [ ] **Step 4: Commit**

```bash
git add auth/package.json pnpm-lock.yaml
git commit -m "chore(auth): add @anthropic-ai/sdk dependency for mastermind"
```

---

## Section 1 — Supabase schema

### Task 1.1: Create `mastermind_queue` and `mastermind_errors` tables

**Migration applied via Supabase MCP `apply_migration` (not a file in this repo).**

- [ ] **Step 1: Apply the migration**

Use Supabase MCP `apply_migration` with migration name `mastermind_queue_init` and SQL:

```sql
-- mastermind_queue: one row per Mastermind invocation request
create table public.mastermind_queue (
  id uuid primary key default gen_random_uuid(),
  task_id text not null,                        -- ClickUp task ID
  list_id text not null,                        -- ClickUp list ID for context
  lane text,                                    -- e.g. 'inbox', 'campaigns', 'channels.email', etc.
  mode text not null,                           -- 'brief_me' | 'strategize' | 'analyze' | 'draft' | 'review' | 'wrap_up' | 'continue'
  requested_by text,                            -- ClickUp user ID who triggered
  requested_at timestamptz not null default now(),
  status text not null default 'pending',       -- 'pending' | 'working' | 'done' | 'failed' | 'cancelled'
  started_at timestamptz,
  completed_at timestamptz,
  model text,
  input_tokens int,
  output_tokens int,
  cost_usd numeric(10, 6),
  output_comment_id text,                       -- ClickUp comment ID where we posted result
  output_doc_id text,                           -- ClickUp doc ID if we created one
  error text,
  retries int not null default 0,
  payload jsonb                                 -- raw webhook payload for debugging
);

create index mastermind_queue_status_requested_at_idx
  on public.mastermind_queue (status, requested_at);
create index mastermind_queue_task_id_idx
  on public.mastermind_queue (task_id);

-- mastermind_errors: failed signature checks, malformed webhooks, etc.
create table public.mastermind_errors (
  id uuid primary key default gen_random_uuid(),
  error_at timestamptz not null default now(),
  error_kind text not null,                     -- 'sig_mismatch' | 'parse_error' | 'unknown'
  message text,
  payload jsonb
);

create index mastermind_errors_error_at_idx
  on public.mastermind_errors (error_at desc);

-- RLS: only service role reads/writes (auth service uses service role key)
alter table public.mastermind_queue enable row level security;
alter table public.mastermind_errors enable row level security;

-- No policies created: service role bypasses RLS, all other access denied by default.
```

Expected: migration succeeds; tables visible via Supabase MCP `list_tables` (schemas: `public`).

- [ ] **Step 2: Verify tables exist**

Use Supabase MCP `list_tables` filtered to `public` schema.
Expected: `mastermind_queue` and `mastermind_errors` appear in the response.

- [ ] **Step 3: No commit needed**

This migration lives in Supabase, not this repo. Note it in the next code commit's body.

---

## Section 2 — Auth webhook endpoint

### Task 2.1: Create mastermind route module skeleton

**Files:**
- Create: `auth/src/routes/mastermind.js`

- [ ] **Step 1: Write the file**

Create `auth/src/routes/mastermind.js`:

```javascript
const { Router } = require('express')
const crypto = require('crypto')
const { supabaseAdmin } = require('../services/supabase')

const router = Router()

const MASTERMIND_ENABLED = process.env.MASTERMIND_ENABLED === 'true'
const CLICKUP_WEBHOOK_SECRET = process.env.CLICKUP_WEBHOOK_SECRET || ''

// Field name (in ClickUp) for the Mastermind dropdown. Configured at provisioning
// time; the field ID is what arrives in webhook payloads, but we accept either.
const MASTERMIND_FIELD_NAME = 'Mastermind'
const MASTERMIND_PAUSED_FIELD_NAME = 'Mastermind Paused'

// Mode dropdown values must match the ClickUp options exactly (case-insensitive)
const MODE_MAP = {
  'brief me': 'brief_me',
  'strategize': 'strategize',
  'analyze': 'analyze',
  'draft': 'draft',
  'review': 'review',
  'wrap up': 'wrap_up',
}

function verifySignature(rawBody, signature, secret) {
  if (!secret) return false
  const hmac = crypto.createHmac('sha256', secret)
  hmac.update(rawBody)
  const expected = hmac.digest('hex')
  // ClickUp sends the hash as-is (no `sha256=` prefix)
  return crypto.timingSafeEqual(
    Buffer.from(expected, 'hex'),
    Buffer.from(String(signature || ''), 'hex'),
  )
}

// POST /webhooks/mastermind
// ClickUp posts task update + comment events here. We filter, debounce, and
// enqueue into mastermind_queue. Always returns 200 quickly; failures land in
// mastermind_errors.
router.post('/mastermind', async (req, res) => {
  // Ack quickly regardless. If we don't ack, ClickUp will keep retrying.
  res.status(200).json({ received: true })

  if (!MASTERMIND_ENABLED) {
    return  // silently ignore
  }

  try {
    const rawBody = req.rawBody || JSON.stringify(req.body)
    const signature = req.headers['x-signature']
    if (!verifySignature(rawBody, signature, CLICKUP_WEBHOOK_SECRET)) {
      await supabaseAdmin.from('mastermind_errors').insert({
        error_kind: 'sig_mismatch',
        message: 'X-Signature did not match HMAC of body',
        payload: req.body,
      })
      return
    }

    const event = req.body
    await handleEvent(event)
  } catch (e) {
    await supabaseAdmin.from('mastermind_errors').insert({
      error_kind: 'parse_error',
      message: e?.message || String(e),
      payload: req.body,
    })
  }
})

async function handleEvent(event) {
  // ClickUp sends events like:
  // { event: 'taskUpdated', task_id, webhook_id, history_items: [...] }
  // For Mastermind, we care about history_items where field == 'Mastermind'.
  const evt = event?.event
  const taskId = event?.task_id

  if (!taskId) return

  if (evt === 'taskUpdated') {
    const histories = Array.isArray(event.history_items) ? event.history_items : []
    for (const h of histories) {
      // ClickUp custom field changes appear as history items with type 17
      // and `field` set to the custom field's data.
      const fieldName = h?.custom_field?.name || ''
      if (fieldName !== MASTERMIND_FIELD_NAME) continue

      const afterValue = h?.after
      const mode = resolveMode(afterValue)
      if (!mode) continue  // blank or unknown value

      await enqueue({
        task_id: taskId,
        list_id: event.list_id || '',
        mode,
        requested_by: event?.history_items?.[0]?.user?.id ?? event?.user_id ?? null,
        payload: event,
      })
    }
    return
  }

  if (evt === 'taskCommentPosted') {
    const text = event?.comment?.comment_text || event?.comment_text || ''
    if (!/@mastermind\b/i.test(text)) return

    await enqueue({
      task_id: taskId,
      list_id: event.list_id || '',
      mode: 'continue',
      requested_by: event?.comment?.user?.id ?? null,
      payload: event,
    })
  }
}

function resolveMode(rawValue) {
  if (!rawValue) return null
  // Custom field "after" can be a string OR an object with `value` / `label`
  let label
  if (typeof rawValue === 'string') label = rawValue
  else if (rawValue.label) label = rawValue.label
  else if (Array.isArray(rawValue) && rawValue[0]?.label) label = rawValue[0].label
  else return null
  return MODE_MAP[label.toLowerCase()] || null
}

// Debounce: if the same (task_id, mode) was enqueued within DEBOUNCE_MS, skip.
const DEBOUNCE_MS = 30_000

async function enqueue(row) {
  const since = new Date(Date.now() - DEBOUNCE_MS).toISOString()
  const { data: recent } = await supabaseAdmin
    .from('mastermind_queue')
    .select('id')
    .eq('task_id', row.task_id)
    .eq('mode', row.mode)
    .gte('requested_at', since)
    .in('status', ['pending', 'working'])
    .limit(1)

  if (recent && recent.length > 0) {
    return  // debounced
  }

  await supabaseAdmin.from('mastermind_queue').insert(row)
}

module.exports = router
module.exports._internal = { verifySignature, resolveMode, MODE_MAP }
```

Expected: file written, no syntax errors when required.

- [ ] **Step 2: Verify module loads**

```bash
cd auth && node -e "require('./src/routes/mastermind')"
```
Expected: no output, exit 0.

- [ ] **Step 3: Commit**

```bash
git add auth/src/routes/mastermind.js
git commit -m "feat(auth): mastermind webhook route skeleton with HMAC + debounce"
```

### Task 2.2: Mount mastermind route in app

**Files:**
- Modify: `auth/src/index.js`

- [ ] **Step 1: Find the existing webhooks mounting block**

Search for `app.use('/webhooks'`. There should be two existing lines:
```javascript
app.use('/webhooks', require('./routes/webhooks'))
app.use('/webhooks', require('./routes/metaCapi'))
```

- [ ] **Step 2: Add mastermind mount immediately after those**

Edit `auth/src/index.js`:

```javascript
app.use('/webhooks', require('./routes/webhooks'))
app.use('/webhooks', require('./routes/metaCapi'))
app.use('/webhooks', require('./routes/mastermind'))
```

- [ ] **Step 3: Start the server locally and confirm the route exists**

```bash
cd auth && MASTERMIND_ENABLED=false node src/index.js &
sleep 2
curl -X POST http://localhost:3001/webhooks/mastermind \
  -H "Content-Type: application/json" \
  -d '{"event":"taskUpdated","task_id":"test"}' \
  -w "\nHTTP %{http_code}\n"
```
(Replace `3001` with whatever `PORT` env this service uses if different — check `auth/src/index.js` for the `listen(...)` line.)
Expected: `HTTP 200` response with `{"received":true}`.

Kill the server when done: find the background `node` process and stop it.

- [ ] **Step 4: Commit**

```bash
git add auth/src/index.js
git commit -m "feat(auth): mount /webhooks/mastermind route"
```

---

## Section 3 — Raw body capture for HMAC verification

ClickUp signs the **raw** request body. Express's `express.json()` consumes the body, so we need to capture it before parsing. The codebase already does this for `/admin/staff/import` via `express.raw`. We'll do it similarly.

### Task 3.1: Capture raw body for mastermind webhook

**Files:**
- Modify: `auth/src/index.js`

- [ ] **Step 1: Add raw body capture for the mastermind webhook**

The cleanest pattern: pass a `verify` callback to `express.json()` that stashes the buffer on `req.rawBody` only for the mastermind path.

Find the line `app.use(express.json())` in `auth/src/index.js`. Replace with:

```javascript
app.use(express.json({
  verify: (req, _res, buf) => {
    if (req.path === '/webhooks/mastermind') {
      req.rawBody = buf.toString('utf8')
    }
  },
}))
```

- [ ] **Step 2: Restart server and confirm raw body is captured**

Add a temporary debug line at the top of the `router.post('/mastermind', ...)` handler:
```javascript
console.log('rawBody length:', req.rawBody ? req.rawBody.length : 'missing')
```

Run the server and curl again as in Task 2.2 Step 3. Expected console output: `rawBody length: <some number>`.

Remove the debug line and recommit cleanly.

- [ ] **Step 3: Commit**

```bash
git add auth/src/index.js
git commit -m "feat(auth): capture raw body for mastermind webhook HMAC"
```

---

## Section 4 — Processor scaffold (in-process)

### Task 4.1: Create the processor module directory

**Files:**
- Create: `auth/src/mastermind/index.js`
- Create: `auth/src/mastermind/queue.js`
- Create: `auth/src/mastermind/clickup.js`
- Create: `auth/src/mastermind/anthropic.js`
- Create: `auth/src/mastermind/cost.js`
- Create: `auth/src/mastermind/dispatch.js`
- Create: `auth/src/mastermind/modes/index.js`

- [ ] **Step 1: Create `auth/src/mastermind/queue.js`**

```javascript
const { supabaseAdmin } = require('../services/supabase')

// Claim up to `limit` pending rows. Marks them 'working' atomically by
// updating only rows that are still 'pending'. Returns the claimed rows.
async function claimPending(limit = 3) {
  // Two-step claim (Postgres lacks SKIP LOCKED in PostgREST). Acceptable for
  // single-instance auth service. If we ever scale to multiple instances we'll
  // need a real advisory lock.
  const { data: candidates } = await supabaseAdmin
    .from('mastermind_queue')
    .select('id')
    .eq('status', 'pending')
    .order('requested_at', { ascending: true })
    .limit(limit)

  if (!candidates || candidates.length === 0) return []

  const ids = candidates.map(r => r.id)
  const { data: claimed } = await supabaseAdmin
    .from('mastermind_queue')
    .update({ status: 'working', started_at: new Date().toISOString() })
    .in('id', ids)
    .eq('status', 'pending')
    .select('*')

  return claimed || []
}

async function markDone(id, { output_comment_id, output_doc_id, input_tokens, output_tokens, model, cost_usd }) {
  await supabaseAdmin
    .from('mastermind_queue')
    .update({
      status: 'done',
      completed_at: new Date().toISOString(),
      output_comment_id: output_comment_id || null,
      output_doc_id: output_doc_id || null,
      input_tokens: input_tokens ?? null,
      output_tokens: output_tokens ?? null,
      model: model || null,
      cost_usd: cost_usd ?? null,
    })
    .eq('id', id)
}

async function markFailed(id, errorMsg, { retries = 0 } = {}) {
  await supabaseAdmin
    .from('mastermind_queue')
    .update({
      status: 'failed',
      completed_at: new Date().toISOString(),
      error: errorMsg,
      retries,
    })
    .eq('id', id)
}

async function incrementRetry(id, errorMsg) {
  const { data } = await supabaseAdmin
    .from('mastermind_queue')
    .select('retries')
    .eq('id', id)
    .single()
  const next = (data?.retries || 0) + 1
  await supabaseAdmin
    .from('mastermind_queue')
    .update({ retries: next, error: errorMsg, status: 'pending', started_at: null })
    .eq('id', id)
  return next
}

async function dailyCostUsd() {
  const since = new Date()
  since.setUTCHours(0, 0, 0, 0)
  const { data } = await supabaseAdmin
    .from('mastermind_queue')
    .select('cost_usd')
    .gte('completed_at', since.toISOString())
    .eq('status', 'done')
  return (data || []).reduce((sum, r) => sum + Number(r.cost_usd || 0), 0)
}

module.exports = { claimPending, markDone, markFailed, incrementRetry, dailyCostUsd }
```

- [ ] **Step 2: Create `auth/src/mastermind/clickup.js`**

```javascript
const CLICKUP_API_BASE = 'https://api.clickup.com/api/v2'
const TOKEN = process.env.CLICKUP_API_KEY

if (!TOKEN && process.env.MASTERMIND_ENABLED === 'true') {
  console.warn('[mastermind] CLICKUP_API_KEY is not set — ClickUp calls will fail')
}

async function cuFetch(path, opts = {}) {
  const url = `${CLICKUP_API_BASE}${path}`
  const r = await fetch(url, {
    ...opts,
    headers: {
      'Authorization': TOKEN,
      'Content-Type': 'application/json',
      ...(opts.headers || {}),
    },
  })
  const text = await r.text()
  let json
  try { json = text ? JSON.parse(text) : {} } catch { json = { raw: text } }
  if (!r.ok) {
    const err = new Error(`ClickUp ${r.status} ${path}: ${text?.slice(0, 200)}`)
    err.status = r.status
    err.body = json
    throw err
  }
  return json
}

async function getTask(taskId) {
  return cuFetch(`/task/${taskId}?include_subtasks=true`)
}

async function getTaskComments(taskId) {
  const r = await cuFetch(`/task/${taskId}/comment`)
  return r.comments || []
}

async function postComment(taskId, text) {
  const r = await cuFetch(`/task/${taskId}/comment`, {
    method: 'POST',
    body: JSON.stringify({ comment_text: text, notify_all: false }),
  })
  return r.id || r.hist_id || null
}

async function updateTaskStatus(taskId, status) {
  return cuFetch(`/task/${taskId}`, {
    method: 'PUT',
    body: JSON.stringify({ status }),
  })
}

async function clearCustomField(taskId, fieldId) {
  return cuFetch(`/task/${taskId}/field/${fieldId}`, { method: 'DELETE' })
}

async function setCustomField(taskId, fieldId, value) {
  return cuFetch(`/task/${taskId}/field/${fieldId}`, {
    method: 'POST',
    body: JSON.stringify({ value }),
  })
}

async function createSubtask(parentTaskId, listId, { name, description }) {
  return cuFetch(`/list/${listId}/task`, {
    method: 'POST',
    body: JSON.stringify({ name, description, parent: parentTaskId }),
  })
}

// ClickUp Docs (v3 API). Notes: Docs API is v3, not v2. The token is the same.
const DOCS_API_BASE = 'https://api.clickup.com/api/v3'

async function createDoc(workspaceId, parentTaskId, { name, content }) {
  const r = await fetch(`${DOCS_API_BASE}/workspaces/${workspaceId}/docs`, {
    method: 'POST',
    headers: { 'Authorization': TOKEN, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      name,
      parent: { id: parentTaskId, type: 6 },  // type 6 = task
      visibility: 'PRIVATE',
      create_page: true,
    }),
  })
  if (!r.ok) {
    const t = await r.text()
    throw new Error(`Docs API ${r.status}: ${t.slice(0, 200)}`)
  }
  const doc = await r.json()
  // Write content to the first page
  if (doc?.id && doc?.pages?.[0]?.id && content) {
    await fetch(`${DOCS_API_BASE}/workspaces/${workspaceId}/docs/${doc.id}/pages/${doc.pages[0].id}`, {
      method: 'PUT',
      headers: { 'Authorization': TOKEN, 'Content-Type': 'application/json' },
      body: JSON.stringify({ content }),
    })
  }
  return doc
}

module.exports = {
  getTask, getTaskComments, postComment, updateTaskStatus,
  clearCustomField, setCustomField, createSubtask, createDoc,
}
```

- [ ] **Step 3: Create `auth/src/mastermind/anthropic.js`**

```javascript
const Anthropic = require('@anthropic-ai/sdk').default

const client = new Anthropic({
  apiKey: process.env.MASTERMIND_ANTHROPIC_API_KEY || process.env.ANTHROPIC_API_KEY,
})

// Default models by mode
const DEFAULT_MODELS = {
  brief_me: 'claude-opus-4-7',
  strategize: 'claude-opus-4-7',
  analyze: 'claude-sonnet-4-6',
  draft: 'claude-sonnet-4-6',
  review: 'claude-opus-4-7',
  wrap_up: 'claude-opus-4-7',
  continue: 'claude-sonnet-4-6',
}

async function complete({ mode, system, messages, maxTokens = 4096, model }) {
  const chosen = model || DEFAULT_MODELS[mode] || 'claude-sonnet-4-6'
  const resp = await client.messages.create({
    model: chosen,
    max_tokens: maxTokens,
    system,
    messages,
  })
  // Extract text content
  const text = (resp.content || [])
    .filter(b => b.type === 'text')
    .map(b => b.text)
    .join('\n')
  return {
    text,
    model: chosen,
    inputTokens: resp.usage?.input_tokens || 0,
    outputTokens: resp.usage?.output_tokens || 0,
  }
}

module.exports = { complete, DEFAULT_MODELS }
```

- [ ] **Step 4: Create `auth/src/mastermind/cost.js`**

```javascript
// USD per 1M tokens. Update when Anthropic changes pricing.
const PRICING = {
  'claude-opus-4-7':    { input: 15.00, output: 75.00 },
  'claude-sonnet-4-6':  { input:  3.00, output: 15.00 },
  'claude-haiku-4-5':   { input:  1.00, output:  5.00 },
}

function computeUsd({ model, inputTokens, outputTokens }) {
  const p = PRICING[model]
  if (!p) return 0
  return (inputTokens / 1_000_000) * p.input + (outputTokens / 1_000_000) * p.output
}

module.exports = { computeUsd, PRICING }
```

- [ ] **Step 5: Create `auth/src/mastermind/modes/index.js` (stub)**

```javascript
// Mode handlers: each returns { commentText, docName?, docContent?, statusAfter?, subtasks? }
const draft = require('./draft')

const HANDLERS = {
  draft,
  // brief_me, strategize, analyze, review, wrap_up, continue — added in later tasks
}

function getHandler(mode) {
  return HANDLERS[mode] || null
}

module.exports = { getHandler, HANDLERS }
```

- [ ] **Step 6: Create `auth/src/mastermind/modes/draft.js` (placeholder, real impl in Section 9)**

```javascript
// Placeholder; real implementation lives in Section 9 Task 9.1.
module.exports = async function draft({ task, comments, anthropic }) {
  throw new Error('draft mode not yet implemented')
}
```

- [ ] **Step 7: Create `auth/src/mastermind/dispatch.js`**

```javascript
const queue = require('./queue')
const cu = require('./clickup')
const ai = require('./anthropic')
const { computeUsd } = require('./cost')
const { getHandler } = require('./modes')

const DAILY_COST_CAP_USD = Number(process.env.MASTERMIND_DAILY_CAP_USD || 25)
const PER_TASK_COST_CAP_USD = Number(process.env.MASTERMIND_TASK_CAP_USD || 2)

async function dispatchOne(row) {
  const handler = getHandler(row.mode)
  if (!handler) {
    await queue.markFailed(row.id, `no handler for mode '${row.mode}'`)
    return
  }

  // Check daily cap
  const dailyUsd = await queue.dailyCostUsd()
  if (dailyUsd >= DAILY_COST_CAP_USD) {
    await queue.markFailed(row.id, `daily cap reached ($${dailyUsd.toFixed(2)} >= $${DAILY_COST_CAP_USD})`)
    return
  }

  // Fetch task context
  let task, comments
  try {
    task = await cu.getTask(row.task_id)
    comments = await cu.getTaskComments(row.task_id)
  } catch (e) {
    const retries = await queue.incrementRetry(row.id, `ClickUp fetch failed: ${e.message}`)
    if (retries >= 5) await queue.markFailed(row.id, `gave up after ${retries} retries`)
    return
  }

  // Check pause field
  if (isPaused(task)) {
    await queue.markFailed(row.id, 'task is paused (Mastermind Paused = true)')
    return
  }

  // Run the handler
  let result
  try {
    result = await handler({ task, comments, anthropic: ai, row })
  } catch (e) {
    const retries = await queue.incrementRetry(row.id, `handler error: ${e.message}`)
    if (retries >= 5) await queue.markFailed(row.id, `gave up after ${retries} retries`)
    return
  }

  // Cost check
  const cost = computeUsd(result.usage || {})
  if (cost > PER_TASK_COST_CAP_USD) {
    // Already incurred; just warn in the comment
    result.commentText = `⚠️ Per-task cost cap exceeded ($${cost.toFixed(2)} > $${PER_TASK_COST_CAP_USD}). Proceeding once; tune cap if needed.\n\n` + result.commentText
  }

  // Post outputs
  let commentId = null, docId = null
  try {
    if (result.docName && result.docContent) {
      // Workspace ID needed for Docs; expect env var (Justin sets at provisioning)
      const wsId = process.env.CLICKUP_WORKSPACE_ID
      if (wsId) {
        const doc = await cu.createDoc(wsId, row.task_id, { name: result.docName, content: result.docContent })
        docId = doc?.id || null
        if (docId) result.commentText += `\n\n📄 Full doc: ${doc?.url || doc?.id}`
      }
    }
    commentId = await cu.postComment(row.task_id, result.commentText)
    if (result.statusAfter) {
      try { await cu.updateTaskStatus(row.task_id, result.statusAfter) } catch {}
    }
    if (result.mastermindFieldId) {
      try { await cu.clearCustomField(row.task_id, result.mastermindFieldId) } catch {}
    }
  } catch (e) {
    await queue.markFailed(row.id, `output post failed: ${e.message}`)
    return
  }

  await queue.markDone(row.id, {
    output_comment_id: commentId,
    output_doc_id: docId,
    input_tokens: result.usage?.inputTokens || 0,
    output_tokens: result.usage?.outputTokens || 0,
    model: result.usage?.model || null,
    cost_usd: cost,
  })
}

function isPaused(task) {
  const fields = task?.custom_fields || []
  const f = fields.find(x => x?.name === 'Mastermind Paused')
  if (!f) return false
  return Boolean(f.value)
}

async function tick() {
  if (process.env.MASTERMIND_ENABLED !== 'true') return
  const rows = await queue.claimPending(3)
  for (const row of rows) {
    try { await dispatchOne(row) }
    catch (e) {
      console.error('[mastermind] dispatch error', e)
      try { await queue.markFailed(row.id, e.message) } catch {}
    }
  }
}

module.exports = { tick, dispatchOne }
```

- [ ] **Step 8: Create `auth/src/mastermind/index.js`**

```javascript
const cron = require('node-cron')
const { tick } = require('./dispatch')

function start() {
  if (process.env.MASTERMIND_ENABLED !== 'true') {
    console.log('[mastermind] disabled (MASTERMIND_ENABLED != "true")')
    return
  }
  // Poll every 60 seconds
  cron.schedule('* * * * *', () => {
    tick().catch(err => console.error('[mastermind] tick error', err))
  })
  console.log('[mastermind] polling enabled (every 60s)')
}

module.exports = { start }
```

- [ ] **Step 9: Smoke-test the modules load**

```bash
cd auth && node -e "require('./src/mastermind').start"
```
Expected: no errors, exit 0.

- [ ] **Step 10: Commit**

```bash
git add auth/src/mastermind/
git commit -m "feat(auth): mastermind processor scaffold (queue, clickup, anthropic, dispatch)"
```

### Task 4.2: Wire processor start into auth bootstrap

**Files:**
- Modify: `auth/src/index.js`

- [ ] **Step 1: Find the `app.listen(...)` line near the bottom of `auth/src/index.js`**

- [ ] **Step 2: Add processor start before `app.listen`**

```javascript
// Start mastermind processor (no-op if disabled)
require('./mastermind').start()

app.listen(PORT, () => { ... })
```

- [ ] **Step 3: Verify server still boots cleanly**

```bash
cd auth && MASTERMIND_ENABLED=false node src/index.js
```
Expected: log line `[mastermind] disabled (MASTERMIND_ENABLED != "true")`. No crash.

Then try enabled:
```bash
cd auth && MASTERMIND_ENABLED=true CLICKUP_API_KEY=fake ANTHROPIC_API_KEY=fake node src/index.js
```
Expected: log line `[mastermind] polling enabled (every 60s)`. (Polling will error on Supabase calls if your local env doesn't have keys, but the start should not crash.)

- [ ] **Step 4: Commit**

```bash
git add auth/src/index.js
git commit -m "feat(auth): start mastermind processor on boot"
```

---

## Section 9 — Mode: `Draft` (MVP end-to-end)

This is the first real mode handler. Once this works end-to-end, the architecture is proven and subsequent modes follow the same shape.

### Task 9.1: Implement Draft mode handler

**Files:**
- Modify: `auth/src/mastermind/modes/draft.js`

- [ ] **Step 1: Replace the placeholder with the real implementation**

```javascript
const { complete } = require('../anthropic')

// Draft mode: produce the actual deliverable based on task context.
// Output: comment with code-fenced copy. For long deliverables (>3000 chars),
// returns a docName + docContent so dispatch creates a ClickUp Doc.
module.exports = async function draft({ task, comments, row }) {
  const lane = inferLane(task)
  const channel = inferChannel(task)

  const taskDescription = task?.description || task?.text_content || ''
  const taskTitle = task?.name || '(untitled task)'
  const recentComments = (comments || []).slice(-5).map(c => `${c.user?.username || 'someone'}: ${c.comment_text}`).join('\n')

  const system = `You are the WCS (West Coast Strength) Marketing Mastermind. You help draft marketing deliverables for a gym chain with 7 locations in Washington/Oregon.

Voice: confident, friendly, premium-not-discount, direct. Avoid hype/desperation. Talk like a trainer who respects the reader, not a marketer trying to close.

When drafting:
- Lead with the value to the reader, not "we" statements
- Concrete > abstract (specific outcomes, real numbers, real timelines)
- One clear CTA per deliverable
- No emojis unless the channel demands it (organic social is the only exception)
- No "First class free" — Justin says it's overused

You are drafting a single deliverable. Match the channel format:
- Email: subject line, preheader, body in plain text, CTA button label
- SMS: under 160 chars, one CTA link placeholder
- Push notification: title (≤40 chars), body (≤140 chars), deep-link placeholder
- Social caption (IG/FB): hook line, 2–4 body lines, 1 CTA, hashtag set
- Blog/landing copy: H1, lede, sections with H2s, CTA block
- Flyer copy: headline (≤8 words), subhead (≤12 words), body (≤40 words), CTA

Return ONLY the deliverable copy in markdown code fences, plus a 1–3 line note about asset needs (photos, design considerations) if relevant. No preamble.`

  const userMsg = `Task: ${taskTitle}
Lane: ${lane}
Channel: ${channel || 'unspecified — infer from task'}

Description / brief:
${taskDescription || '(none provided)'}

Recent comments on this task:
${recentComments || '(none)'}

Draft the deliverable now.`

  const result = await complete({
    mode: 'draft',
    system,
    messages: [{ role: 'user', content: userMsg }],
    maxTokens: 3000,
  })

  const text = result.text.trim()
  const long = text.length > 3000

  const commentText = long
    ? `**Draft ready — see attached Doc for full copy** (${text.length} chars). Excerpt:\n\n${text.slice(0, 600)}...`
    : `**Draft ready** — Mastermind (${result.model}):\n\n${text}`

  return {
    commentText,
    docName: long ? `Draft — ${taskTitle.slice(0, 60)}` : null,
    docContent: long ? text : null,
    statusAfter: 'review',  // best-effort; if status doesn't exist on the list, dispatch swallows error
    usage: {
      model: result.model,
      inputTokens: result.inputTokens,
      outputTokens: result.outputTokens,
    },
  }
}

function inferLane(task) {
  // List name like "Email & SMS (Always-On)" or "Campaign Lab"
  const listName = task?.list?.name || ''
  if (/lab/i.test(listName)) return 'campaign_lab'
  if (/campaign/i.test(listName)) return 'campaign'
  if (/email|sms/i.test(listName)) return 'channel.email'
  if (/social|instagram|tiktok/i.test(listName)) return 'channel.social'
  if (/blog|seo/i.test(listName)) return 'channel.seo'
  if (/meta|ads/i.test(listName)) return 'channel.meta'
  if (/flyer|print/i.test(listName)) return 'channel.flyers'
  if (/app blast|push/i.test(listName)) return 'channel.appblast'
  if (/promotion|in-gym/i.test(listName)) return 'channel.promo'
  if (/inbox/i.test(listName)) return 'inbox'
  if (/strategy/i.test(listName)) return 'strategy'
  if (/performance/i.test(listName)) return 'performance'
  return 'unknown'
}

function inferChannel(task) {
  const lane = inferLane(task)
  if (lane.startsWith('channel.')) return lane.split('.')[1]
  return null
}
```

- [ ] **Step 2: Verify module loads**

```bash
cd auth && node -e "const m = require('./src/mastermind/modes/draft'); console.log(typeof m)"
```
Expected: `function`.

- [ ] **Step 3: Commit**

```bash
git add auth/src/mastermind/modes/draft.js
git commit -m "feat(auth): draft mode handler with WCS voice prompt"
```

### Task 9.2: End-to-end smoke test

This step is **manual** — Justin (or whoever runs this) needs an actual ClickUp task and a real Anthropic key. No code change.

- [ ] **Step 1: Set up local env vars**

In `auth/.env.local` (or equivalent):
```
MASTERMIND_ENABLED=true
CLICKUP_API_KEY=<existing key>
CLICKUP_WEBHOOK_SECRET=<choose any random string for local test>
ANTHROPIC_API_KEY=<real key>
MASTERMIND_DAILY_CAP_USD=5
MASTERMIND_TASK_CAP_USD=1
```

- [ ] **Step 2: Insert a fake queue row pointing at an existing ClickUp task**

Use Supabase MCP `execute_sql`:
```sql
insert into mastermind_queue (task_id, list_id, mode, status)
values ('<real-clickup-task-id>', '<real-list-id>', 'draft', 'pending');
```

- [ ] **Step 3: Run the auth service locally and wait up to 60s**

```bash
cd auth && node src/index.js
```

- [ ] **Step 4: Verify**

- Check ClickUp: a comment should appear on the task with the draft copy.
- Check Supabase: the queue row should be `status='done'` with `cost_usd` populated.
- If failed: row will be `status='failed'` with an `error` message.

- [ ] **Step 5: Document any issues found in this plan's "Notes" section**

(No commit required for the smoke test itself.)

---

## Section 10 — Remaining mode handlers

Each mode follows the same shape as `draft.js`. The plan below shows the prompt + output shape for each.

### Task 10.1: Implement `brief_me` mode

**Files:**
- Create: `auth/src/mastermind/modes/briefMe.js`
- Modify: `auth/src/mastermind/modes/index.js` (register handler)

**Important branching:** When the task is in Campaign Lab with status `Approved`, `brief_me` should not just write a brief — it should **promote** the concept to a full Active Campaign folder. That promotion logic is significant; defer it to Task 10.7. For now, this task handles the simple "write me a structured brief" case.

- [ ] **Step 1: Create `auth/src/mastermind/modes/briefMe.js`**

```javascript
const { complete } = require('../anthropic')

module.exports = async function briefMe({ task, comments }) {
  const taskTitle = task?.name || '(untitled)'
  const description = task?.description || task?.text_content || ''
  const lane = task?.list?.name || 'unknown'

  const system = `You are the WCS Marketing Mastermind. Your job is to read a raw request and produce a tight, structured brief. Keep it tactical, not theoretical.

Output format (markdown, no preamble):

### Scope
1–2 sentences. What is this deliverable? What is it NOT?

### Audience
Who specifically — segment, location, life stage, awareness level.

### Channels
Bulleted list. Which channels should carry this and why.

### Hook / Angle
The single sharpest angle. One sentence.

### Key messages
3–5 bullets. The things the audience must take away.

### CTA
One clear action.

### Success metric
How will we know it worked?

### Open questions
Anything I'd need before drafting. If none, write "None."

### Deliverables checklist
Concrete artifacts needed (e.g., "1 cold-traffic Meta ad set + 3 variants", "5-email nurture sequence", "in-gym A-frame copy").`

  const user = `Lane: ${lane}
Task title: ${taskTitle}

Raw description:
${description || '(none provided — infer from title)'}

Recent comments:
${(comments || []).slice(-5).map(c => `${c.user?.username || '?'}: ${c.comment_text}`).join('\n') || '(none)'}

Write the brief now.`

  const result = await complete({
    mode: 'brief_me',
    system,
    messages: [{ role: 'user', content: user }],
    maxTokens: 2500,
  })

  return {
    commentText: `**Brief — Mastermind (${result.model})**\n\n${result.text.trim()}`,
    statusAfter: 'building',
    usage: { model: result.model, inputTokens: result.inputTokens, outputTokens: result.outputTokens },
  }
}
```

- [ ] **Step 2: Register in `modes/index.js`**

```javascript
const draft = require('./draft')
const briefMe = require('./briefMe')

const HANDLERS = {
  draft,
  brief_me: briefMe,
}
```

- [ ] **Step 3: Commit**

```bash
git add auth/src/mastermind/modes/briefMe.js auth/src/mastermind/modes/index.js
git commit -m "feat(auth): brief_me mode handler"
```

### Task 10.2: Implement `strategize` mode (incl. Lab concept generation)

**Files:**
- Create: `auth/src/mastermind/modes/strategize.js`

`Strategize` has two flavors:
- **General strategize** (anywhere except Labs) → strategic memo as a comment.
- **Lab strategize** (Campaign Lab, Post Lab, Broadcast Lab) → generate N concept subtasks.

- [ ] **Step 1: Create `auth/src/mastermind/modes/strategize.js`**

```javascript
const { complete } = require('../anthropic')
const cu = require('../clickup')

const LAB_LISTS = /campaign lab|post lab|broadcast lab/i
const DEFAULT_CONCEPTS_PER_REQUEST = 3

module.exports = async function strategize({ task, comments, row }) {
  const listName = task?.list?.name || ''
  const isLab = LAB_LISTS.test(listName)

  if (isLab) {
    return strategizeLab({ task, comments, listName })
  }
  return strategizeGeneral({ task, comments })
}

async function strategizeGeneral({ task, comments }) {
  const system = `You are the WCS Marketing Mastermind. You produce sharp strategic memos: positioning, channel mix, opportunity cost, alternatives. You are willing to recommend NOT doing the thing if that's the right call.

Output format:
1. **The ask, as I understand it** — 1–2 sentences.
2. **My take** — should we, shouldn't we, or "yes but" — and why.
3. **Risks / what would have to be true.**
4. **Alternatives** — 2–3 different angles worth considering.
5. **Recommendation** — concrete next step.

Tight. No padding.`

  const user = `Task: ${task?.name}
List: ${task?.list?.name || ''}
Description: ${task?.description || task?.text_content || '(none)'}
Recent comments: ${(comments || []).slice(-3).map(c => c.comment_text).join('\n') || '(none)'}

Give me your strategic take.`

  const r = await complete({ mode: 'strategize', system, messages: [{ role: 'user', content: user }], maxTokens: 2000 })

  return {
    commentText: `**Strategic take — Mastermind (${r.model})**\n\n${r.text.trim()}`,
    usage: { model: r.model, inputTokens: r.inputTokens, outputTokens: r.outputTokens },
  }
}

async function strategizeLab({ task, comments, listName }) {
  const labKind = /campaign/i.test(listName) ? 'campaign'
    : /post/i.test(listName) ? 'social post'
    : /broadcast/i.test(listName) ? 'email broadcast'
    : 'concept'

  const system = `You are the WCS Marketing Mastermind. The user asked for ${labKind} ideas. Generate exactly ${DEFAULT_CONCEPTS_PER_REQUEST} distinct concepts.

Each concept must be substantively different (not three flavors of the same idea). For each, output exactly this JSON shape inside a single \`\`\`json code block at the end of your message:

\`\`\`json
{
  "intro": "1–2 sentence read of the brief + market context",
  "concepts": [
    {
      "name": "short punchy concept name",
      "hook": "the angle / what makes this work",
      "audience": "who specifically",
      "channels": "bulleted channel mix as a string",
      "expected_outcome": "honest read on what this would deliver",
      "score": 4
    }
  ]
}
\`\`\`

\`score\` is your 1–5 confidence rating. Be honest — not all 5s.`

  const user = `Lab: ${listName}
Parent task: ${task?.name}
Brief from user:
${task?.description || '(none)'}

Generate ${DEFAULT_CONCEPTS_PER_REQUEST} concepts now.`

  const r = await complete({ mode: 'strategize', system, messages: [{ role: 'user', content: user }], maxTokens: 3000 })

  // Parse the JSON block
  let parsed
  try {
    const match = r.text.match(/```json\s*([\s\S]+?)```/)
    parsed = JSON.parse(match[1])
  } catch (e) {
    return {
      commentText: `**Concept generation failed to parse JSON.** Raw output:\n\n${r.text}`,
      usage: { model: r.model, inputTokens: r.inputTokens, outputTokens: r.outputTokens },
    }
  }

  // Create subtasks (one per concept)
  const listId = task?.list?.id
  for (const c of (parsed.concepts || [])) {
    try {
      await cu.createSubtask(task.id, listId, {
        name: c.name,
        description: `**Hook:** ${c.hook}\n\n**Audience:** ${c.audience}\n\n**Channels:** ${c.channels}\n\n**Expected outcome:** ${c.expected_outcome}\n\n**Mastermind confidence:** ${c.score}/5`,
      })
    } catch (e) {
      console.error('[mastermind] subtask creation failed', e.message)
    }
  }

  return {
    commentText: `**${(parsed.concepts || []).length} concepts generated — Mastermind (${r.model})**\n\n${parsed.intro}\n\nReview the subtasks below. Mark the one you want with status \`Approved\` and set \`Mastermind = Brief Me\` on it.`,
    statusAfter: 'ideas posted',
    usage: { model: r.model, inputTokens: r.inputTokens, outputTokens: r.outputTokens },
  }
}
```

- [ ] **Step 2: Register handler in `modes/index.js`**

```javascript
const HANDLERS = {
  draft,
  brief_me: briefMe,
  strategize: require('./strategize'),
}
```

- [ ] **Step 3: Commit**

```bash
git add auth/src/mastermind/modes/strategize.js auth/src/mastermind/modes/index.js
git commit -m "feat(auth): strategize mode (general + lab-concept generation)"
```

### Task 10.3: Implement `analyze` mode

**Files:**
- Create: `auth/src/mastermind/modes/analyze.js`

`Analyze` needs to pull real data. For MVP, support a minimal case: detect what kind of report the task is asking for (Meta ROAS / GA4 / GBP / cross-channel) and use the existing report modules in `auth/src/routes/fbRoas.js`, `googleAnalytics.js`, `googleBusiness.js`. **For Phase 1, only Meta ROAS analysis is supported.** Other report types respond with "not yet wired" and a manual data path.

- [ ] **Step 1: Inspect available helpers**

```bash
grep -n "module.exports" auth/src/routes/fbRoas.js | head -10
```
Take note of which functions are exported and re-usable.

- [ ] **Step 2: If `fbRoas.js` doesn't already export a callable function (only an Express router), refactor minimally to expose a `getRoasData({ startDate, endDate, locationId? })` helper alongside the router. Otherwise reuse what exists.**

(This step requires reading the file. If extraction is non-trivial, fall back to: re-query the same Meta API directly using the existing token/env vars used by `fbRoas.js`.)

- [ ] **Step 3: Create `auth/src/mastermind/modes/analyze.js`**

```javascript
const { complete } = require('../anthropic')

module.exports = async function analyze({ task, comments }) {
  const desc = (task?.description || task?.text_content || '').toLowerCase()
  const title = (task?.name || '').toLowerCase()
  const text = `${title}\n${desc}`

  if (/meta|fb|roas|facebook/.test(text)) {
    return analyzeMetaRoas({ task })
  }
  // Other report kinds: write a placeholder until they're wired
  return {
    commentText: `**Analyze — not yet wired for this task type.**\n\nI detected the task isn't about Meta ROAS. Currently the only data adapter wired is Meta ROAS. To add GA4 / GBP / GHL adapters, see plan section 10.3.\n\n(MVP scope.)`,
    statusAfter: 'analyzing',
    usage: { model: 'none', inputTokens: 0, outputTokens: 0 },
  }
}

async function analyzeMetaRoas({ task }) {
  // Hand off to the existing FB ROAS helper. If it doesn't exist as a function,
  // this stub will need adjustment based on Task 10.3 Step 2 findings.
  let data
  try {
    const fbRoas = require('../../routes/fbRoas')
    if (typeof fbRoas.getRoasData === 'function') {
      data = await fbRoas.getRoasData({ days: 7 })
    } else {
      return {
        commentText: `**Analyze — fbRoas.js does not yet export a callable helper.** Add \`getRoasData()\` per plan section 10.3 step 2.`,
        usage: { model: 'none', inputTokens: 0, outputTokens: 0 },
      }
    }
  } catch (e) {
    return {
      commentText: `**Analyze failed — could not load fbRoas helper:** ${e.message}`,
      usage: { model: 'none', inputTokens: 0, outputTokens: 0 },
    }
  }

  const system = `You are the WCS Marketing Mastermind. You read Meta ad performance data and write a concise weekly review.

Output:
1. **Headline read** — 1–2 sentences. What matters most this week?
2. **What's working** — 3 bullets max with numbers.
3. **What's bleeding** — 3 bullets max with numbers.
4. **Recommended actions** — 2–4 concrete budget shifts or experiments to run.

Be specific. Numbers beat adjectives. No hedging.`

  const user = `Task: ${task?.name}\n\nMeta ROAS data (last 7 days):\n\`\`\`json\n${JSON.stringify(data, null, 2).slice(0, 12000)}\n\`\`\`\n\nWrite the review now.`

  const r = await complete({
    mode: 'analyze',
    system,
    messages: [{ role: 'user', content: user }],
    maxTokens: 2500,
  })

  return {
    commentText: `**Weekly Meta ROAS Review — Mastermind (${r.model})**\n\n${r.text.trim()}`,
    statusAfter: 'drafted',
    usage: { model: r.model, inputTokens: r.inputTokens, outputTokens: r.outputTokens },
  }
}
```

- [ ] **Step 4: Register and commit**

```javascript
const HANDLERS = {
  draft, brief_me: briefMe, strategize: require('./strategize'),
  analyze: require('./analyze'),
}
```

```bash
git add auth/src/mastermind/modes/analyze.js auth/src/mastermind/modes/index.js
git commit -m "feat(auth): analyze mode (MVP: Meta ROAS only)"
```

### Task 10.4: Implement `review` mode

**Files:**
- Create: `auth/src/mastermind/modes/review.js`

- [ ] **Step 1: Create file**

```javascript
const { complete } = require('../anthropic')

module.exports = async function review({ task, comments }) {
  // The "draft to review" is expected in either the task description OR the
  // most recent attached comment that isn't from Mastermind.
  const descDraft = task?.description || task?.text_content || ''
  const lastUserComment = (comments || []).reverse().find(c => !/^\*\*(draft|brief|strategic|analyze|wrap)/i.test(c.comment_text || ''))
  const draftText = lastUserComment?.comment_text || descDraft

  const system = `You are the WCS Marketing Mastermind. Critique the draft like a senior creative director who respects the writer.

Output:
**Overall:** 1–2 sentences. Is it ready? Close? Way off?

**Strengths:** 2–3 bullets. Be specific — quote the line.

**Issues:** Numbered list. For each, quote the offending line and propose a rewrite.

**Suggested rewrites** (if more than minor tweaks):
\`\`\`
the revised version
\`\`\`

**Risk flags:** anything that could cause legal / brand / member backlash. (Often "none" — say so.)

Be honest. Sycophancy doesn't help.`

  const user = `Task: ${task?.name}\n\nDraft to review:\n${draftText || '(no draft found)'}\n\nReview now.`

  const r = await complete({ mode: 'review', system, messages: [{ role: 'user', content: user }], maxTokens: 2500 })

  return {
    commentText: `**Review — Mastermind (${r.model})**\n\n${r.text.trim()}`,
    usage: { model: r.model, inputTokens: r.inputTokens, outputTokens: r.outputTokens },
  }
}
```

- [ ] **Step 2: Register + commit**

### Task 10.5: Implement `wrap_up` mode

**Files:**
- Create: `auth/src/mastermind/modes/wrapUp.js`

This mode is special: it produces a post-mortem AND creates follow-up subtasks for action items it identifies.

- [ ] **Step 1: Create file**

```javascript
const { complete } = require('../anthropic')
const cu = require('../clickup')

module.exports = async function wrapUp({ task, comments }) {
  const system = `You are the WCS Marketing Mastermind. Write a post-mortem for this completed marketing work.

Output ONE markdown comment ending with a JSON code block of action items:

### What was the goal
1 sentence.

### What happened
3–5 bullets. Numbers if available.

### What worked
2–3 bullets, specific.

### What didn't
2–3 bullets, specific. Honest.

### What to keep / kill / try next
- **Keep:** 1–3 things to systematize.
- **Kill:** 1–3 things to stop doing.
- **Try next:** 1–3 experiments.

\`\`\`json
{
  "action_items": [
    { "title": "...", "description": "...", "owner_hint": "Justin or Paige or unassigned" }
  ]
}
\`\`\`

Each action_item becomes a subtask. Don't generate more than 5. Quality > quantity.`

  const user = `Task: ${task?.name}\nList: ${task?.list?.name}\nDescription: ${task?.description || ''}\n\nComments history:\n${(comments || []).map(c => `${c.user?.username || '?'}: ${c.comment_text}`).join('\n----\n')}\n\nWrite the post-mortem now.`

  const r = await complete({ mode: 'wrap_up', system, messages: [{ role: 'user', content: user }], maxTokens: 3500 })

  // Try to extract action items
  let actionItems = []
  try {
    const match = r.text.match(/```json\s*([\s\S]+?)```/)
    if (match) {
      const parsed = JSON.parse(match[1])
      actionItems = Array.isArray(parsed.action_items) ? parsed.action_items : []
    }
  } catch { /* ignore */ }

  // Create subtasks
  for (const item of actionItems) {
    try {
      await cu.createSubtask(task.id, task?.list?.id, {
        name: item.title,
        description: `${item.description || ''}\n\n_Suggested owner: ${item.owner_hint || 'unassigned'}_\n_(Auto-created from Wrap Up post-mortem)_`,
      })
    } catch (e) {
      console.error('[mastermind] wrap-up subtask creation failed', e.message)
    }
  }

  return {
    commentText: `**Post-mortem — Mastermind (${r.model})**\n\n${r.text.trim()}\n\n_${actionItems.length} action items created as subtasks._`,
    statusAfter: 'closed',
    usage: { model: r.model, inputTokens: r.inputTokens, outputTokens: r.outputTokens },
  }
}
```

- [ ] **Step 2: Register + commit**

### Task 10.6: Implement `continue` mode (comment-mention follow-up)

**Files:**
- Create: `auth/src/mastermind/modes/continue.js`

- [ ] **Step 1: Create file**

```javascript
const { complete } = require('../anthropic')

module.exports = async function cont({ task, comments }) {
  const history = (comments || []).map(c => ({
    role: /mastermind/i.test(c.user?.username || c.user?.name || '') ? 'assistant' : 'user',
    content: c.comment_text || '',
  })).filter(m => m.content.length > 0)

  // The latest comment is the @mention that triggered us
  const triggerComment = history[history.length - 1]?.content || ''

  const system = `You are the WCS Marketing Mastermind continuing a conversation in a ClickUp task. The user just replied to you. Respond directly — no preamble, no headers unless useful. Stay concise. If they're asking for a revision, deliver the revision in a code block.`

  const user = `Task: ${task?.name}\nTask description: ${task?.description || ''}\n\nConversation so far (most recent last):\n${history.slice(-10).map(m => `${m.role === 'user' ? 'User' : 'You'}: ${m.content}`).join('\n----\n')}\n\nLatest message to respond to:\n${triggerComment}\n\nRespond now.`

  const r = await complete({ mode: 'continue', system, messages: [{ role: 'user', content: user }], maxTokens: 2000 })

  return {
    commentText: r.text.trim(),
    usage: { model: r.model, inputTokens: r.inputTokens, outputTokens: r.outputTokens },
  }
}
```

- [ ] **Step 2: Register + commit**

### Task 10.7: Campaign Lab promotion (brief_me on Approved concept)

**Files:**
- Modify: `auth/src/mastermind/modes/briefMe.js`

When `brief_me` fires on a task that lives in Campaign Lab and has status `Approved`, the handler must promote the concept to a full Active Campaign folder. This is the most complex composite behavior in the spec.

- [ ] **Step 1: Add lane/status detection at the top of `briefMe`**

(Logic: if `task.list.name` matches `/campaign lab/i` AND `task.status.status` matches `/approved/i`, branch into `promoteConcept`. Otherwise fall through to the existing brief-only behavior.)

- [ ] **Step 2: Implement `promoteConcept`**

The promotion sequence:
1. Read concept subtask description (set by `strategize` Lab mode)
2. Ask Claude for the full campaign plan + deliverable list keyed by `Campaign Type`
3. Create a new folder under the Campaigns space named `🟢 [Active] <campaign-name>`
4. Create a parent task in that folder with the campaign plan as description
5. Create deliverable subtasks for each channel needed
6. Create a ClickUp Doc with the full plan attached to the parent task
7. Move the Lab concept's status to `Promoted` and the parent Lab task to `Promoted`
8. Archive the non-chosen sibling concepts (status → `Archived`)

ClickUp API endpoints needed:
- `POST /space/{space_id}/folder` (create folder)
- `POST /folder/{folder_id}/list` (create lists if needed inside folder)
- `POST /list/{list_id}/task` (create parent task)

**This task is the largest in the plan.** It depends on knowing the ClickUp space + folder IDs (set during provisioning — Section 18). Defer the implementation until after Section 18 is done OR until we have those IDs from a manual smoke test.

For MVP: stub `promoteConcept` to post a comment saying "Promotion not yet implemented — set space IDs in env first." This unblocks shipping the rest.

- [ ] **Step 3: Commit stub**

```bash
git add auth/src/mastermind/modes/briefMe.js
git commit -m "feat(auth): briefMe — campaign lab promotion stub (full impl deferred to post-provisioning)"
```

---

## Section 11 — Mastermind field reset

After completing work, the dispatcher attempts to clear the `Mastermind` custom field on the task. We need the field's UUID (not name). This is read at boot from env.

### Task 11.1: Add field-ID env vars + dispatch wiring

**Files:**
- Modify: `auth/src/mastermind/dispatch.js`

- [ ] **Step 1: Add field ID lookup**

```javascript
const MASTERMIND_FIELD_ID = process.env.CLICKUP_MASTERMIND_FIELD_ID || ''

// In dispatchOne, after work succeeds:
if (MASTERMIND_FIELD_ID) {
  try { await cu.clearCustomField(row.task_id, MASTERMIND_FIELD_ID) } catch {}
}
```

- [ ] **Step 2: Commit**

---

## Section 12 — Recurring rhythms

### Task 12.1: Create rhythm scheduler

**Files:**
- Create: `auth/src/mastermind/rhythms.js`
- Modify: `auth/src/mastermind/index.js`

- [ ] **Step 1: Create `auth/src/mastermind/rhythms.js`**

```javascript
const cron = require('node-cron')
const cu = require('./clickup')

// Each rhythm: cron expression, list ID (target), task template, mastermind mode to set.
// List IDs come from env (set during provisioning).
const RHYTHMS = [
  {
    name: 'weekly_meta_review',
    cron: '0 7 * * 1',  // Mon 7am
    listIdEnv: 'CLICKUP_LIST_PERFORMANCE',
    title: () => `Weekly Meta ROAS Review — week of ${weekOf()}`,
    mode: 'Analyze',
  },
  {
    name: 'weekly_digest',
    cron: '0 16 * * 5',  // Fri 4pm
    listIdEnv: 'CLICKUP_LIST_PERFORMANCE',
    title: () => `Weekly Marketing Digest — week of ${weekOf()}`,
    mode: 'Analyze',
  },
  {
    name: 'monthly_report',
    cron: '0 7 1 * *',  // 1st of month 7am
    listIdEnv: 'CLICKUP_LIST_PERFORMANCE',
    title: () => `Monthly Marketing Report — ${monthName()}`,
    mode: 'Analyze',
  },
  {
    name: 'quarterly_strategy',
    cron: '0 7 1 1,4,7,10 *',  // 1st of each quarter 7am
    listIdEnv: 'CLICKUP_LIST_PERFORMANCE',
    title: () => `Quarterly Strategy Review — ${quarter()}`,
    mode: 'Strategize',
  },
  {
    name: 'flyer_audit',
    cron: '0 8 1 * *',  // 1st of month 8am
    listIdEnv: 'CLICKUP_LIST_FLYERS',
    title: () => `Flyer Audit — what's expired (${monthName()})`,
    mode: 'Analyze',
  },
  {
    name: 'email_queue_check',
    cron: '0 8 * * 2',  // Tue 8am
    listIdEnv: 'CLICKUP_LIST_EMAIL',
    title: () => `Email & SMS — what's queued this week`,
    mode: 'Analyze',
  },
  {
    name: 'annual_brand_review',
    cron: '0 7 1 1 *',  // Jan 1 7am
    listIdEnv: 'CLICKUP_LIST_STRATEGY',
    title: () => `Annual Brand Review — ${new Date().getFullYear()}`,
    mode: 'Strategize',
  },
]

function start() {
  for (const r of RHYTHMS) {
    const listId = process.env[r.listIdEnv]
    if (!listId) {
      console.warn(`[mastermind] rhythm '${r.name}' has no list id (env ${r.listIdEnv} unset) — skipped`)
      continue
    }
    cron.schedule(r.cron, async () => {
      try {
        const taskRes = await cu.cuFetch(`/list/${listId}/task`, {
          method: 'POST',
          body: JSON.stringify({
            name: r.title(),
            description: '(auto-created by Mastermind recurring rhythm)',
          }),
        }) || {}
        const taskId = taskRes.id
        if (taskId && process.env.CLICKUP_MASTERMIND_FIELD_ID) {
          await cu.setCustomField(taskId, process.env.CLICKUP_MASTERMIND_FIELD_ID, r.mode)
        }
        console.log(`[mastermind] rhythm '${r.name}' created task ${taskId}`)
      } catch (e) {
        console.error(`[mastermind] rhythm '${r.name}' failed`, e.message)
      }
    }, { timezone: 'America/Los_Angeles' })
    console.log(`[mastermind] rhythm '${r.name}' scheduled: ${r.cron}`)
  }
}

function weekOf() {
  const d = new Date()
  return d.toISOString().slice(0, 10)
}
function monthName() {
  const d = new Date()
  return d.toLocaleString('en-US', { month: 'long', year: 'numeric' })
}
function quarter() {
  const d = new Date()
  const q = Math.floor(d.getMonth() / 3) + 1
  return `Q${q} ${d.getFullYear()}`
}

module.exports = { start, RHYTHMS }
```

- [ ] **Step 2: Export `cuFetch` from `clickup.js` so rhythms can use it**

Modify `auth/src/mastermind/clickup.js`:
```javascript
module.exports = {
  cuFetch,  // <-- add this
  getTask, getTaskComments, postComment, updateTaskStatus,
  clearCustomField, setCustomField, createSubtask, createDoc,
}
```

- [ ] **Step 3: Wire rhythms into `mastermind/index.js`**

```javascript
const cron = require('node-cron')
const { tick } = require('./dispatch')
const rhythms = require('./rhythms')

function start() {
  if (process.env.MASTERMIND_ENABLED !== 'true') {
    console.log('[mastermind] disabled')
    return
  }
  cron.schedule('* * * * *', () => tick().catch(console.error))
  console.log('[mastermind] polling enabled (every 60s)')
  rhythms.start()
}

module.exports = { start }
```

- [ ] **Step 4: Commit**

---

## Section 13 — Admin stats endpoint

### Task 13.1: Create stats route

**Files:**
- Create: `auth/src/routes/mastermindStats.js`
- Modify: `auth/src/index.js`

- [ ] **Step 1: Create stats route**

```javascript
const { Router } = require('express')
const authenticate = require('../middleware/auth')
const { requireRole } = require('../middleware/role')
const { supabaseAdmin } = require('../services/supabase')

const router = Router()
router.use(authenticate)
router.use(requireRole('admin'))

router.get('/stats', async (req, res) => {
  const since = new Date()
  since.setUTCDate(since.getUTCDate() - 30)

  const { data: rows } = await supabaseAdmin
    .from('mastermind_queue')
    .select('mode, lane, status, cost_usd, input_tokens, output_tokens, model, requested_at, completed_at, task_id')
    .gte('requested_at', since.toISOString())

  const totalCost = (rows || []).reduce((s, r) => s + Number(r.cost_usd || 0), 0)
  const totalInvocations = (rows || []).length

  const byMode = {}
  const byLane = {}
  for (const r of rows || []) {
    byMode[r.mode] = (byMode[r.mode] || 0) + Number(r.cost_usd || 0)
    if (r.lane) byLane[r.lane] = (byLane[r.lane] || 0) + Number(r.cost_usd || 0)
  }

  const topTasks = [...(rows || [])]
    .sort((a, b) => Number(b.cost_usd || 0) - Number(a.cost_usd || 0))
    .slice(0, 10)
    .map(r => ({ task_id: r.task_id, mode: r.mode, cost_usd: r.cost_usd, model: r.model }))

  res.json({
    period_days: 30,
    total_cost_usd: totalCost,
    total_invocations: totalInvocations,
    by_mode: byMode,
    by_lane: byLane,
    top_tasks: topTasks,
  })
})

module.exports = router
```

- [ ] **Step 2: Mount in `auth/src/index.js`**

```javascript
app.use('/admin/mastermind', require('./routes/mastermindStats'))
```

- [ ] **Step 3: Commit**

---

## Section 14 — Admin dashboard frontend

### Task 14.1: Create dashboard component

**Files:**
- Create: `portal/src/components/admin/MastermindDashboard.jsx`
- Modify: portal admin nav file (`portal/src/components/admin/AdminView.jsx` or equivalent — verify path at build time)

- [ ] **Step 1: Create component**

```jsx
import { useEffect, useState } from 'react'
import { authFetch } from '../../lib/authFetch'  // adjust import to match codebase

export default function MastermindDashboard() {
  const [stats, setStats] = useState(null)
  const [err, setErr] = useState(null)

  useEffect(() => {
    authFetch('/admin/mastermind/stats')
      .then(r => r.json())
      .then(setStats)
      .catch(e => setErr(e.message))
  }, [])

  if (err) return <div className="p-4 text-red-600">Error: {err}</div>
  if (!stats) return <div className="p-4">Loading…</div>

  return (
    <div className="p-6 space-y-6">
      <h1 className="text-2xl font-semibold">Mastermind — Last 30 Days</h1>

      <div className="grid grid-cols-2 gap-4">
        <Card label="Total cost" value={`$${stats.total_cost_usd.toFixed(2)}`} />
        <Card label="Total invocations" value={stats.total_invocations} />
      </div>

      <Section title="By mode">
        <BreakdownTable data={stats.by_mode} />
      </Section>

      <Section title="By lane">
        <BreakdownTable data={stats.by_lane} />
      </Section>

      <Section title="Top 10 most expensive tasks">
        <table className="w-full text-sm">
          <thead><tr><th>Task ID</th><th>Mode</th><th>Model</th><th>Cost</th></tr></thead>
          <tbody>
            {(stats.top_tasks || []).map(t => (
              <tr key={t.task_id}>
                <td><a href={`https://app.clickup.com/t/${t.task_id}`} target="_blank" rel="noreferrer">{t.task_id}</a></td>
                <td>{t.mode}</td>
                <td>{t.model}</td>
                <td>${Number(t.cost_usd || 0).toFixed(4)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </Section>
    </div>
  )
}

function Card({ label, value }) {
  return (
    <div className="border rounded p-4">
      <div className="text-sm text-gray-500">{label}</div>
      <div className="text-2xl font-semibold">{value}</div>
    </div>
  )
}

function Section({ title, children }) {
  return (
    <div>
      <h2 className="text-lg font-medium mb-2">{title}</h2>
      {children}
    </div>
  )
}

function BreakdownTable({ data }) {
  const entries = Object.entries(data || {}).sort((a, b) => b[1] - a[1])
  if (entries.length === 0) return <div className="text-gray-500">No data yet.</div>
  return (
    <table className="w-full text-sm">
      <thead><tr><th align="left">Key</th><th align="right">Cost (USD)</th></tr></thead>
      <tbody>
        {entries.map(([k, v]) => (
          <tr key={k}><td>{k}</td><td align="right">${Number(v).toFixed(4)}</td></tr>
        ))}
      </tbody>
    </table>
  )
}
```

- [ ] **Step 2: Add to admin nav (find existing admin nav pattern in `portal/src/components/admin/`)**

Look for how `cacheAdmin`, `staffAdmin`, etc. are added to the admin nav. Mirror that pattern. **Verify at build time — paths may differ from spec.**

- [ ] **Step 3: Commit**

---

## Section 15 — ClickUp space provisioning script

### Task 15.1: Create provisioning script

**Files:**
- Create: `auth/scripts/provision-mastermind-space.js`

This is a one-time script that creates the entire ClickUp space programmatically. Justin runs it once.

- [ ] **Step 1: Write script that:**

1. Takes `CLICKUP_API_KEY` and `CLICKUP_WORKSPACE_ID` env vars
2. Creates a new space "WCS Marketing"
3. Creates the five lanes as folders (Inbox & Ideas, Strategy, Campaigns, Channels, Performance)
4. Creates the lists inside each folder per the spec
5. Creates custom fields (`Mastermind` dropdown, `Mastermind Paused` boolean, `Campaign Type`, `Channel`, `Location`, `Publish Date`, etc.)
6. Sets up statuses per list
7. Outputs an `env-additions.txt` file with all the IDs that need to be added to Render env (list IDs, field ID)

Full implementation is ~500 lines. Plan deferred — Justin can run it interactively during rollout Week 2.

- [ ] **Step 2: Commit skeleton + completion plan note**

---

## Section 16 — Documentation

### Task 16.1: Add deployment/ops doc

**Files:**
- Create: `docs/superpowers/runbooks/2026-05-21-mastermind-ops.md`

- [ ] **Step 1: Document env vars needed**

| Env var | Required | Notes |
|---|---|---|
| `MASTERMIND_ENABLED` | yes | `true` to enable; default false |
| `MASTERMIND_ANTHROPIC_API_KEY` | yes | dedicated key for billing isolation |
| `MASTERMIND_DAILY_CAP_USD` | no | default 25 |
| `MASTERMIND_TASK_CAP_USD` | no | default 2 |
| `CLICKUP_API_KEY` | yes | existing |
| `CLICKUP_WEBHOOK_SECRET` | yes | from ClickUp webhook setup |
| `CLICKUP_WORKSPACE_ID` | yes | for Docs API |
| `CLICKUP_MASTERMIND_FIELD_ID` | yes | from provisioning |
| `CLICKUP_LIST_PERFORMANCE` | yes | for rhythms |
| `CLICKUP_LIST_FLYERS` | yes | for rhythms |
| `CLICKUP_LIST_EMAIL` | yes | for rhythms |
| `CLICKUP_LIST_STRATEGY` | yes | for rhythms |

- [ ] **Step 2: Document the rollout sequence**

- [ ] **Step 3: Commit**

---

## Section 17 — Open PR

### Task 17.1: Push branch and open PR

- [ ] **Step 1: Push branch**

```bash
git push -u origin feat/marketing-mastermind
```

- [ ] **Step 2: Open PR via `gh pr create`**

PR title: `feat(mastermind): WCS Marketing Mastermind MVP — webhook + queue + processor + Draft mode`

Body should include:
- Summary of what's in the PR
- What's deferred (per spec — provisioning script, dashboard polish, full mode coverage)
- Manual steps Justin needs to take post-merge (env vars, ClickUp space, webhook registration)
- Link to the spec doc

- [ ] **Step 3: Do NOT merge** — Justin is merger of record (per memory: feedback_dont_auto_merge.md).

---

## Notes / questions for Justin to answer when he returns

These are non-blocking — I've made reasonable defaults but flag them here.

1. **Anthropic models in `anthropic.js` `DEFAULT_MODELS`** — I set Opus 4.7 for strategic modes and Sonnet 4.6 for data-heavy modes per the spec's cost analysis. If you want all-Sonnet for cost-conscious start, change in one place.

2. **`PRICING` table in `cost.js`** — verify current per-1M-token rates against your Anthropic billing page. I used my training-data numbers (Opus $15/$75, Sonnet $3/$15, Haiku $1/$5). If pricing changed, update the constants.

3. **Status name strings** — the dispatcher tries to set statuses like `'review'`, `'building'`, `'briefing'`, etc. ClickUp statuses are list-scoped and case-matters. After you create the space, verify status names match what the handlers expect; either rename in ClickUp or update the handler `statusAfter` strings.

4. **Section 10.7 (Campaign Lab promotion) is stubbed.** Real promotion requires ClickUp space/folder IDs that don't exist until provisioning. After Section 15 runs once, the IDs flow into env vars, and the stub can be replaced.

5. **No automated tests.** The auth service has no test framework. Smoke tests are the only verification. If you want unit tests added later, that's a separate plan.

6. **`fbRoas.js` shape unknown at planning time.** Task 10.3 may need a small refactor of that file to expose a function. Plan flagged this; implementation may discover the right shape.

7. **ClickUp `taskCommentPosted` webhook payload shape varies** — I used `event.comment.comment_text` as the field name based on docs but real payloads may use slightly different keys. First smoke test will validate.

8. **The `Mastermind` custom field ID needs to be set in env before status auto-transition and field reset work.** Fine for MVP — without it, work still completes, just doesn't reset the field. Field reset is a polish layer.

---

## Spec coverage self-review

Going through the spec sections to ensure plan coverage:

| Spec section | Plan task(s) |
|---|---|
| Goal / Non-goals | (Plan goal section reflects) |
| Architecture overview | Sections 0–4 |
| ClickUp space structure | Section 15 (provisioning script) |
| Mastermind trigger field | Section 2 (webhook field detection) + Section 11 (field reset) |
| `@mastermind` comment trigger | Section 2 (event handling) + Section 10.6 (continue mode) |
| Output destinations | Section 4.1 (dispatch handles comment/doc/subtask routing) |
| Per-mode behavior | Section 9 (Draft) + Section 10 (all other modes) |
| Recurring rhythms | Section 12 |
| Cost tracking | Section 4.1 (cost.js) + Section 13 (stats endpoint) + Section 14 (dashboard) |
| Safety rails | Section 4.1 (dispatch caps, pause check) + Section 2.1 (debounce) |
| Components to build | Sections 0–14 (matches spec component table) |
| Migration/rollout | Section 16 (docs) |
| Error handling | Section 4.1 (retry logic, markFailed) + Section 2.1 (error inserts) |

Gaps acknowledged: comment-storm cap (>5 mentions/hour) is not implemented in this plan — would go into the webhook handler's debounce logic in Task 2.1, extended. Plan-as-followup item.
