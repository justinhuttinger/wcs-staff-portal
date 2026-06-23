# Day One Program Generator → Portal Migration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Migrate the standalone Day One PT program generator into the wcs-staff-portal `auth/` backend as a modular webhook service that reuses portal infra, persists programs in Supabase, and generates programs in parallel for speed.

**Architecture:** A new Express route (`/day-one-program`) plus a `services/dayOneProgram/` module set. One GHL webhook creates a `pt_programs` job row and returns 200 immediately; a background pipeline assigns per-day focuses (form fields or a default split table), fans out N parallel day-calls + 1 overview-call to Claude, runs a final terminology call, assembles the program JSON, renders a PDF, and delivers it (email + ABC). A success page subscribes via SSE keyed on `contact_id`.

**Tech Stack:** Node 18+, Express 4, `@anthropic-ai/sdk@^0.97.1` (`claude-sonnet-4-6`), `@sendgrid/mail` (new), PDFShift, Supabase (`@supabase/supabase-js`, Postgres + Storage), `node:test` + `node:assert` for tests.

## Global Constraints

- **Model:** `claude-sonnet-4-6` for all AI calls. No model downgrade, no prompt caching.
- **Test runner:** Node built-in — `const test = require('node:test')`, `const assert = require('node:assert')`. Run with `node --test <file>`. No vitest/jest.
- **Anthropic SDK:** use the portal's existing `@anthropic-ai/sdk@^0.97.1`. All AI calls stream (`.messages.stream(...).finalMessage()`) and are wrapped in a mid-stream retry loop (transient `ERR_STREAM_PREMATURE_CLOSE`/`ECONNRESET`/`ETIMEDOUT`/`EPIPE`/`APIConnectionError`/"premature close"/"socket hang up" → retry up to 4 attempts with exp backoff capped at 8s; non-retryable API errors throw immediately).
- **Per-call truncation guard:** every AI call asserts `stop_reason !== 'max_tokens'` and throws loudly if it truncates. Never render raw/partial AI text into a client PDF.
- **Generation is all-or-nothing:** any day-call or overview-call failure after retries aborts the whole generation and sends a trainer error notification — no partial program is emailed.
- **Delivery resilience:** PDF disk/storage save, email, and ABC upload are each independently try/caught — one failing must never block the others.
- **Supabase access:** service-role only via `src/services/supabase.js` (`supabaseAdmin`). Every new table has **RLS enabled with no policy** (portal convention — frontend never touches it directly).
- **Locations:** resolve via `src/config/ghlLocations.js` `getLocationById(locationId)` → `{ id, apiKey, name, slug, clubCode }` (clubCode = ABC club number). All 7 locations active incl. Medford. Unknown location → 400 + error email.
- **Route mounting:** add `app.use('/day-one-program', require('./routes/dayOneProgram'))` in `src/index.js` alongside the other `app.use(...)` mounts.
- **No em-dashes in any user-facing copy** (emails, success page).
- **PDF output stays equivalent** — copy the existing HTML template + logo verbatim; no redesign.

## Reference: source files to port from

The current standalone implementation lives at `C:\Users\justi\dayone\server.js` (1,085 lines). Port logic from these functions (do not copy the monolith wholesale — split per the file structure below):
- Field mapping: `app.post('/webhook/generate-program'` body → `formData` (lines ~219–276).
- Prompt: `buildPrompt` (lines ~556–739).
- Retry helpers: `isRetryableStreamError`, `sleep`, `withStreamRetry` (lines ~430–467).
- PDF/HTML: `generatePDF`, `formatProgramHTML` (lines ~743–916).
- Email/ABC/error: `sendProgramEmail`, `uploadToABCFinancial`, `sendErrorNotification` (lines ~981–1071).
- Template + logo: `C:\Users\justi\dayone\templates\program-template.html` and `logo.png`.

## File Structure

**Create:**
- `auth/src/routes/dayOneProgram.js` — Express router (webhook, SSE stream, pdf download, success page).
- `auth/src/services/dayOneProgram/intake.js` — GHL webhook body → normalized `formData`.
- `auth/src/services/dayOneProgram/splits.js` — default split table + per-day focus resolution.
- `auth/src/services/dayOneProgram/prompts.js` — prompt builders (preamble, day, overview, terminology).
- `auth/src/services/dayOneProgram/anthropic.js` — streamed-with-retry Claude wrapper + error classifier.
- `auth/src/services/dayOneProgram/generate.js` — parallel orchestration + assembly.
- `auth/src/services/dayOneProgram/pdf.js` — HTML fill + PDFShift call.
- `auth/src/services/dayOneProgram/deliver.js` — SendGrid email + ABC upload + error notification.
- `auth/src/services/dayOneProgram/jobs.js` — `pt_programs` lifecycle + SSE pump helpers.
- `auth/src/services/dayOneProgram/successPage.js` — the success HTML page string builder.
- `auth/src/templates/day-one/program-template.html` — copied verbatim.
- `auth/src/templates/day-one/logo.png` — copied verbatim.
- `auth/migrations/054_pt_programs.sql` — table + indexes + RLS.
- Tests: `auth/src/services/dayOneProgram/{intake,splits,generate,anthropic}.test.js`.

**Modify:**
- `auth/src/index.js` — mount the new route.
- `auth/package.json` — add `@sendgrid/mail`.

---

### Task 1: Add `@sendgrid/mail` dependency

**Files:**
- Modify: `auth/package.json`

- [ ] **Step 1: Install the dependency**

Run (from `auth/`):
```bash
npm install @sendgrid/mail@^8.1.3
```
Expected: `package.json` gains `"@sendgrid/mail": "^8.1.3"` under dependencies; lockfile updates.

- [ ] **Step 2: Verify it resolves**

Run (from `auth/`):
```bash
node -e "require('@sendgrid/mail'); console.log('ok')"
```
Expected: prints `ok`.

- [ ] **Step 3: Commit**

```bash
git add auth/package.json auth/package-lock.json
git commit -m "build(day-one): add @sendgrid/mail for outbound program emails"
```

---

### Task 2: Database migration — `pt_programs`

**Files:**
- Create: `auth/migrations/054_pt_programs.sql`

**Interfaces:**
- Produces: table `pt_programs` with columns used by `jobs.js` (Task 6).

- [ ] **Step 1: Write the migration**

Create `auth/migrations/054_pt_programs.sql`:
```sql
-- Day One PT program generation jobs (migrated from standalone dayone service).
-- Replaces the ephemeral on-disk PDF cache + lastGeneratedPdf global var.
create table if not exists public.pt_programs (
  id            uuid primary key default gen_random_uuid(),
  contact_id    text not null,
  contact_name  text,
  contact_email text,
  location_id   text,
  club_code     text,
  trainer_name  text,
  abc_member_id text,
  status        text not null default 'pending',
  progress      text,
  program_json  jsonb,
  pdf_path      text,
  emailed       boolean not null default false,
  uploaded_abc  boolean not null default false,
  error_message text,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  completed_at  timestamptz
);

-- "latest job for this contact" lookup used by the SSE success page.
create index if not exists pt_programs_contact_created_idx
  on public.pt_programs (contact_id, created_at desc);

-- Portal convention: RLS on, no policy (service-role-only; frontend never reads this).
alter table public.pt_programs enable row level security;
```

- [ ] **Step 2: Apply the migration**

Apply via the project's normal migration path (Supabase MCP `apply_migration` with name `054_pt_programs`, or the repo's migration runner). Confirm the table exists:
```sql
select column_name from information_schema.columns where table_name = 'pt_programs' order by ordinal_position;
```
Expected: 18 columns matching the DDL above.

- [ ] **Step 3: Create the Storage bucket**

Create a **private** Supabase Storage bucket named `pt-programs` (via Supabase dashboard or MCP). Verify it exists and is not public.

- [ ] **Step 4: Commit**

```bash
git add auth/migrations/054_pt_programs.sql
git commit -m "feat(day-one): pt_programs table + storage for program persistence"
```

---

### Task 3: Intake field mapping

**Files:**
- Create: `auth/src/services/dayOneProgram/intake.js`
- Test: `auth/src/services/dayOneProgram/intake.test.js`

**Interfaces:**
- Produces: `mapWebhookToFormData(body) -> formData` object with keys: `trainerName, programGoal, duration, daysPerWeek, experienceLevel, equipment, weight, height, bodyFat, bmr, neckLimitation, shoulderLimitation, elbowWristLimitation, lowerBackLimitation, hipLimitation, kneeLimitation, ankleLimitation, otherLimitations, interestedIn, interestedInPT, preferredCoach, fitnessGoals, heartCondition, chestPain, boneJointProblem, bloodPressureMedication, medicalSupervisionNeeded, currentWorkoutRoutine, followsDietPlan, biggestObstacles, wouldHelpMost, gender, trainerNotes, day1Focus..day7Focus`. Limitation fields are booleans; the rest are strings. `duration`/`daysPerWeek` are digit-only strings.

- [ ] **Step 1: Write the failing test**

Create `auth/src/services/dayOneProgram/intake.test.js`:
```js
const test = require('node:test')
const assert = require('node:assert')
const { mapWebhookToFormData } = require('./intake')

test('maps core program-design fields with fallbacks', () => {
  const fd = mapWebhookToFormData({
    'Service Employee': 'Alex',
    'Program Goal': 'hypertrophy',
    'Duration (Weeks)': '12 weeks',
    'Days Per Week': '4 days a week',
    'Experience Level': 'Advanced',
    'Equipment': 'full gym',
  })
  assert.equal(fd.trainerName, 'Alex')
  assert.equal(fd.programGoal, 'hypertrophy')
  assert.equal(fd.duration, '12')          // " weeks" stripped
  assert.equal(fd.daysPerWeek, '4')        // " days a week" stripped
  assert.equal(fd.experienceLevel, 'advanced') // lowercased
})

test('defaults when fields are absent', () => {
  const fd = mapWebhookToFormData({})
  assert.equal(fd.programGoal, 'general fitness')
  assert.equal(fd.duration, '8')
  assert.equal(fd.daysPerWeek, '4')
  assert.equal(fd.experienceLevel, 'intermediate')
})

test('limitation fields become booleans incl. array form', () => {
  const fd = mapWebhookToFormData({
    'Knee Limitation': 'Yes',
    'Shoulder Limitation': ['Yes'],
    'Hip Limitation': 'No',
  })
  assert.equal(fd.kneeLimitation, true)
  assert.equal(fd.shoulderLimitation, true)
  assert.equal(fd.hipLimitation, false)
  assert.equal(fd.neckLimitation, false)
})

test('body fat and weight strip units; day focuses captured', () => {
  const fd = mapWebhookToFormData({
    'Body Fat (%)': '18%',
    'Weight (Lbs)': '180',
    'Day 1 Focus': 'Push',
    'Day Two Focus': 'Pull',
  })
  assert.equal(fd.bodyFat, '18')
  assert.equal(fd.weight, '180')
  assert.equal(fd.day1Focus, 'Push')
  assert.equal(fd.day2Focus, 'Pull')
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test auth/src/services/dayOneProgram/intake.test.js`
Expected: FAIL — cannot find module `./intake`.

- [ ] **Step 3: Write the implementation**

Create `auth/src/services/dayOneProgram/intake.js` (port the field-mapping block from `dayone/server.js` ~219–276):
```js
'use strict'

function bool(v) {
  return v === 'Yes' || (Array.isArray(v) && v.includes('Yes'))
}

// Map a GHL PT-Intake webhook body to a normalized formData object.
function mapWebhookToFormData(body = {}) {
  return {
    // Trainer & program design
    trainerName: body['Service Employee'] || '',
    programGoal: body['Program Goal'] || 'general fitness',
    duration: String(body['Duration (Weeks)'] || body['Duration'] || 8).replace(' weeks', ''),
    daysPerWeek: String(body['Days Per Week'] || body['Days per Week'] || 4)
      .replace(' days a week', '').replace(' day a week', ''),
    experienceLevel: (body['Experience Level'] || 'intermediate').toLowerCase(),
    equipment: body['Equipment'] || 'full gym',

    // InBody metrics
    weight: body['Weight (Lbs)'] || body['Weight'] || '',
    height: body['Height'] || '',
    bodyFat: String(body['Body Fat (%)'] || body['Body Fat'] || '').replace('%', ''),
    bmr: body['BMR'] || '',

    // Movement limitations
    neckLimitation: bool(body['Neck Limitation']),
    shoulderLimitation: bool(body['Shoulder Limitation']),
    elbowWristLimitation: bool(body['Elbow Wrist Limitation']),
    lowerBackLimitation: bool(body['Lower Back Limitation']),
    hipLimitation: bool(body['Hip Limitation']),
    kneeLimitation: bool(body['Knee Limitation']),
    ankleLimitation: bool(body['Ankle Limitation']),
    otherLimitations: body['Other Limitations'] || '',

    // Client goals & interests
    interestedIn: body['What are you interested in?'] || '',
    interestedInPT: body['Are you interested in Personal Training?'] || '',
    preferredCoach: body['Do you have a Preferred Coach?'] || '',
    fitnessGoals: body['What are your Fitness Goals?'] || '',

    // Medical screening
    heartCondition: body['Has a Doctor Ever Said You Have a Heart Condition & Recommended Only Medically Supervised Activity?'] || '',
    chestPain: body['Do You Experience Chest Pain During Physical Activity?'] || '',
    boneJointProblem: body['Do You Have a Bone or Joint Problem that Physical Activity Could Aggravate?'] || '',
    bloodPressureMedication: body['Has Your Doctor Recommended Medication for your Blood Pressure?'] || '',
    medicalSupervisionNeeded: body['Are you Aware of Any Reason you Should Not Exercise Without Medical Supervision'] || '',

    // Current fitness & nutrition
    currentWorkoutRoutine: body['What is Your Current Workout Routine?'] || '',
    followsDietPlan: body['Do You Follow a Diet / Meal Plan?'] || '',
    biggestObstacles: body['What are your Biggest Obstacles?'] || '',
    wouldHelpMost: body['What Would Help You the Most?'] || '',

    // Additional info
    gender: body['Gender'] || body['contact.gender'] || '',
    trainerNotes: body['contact.pt_notes'] || body['PT Notes'] || '',

    // Day focus (optional overrides)
    day1Focus: body['Day 1 Focus'] || '',
    day2Focus: body['Day Two Focus'] || '',
    day3Focus: body['Day Three Focus'] || '',
    day4Focus: body['Day Four Focus'] || '',
    day5Focus: body['Day Five Focus'] || '',
    day6Focus: body['Day Six Focus'] || '',
    day7Focus: body['Day Seven Focus'] || '',
  }
}

module.exports = { mapWebhookToFormData }
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test auth/src/services/dayOneProgram/intake.test.js`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add auth/src/services/dayOneProgram/intake.js auth/src/services/dayOneProgram/intake.test.js
git commit -m "feat(day-one): intake webhook field mapping"
```

---

### Task 4: Split table + per-day focus resolution

**Files:**
- Create: `auth/src/services/dayOneProgram/splits.js`
- Test: `auth/src/services/dayOneProgram/splits.test.js`

**Interfaces:**
- Consumes: `formData` from Task 3 (`daysPerWeek`, `day1Focus..day7Focus`).
- Produces: `resolveDayFocuses(formData) -> [{ day: number, focus: string }]` with length = parsed `daysPerWeek` (clamped 1..7). A trainer-supplied `dayNFocus` overrides the default for that day.

- [ ] **Step 1: Write the failing test**

Create `auth/src/services/dayOneProgram/splits.test.js`:
```js
const test = require('node:test')
const assert = require('node:assert')
const { resolveDayFocuses } = require('./splits')

test('3 days defaults to push/pull/legs', () => {
  const r = resolveDayFocuses({ daysPerWeek: '3' })
  assert.deepEqual(r.map(d => d.day), [1, 2, 3])
  assert.deepEqual(r.map(d => d.focus), ['Push', 'Pull', 'Legs'])
})

test('4 days defaults to upper/lower split', () => {
  const r = resolveDayFocuses({ daysPerWeek: '4' })
  assert.deepEqual(r.map(d => d.focus), ['Upper Body', 'Lower Body', 'Upper Body', 'Lower Body'])
})

test('trainer day focus overrides the default for that day', () => {
  const r = resolveDayFocuses({ daysPerWeek: '3', day2Focus: 'Conditioning' })
  assert.deepEqual(r.map(d => d.focus), ['Push', 'Conditioning', 'Legs'])
})

test('clamps to 1..7 and falls back for unknown counts', () => {
  assert.equal(resolveDayFocuses({ daysPerWeek: '0' }).length, 1)
  assert.equal(resolveDayFocuses({ daysPerWeek: '9' }).length, 7)
  assert.equal(resolveDayFocuses({ daysPerWeek: 'abc' }).length, 4) // default 4
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test auth/src/services/dayOneProgram/splits.test.js`
Expected: FAIL — cannot find module `./splits`.

- [ ] **Step 3: Write the implementation**

Create `auth/src/services/dayOneProgram/splits.js`:
```js
'use strict'

// Default training splits keyed by days/week. Each entry is the per-day focus.
const DEFAULT_SPLITS = {
  1: ['Full Body'],
  2: ['Upper Body', 'Lower Body'],
  3: ['Push', 'Pull', 'Legs'],
  4: ['Upper Body', 'Lower Body', 'Upper Body', 'Lower Body'],
  5: ['Push', 'Pull', 'Legs', 'Upper Body', 'Lower Body'],
  6: ['Push', 'Pull', 'Legs', 'Push', 'Pull', 'Legs'],
  7: ['Push', 'Pull', 'Legs', 'Upper Body', 'Lower Body', 'Full Body', 'Conditioning'],
}

function parseDays(daysPerWeek) {
  const n = parseInt(daysPerWeek, 10)
  if (Number.isNaN(n)) return 4          // default
  return Math.min(7, Math.max(1, n))     // clamp 1..7
}

// Build [{ day, focus }] for the program. Trainer dayNFocus fields override defaults.
function resolveDayFocuses(formData = {}) {
  const days = parseDays(formData.daysPerWeek)
  const defaults = DEFAULT_SPLITS[days]
  const out = []
  for (let day = 1; day <= days; day++) {
    const override = (formData[`day${day}Focus`] || '').trim()
    out.push({ day, focus: override || defaults[day - 1] })
  }
  return out
}

module.exports = { resolveDayFocuses, DEFAULT_SPLITS }
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test auth/src/services/dayOneProgram/splits.test.js`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add auth/src/services/dayOneProgram/splits.js auth/src/services/dayOneProgram/splits.test.js
git commit -m "feat(day-one): default split table + per-day focus resolution"
```

---

### Task 5: Anthropic streamed-with-retry wrapper

**Files:**
- Create: `auth/src/services/dayOneProgram/anthropic.js`
- Test: `auth/src/services/dayOneProgram/anthropic.test.js`

**Interfaces:**
- Produces:
  - `isRetryableStreamError(err) -> boolean`
  - `withStreamRetry(fn, maxAttempts = 4) -> Promise<any>`
  - `generateText({ prompt, maxTokens }) -> Promise<string>` — streams a `claude-sonnet-4-6` completion, retries transient mid-stream drops, throws on `max_tokens` truncation, returns the text of `content[0]`.
- Consumes: `process.env.ANTHROPIC_API_KEY`.

- [ ] **Step 1: Write the failing test** (classifier + retry loop are pure-ish and testable without the network)

Create `auth/src/services/dayOneProgram/anthropic.test.js`:
```js
const test = require('node:test')
const assert = require('node:assert')
const { isRetryableStreamError, withStreamRetry } = require('./anthropic')

test('classifies transient stream drops as retryable', () => {
  assert.equal(isRetryableStreamError({ code: 'ERR_STREAM_PREMATURE_CLOSE' }), true)
  assert.equal(isRetryableStreamError({ code: 'ECONNRESET' }), true)
  assert.equal(isRetryableStreamError({ message: 'Premature close' }), true)
  assert.equal(isRetryableStreamError({ constructor: { name: 'APIConnectionError' } }), true)
})

test('classifies real API errors as non-retryable', () => {
  assert.equal(isRetryableStreamError({ status: 400, message: 'credit balance too low' }), false)
  assert.equal(isRetryableStreamError({ message: 'invalid_request_error' }), false)
})

test('withStreamRetry retries transient then succeeds', async () => {
  let calls = 0
  const result = await withStreamRetry(async () => {
    calls++
    if (calls < 2) { const e = new Error('Premature close'); e.code = 'ERR_STREAM_PREMATURE_CLOSE'; throw e }
    return 'ok'
  }, 4)
  assert.equal(result, 'ok')
  assert.equal(calls, 2)
})

test('withStreamRetry rethrows non-retryable immediately', async () => {
  let calls = 0
  await assert.rejects(() => withStreamRetry(async () => { calls++; throw new Error('credit balance too low') }, 4))
  assert.equal(calls, 1)
})
```

Note: the backoff sleeps make the retry test take a couple seconds; that is acceptable.

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test auth/src/services/dayOneProgram/anthropic.test.js`
Expected: FAIL — cannot find module `./anthropic`.

- [ ] **Step 3: Write the implementation** (port from `dayone/server.js` ~28–36, 430–510)

Create `auth/src/services/dayOneProgram/anthropic.js`:
```js
'use strict'

const Anthropic = require('@anthropic-ai/sdk').default
  || require('@anthropic-ai/sdk').Anthropic
  || require('@anthropic-ai/sdk')

const MODEL = 'claude-sonnet-4-6'

const apiKey = process.env.ANTHROPIC_API_KEY
const client = apiKey
  ? new Anthropic({ apiKey, maxRetries: 4, timeout: 10 * 60 * 1000 })
  : null

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

// True when an error is a transient mid-stream connection drop worth retrying.
function isRetryableStreamError(err) {
  const code = err?.code || err?.cause?.code
  if (code === 'ERR_STREAM_PREMATURE_CLOSE' || code === 'ECONNRESET'
      || code === 'ETIMEDOUT' || code === 'EPIPE') {
    return true
  }
  if (err?.constructor?.name === 'APIConnectionError'
      || err?.constructor?.name === 'APIConnectionTimeoutError') {
    return true
  }
  const msg = `${err?.message || ''} ${err?.cause?.message || ''}`.toLowerCase()
  return msg.includes('premature close') || msg.includes('socket hang up')
    || msg.includes('connection error')
}

// Run a streaming call, retrying transient mid-stream drops with exp backoff.
async function withStreamRetry(fn, maxAttempts = 4) {
  let lastErr
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await fn()
    } catch (err) {
      lastErr = err
      if (attempt >= maxAttempts || !isRetryableStreamError(err)) throw err
      const delayMs = Math.min(1000 * 2 ** (attempt - 1), 8000)
      console.warn(`[DayOne] Stream dropped (${err?.code || err?.message}); retry ${attempt + 1}/${maxAttempts} in ${delayMs}ms`)
      await sleep(delayMs)
    }
  }
  throw lastErr
}

// Stream a single completion, returning its text. Throws on truncation.
async function generateText({ prompt, maxTokens = 4000 }) {
  if (!client) throw new Error('Anthropic client not initialized (ANTHROPIC_API_KEY missing)')
  const message = await withStreamRetry(() =>
    client.messages.stream({
      model: MODEL,
      max_tokens: maxTokens,
      messages: [{ role: 'user', content: prompt }],
    }).finalMessage()
  )
  if (message.stop_reason === 'max_tokens') {
    throw new Error(`Day One AI call hit max_tokens (truncated). Increase max_tokens.`)
  }
  return message.content[0].text
}

module.exports = { MODEL, isRetryableStreamError, withStreamRetry, generateText }
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test auth/src/services/dayOneProgram/anthropic.test.js`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add auth/src/services/dayOneProgram/anthropic.js auth/src/services/dayOneProgram/anthropic.test.js
git commit -m "feat(day-one): streamed-with-retry Anthropic wrapper"
```

---

### Task 6: Job lifecycle helpers (`jobs.js`)

**Files:**
- Create: `auth/src/services/dayOneProgram/jobs.js`

**Interfaces:**
- Consumes: `require('../supabase').supabaseAdmin`, table `pt_programs` (Task 2).
- Produces:
  - `createJob({ contactId, contactName, contactEmail, locationId, clubCode, trainerName, abcMemberId }) -> Promise<{ id }>`
  - `setProgress(id, status, progress) -> Promise<void>` (updates `status`, `progress`, `updated_at`)
  - `attachProgram(id, programJson) -> Promise<void>`
  - `attachPdf(id, pdfPath) -> Promise<void>`
  - `markFlags(id, { emailed, uploadedAbc }) -> Promise<void>`
  - `markComplete(id) -> Promise<void>` (status `complete`, `completed_at` now)
  - `markError(id, message) -> Promise<void>` (status `error`, `error_message`)
  - `getLatestForContact(contactId) -> Promise<row|null>` (ordered by `created_at desc`)
  - `uploadPdfToStorage(id, pdfBuffer) -> Promise<string>` (uploads to `pt-programs/{id}.pdf`, returns path)
  - `downloadPdfFromStorage(pdfPath) -> Promise<Buffer>`

- [ ] **Step 1: Write the implementation** (no unit test — thin Supabase wrapper, exercised in the integration/manual test)

Create `auth/src/services/dayOneProgram/jobs.js`:
```js
'use strict'

const { supabaseAdmin } = require('../supabase')

const BUCKET = 'pt-programs'

async function createJob(fields) {
  const { data, error } = await supabaseAdmin.from('pt_programs').insert({
    contact_id: fields.contactId,
    contact_name: fields.contactName || null,
    contact_email: fields.contactEmail || null,
    location_id: fields.locationId || null,
    club_code: fields.clubCode || null,
    trainer_name: fields.trainerName || null,
    abc_member_id: fields.abcMemberId || null,
    status: 'pending',
    progress: 'Queued',
  }).select('id').single()
  if (error) throw new Error(`createJob failed: ${error.message}`)
  return data
}

async function update(id, patch) {
  const { error } = await supabaseAdmin.from('pt_programs')
    .update({ ...patch, updated_at: new Date().toISOString() }).eq('id', id)
  if (error) throw new Error(`pt_programs update failed: ${error.message}`)
}

const setProgress = (id, status, progress) => update(id, { status, progress })
const attachProgram = (id, programJson) => update(id, { program_json: programJson })
const attachPdf = (id, pdfPath) => update(id, { pdf_path: pdfPath })
const markFlags = (id, { emailed, uploadedAbc }) =>
  update(id, { ...(emailed != null ? { emailed } : {}), ...(uploadedAbc != null ? { uploaded_abc: uploadedAbc } : {}) })
const markComplete = (id) => update(id, { status: 'complete', progress: 'Done', completed_at: new Date().toISOString() })
const markError = (id, message) => update(id, { status: 'error', error_message: String(message || '').slice(0, 2000) })

async function getLatestForContact(contactId) {
  const { data, error } = await supabaseAdmin.from('pt_programs')
    .select('*').eq('contact_id', contactId)
    .order('created_at', { ascending: false }).limit(1).maybeSingle()
  if (error) throw new Error(`getLatestForContact failed: ${error.message}`)
  return data
}

async function uploadPdfToStorage(id, pdfBuffer) {
  const pdfPath = `${id}.pdf`
  const { error } = await supabaseAdmin.storage.from(BUCKET)
    .upload(pdfPath, pdfBuffer, { contentType: 'application/pdf', upsert: true })
  if (error) throw new Error(`PDF storage upload failed: ${error.message}`)
  return pdfPath
}

async function downloadPdfFromStorage(pdfPath) {
  const { data, error } = await supabaseAdmin.storage.from(BUCKET).download(pdfPath)
  if (error) throw new Error(`PDF storage download failed: ${error.message}`)
  return Buffer.from(await data.arrayBuffer())
}

module.exports = {
  BUCKET, createJob, setProgress, attachProgram, attachPdf, markFlags,
  markComplete, markError, getLatestForContact, uploadPdfToStorage, downloadPdfFromStorage,
}
```

- [ ] **Step 2: Verify it loads**

Run: `node -e "require('./auth/src/services/dayOneProgram/jobs')" ` from repo root.
Expected: no error (Supabase client constructs from env; if env missing locally, this may throw — acceptable, the manual end-to-end on Render is the real check).

- [ ] **Step 3: Commit**

```bash
git add auth/src/services/dayOneProgram/jobs.js
git commit -m "feat(day-one): pt_programs job lifecycle + storage helpers"
```

---

### Task 7: Prompt builders

**Files:**
- Create: `auth/src/services/dayOneProgram/prompts.js`

**Interfaces:**
- Consumes: `contactData` (`{ firstName, lastName }`), `formData` (Task 3).
- Produces:
  - `buildPreamble(contactData, formData) -> string` — shared client context (info, limitations, medical, goals, trainer notes).
  - `buildDayPrompt(preamble, { day, focus }, formData) -> string` — asks for ONE workout day as JSON `{ day, title, focus, exercises:[{name,sets,reps,notes,variations}] }`.
  - `buildOverviewPrompt(preamble, dayFocuses) -> string` — asks for JSON `{ basicExplanation, progressionNotes, principles, importantNotes }`.
  - `buildTerminologyPrompt(workouts) -> string` — given the assembled workouts, asks for a `terminology` string defining ONLY terms used in those exercises/notes.

- [ ] **Step 1: Write the implementation** (port + split `buildPrompt` from `dayone/server.js` ~556–739; preserve all the CRITICAL INSTRUCTIONS, exercise-ordering rules, and the "never mention doctor/PT" rule)

Create `auth/src/services/dayOneProgram/prompts.js`:
```js
'use strict'

// Shared client-context preamble used by every parallel call.
function buildPreamble(contactData, formData) {
  const f = formData
  const limitations = []
  if (f.neckLimitation) limitations.push('Neck')
  if (f.shoulderLimitation) limitations.push('Shoulder')
  if (f.elbowWristLimitation) limitations.push('Elbow/Wrist')
  if (f.lowerBackLimitation) limitations.push('Lower Back')
  if (f.hipLimitation) limitations.push('Hip')
  if (f.kneeLimitation) limitations.push('Knee')
  if (f.ankleLimitation) limitations.push('Ankle')
  if (f.otherLimitations) limitations.push(`Other: ${f.otherLimitations}`)
  const limitationsText = limitations.length
    ? `MOVEMENT LIMITATIONS: ${limitations.join(', ')}. You MUST modify exercises to work around these limitations.`
    : 'No movement limitations reported.'

  const inbody = (f.weight || f.height || f.bodyFat || f.bmr)
    ? `INBODY METRICS: Weight: ${f.weight} lbs, Height: ${f.height} inches, Body Fat: ${f.bodyFat}%, BMR: ${f.bmr} calories/day`
    : ''

  const medical = []
  if (f.heartCondition && f.heartCondition !== 'No') medical.push(`Heart condition requiring medical supervision: ${f.heartCondition}`)
  if (f.chestPain && f.chestPain !== 'No') medical.push(`Chest pain during activity: ${f.chestPain}`)
  if (f.boneJointProblem && f.boneJointProblem !== 'No') medical.push(`Bone/joint concerns: ${f.boneJointProblem}`)
  if (f.bloodPressureMedication && f.bloodPressureMedication !== 'No') medical.push(`Blood pressure medication: ${f.bloodPressureMedication}`)
  if (f.medicalSupervisionNeeded && f.medicalSupervisionNeeded !== 'No') medical.push(`Other medical supervision needed: ${f.medicalSupervisionNeeded}`)
  const medicalText = medical.length
    ? `\nMEDICAL SCREENING ALERTS:\n- ${medical.join('\n- ')}\nIMPORTANT: Design a conservative program (moderate intensity, avoid high-impact, longer rest) that accounts for these.`
    : ''

  const ctx = []
  if (f.fitnessGoals) ctx.push(`Fitness Goals: ${f.fitnessGoals}`)
  if (f.currentWorkoutRoutine) ctx.push(`Current Routine: ${f.currentWorkoutRoutine}`)
  if (f.followsDietPlan) ctx.push(`Diet/Meal Plan: ${f.followsDietPlan}`)
  if (f.biggestObstacles) ctx.push(`Biggest Obstacles: ${f.biggestObstacles}`)
  if (f.wouldHelpMost) ctx.push(`What Would Help Most: ${f.wouldHelpMost}`)
  if (f.interestedIn) ctx.push(`Interests: ${f.interestedIn}`)
  const ctxText = ctx.length ? `\nCLIENT BACKGROUND:\n${ctx.join('\n')}` : ''

  const notesText = f.trainerNotes
    ? `\nTRAINER NOTES (IMPORTANT - use these to customize): ${f.trainerNotes}\nIncorporate these: include exercises the client loves, avoid ones they hate.`
    : ''

  return `CLIENT: ${contactData.firstName} ${contactData.lastName}
${f.gender ? `Gender: ${f.gender}` : ''}
Experience Level: ${f.experienceLevel}
Available Equipment: ${f.equipment}
Primary Goal: ${f.programGoal}
Program Length: ${f.duration} weeks, ${f.daysPerWeek} days/week
${inbody}
${ctxText}
${notesText}

${limitationsText}${medicalText}

RULES (apply to all output):
- If there are movement limitations, intelligently substitute safer variants (e.g. shoulder -> landmine/neutral-grip press; knee -> leg press/step-ups/belt squat; lower back -> hex-bar deadlift/hip thrust).
- NEVER mention or recommend consulting a physical therapist, doctor, physician, medical professional, or healthcare provider. Provide exercise modifications instead.
- Return ONLY valid JSON. No markdown code fences, no text before or after the JSON.`
}

// One workout day. Exercise order: hardest compounds first, finish all work for a
// muscle group before moving on, isolation last.
function buildDayPrompt(preamble, dayFocus, formData) {
  return `${preamble}

Create ONE workout day for this program.
DAY: ${dayFocus.day}
FOCUS: ${dayFocus.focus}

Requirements:
- 5-8 exercises with specific sets, reps, and form-cue notes.
- Provide 1-2 alternative variations per exercise.
- EXERCISE ORDER: most demanding compound lifts first (squats, deadlifts, presses, rows), then secondary compounds, then isolation. Complete ALL exercises for one muscle group before moving to the next (e.g. all back, THEN all biceps).
${formData.biggestObstacles ? `- Address their biggest obstacle: ${formData.biggestObstacles}` : ''}

Return ONLY this JSON object:
{
  "day": ${dayFocus.day},
  "title": "Workout name reflecting the focus",
  "focus": "Primary muscle groups / movement patterns",
  "exercises": [
    { "name": "Exercise name", "sets": "3", "reps": "8-10", "notes": "Form cues / modifications", "variations": "1-2 alternatives, e.g. 'DB Press, Machine Press'" }
  ]
}`
}

function buildOverviewPrompt(preamble, dayFocuses) {
  const split = dayFocuses.map(d => `Day ${d.day}: ${d.focus}`).join(', ')
  return `${preamble}

This program's training split is: ${split}.

Return ONLY this JSON object describing the program overview:
{
  "basicExplanation": "2-3 sentences: what this program is, the split used, how it helps reach the goal",
  "progressionNotes": "How to progress week to week - when to add weight/reps, specific protocol",
  "principles": "Core training principles this program is built on (e.g. progressive overload, compounds first)",
  "importantNotes": "Safety reminders, warm-up guidance, rest-day recommendations"
}`
}

// Terminology must stay relatable: only define terms actually used in the workouts.
function buildTerminologyPrompt(workouts) {
  const corpus = JSON.stringify(workouts)
  return `Below is the JSON of a training program's workouts.

${corpus}

Write a "terminology" glossary string that defines ONLY the training terms that actually appear in the exercise names or notes above (e.g. superset, AMRAP, RPE, tempo, drop set). Do NOT define any term that is not present in the workouts. Format each as "Term: definition" separated by line breaks.

Return ONLY this JSON object:
{ "terminology": "Term: definition\\nTerm: definition" }`
}

module.exports = { buildPreamble, buildDayPrompt, buildOverviewPrompt, buildTerminologyPrompt }
```

- [ ] **Step 2: Verify it loads**

Run: `node -e "const p=require('./auth/src/services/dayOneProgram/prompts'); console.log(typeof p.buildDayPrompt)"` from repo root.
Expected: prints `function`.

- [ ] **Step 3: Commit**

```bash
git add auth/src/services/dayOneProgram/prompts.js
git commit -m "feat(day-one): split prompt builders (preamble/day/overview/terminology)"
```

---

### Task 8: Parallel generation + assembly (`generate.js`)

**Files:**
- Create: `auth/src/services/dayOneProgram/generate.js`
- Test: `auth/src/services/dayOneProgram/generate.test.js`

**Interfaces:**
- Consumes: `resolveDayFocuses` (Task 4), `generateText` (Task 5), prompt builders (Task 7).
- Produces: `generateProgram(contactData, formData, { generateText } = deps) -> Promise<programJson>` where `programJson = { basicExplanation, progressionNotes, terminology, principles, importantNotes, weekTemplate: { workouts: [...] } }`. The `generateText` dep is injectable for testing. Includes a local `parseJson(text)` that strips markdown fences before `JSON.parse` and throws on failure.

- [ ] **Step 1: Write the failing test** (inject a fake `generateText`; assert parallelism, ordering, terminology-after-days, assembled shape)

Create `auth/src/services/dayOneProgram/generate.test.js`:
```js
const test = require('node:test')
const assert = require('node:assert')
const { generateProgram } = require('./generate')

function fakeGenerator() {
  const calls = []
  let daysSeenWhenTerminologyRan = null
  const generateText = async ({ prompt }) => {
    calls.push(prompt)
    if (prompt.includes('"basicExplanation"')) {
      return JSON.stringify({ basicExplanation: 'b', progressionNotes: 'p', principles: 'pr', importantNotes: 'n' })
    }
    if (prompt.includes('"terminology"')) {
      daysSeenWhenTerminologyRan = calls.filter(c => c.includes('Create ONE workout day')).length
      return JSON.stringify({ terminology: 'Superset: two exercises back to back' })
    }
    // day prompt — echo the day number requested
    const m = prompt.match(/DAY: (\d)/)
    const day = m ? Number(m[1]) : 1
    return JSON.stringify({ day, title: `Day ${day}`, focus: 'x', exercises: [{ name: 'Squat', sets: '3', reps: '5', notes: '', variations: '' }] })
  }
  return { generateText, calls, getDaysSeen: () => daysSeenWhenTerminologyRan }
}

test('assembles program with N workouts in day order', async () => {
  const fake = fakeGenerator()
  const program = await generateProgram(
    { firstName: 'Sam', lastName: 'Lee' },
    { daysPerWeek: '3', programGoal: 'strength', experienceLevel: 'intermediate', equipment: 'full gym', duration: '8' },
    { generateText: fake.generateText },
  )
  assert.deepEqual(program.weekTemplate.workouts.map(w => w.day), [1, 2, 3])
  assert.equal(program.basicExplanation, 'b')
  assert.equal(program.terminology, 'Superset: two exercises back to back')
})

test('terminology call runs AFTER all day calls', async () => {
  const fake = fakeGenerator()
  await generateProgram(
    { firstName: 'Sam', lastName: 'Lee' },
    { daysPerWeek: '3' },
    { generateText: fake.generateText },
  )
  assert.equal(fake.getDaysSeen(), 3) // all 3 day calls completed before terminology
})

test('throws if a day call returns unparseable JSON', async () => {
  const generateText = async ({ prompt }) => prompt.includes('Create ONE workout day') ? 'not json' : '{}'
  await assert.rejects(() => generateProgram({ firstName: 'A', lastName: 'B' }, { daysPerWeek: '2' }, { generateText }))
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test auth/src/services/dayOneProgram/generate.test.js`
Expected: FAIL — cannot find module `./generate`.

- [ ] **Step 3: Write the implementation**

Create `auth/src/services/dayOneProgram/generate.js`:
```js
'use strict'

const { resolveDayFocuses } = require('./splits')
const { generateText: realGenerateText } = require('./anthropic')
const { buildPreamble, buildDayPrompt, buildOverviewPrompt, buildTerminologyPrompt } = require('./prompts')

// Parse model output that may be wrapped in markdown fences.
function parseJson(text) {
  let s = String(text || '').trim()
  const jsonFence = s.match(/```json\s*\n?([\s\S]*?)\n?```/)
  const anyFence = s.match(/```\s*\n?([\s\S]*?)\n?```/)
  if (jsonFence) s = jsonFence[1]
  else if (anyFence) s = anyFence[1]
  return JSON.parse(s.trim())
}

// Generate a full program via parallel per-day calls + overview, then terminology.
async function generateProgram(contactData, formData, deps = {}) {
  const generateText = deps.generateText || realGenerateText
  const preamble = buildPreamble(contactData, formData)
  const dayFocuses = resolveDayFocuses(formData)

  // Fan out: N day-calls + 1 overview-call, all in parallel.
  const dayPromises = dayFocuses.map(df =>
    generateText({ prompt: buildDayPrompt(preamble, df, formData), maxTokens: 3000 })
      .then(parseJson)
  )
  const overviewPromise = generateText({ prompt: buildOverviewPrompt(preamble, dayFocuses), maxTokens: 2000 })
    .then(parseJson)

  const [workoutsRaw, overview] = await Promise.all([Promise.all(dayPromises), overviewPromise])

  // Keep day order stable.
  const workouts = workoutsRaw.slice().sort((a, b) => (a.day || 0) - (b.day || 0))

  // Terminology AFTER days so it only defines terms actually used.
  const terminologyRaw = await generateText({ prompt: buildTerminologyPrompt(workouts), maxTokens: 1500 })
  const { terminology } = parseJson(terminologyRaw)

  return {
    basicExplanation: overview.basicExplanation || '',
    progressionNotes: overview.progressionNotes || '',
    terminology: terminology || '',
    principles: overview.principles || '',
    importantNotes: overview.importantNotes || '',
    weekTemplate: { workouts },
  }
}

module.exports = { generateProgram, parseJson }
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test auth/src/services/dayOneProgram/generate.test.js`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add auth/src/services/dayOneProgram/generate.js auth/src/services/dayOneProgram/generate.test.js
git commit -m "feat(day-one): parallel per-day generation + assembly"
```

---

### Task 9: Copy templates + PDF builder (`pdf.js`)

**Files:**
- Create: `auth/src/templates/day-one/program-template.html` (copied)
- Create: `auth/src/templates/day-one/logo.png` (copied)
- Create: `auth/src/services/dayOneProgram/pdf.js`

**Interfaces:**
- Consumes: `contactData`, `programContent` (the assembled program from Task 8, plus `trainerName` + `medicalScreening` attached by the caller).
- Produces: `buildProgramPdf(contactData, programContent) -> Promise<Buffer>`.

- [ ] **Step 1: Copy the template + logo verbatim**

Run (from repo root):
```bash
mkdir -p auth/src/templates/day-one
cp /c/Users/justi/dayone/templates/program-template.html auth/src/templates/day-one/program-template.html
cp /c/Users/justi/dayone/templates/logo.png auth/src/templates/day-one/logo.png
```
Expected: both files present under `auth/src/templates/day-one/`.

- [ ] **Step 2: Write the implementation** (port `formatProgramHTML` + `generatePDF` from `dayone/server.js` ~743–916; use the portal's PDFShift Basic-auth `fetch` pattern from `hrDocuments.js`)

Create `auth/src/services/dayOneProgram/pdf.js`:
```js
'use strict'

const fs = require('fs').promises
const path = require('path')

const TEMPLATE_DIR = path.join(__dirname, '..', '..', 'templates', 'day-one')

function formatTerminology(text) {
  if (!text) return ''
  return text
    .replace(/([A-Za-z\s]+):/g, '<strong>$1</strong>:')
    .replace(/([A-Za-z]+)\s*-\s+/g, '<strong>$1</strong> - ')
}

// Build the inner program HTML (same markup as the standalone service).
function formatProgramHTML(contactData, programContent) {
  if (!programContent.weekTemplate && !programContent.weeks) {
    return `<div class="program-text">${programContent.programText || 'Program content'}</div>`
  }
  const name = `${contactData.firstName} ${contactData.lastName}`
  let html = `
    <div class="page">
      <img src="data:image/png;base64,{{logoBase64}}" class="logo-image" alt="WCS Logo">
      <div class="page-header" style="margin-bottom: 10px;">
        <div class="header-left"><h1>WEST COAST STRENGTH</h1><h2>PROGRAM OVERVIEW</h2></div>
        <div class="header-right" style="padding-top: 30px;"><p>CLIENT: ${name}</p></div>
      </div>
      <div class="core-concepts" style="margin-top: 5px;">
        <h3 style="margin-bottom: 3px;">BASIC EXPLANATION:</h3>
        <div class="core-concepts-content" style="margin-bottom: 10px;"><p style="margin: 0;">${programContent.basicExplanation || ''}</p></div>
        <h3 style="margin-bottom: 3px;">PROGRESSION:</h3>
        <div class="core-concepts-content" style="margin-bottom: 10px;"><p style="margin: 0;">${programContent.progressionNotes || ''}</p></div>
        <h3 style="margin-bottom: 3px;">TERMINOLOGY:</h3>
        <div class="core-concepts-content" style="margin-bottom: 10px;"><p style="margin: 0;">${formatTerminology(programContent.terminology) || ''}</p></div>
        <h3 style="margin-bottom: 3px;">PRINCIPLES:</h3>
        <div class="core-concepts-content" style="margin-bottom: 10px;"><p style="margin: 0;">${programContent.principles || ''}</p></div>
        <h3 style="margin-bottom: 3px;">IMPORTANT NOTES:</h3>
        <div class="core-concepts-content" style="margin-bottom: 10px;"><p style="margin: 0;">${programContent.importantNotes || ''}</p></div>
      </div>
    </div>`

  const workouts = programContent.weekTemplate?.workouts || programContent.weeks?.[0]?.workouts || []
  workouts.forEach(workout => {
    html += `
      <div class="page">
        <img src="data:image/png;base64,{{logoBase64}}" class="logo-image" alt="WCS Logo">
        <div class="page-header">
          <div class="header-left"><h1>WEST COAST STRENGTH</h1><h2>DAY ${workout.day} - ${String(workout.title || '').toUpperCase()}</h2></div>
          <div class="header-right" style="padding-top: 30px;"><p>CLIENT: ${name}</p></div>
        </div>
        <table style="width: 100%; border-collapse: collapse; border: 1px solid #000;">
          <thead><tr>
            <th style="text-align: left; padding: 8px; border: 1px solid #000;">EXERCISE</th>
            <th style="text-align: center; padding: 8px; border: 1px solid #000; width: 100px;"></th>
            <th style="text-align: left; padding: 8px; border: 1px solid #000; width: 180px;">VARIATIONS</th>
          </tr></thead>
          <tbody>`
    ;(workout.exercises || []).forEach(ex => {
      const setsReps = `${ex.sets} x ${ex.reps}`
      const notes = ex.notes || ''
      const variations = ex.variations || ex.variation || ''
      html += `
        <tr>
          <td style="padding: 8px; border: 1px solid #000;"><strong>${ex.name}</strong>${notes ? `<br><span style="font-size: 11px; color: #666;">${notes}</span>` : ''}</td>
          <td style="text-align: center; padding: 8px; border: 1px solid #000; width: 100px;">${setsReps}</td>
          <td style="padding: 8px; border: 1px solid #000; width: 180px; font-size: 11px;">${variations}</td>
        </tr>`
    })
    html += `</tbody></table></div>`
  })
  return html
}

async function buildProgramPdf(contactData, programContent) {
  const htmlTemplate = await fs.readFile(path.join(TEMPLATE_DIR, 'program-template.html'), 'utf8')
  const logoBase64 = (await fs.readFile(path.join(TEMPLATE_DIR, 'logo.png'))).toString('base64')

  let programHTML = formatProgramHTML(contactData, programContent).replace(/{{logoBase64}}/g, logoBase64)
  const finalHtml = htmlTemplate.replace(/{{programContent}}/g, programHTML)

  const apiKey = process.env.PDFSHIFT_API_KEY
  if (!apiKey) throw new Error('PDFSHIFT_API_KEY not set')

  const resp = await fetch('https://api.pdfshift.io/v3/convert/pdf', {
    method: 'POST',
    headers: {
      Authorization: 'Basic ' + Buffer.from('api:' + apiKey).toString('base64'),
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      source: finalHtml,
      landscape: false,
      use_print: true,
      margin: { top: '0.5in', bottom: '0.5in', left: '0.5in', right: '0.5in' },
    }),
  })
  if (!resp.ok) throw new Error(`PDFShift error ${resp.status}: ${await resp.text()}`)
  return Buffer.from(await resp.arrayBuffer())
}

module.exports = { buildProgramPdf, formatProgramHTML }
```

- [ ] **Step 3: Verify it loads + renders HTML offline**

Run (from repo root):
```bash
node -e "const {formatProgramHTML}=require('./auth/src/services/dayOneProgram/pdf'); const h=formatProgramHTML({firstName:'Sam',lastName:'Lee'},{basicExplanation:'b',weekTemplate:{workouts:[{day:1,title:'Push',exercises:[{name:'Bench',sets:'3',reps:'5'}]}]}}); console.log(h.includes('DAY 1 - PUSH') && h.includes('Bench'))"
```
Expected: prints `true`.

- [ ] **Step 4: Commit**

```bash
git add auth/src/templates/day-one auth/src/services/dayOneProgram/pdf.js
git commit -m "feat(day-one): port HTML template + PDFShift PDF builder"
```

---

### Task 10: Delivery — email + ABC + error notification (`deliver.js`)

**Files:**
- Create: `auth/src/services/dayOneProgram/deliver.js`

**Interfaces:**
- Consumes: `@sendgrid/mail`, `process.env.SENDGRID_API_KEY`, `FROM_EMAIL`, ABC `app_id`/`app_key`.
- Produces:
  - `clubFromName(club) -> string`
  - `sendProgramEmail(contactData, club, pdfBuffer) -> Promise<void>`
  - `uploadToABC(memberId, clubCode, pdfBuffer, contactData) -> Promise<void>`
  - `sendErrorNotification(error, contactId, club) -> Promise<void>`
- Note: ABC document filename must strip disallowed chars (parens etc.) — see `reference_abc_document_filename` memory; ABC silently drops uploads with bad filename chars.

- [ ] **Step 1: Write the implementation** (port `sendProgramEmail`/`uploadToABCFinancial`/`sendErrorNotification` from `dayone/server.js` ~981–1071; no em-dashes in copy; sanitize filename)

Create `auth/src/services/dayOneProgram/deliver.js`:
```js
'use strict'

const sgMail = require('@sendgrid/mail')
if (process.env.SENDGRID_API_KEY) sgMail.setApiKey(process.env.SENDGRID_API_KEY)

const FROM_EMAIL = process.env.FROM_EMAIL || 'programs@westcoaststrength.com'
const ADMIN_EMAIL = process.env.DAY_ONE_ADMIN_EMAIL || 'justin@westcoaststrength.com'

// ABC silently drops uploads whose filename has disallowed chars (parens etc.).
function safeFilename(contactData) {
  const base = `Training_Program_${contactData.firstName}_${contactData.lastName}`
  return base.replace(/[^A-Za-z0-9_\-]/g, '') + '.pdf'
}

function clubFromName(club) {
  const name = club.name || 'West Coast Strength'
  return name.includes('West Coast Strength') ? name : `West Coast Strength - ${name}`
}

async function sendProgramEmail(contactData, club, pdfBuffer) {
  const fromName = clubFromName(club)
  await sgMail.send({
    to: contactData.email,
    from: { email: FROM_EMAIL, name: fromName },
    subject: `Your Personalized Training Program - ${contactData.firstName}`,
    text: `Hi ${contactData.firstName},\n\nYour customized training program from ${fromName} is attached. Please review it carefully and reach out if you have any questions.\n\nLet's crush these goals!\n\n${fromName}`,
    html: `<p>Hi ${contactData.firstName},</p><p>Your customized training program from <strong>${fromName}</strong> is attached. Please review it carefully and reach out if you have any questions.</p><p><strong>Let's crush these goals!</strong></p><p>${fromName}</p>`,
    attachments: [{
      content: pdfBuffer.toString('base64'),
      filename: safeFilename(contactData),
      type: 'application/pdf',
      disposition: 'attachment',
    }],
  })
}

async function uploadToABC(memberId, clubCode, pdfBuffer, contactData) {
  const payload = {
    document: pdfBuffer.toString('base64'),
    documentName: safeFilename(contactData),
    documentType: 'pdf',
    imageType: 'member_document',
    memberId,
  }
  const resp = await fetch(`https://api.abcfinancial.com/rest/${clubCode}/members/documents/${memberId}`, {
    method: 'POST',
    headers: {
      app_id: process.env.ABC_APP_ID,
      app_key: process.env.ABC_APP_KEY,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(payload),
  })
  if (!resp.ok) throw new Error(`ABC upload error ${resp.status}: ${await resp.text()}`)
  return resp.json().catch(() => ({}))
}

async function sendErrorNotification(error, contactId, club) {
  if (!process.env.SENDGRID_API_KEY) return
  try {
    await sgMail.send({
      to: ADMIN_EMAIL,
      from: FROM_EMAIL,
      subject: `PT Program Generator Error - ${club?.name || 'unknown'}`,
      text: `Error generating program for contact ${contactId} at ${club?.name} (${club?.clubCode}):\n\n${error.message}\n\n${error.stack || ''}`,
    })
  } catch (e) {
    console.error('[DayOne] Failed to send error notification:', e.message)
  }
}

module.exports = { clubFromName, sendProgramEmail, uploadToABC, sendErrorNotification, safeFilename }
```

- [ ] **Step 2: Verify it loads + filename sanitization**

Run (from repo root):
```bash
node -e "const d=require('./auth/src/services/dayOneProgram/deliver'); console.log(d.safeFilename({firstName:'Mary (Jo)',lastName:\"O'Neil\"}))"
```
Expected: prints `Training_Program_MaryJo_ONeil.pdf` (parens, spaces, apostrophe stripped).

- [ ] **Step 3: Commit**

```bash
git add auth/src/services/dayOneProgram/deliver.js
git commit -m "feat(day-one): email + ABC upload + error notification (sanitized filenames)"
```

---

### Task 11: Success page builder (`successPage.js`)

**Files:**
- Create: `auth/src/services/dayOneProgram/successPage.js`

**Interfaces:**
- Produces: `renderSuccessPage(contactId) -> string` — an HTML page that opens an EventSource to `/day-one-program/status/stream?contactId=...`, shows live progress, and on a `done` event redirects to the PDF download (`/day-one-program/pdf/:jobId`). No em-dashes in copy.

- [ ] **Step 1: Write the implementation**

Create `auth/src/services/dayOneProgram/successPage.js`:
```js
'use strict'

function renderSuccessPage(contactId) {
  const cid = encodeURIComponent(contactId || '')
  return `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <title>Generating Program...</title>
  <style>
    body { font-family: Arial, sans-serif; text-align: center; padding: 50px; color: #222; }
    h1 { color: #E31E24; }
    #steps { margin-top: 20px; font-size: 16px; color: #555; min-height: 24px; }
    a { color: #E31E24; font-weight: bold; }
  </style>
</head>
<body>
  <h1>Generating Program...</h1>
  <p>Your personalized training program is being created. This usually takes 10 to 15 seconds.</p>
  <div id="steps">Starting...</div>
  <script>
    var stepsEl = document.getElementById('steps');
    var es = new EventSource('/day-one-program/status/stream?contactId=${cid}');
    es.addEventListener('progress', function (e) {
      try { var d = JSON.parse(e.data); stepsEl.textContent = d.progress || d.status || ''; } catch (_) {}
    });
    es.addEventListener('done', function (e) {
      try {
        var d = JSON.parse(e.data);
        es.close();
        if (d.jobId) {
          stepsEl.innerHTML = 'Program ready. Opening your PDF...';
          window.location.href = '/day-one-program/pdf/' + d.jobId;
        } else {
          stepsEl.textContent = 'Program sent. Check the client email.';
        }
      } catch (_) {}
    });
    es.addEventListener('failed', function (e) {
      es.close();
      stepsEl.innerHTML = 'Your program is still being sent. Please check the client email shortly.';
    });
    es.onerror = function () { /* keep the page; SSE auto-reconnects */ };
  </script>
</body>
</html>`
}

module.exports = { renderSuccessPage }
```

- [ ] **Step 2: Verify it loads**

Run: `node -e "console.log(require('./auth/src/services/dayOneProgram/successPage').renderSuccessPage('abc').includes('EventSource'))"` from repo root.
Expected: prints `true`.

- [ ] **Step 3: Commit**

```bash
git add auth/src/services/dayOneProgram/successPage.js
git commit -m "feat(day-one): SSE success page"
```

---

### Task 12: Route + orchestration (`dayOneProgram.js`) + mount

**Files:**
- Create: `auth/src/routes/dayOneProgram.js`
- Modify: `auth/src/index.js` (add the mount line)

**Interfaces:**
- Consumes: everything above — `mapWebhookToFormData`, `getLocationById`, `ghlFetch`, `createJob`/`setProgress`/`attachProgram`/`attachPdf`/`markFlags`/`markComplete`/`markError`/`getLatestForContact`/`uploadPdfToStorage`/`downloadPdfFromStorage`, `generateProgram`, `buildProgramPdf`, `sendProgramEmail`/`uploadToABC`/`sendErrorNotification`, `renderSuccessPage`.
- Produces: an Express router with `POST /webhook`, `GET /status/stream`, `GET /pdf/:jobId`, `GET /success`.

- [ ] **Step 1: Write the route**

Create `auth/src/routes/dayOneProgram.js`:
```js
'use strict'

const { Router } = require('express')
const { getLocationById } = require('../config/ghlLocations')
const { ghlFetch } = require('../services/ghlClient')
const { mapWebhookToFormData } = require('../services/dayOneProgram/intake')
const { generateProgram } = require('../services/dayOneProgram/generate')
const { buildProgramPdf } = require('../services/dayOneProgram/pdf')
const deliver = require('../services/dayOneProgram/deliver')
const jobs = require('../services/dayOneProgram/jobs')
const { renderSuccessPage } = require('../services/dayOneProgram/successPage')

const router = Router()

// Resolve a GHL contact to the fields we need.
async function fetchContact(contactId, club) {
  const data = await ghlFetch(`/contacts/${contactId}`, club.apiKey)
  const c = data.contact || {}
  return {
    id: c.id,
    name: c.name || 'Client',
    firstName: c.firstName || '',
    lastName: c.lastName || '',
    email: c.email,
    phone: c.phone,
  }
}

// Background pipeline. Updates the job row as it advances (SSE reads the row).
async function runPipeline(jobId, contactId, club, formData, abcMemberId) {
  try {
    await jobs.setProgress(jobId, 'generating', 'Fetching client details')
    const contact = await fetchContact(contactId, club)
    await jobs.setProgress(jobId, 'generating', 'Designing your workouts')

    const program = await generateProgram(contact, formData)
    program.trainerName = formData.trainerName || ''
    program.medicalScreening = {
      heartCondition: formData.heartCondition || 'No',
      chestPain: formData.chestPain || 'No',
      boneJointProblem: formData.boneJointProblem || 'No',
      bloodPressureMedication: formData.bloodPressureMedication || 'No',
      medicalSupervisionNeeded: formData.medicalSupervisionNeeded || 'No',
    }
    await jobs.attachProgram(jobId, program)

    await jobs.setProgress(jobId, 'rendering', 'Building your PDF')
    const pdfBuffer = await buildProgramPdf(contact, program)

    // Persist PDF (non-fatal).
    try {
      const pdfPath = await jobs.uploadPdfToStorage(jobId, pdfBuffer)
      await jobs.attachPdf(jobId, pdfPath)
    } catch (e) {
      console.warn('[DayOne] PDF storage save failed (continuing):', e.message)
    }

    await jobs.setProgress(jobId, 'delivering', 'Emailing the client')
    // Email + ABC are independent: one failing must not block the other.
    try { await deliver.sendProgramEmail(contact, club, pdfBuffer); await jobs.markFlags(jobId, { emailed: true }) }
    catch (e) { console.warn('[DayOne] Email failed:', e.message) }

    if (abcMemberId && club.clubCode) {
      try { await deliver.uploadToABC(abcMemberId, club.clubCode, pdfBuffer, contact); await jobs.markFlags(jobId, { uploadedAbc: true }) }
      catch (e) { console.warn('[DayOne] ABC upload failed:', e.message) }
    }

    await jobs.markComplete(jobId)
  } catch (err) {
    console.error('[DayOne] Pipeline error:', err)
    await jobs.markError(jobId, err.message).catch(() => {})
    await deliver.sendErrorNotification(err, contactId, club).catch(() => {})
  }
}

// POST /day-one-program/webhook — GHL trigger.
router.post('/webhook', async (req, res) => {
  try {
    const contactId = req.body.contact_id
    const locationId = req.body.location?.id
    if (!contactId) return res.status(400).json({ error: 'Missing contact_id' })
    if (!locationId) return res.status(400).json({ error: 'Missing location.id' })

    const club = getLocationById(locationId)
    if (!club) {
      await deliver.sendErrorNotification(new Error(`Unknown location ${locationId}`), contactId, { name: locationId })
      return res.status(400).json({ error: `Unknown location ${locationId}` })
    }

    const formData = mapWebhookToFormData(req.body)
    const abcMemberId = req.body['ABC Member ID'] || null

    const job = await jobs.createJob({
      contactId,
      locationId,
      clubCode: club.clubCode,
      trainerName: formData.trainerName,
      abcMemberId,
    })

    // Respond immediately; run generation in the background.
    res.status(200).json({ message: 'Program generation started', jobId: job.id, success: true })
    runPipeline(job.id, contactId, club, formData, abcMemberId)
  } catch (err) {
    console.error('[DayOne] Webhook error:', err)
    if (!res.headersSent) res.status(500).json({ error: err.message })
  }
})

// GET /day-one-program/status/stream?contactId=... — SSE progress for the latest job.
router.get('/status/stream', async (req, res) => {
  const contactId = req.query.contactId
  res.set({ 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive' })
  res.flushHeaders?.()

  let closed = false
  req.on('close', () => { closed = true })

  const startedAt = Date.now()
  const MAX_MS = 2 * 60 * 1000

  const send = (event, data) => res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`)

  async function tick() {
    if (closed) return
    try {
      const row = contactId ? await jobs.getLatestForContact(contactId) : null
      if (row) {
        send('progress', { status: row.status, progress: row.progress })
        if (row.status === 'complete') { send('done', { jobId: row.id }); return res.end() }
        if (row.status === 'error') { send('failed', { error: row.error_message }); return res.end() }
      }
    } catch (e) {
      // transient read error; keep polling
    }
    if (Date.now() - startedAt > MAX_MS) { send('failed', { error: 'timeout' }); return res.end() }
    setTimeout(tick, 1500)
  }
  tick()
})

// GET /day-one-program/pdf/:jobId — stream the finished PDF.
router.get('/pdf/:jobId', async (req, res) => {
  try {
    const { data, error } = await require('../services/supabase').supabaseAdmin
      .from('pt_programs').select('pdf_path, contact_name').eq('id', req.params.jobId).maybeSingle()
    if (error || !data?.pdf_path) return res.status(404).send('Program PDF not found')
    const buf = await jobs.downloadPdfFromStorage(data.pdf_path)
    res.set({ 'Content-Type': 'application/pdf', 'Content-Disposition': 'inline; filename="Training_Program.pdf"' })
    res.send(buf)
  } catch (e) {
    res.status(500).send('Error loading PDF')
  }
})

// GET /day-one-program/success?contactId=... — the SSE success page.
router.get('/success', (req, res) => {
  res.set('Content-Type', 'text/html')
  res.send(renderSuccessPage(req.query.contactId))
})

module.exports = router
```

- [ ] **Step 2: Mount the route in `index.js`**

In `auth/src/index.js`, add alongside the other `app.use(...)` mounts (e.g. right after the `app.use('/webhooks', ...)` lines):
```js
app.use('/day-one-program', require('./routes/dayOneProgram'))
```

- [ ] **Step 3: Verify the app boots with the route**

Run (from `auth/`): `node -e "require('./src/routes/dayOneProgram'); console.log('route loads')"`
Expected: prints `route loads` (no missing-module errors).

- [ ] **Step 4: Commit**

```bash
git add auth/src/routes/dayOneProgram.js auth/src/index.js
git commit -m "feat(day-one): webhook route, background pipeline, SSE stream, PDF download, mount"
```

---

### Task 13: Run the full test suite + boot check

**Files:** none (verification task)

- [ ] **Step 1: Run all Day One unit tests**

Run (from repo root):
```bash
node --test auth/src/services/dayOneProgram/
```
Expected: all tests across `intake`, `splits`, `anthropic`, `generate` PASS, 0 failures.

- [ ] **Step 2: Boot the auth server locally to confirm no startup error**

Run (from `auth/`, with env present): `node -e "process.env.PORT=0; require('./src/index.js'); setTimeout(()=>{console.log('booted ok'); process.exit(0)}, 1500)"`
Expected: prints `booted ok` (the route mount and all requires resolve). If Supabase/env is unavailable locally, instead confirm each module `require`s without error individually.

- [ ] **Step 3: Commit (if anything was fixed)**

```bash
git add -A
git commit -m "test(day-one): green unit suite + boot check" || echo "nothing to commit"
```

---

### Task 14: Cutover runbook (manual, documented — not auto-run)

**Files:**
- Modify: `docs/superpowers/specs/2026-06-23-day-one-portal-migration-design.md` is the reference; record actual values here as a checklist when executed.

This task is performed by Justin / operator after the PR merges and deploys. Do NOT run it as part of code implementation.

- [ ] **Step 1: Set portal env vars on Render** (auth service): `SENDGRID_API_KEY` (same key the dayone service uses), `FROM_EMAIL=programs@westcoaststrength.com`, `GHL_LOCATION_MEDFORD`, `GHL_API_KEY_MEDFORD`. Confirm `ANTHROPIC_API_KEY`, `PDFSHIFT_API_KEY`, `ABC_APP_ID`, `ABC_APP_KEY` already present.
- [ ] **Step 2:** Confirm migration `054_pt_programs` applied and `pt-programs` Storage bucket exists (Task 2).
- [ ] **Step 3:** Deploy the branch to a Render preview/the auth service. Hit `GET /day-one-program/success?contactId=test` and confirm the page renders.
- [ ] **Step 4: Real end-to-end** — submit a real PT-Intake test contact (or POST a representative webhook body to `/day-one-program/webhook`). Confirm: job row goes `pending→…→complete`, PDF appears in Storage, client email arrives, ABC doc uploads (if member id present), and the success page shows progress then opens the PDF. Target wall-clock ~10-15s.
- [ ] **Step 5:** Repoint the GHL PT-Intake workflow: webhook URL → `https://wcs-auth-api.onrender.com/day-one-program/webhook`; post-submit redirect → `https://wcs-auth-api.onrender.com/day-one-program/success?contactId={{contact.id}}`.
- [ ] **Step 6:** Verify a real submission through GHL end-to-end.
- [ ] **Step 7:** Decommission the old `dayone` Render service; archive `justinhuttinger/dayone`.

---

## Self-Review

**Spec coverage:**
- Modular structure (route + services) → Tasks 3-12. ✓
- Reuse portal infra (Anthropic/GHL/ABC/PDFShift/Supabase) → Tasks 5,6,9,10,12. ✓
- `@sendgrid/mail` added (outbound new) → Task 1, 10. ✓
- Retire `clubs-config.json` via `getLocationById` → Task 12. ✓
- Supabase persistence (table + Storage, RLS) → Tasks 2, 6. ✓
- Parallel per-day generation + terminology-after-days → Task 8. ✓
- Delivery resilience (independent email/ABC/disk) → Task 12 pipeline. ✓
- SSE + fire-on-ready + contact_id correlation → Tasks 11, 12. ✓
- All 7 locations incl. Medford → Global Constraints + Task 14 env. ✓
- Cutover + decommission → Task 14. ✓
- Streamed-with-retry + truncation guard + all-or-nothing → Task 5, 8. ✓

**Placeholder scan:** No TBD/TODO; all code shown; all commands concrete. ✓

**Type consistency:** `generateText({ prompt, maxTokens })` consistent across Tasks 5/8. `programJson` shape (`weekTemplate.workouts`) consistent across Tasks 8/9/12. `jobs.*` names consistent across Tasks 6/12. `getLocationById` returns `{ apiKey, clubCode, name }` used consistently. `club.clubCode` (not `clubNumber`) used everywhere for ABC. ✓

**Known assumptions to flag at execution:**
- `ghlFetch(path, apiKey)` signature confirmed from `src/services/ghlClient.js`.
- Migration number `054` assumes no parallel migration lands first — verify `ls auth/migrations | tail` before applying and bump if needed.
- The success page is served by the auth API (public); confirm no global auth middleware blocks `/day-one-program/*` (the route mounts without `authenticate`, matching `/webhooks`).
