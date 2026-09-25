# Quiz Funnels Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A Quiz Funnels tile in the portal's Marketing folder. It builds multi-step lead quizzes that run per club at `forms.westcoaststrength.com/q/<club>/<slug>`, write each submission to a Google Sheet, POST it to the club's GHL webhook, and load GHL External Tracking, Meta Pixel and GTM.

**Architecture:** A quiz is a row in `forms` with `kind = 'quiz'`.
- The existing Forms route file becomes a factory (`buildFormsRouter`) mounted twice, at `/forms` and `/quizzes`, each gated by its own permission.
- Quiz-only pieces are added on top:
  - a `quiz_clubs` table for per-club webhook and tracking settings
  - public `/public/quizzes/:club/:slug` endpoints
  - a webhook sender with a 10-minute retry sweep
  - quiz lead columns in the Sheets service
- The portal reuses FormsView/FormBuilder with a `kind` prop.
- The renderer gains a `/q/` route with a one-question-per-screen QuizPage.

**Tech Stack:** Node/Express + Supabase (auth/), React 19 + Vite + Tailwind 4 (portal/), Vite React on a Cloudflare Workers static-assets Worker (wcs-forms-renderer), `node --test`.

**Spec:** `docs/superpowers/specs/2026-09-25-quiz-funnels-design.md`

## Global Constraints

- Repos: `wcs-staff-portal` (branch `feat/quiz-funnels`, worktree `.claude/worktrees/quiz-funnels`, base `origin/master`). `wcs-forms-renderer` (`C:\Users\justi\Desktop\wcs-forms-renderer`, branch `feat/quiz-page`, base `main`).
- Migration file is `auth/migrations/208_quiz_funnels.sql`. Do NOT apply it to prod; it is applied at merge time with Justin's explicit consent.
- Public URL format: `https://forms.westcoaststrength.com/q/<club>/<slug>`. Club slugs are exactly `salem, keizer, eugene, springfield, clackamas, milwaukie, medford`.
- The public quiz GET must never include `ghl_webhook_url`.
- Webhook: https only, 10s timeout, max 5 automatic attempts, retry window 7 days, `pending` rows are only retried after 2 minutes.
- Validators:
  - GHL tracking id: `/^tk_[A-Za-z0-9]{8,64}$/`
  - GHL script host must end in `msgsndr.com | leadconnectorhq.com | gohighlevel.com | westcoaststrength.com`, with path ending `/js/external-tracking.js`
  - Meta Pixel: `/^\d{6,20}$/`
  - GTM: `/^GTM-[A-Z0-9]{4,12}$/`
- Sheet header for a new quiz: `Submitted At | Club | First Name | Last Name | Email | Phone | <questions…> | UTM Source | UTM Medium | UTM Campaign`.
- Quiz tile is admin-only by default and grantable via the RBAC key `quizzes`.
- Copy buttons show "Copied!". Every content block on a portal page sits in a card (`bg-surface rounded-xl border border-border`).
- No em-dashes in lead-facing copy (renderer strings, default headings).
- Never push to an open PR's branch. Open PRs; never merge.
- Commits end with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.

## Review Focus

1. **A quiz id sent to `/forms/:id` (or a form id to `/quizzes/:id`)** must 404, never edit across kinds. Pinned by the `kindMatches` tests in Task 4.
2. **Unknown club slug, inactive club, or unpublished quiz on the public URL** must 404, and the public view must never contain the webhook URL. Pinned by the `publicQuizView` and `CLUB_SLUGS` tests in Task 2.
3. **Two questions with the same text** must not overwrite each other in the webhook `answers` object. Pinned by the duplicate-label test in Task 2.
4. **A GHL snippet pasted with line breaks, extra attributes, `http:`, or a foreign host** must parse correctly or return a clear error. Pinned by the snippet tests in Task 2.
5. **GHL slow (timeout) or 5xx** must become `failed` with an error and be retried, never stuck in `pending`. Pinned by the `postJson` timeout and `nextWebhookState` tests in Task 3.

## Spec deviations (intentional, small)

- The GHL tracking field accepts the pasted snippet only, not a bare `tk_` id, because the host varies with the white-label domain.
- The quiz sheet is titled `"<Title> (Quiz Funnels)"` and filed in the `Quiz Funnels` Drive subfolder.
- The quiz list has search + status filters but no club filter. The club filter lives in the Submissions tab.
- The builder keeps the existing stacked preview. Real one-per-screen review is done through a club's live link.
- `page_url` in the webhook is built server-side from club + slug, not sent by the browser.

---

## File Structure

**auth/ (wcs-staff-portal)**
- Create `auth/migrations/208_quiz_funnels.sql`: kind column, quiz_clubs, submission webhook columns, audit actions, permission seed.
- Modify `auth/src/services/formsSchema.js`: export `EMAIL_RE`, `normalizePhone`.
- Create `auth/src/services/quizSchema.js` (+ `.test.js`): pure quiz validation, settings, payload, public view, club planning.
- Modify `auth/src/services/formsSheets.js` (+ test): quiz lead columns, Quiz Funnels folder label.
- Create `auth/src/services/quizWebhook.js` (+ `.test.js`): send, state machine, retry sweep.
- Modify `auth/src/services/formsPermissions.js` (+ test): `makeModuleGate`, `requireQuizBuilder`.
- Rename `auth/src/routes/forms.js` to `auth/src/routes/formsHandlers.js` (factory) and create a new 3-line `auth/src/routes/forms.js`.
- Create `auth/src/routes/formsHandlers.test.js`: `kindMatches`, `normalizeSettings`.
- Create `auth/src/routes/quizzes.js`: factory mount + clubs, test webhook, retry webhook.
- Create `auth/src/routes/publicQuizzes.js`. Modify `auth/src/routes/publicForms.js` to refuse quizzes.
- Modify `auth/src/index.js`: mounts + sweep start.
- Modify `auth/src/routes/admin.js`: `'quizzes'` in `CUSTOM_TILE_KEYS`.

**portal/ (wcs-staff-portal)**
- Modify `portal/src/lib/api.js`: `makeFormsClient`, `quizzes` client.
- Create `portal/src/components/forms/quizDefaults.js` (+ `.test.mjs`).
- Create `portal/src/components/forms/QuizSettingsPanels.jsx`: Contact / Thank-you / Tracking panels.
- Create `portal/src/components/forms/QuizClubsPanel.jsx` and `QuizSubmissionsPanel.jsx`.
- Modify `FormBuilder.jsx`, `FormsView.jsx`, `FormSharePanel.jsx`, `FormAuditPanel.jsx`: `kind` / `api` props.
- Modify `ToolGrid.jsx`, `App.jsx`, `config/portalTiles.js`, `config/changelog.js`: tile wiring.

**wcs-forms-renderer**
- Create `src/lib/quiz.js`, `src/lib/tracking.js` (+ `.test.js` each), and `src/QuizPage.jsx`.
- Modify `src/App.jsx`, `src/styles.css`, `package.json` (test script).

---

## PR 1: wcs-staff-portal

### Task 1: Migration 208

**Files:**
- Create: `auth/migrations/208_quiz_funnels.sql`

**Interfaces:**
- Produces:
  - `forms.kind` (`'form'|'quiz'`)
  - table `quiz_clubs(form_id, location_id, active, ghl_webhook_url, ghl_tracking_src, ghl_tracking_id)` unique `(form_id, location_id)`
  - `form_submissions.location_id`, `.webhook_status` (`none|pending|sent|failed`), `.webhook_attempts`, `.webhook_error`
  - audit actions `location_changed, clubs_updated, webhook_test, webhook_retry`
  - permission key `quizzes`

- [ ] **Step 1: Write the migration**

```sql
-- 208: Quiz Funnels. A quiz is a forms row with kind='quiz' that runs at a set
-- of clubs (quiz_clubs). Each club carries its own GHL inbound webhook and GHL
-- External Tracking snippet. Submissions remember their club and webhook state.

alter table forms add column if not exists kind text not null default 'form';
do $$ begin
  alter table forms add constraint forms_kind_check check (kind in ('form','quiz'));
exception when duplicate_object then null; end $$;
create index if not exists idx_forms_kind on forms (kind);

create table if not exists quiz_clubs (
  id uuid primary key default gen_random_uuid(),
  form_id uuid not null references forms(id) on delete cascade,
  location_id uuid not null references locations(id),
  active boolean not null default true,
  ghl_webhook_url text,
  ghl_tracking_src text,
  ghl_tracking_id text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (form_id, location_id)
);
alter table quiz_clubs enable row level security;

alter table form_submissions add column if not exists location_id uuid references locations(id);
alter table form_submissions add column if not exists webhook_status text not null default 'none';
alter table form_submissions add column if not exists webhook_attempts int not null default 0;
alter table form_submissions add column if not exists webhook_error text;
do $$ begin
  alter table form_submissions add constraint form_submissions_webhook_status_check
    check (webhook_status in ('none','pending','sent','failed'));
exception when duplicate_object then null; end $$;
create index if not exists idx_form_submissions_webhook_retry
  on form_submissions (submitted_at) where webhook_status in ('pending','failed');

-- Audit actions. 'location_changed' was already written by PATCH /forms/:id
-- (All-Locations work, #472) but never added to the check, so those inserts
-- were silently rejected. Add it alongside the quiz actions.
alter table form_audit_log drop constraint if exists form_audit_log_action_check;
alter table form_audit_log add constraint form_audit_log_action_check check (action in (
  'created','edited','published','archived','deleted','shared','unshared',
  'permission_changed','visibility_changed','submission_received','sheet_retry',
  'location_changed','clubs_updated','webhook_test','webhook_retry'));

insert into permission_catalog (perm_key, label, category, min_tier) values
  ('quizzes', 'Quiz Funnels', 'Tools', 'admin')
on conflict (perm_key) do nothing;

insert into role_tool_visibility (role, tool_key, visible) values ('admin', 'quizzes', true)
on conflict (role, tool_key) do update set visible = true;
```

- [ ] **Step 2: Sanity-check the file parses as SQL.** There is no local database, so review it by eye against 078. Check the constraint name `form_audit_log_action_check` is Postgres's default name for the inline check in 078 (`<table>_<column>_check`).

- [ ] **Step 3: Commit**

```bash
git add auth/migrations/208_quiz_funnels.sql
git commit -m "feat(quizzes): migration 208 for quiz funnels"
```

### Task 2: Pure quiz schema module

**Files:**
- Modify: `auth/src/services/formsSchema.js`
- Create: `auth/src/services/quizSchema.js`
- Test: `auth/src/services/quizSchema.test.js`

**Interfaces:**
- Produces:
  - `formsSchema`:
    - `EMAIL_RE`
    - `normalizePhone(v) -> '(999) 999-9999' | null`
  - `quizSchema`:
    - `CLUB_SLUGS: string[]`
    - `DEFAULT_QUIZ_SETTINGS`
    - `quizSettingsWithDefaults(s) -> {contact_step, thank_you, tracking}`
    - `normalizeQuizSettings(input, existing) -> {ok, error?, settings?}`
    - `parseGhlTrackingSnippet(text) -> {ok, error?, src, trackingId}`
    - `validateWebhookUrl(url) -> {ok, error?, url}`
    - `validateContact(contact, contactStep) -> {ok, errors, cleaned}`
    - `questionFields(schema)`
    - `buildWebhookPayload({form, clubName, submission, test?})`
    - `sampleSubmission(form)`
    - `publicQuizView(form, location, club)`
    - `quizPublicUrl(clubSlug, slug)`
    - `clubRowsView(locations, rows, form)`
    - `planClubUpserts(formId, input, existing, locations) -> {ok, error?, rows}`

- [ ] **Step 1: Refactor phone/email out of formsSchema.** In `formsSchema.js`, add above `validateSubmission`:

```js
// US numbers only: 10 digits (optional leading 1), NANP shape (area code and
// exchange can't start with 0/1). Returns "(999) 999-9999" or null.
function normalizePhone(v) {
  const digits = String(v ?? '').replace(/\D/g, '').replace(/^1(?=\d{10}$)/, '')
  if (!/^[2-9]\d{2}[2-9]\d{6}$/.test(digits)) return null
  return `(${digits.slice(0, 3)}) ${digits.slice(3, 6)}-${digits.slice(6)}`
}
```

Replace the body of `case 'phone': { ... }` with:

```js
      case 'phone': {
        const p = normalizePhone(v)
        if (!p) { errors[f.id] = 'Enter a valid 10-digit phone number'; continue }
        cleaned[f.id] = p
        continue
      }
```

and add `EMAIL_RE, normalizePhone` to `module.exports`. Run `cd auth && node --test src/services/formsSchema.test.js`. Expected: PASS, with no behavior change.

- [ ] **Step 2: Write the failing tests** in `auth/src/services/quizSchema.test.js`:

```js
const test = require('node:test')
const assert = require('node:assert/strict')
const q = require('./quizSchema')

const FORM = {
  title: 'Find Your Fit', slug: 'find-your-fit-k3x9', description: 'Intro',
  schema: [
    { id: 'f_goal', type: 'radio', label: "What's your main goal?", options: ['Lose weight', 'Build muscle'], required: true },
    { id: 'f_days', type: 'checkbox', label: 'Which days work?', options: ['Mon', 'Wed', 'Fri'] },
    { id: 'f_note', type: 'short_text', label: 'Anything else?' },
  ],
  settings: { tracking: { meta_pixel_id: '820682157231470', gtm_id: 'GTM-N4BRPV65' } },
}

test('snippet: parses the GHL script tag, even across lines with extra attrs', () => {
  const r = q.parseGhlTrackingSnippet(`<script
    src="https://link.westcoaststrength.com/js/external-tracking.js"
    data-tracking-id="tk_0123456789abcdef0123456789abcdef" async></script>`)
  assert.equal(r.ok, true)
  assert.equal(r.src, 'https://link.westcoaststrength.com/js/external-tracking.js')
  assert.equal(r.trackingId, 'tk_0123456789abcdef0123456789abcdef')
})

test('snippet: blank clears', () => {
  assert.deepEqual(q.parseGhlTrackingSnippet('  '), { ok: true, src: null, trackingId: null })
})

test('snippet: rejects http, foreign host, wrong path, bad id, missing parts', () => {
  const id = 'data-tracking-id="tk_0123456789abcdef"'
  assert.equal(q.parseGhlTrackingSnippet(`<script src="http://link.msgsndr.com/js/external-tracking.js" ${id}>`).ok, false)
  assert.equal(q.parseGhlTrackingSnippet(`<script src="https://evil.com/js/external-tracking.js" ${id}>`).ok, false)
  assert.equal(q.parseGhlTrackingSnippet(`<script src="https://msgsndr.com.evil.com/js/external-tracking.js" ${id}>`).ok, false)
  assert.equal(q.parseGhlTrackingSnippet(`<script src="https://link.msgsndr.com/js/other.js" ${id}>`).ok, false)
  assert.equal(q.parseGhlTrackingSnippet(`<script src="https://link.msgsndr.com/js/external-tracking.js" data-tracking-id="nope">`).ok, false)
  assert.equal(q.parseGhlTrackingSnippet('tk_0123456789abcdef').ok, false)
})

test('webhook url: https only, blank allowed', () => {
  assert.deepEqual(q.validateWebhookUrl(''), { ok: true, url: null })
  assert.equal(q.validateWebhookUrl('http://x.com/h').ok, false)
  assert.equal(q.validateWebhookUrl('not a url').ok, false)
  assert.equal(q.validateWebhookUrl('https://services.leadconnectorhq.com/hooks/a/b').ok, true)
})

test('settings: defaults fill gaps; tracking ids validated; redirect https only', () => {
  const d = q.quizSettingsWithDefaults(null)
  assert.equal(d.contact_step.require_phone, true)
  assert.equal(q.normalizeQuizSettings({ tracking: { meta_pixel_id: 'abc' } }, {}).ok, false)
  assert.equal(q.normalizeQuizSettings({ tracking: { gtm_id: 'gtm-12' } }, {}).ok, false)
  const ok = q.normalizeQuizSettings({ tracking: { meta_pixel_id: ' 123456 ', gtm_id: 'gtm-abc123' } }, {})
  assert.deepEqual(ok.settings.tracking, { meta_pixel_id: '123456', gtm_id: 'GTM-ABC123' })
  assert.equal(q.normalizeQuizSettings({ thank_you: { redirect_url: 'http://x.com' } }, {}).ok, false)
  // untouched sections keep existing values
  const kept = q.normalizeQuizSettings({ thank_you: { heading: 'Hi' } }, { tracking: { gtm_id: 'GTM-KEEP1' } })
  assert.equal(kept.settings.tracking.gtm_id, 'GTM-KEEP1')
})

test('contact: email always required; phone normalized; required flags honored', () => {
  const step = { require_first_name: true, require_last_name: false, require_phone: true }
  const bad = q.validateContact({ email: 'x', phone: '123' }, step)
  assert.equal(bad.ok, false)
  assert.ok(bad.errors.first_name && bad.errors.email && bad.errors.phone)
  const good = q.validateContact({ first_name: ' Jane ', email: 'Jane@X.com', phone: '1-503-555-0101' }, step)
  assert.equal(good.ok, true)
  assert.deepEqual(good.cleaned, { first_name: 'Jane', email: 'jane@x.com', phone: '(503) 555-0101' })
  assert.equal(q.validateContact({ first_name: 'J', email: 'j@x.co' }, { ...step, require_phone: false }).ok, true)
})

test('payload: answers keyed by question, checkbox joined, blanks empty, duplicate labels suffixed', () => {
  const form = { ...FORM, schema: [...FORM.schema, { id: 'f_dup', type: 'short_text', label: 'Anything else?' }] }
  const p = q.buildWebhookPayload({
    form, clubName: 'Salem',
    submission: { id: 's1', submitted_at: '2026-09-25T18:00:00.000Z', utm: { utm_source: 'meta' },
      data: { f_goal: 'Lose weight', f_days: ['Mon', 'Fri'], f_dup: 'x', club: 'Salem', first_name: 'Jane', email: 'j@x.com' } },
  })
  assert.equal(p.event, 'quiz_submission')
  assert.equal(p.club_slug, 'salem')
  assert.equal(p.page_url, 'https://forms.westcoaststrength.com/q/salem/find-your-fit-k3x9')
  assert.deepEqual(p.answers, {
    "What's your main goal?": 'Lose weight', 'Which days work?': 'Mon, Fri',
    'Anything else?': '', 'Anything else? (2)': 'x',
  })
  assert.equal(p.questions.length, 4)
  assert.equal(p.last_name, '')
  assert.equal(p.utm_source, 'meta')
  assert.equal(p.test, false)
})

test('sample submission satisfies every question type', () => {
  const s = q.sampleSubmission(FORM)
  assert.equal(s.data.f_goal, 'Lose weight')
  assert.deepEqual(s.data.f_days, ['Mon', 'Wed'])
  assert.equal(s.data.email, 'test@example.com')
})

test('public view: questions only, tracking shaped, never the webhook url', () => {
  const form = { ...FORM, schema: [{ id: 'f_h', type: 'header', label: 'X' }, ...FORM.schema] }
  const club = { ghl_webhook_url: 'https://secret', ghl_tracking_src: 'https://link.msgsndr.com/js/external-tracking.js', ghl_tracking_id: 'tk_0123456789' }
  const v = q.publicQuizView(form, { id: 'L1', name: 'Salem' }, club)
  assert.equal(JSON.stringify(v).includes('secret'), false)
  assert.equal(v.schema.length, 3)
  assert.equal(v.club_slug, 'salem')
  assert.deepEqual(v.tracking, {
    ghl: { src: club.ghl_tracking_src, tracking_id: 'tk_0123456789' },
    meta_pixel_id: '820682157231470', gtm_id: 'GTM-N4BRPV65',
  })
  assert.equal(q.publicQuizView(form, { id: 'L1', name: 'Salem' }, {}).tracking.ghl, null)
})

test('club slugs are the 7 clubs', () => {
  assert.deepEqual(q.CLUB_SLUGS, ['salem', 'keizer', 'eugene', 'springfield', 'clackamas', 'milwaukie', 'medford'])
})

test('clubRowsView merges locations with saved rows', () => {
  const rows = q.clubRowsView(
    [{ id: 'L1', name: 'Salem' }, { id: 'L2', name: 'Keizer' }],
    [{ location_id: 'L1', active: true, ghl_webhook_url: 'https://h', ghl_tracking_id: 'tk_1', ghl_tracking_src: 's' }],
    FORM)
  assert.equal(rows[0].active, true)
  assert.equal(rows[0].url, 'https://forms.westcoaststrength.com/q/salem/find-your-fit-k3x9')
  assert.equal(rows[1].active, false)
  assert.equal(rows[1].ghl_webhook_url, '')
})

test('planClubUpserts validates and keeps tracking unless a snippet is sent', () => {
  const locs = [{ id: 'L1', name: 'Salem' }]
  const existing = [{ location_id: 'L1', ghl_tracking_src: 'https://old', ghl_tracking_id: 'tk_old' }]
  const keep = q.planClubUpserts('F', [{ location_id: 'L1', active: true, ghl_webhook_url: 'https://h' }], existing, locs)
  assert.equal(keep.ok, true)
  assert.equal(keep.rows[0].ghl_tracking_id, 'tk_old')
  const cleared = q.planClubUpserts('F', [{ location_id: 'L1', active: false, ghl_tracking_snippet: '' }], existing, locs)
  assert.equal(cleared.rows[0].ghl_tracking_id, null)
  assert.match(q.planClubUpserts('F', [{ location_id: 'L1', ghl_webhook_url: 'http://h' }], [], locs).error, /^Salem: /)
  assert.equal(q.planClubUpserts('F', [{ location_id: 'NOPE' }], [], locs).ok, false)
})
```

- [ ] **Step 3: Run to verify it fails.** Run `cd auth && node --test src/services/quizSchema.test.js`. Expected: FAIL, `Cannot find module './quizSchema'`.

- [ ] **Step 4: Implement `auth/src/services/quizSchema.js`**

```js
const { INPUT_TYPES, EMAIL_RE, normalizePhone } = require('./formsSchema')

// Pure helpers for Quiz Funnels (spec: docs/superpowers/specs/2026-09-25-quiz-funnels-design.md).
// No Supabase here so every function is unit-testable.

const CLUB_SLUGS = ['salem', 'keizer', 'eugene', 'springfield', 'clackamas', 'milwaukie', 'medford']
const PUBLIC_BASE = 'https://forms.westcoaststrength.com'
const GHL_HOST_SUFFIXES = ['msgsndr.com', 'leadconnectorhq.com', 'gohighlevel.com', 'westcoaststrength.com']
const TRACKING_ID_RE = /^tk_[A-Za-z0-9]{8,64}$/
const PIXEL_RE = /^\d{6,20}$/
const GTM_RE = /^GTM-[A-Z0-9]{4,12}$/

const DEFAULT_QUIZ_SETTINGS = {
  contact_step: {
    heading: 'Where should we send your results?', subtext: '',
    require_first_name: true, require_last_name: false, require_phone: true,
  },
  thank_you: { heading: "You're all set!", message: '', redirect_url: '' },
  tracking: { meta_pixel_id: '', gtm_id: '' },
}

const str = (v, max) => (typeof v === 'string' ? v.trim().slice(0, max) : '')

function quizSettingsWithDefaults(s) {
  const src = s && typeof s === 'object' ? s : {}
  return {
    contact_step: { ...DEFAULT_QUIZ_SETTINGS.contact_step, ...(src.contact_step || {}) },
    thank_you: { ...DEFAULT_QUIZ_SETTINGS.thank_you, ...(src.thank_you || {}) },
    tracking: { ...DEFAULT_QUIZ_SETTINGS.tracking, ...(src.tracking || {}) },
  }
}

function httpsUrl(raw) {
  try { const u = new URL(raw); return u.protocol === 'https:' ? u : null } catch { return null }
}

// Sections not present in `input` keep their existing values.
function normalizeQuizSettings(input, existing) {
  if (input === null || typeof input !== 'object' || Array.isArray(input)) {
    return { ok: false, error: 'settings must be an object' }
  }
  const out = quizSettingsWithDefaults(existing)
  if (input.contact_step !== undefined) {
    const c = input.contact_step || {}
    out.contact_step = {
      heading: str(c.heading, 200), subtext: str(c.subtext, 500),
      require_first_name: !!c.require_first_name,
      require_last_name: !!c.require_last_name,
      require_phone: !!c.require_phone,
    }
  }
  if (input.thank_you !== undefined) {
    const t = input.thank_you || {}
    const redirect = str(t.redirect_url, 1000)
    if (redirect && !httpsUrl(redirect)) return { ok: false, error: 'Redirect URL must be a full https:// link' }
    out.thank_you = { heading: str(t.heading, 200), message: str(t.message, 1000), redirect_url: redirect }
  }
  if (input.tracking !== undefined) {
    const t = input.tracking || {}
    const pixel = str(t.meta_pixel_id, 40)
    const gtm = str(t.gtm_id, 40).toUpperCase()
    if (pixel && !PIXEL_RE.test(pixel)) return { ok: false, error: 'Meta Pixel ID should be digits only' }
    if (gtm && !GTM_RE.test(gtm)) return { ok: false, error: 'GTM ID should look like GTM-XXXXXXX' }
    out.tracking = { meta_pixel_id: pixel, gtm_id: gtm }
  }
  return { ok: true, settings: out }
}

// Accepts the snippet GHL shows under Settings -> External Tracking:
// <script src="https://<link-domain>/js/external-tracking.js" data-tracking-id="tk_..."></script>
function parseGhlTrackingSnippet(text) {
  const s = String(text ?? '').trim()
  if (!s) return { ok: true, src: null, trackingId: null }
  const srcM = s.match(/\bsrc\s*=\s*["']([^"']+)["']/i)
  const idM = s.match(/\bdata-tracking-id\s*=\s*["']([^"']+)["']/i)
  if (!srcM || !idM) {
    return { ok: false, error: 'Paste the full <script> snippet from GHL Settings > External Tracking' }
  }
  const url = httpsUrl(srcM[1])
  if (!url) return { ok: false, error: 'The script src must be an https:// link' }
  const host = url.hostname.toLowerCase()
  if (!GHL_HOST_SUFFIXES.some(h => host === h || host.endsWith('.' + h))) {
    return { ok: false, error: `The script host ${host} is not a GHL domain` }
  }
  if (!url.pathname.endsWith('/js/external-tracking.js')) {
    return { ok: false, error: 'That is not the GHL external-tracking.js script' }
  }
  if (!TRACKING_ID_RE.test(idM[1])) return { ok: false, error: 'The tracking id should start with tk_' }
  return { ok: true, src: url.toString(), trackingId: idM[1] }
}

function validateWebhookUrl(url) {
  const s = String(url ?? '').trim()
  if (!s) return { ok: true, url: null }
  if (s.length > 1000) return { ok: false, error: 'Webhook URL is too long' }
  const u = httpsUrl(s)
  if (!u) return { ok: false, error: 'Webhook URL must be a full https:// link' }
  return { ok: true, url: u.toString() }
}

function validateContact(contact, contactStep) {
  const c = contact && typeof contact === 'object' ? contact : {}
  const step = { ...DEFAULT_QUIZ_SETTINGS.contact_step, ...(contactStep || {}) }
  const errors = {}
  const cleaned = {}
  const first = str(c.first_name, 100)
  const last = str(c.last_name, 100)
  const email = str(c.email, 254)
  const phone = str(c.phone, 40)
  if (first) cleaned.first_name = first
  else if (step.require_first_name) errors.first_name = 'First name is required'
  if (last) cleaned.last_name = last
  else if (step.require_last_name) errors.last_name = 'Last name is required'
  if (!email) errors.email = 'Email is required'
  else if (!EMAIL_RE.test(email)) errors.email = 'Enter a valid email address'
  else cleaned.email = email.toLowerCase()
  if (phone) {
    const p = normalizePhone(phone)
    if (p) cleaned.phone = p
    else errors.phone = 'Enter a valid 10-digit phone number'
  } else if (step.require_phone) {
    errors.phone = 'Phone is required'
  }
  return { ok: Object.keys(errors).length === 0, errors, cleaned }
}

function questionFields(schema) {
  return (schema || []).filter(f => INPUT_TYPES.includes(f.type))
}

const formatAnswer = v => (v == null ? '' : Array.isArray(v) ? v.join(', ') : String(v))

function quizPublicUrl(clubSlug, slug) {
  return `${PUBLIC_BASE}/q/${clubSlug}/${slug}`
}

function buildWebhookPayload({ form, clubName, submission, test = false }) {
  const data = submission.data || {}
  const questions = questionFields(form.schema)
    .map(f => ({ question: f.label, answer: formatAnswer(data[f.id]) }))
  // Flat map for GHL's inbound-webhook mapper (it can't index arrays).
  // Repeated question text gets " (2)", " (3)" so no answer is overwritten.
  const answers = {}
  for (const item of questions) {
    let key = item.question
    let n = 2
    while (Object.prototype.hasOwnProperty.call(answers, key)) key = `${item.question} (${n++})`
    answers[key] = item.answer
  }
  const utm = submission.utm || {}
  const clubSlug = String(clubName || '').toLowerCase()
  return {
    event: 'quiz_submission',
    test: !!test,
    quiz: form.title,
    quiz_slug: form.slug,
    club: clubName || '',
    club_slug: clubSlug,
    first_name: data.first_name || '',
    last_name: data.last_name || '',
    email: data.email || '',
    phone: data.phone || '',
    answers,
    questions,
    utm_source: utm.utm_source || '',
    utm_medium: utm.utm_medium || '',
    utm_campaign: utm.utm_campaign || '',
    page_url: quizPublicUrl(clubSlug, form.slug),
    submission_id: submission.id || null,
    submitted_at: submission.submitted_at || new Date().toISOString(),
  }
}

// Fake-but-valid submission for the portal's "Send test" button, so GHL's
// mapper sees every key it will get from a real lead.
function sampleSubmission(form) {
  const data = { first_name: 'Test', last_name: 'Lead', email: 'test@example.com', phone: '(503) 555-0100' }
  for (const f of questionFields(form.schema)) {
    if (f.type === 'checkbox') data[f.id] = (f.options || []).slice(0, 2)
    else if (Array.isArray(f.options) && f.options.length) data[f.id] = f.options[0]
    else if (f.type === 'number') data[f.id] = '1'
    else if (f.type === 'date') data[f.id] = '2026-01-01'
    else if (f.type === 'email') data[f.id] = 'test@example.com'
    else if (f.type === 'phone') data[f.id] = '(503) 555-0100'
    else data[f.id] = 'Sample answer'
  }
  return { id: null, data, utm: { utm_source: 'test' }, submitted_at: new Date().toISOString() }
}

// What the public renderer may see. Deliberately rebuilt field-by-field so the
// club's webhook URL can never leak.
function publicQuizView(form, location, club) {
  const s = quizSettingsWithDefaults(form.settings)
  const hasGhl = !!(club && club.ghl_tracking_src && club.ghl_tracking_id)
  return {
    slug: form.slug,
    title: form.title,
    description: form.description || '',
    club: location.name,
    club_slug: String(location.name).toLowerCase(),
    schema: questionFields(form.schema),
    contact_step: s.contact_step,
    thank_you: s.thank_you,
    tracking: {
      ghl: hasGhl ? { src: club.ghl_tracking_src, tracking_id: club.ghl_tracking_id } : null,
      meta_pixel_id: s.tracking.meta_pixel_id || '',
      gtm_id: s.tracking.gtm_id || '',
    },
  }
}

// Every club, with its saved row (or blanks), for the portal Clubs tab.
function clubRowsView(locations, rows, form) {
  const byLoc = Object.fromEntries((rows || []).map(r => [r.location_id, r]))
  return (locations || []).map(l => {
    const r = byLoc[l.id] || {}
    const clubSlug = String(l.name).toLowerCase()
    return {
      location_id: l.id,
      name: l.name,
      club_slug: clubSlug,
      active: !!r.active,
      ghl_webhook_url: r.ghl_webhook_url || '',
      ghl_tracking_id: r.ghl_tracking_id || '',
      ghl_tracking_src: r.ghl_tracking_src || '',
      url: quizPublicUrl(clubSlug, form.slug),
    }
  })
}

// Validate a PUT /quizzes/:id/clubs body into upsert rows. Tracking only
// changes when `ghl_tracking_snippet` is sent ('' clears it).
function planClubUpserts(formId, input, existing, locations) {
  const locName = Object.fromEntries((locations || []).map(l => [l.id, l.name]))
  const prev = Object.fromEntries((existing || []).map(r => [r.location_id, r]))
  const rows = []
  for (const c of input || []) {
    const name = locName[c && c.location_id]
    if (!name) return { ok: false, error: 'Unknown club' }
    const hook = validateWebhookUrl(c.ghl_webhook_url)
    if (!hook.ok) return { ok: false, error: `${name}: ${hook.error}` }
    let src = prev[c.location_id]?.ghl_tracking_src || null
    let tid = prev[c.location_id]?.ghl_tracking_id || null
    if (c.ghl_tracking_snippet !== undefined) {
      const t = parseGhlTrackingSnippet(c.ghl_tracking_snippet)
      if (!t.ok) return { ok: false, error: `${name}: ${t.error}` }
      src = t.src
      tid = t.trackingId
    }
    rows.push({
      form_id: formId, location_id: c.location_id, active: !!c.active,
      ghl_webhook_url: hook.url, ghl_tracking_src: src, ghl_tracking_id: tid,
      updated_at: new Date().toISOString(),
    })
  }
  return { ok: true, rows }
}

module.exports = {
  CLUB_SLUGS, DEFAULT_QUIZ_SETTINGS, PIXEL_RE, GTM_RE, TRACKING_ID_RE,
  quizSettingsWithDefaults, normalizeQuizSettings, parseGhlTrackingSnippet, validateWebhookUrl,
  validateContact, questionFields, buildWebhookPayload, sampleSubmission, publicQuizView,
  quizPublicUrl, clubRowsView, planClubUpserts,
}
```

- [ ] **Step 5: Run the tests.** Run `cd auth && node --test src/services/quizSchema.test.js src/services/formsSchema.test.js`. Expected: all PASS.

- [ ] **Step 6: Commit**

```bash
git add auth/src/services/formsSchema.js auth/src/services/quizSchema.js auth/src/services/quizSchema.test.js
git commit -m "feat(quizzes): pure quiz schema, tracking and payload helpers"
```

### Task 3: Webhook sender + retry sweep

**Files:**
- Create: `auth/src/services/quizWebhook.js`
- Test: `auth/src/services/quizWebhook.test.js`

**Interfaces:**
- Consumes: `buildWebhookPayload` (Task 2).
- Produces:
  - `postJson(url, payload, fetchImpl?, timeoutMs?) -> {ok, status, text}`
  - `nextWebhookState(prevAttempts, result) -> {webhook_status, webhook_attempts, webhook_error}`
  - `isRetryDue(row, now?) -> bool`
  - `deliverWebhook(submissionId) -> state | {skipped:true}`
  - `retryWebhooks() -> {sent, failed}`
  - `start()`
  - `MAX_ATTEMPTS = 5`

- [ ] **Step 1: Write the failing tests**

```js
const test = require('node:test')
const assert = require('node:assert/strict')
const w = require('./quizWebhook')

test('postJson: 2xx ok, sends JSON', async () => {
  let seen
  const fetchImpl = async (url, init) => { seen = { url, init }; return { ok: true, status: 200, text: async () => 'ok' } }
  const r = await w.postJson('https://h', { a: 1 }, fetchImpl)
  assert.deepEqual(r, { ok: true, status: 200, text: 'ok' })
  assert.equal(seen.init.method, 'POST')
  assert.equal(seen.init.headers['Content-Type'], 'application/json')
  assert.equal(seen.init.body, '{"a":1}')
})

test('postJson: 5xx is not ok and keeps the body', async () => {
  const r = await w.postJson('https://h', {}, async () => ({ ok: false, status: 502, text: async () => 'bad gateway' }))
  assert.deepEqual(r, { ok: false, status: 502, text: 'bad gateway' })
})

test('postJson: timeout becomes a failure, not a hang', async () => {
  const hang = (url, init) => new Promise((_, reject) => {
    init.signal.addEventListener('abort', () => { const e = new Error('aborted'); e.name = 'AbortError'; reject(e) })
  })
  const r = await w.postJson('https://h', {}, hang, 20)
  assert.equal(r.ok, false)
  assert.equal(r.status, 0)
  assert.match(r.text, /Timed out/)
})

test('nextWebhookState counts attempts and records errors', () => {
  assert.deepEqual(w.nextWebhookState(0, { ok: true, status: 200 }),
    { webhook_status: 'sent', webhook_attempts: 1, webhook_error: null })
  const f = w.nextWebhookState(2, { ok: false, status: 500, text: 'boom' })
  assert.equal(f.webhook_status, 'failed')
  assert.equal(f.webhook_attempts, 3)
  assert.equal(f.webhook_error, 'HTTP 500: boom')
  assert.equal(w.nextWebhookState(0, { ok: false, status: 0, text: 'Timed out after 10s' }).webhook_error, 'Network error: Timed out after 10s')
})

test('isRetryDue: grace for pending, cap, window, status', () => {
  const now = Date.parse('2026-09-25T12:00:00Z')
  const at = mins => new Date(now - mins * 60000).toISOString()
  assert.equal(w.isRetryDue({ webhook_status: 'pending', webhook_attempts: 0, submitted_at: at(1) }, now), false)
  assert.equal(w.isRetryDue({ webhook_status: 'pending', webhook_attempts: 0, submitted_at: at(3) }, now), true)
  assert.equal(w.isRetryDue({ webhook_status: 'failed', webhook_attempts: 4, submitted_at: at(1) }, now), true)
  assert.equal(w.isRetryDue({ webhook_status: 'failed', webhook_attempts: 5, submitted_at: at(30) }, now), false)
  assert.equal(w.isRetryDue({ webhook_status: 'failed', webhook_attempts: 1, submitted_at: at(8 * 24 * 60) }, now), false)
  assert.equal(w.isRetryDue({ webhook_status: 'sent', webhook_attempts: 1, submitted_at: at(30) }, now), false)
})
```

- [ ] **Step 2: Run to verify it fails.** Run `cd auth && node --test src/services/quizWebhook.test.js`. Expected: FAIL (module not found).

- [ ] **Step 3: Implement `auth/src/services/quizWebhook.js`**

```js
const { buildWebhookPayload } = require('./quizSchema')

// Quiz submission -> club's GHL inbound webhook. Every send updates the
// submission row (webhook_status/attempts/error); a 10-minute sweep retries
// failures. A failed webhook never affects the lead's submit.
const MAX_ATTEMPTS = 5
const TIMEOUT_MS = 10 * 1000
const PENDING_GRACE_MS = 2 * 60 * 1000
const RETRY_WINDOW_MS = 7 * 24 * 60 * 60 * 1000

// Lazy-require: services/supabase throws at import without env vars.
function db() {
  return require('./supabase').supabaseAdmin
}

async function postJson(url, payload, fetchImpl = fetch, timeoutMs = TIMEOUT_MS) {
  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), timeoutMs)
  try {
    const res = await fetchImpl(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
      signal: ctrl.signal,
    })
    const text = await res.text().catch(() => '')
    return { ok: !!res.ok, status: res.status, text: String(text).slice(0, 500) }
  } catch (err) {
    const text = err && err.name === 'AbortError' ? `Timed out after ${Math.round(timeoutMs / 1000)}s` : String(err && err.message).slice(0, 300)
    return { ok: false, status: 0, text }
  } finally {
    clearTimeout(timer)
  }
}

function nextWebhookState(prevAttempts, result) {
  const attempts = (prevAttempts || 0) + 1
  if (result.ok) return { webhook_status: 'sent', webhook_attempts: attempts, webhook_error: null }
  const prefix = result.status ? `HTTP ${result.status}` : 'Network error'
  return {
    webhook_status: 'failed',
    webhook_attempts: attempts,
    webhook_error: `${prefix}: ${result.text || ''}`.trim().slice(0, 300),
  }
}

function isRetryDue(row, now = Date.now()) {
  if (row.webhook_status !== 'pending' && row.webhook_status !== 'failed') return false
  if ((row.webhook_attempts || 0) >= MAX_ATTEMPTS) return false
  const age = now - new Date(row.submitted_at).getTime()
  if (age > RETRY_WINDOW_MS) return false
  // A fresh 'pending' row is still being sent by the submit handler.
  if (row.webhook_status === 'pending' && age < PENDING_GRACE_MS) return false
  return true
}

async function deliverWebhook(submissionId) {
  const { data: sub } = await db().from('form_submissions').select('*').eq('id', submissionId).maybeSingle()
  if (!sub || !sub.location_id) return { skipped: true }
  const [{ data: form }, { data: club }, { data: loc }] = await Promise.all([
    db().from('forms').select('*').eq('id', sub.form_id).maybeSingle(),
    db().from('quiz_clubs').select('*').eq('form_id', sub.form_id).eq('location_id', sub.location_id).maybeSingle(),
    db().from('locations').select('name').eq('id', sub.location_id).maybeSingle(),
  ])
  if (!form) return { skipped: true }
  if (!club || !club.ghl_webhook_url) {
    // URL removed since submit: nothing to deliver to.
    await db().from('form_submissions').update({ webhook_status: 'none' }).eq('id', sub.id)
    return { skipped: true }
  }
  const payload = buildWebhookPayload({ form, clubName: loc?.name || '', submission: sub })
  const result = await postJson(club.ghl_webhook_url, payload)
  const state = nextWebhookState(sub.webhook_attempts, result)
  await db().from('form_submissions').update(state).eq('id', sub.id)
  if (!result.ok) console.error(`[quizWebhook] submission ${sub.id} failed: ${state.webhook_error}`)
  return { ...state, http_status: result.status }
}

async function retryWebhooks() {
  const since = new Date(Date.now() - RETRY_WINDOW_MS).toISOString()
  const { data, error } = await db().from('form_submissions')
    .select('id, webhook_status, webhook_attempts, submitted_at')
    .in('webhook_status', ['pending', 'failed'])
    .lt('webhook_attempts', MAX_ATTEMPTS)
    .gte('submitted_at', since)
    .order('submitted_at', { ascending: true })
    .limit(100)
  if (error) throw error
  let sent = 0
  let failed = 0
  for (const row of (data || []).filter(r => isRetryDue(r))) {
    try {
      const r = await deliverWebhook(row.id)
      if (r.webhook_status === 'sent') sent++
      else if (r.webhook_status === 'failed') failed++
    } catch (err) {
      failed++
      console.error('[quizWebhook] retry threw:', err.message)
    }
  }
  return { sent, failed }
}

function start() {
  if (process.env.QUIZ_WEBHOOKS_DISABLED === '1') return
  const sweep = async () => {
    try {
      const { sent, failed } = await retryWebhooks()
      if (sent || failed) console.log(`[quizWebhook] sweep: ${sent} sent, ${failed} failed`)
    } catch (err) {
      console.error('[quizWebhook] sweep failed:', err.message)
    }
  }
  setInterval(sweep, 10 * 60 * 1000).unref()
}

module.exports = { MAX_ATTEMPTS, postJson, nextWebhookState, isRetryDue, deliverWebhook, retryWebhooks, start }
```

- [ ] **Step 4: Run the tests.** Run `cd auth && node --test src/services/quizWebhook.test.js`. Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add auth/src/services/quizWebhook.js auth/src/services/quizWebhook.test.js
git commit -m "feat(quizzes): GHL webhook sender with retry sweep"
```

### Task 4: Sheets lead columns, permission gate, route factory

**Files:**
- Modify: `auth/src/services/formsSheets.js`, `auth/src/services/formsSheets.test.js`
- Modify: `auth/src/services/formsPermissions.js`, `auth/src/services/formsPermissions.test.js`
- Move: `auth/src/routes/forms.js` to `auth/src/routes/formsHandlers.js`. Create a new `auth/src/routes/forms.js`.
- Test: `auth/src/routes/formsHandlers.test.js`

**Interfaces:**
- Consumes: `normalizeQuizSettings` (Task 2).
- Produces:
  - `formsSheets`:
    - `QUIZ_LEAD_KEYS`
    - `leadKeysFor(form)`
    - `computeColumns(schema, existing, leadKeys = [])`
  - `formsPermissions`:
    - `makeModuleGate(permKey, label)`
    - `requireQuizBuilder`
  - `formsHandlers`:
    - `buildFormsRouter({kind, gate}) -> express.Router`
    - `loadFormAccess(req, formId, kind)`
    - `kindMatches(form, kind)`
    - `normalizeSettings(input)`

- [ ] **Step 1: Failing Sheets tests.** Append to `formsSheets.test.js`:

```js
const { leadKeysFor, QUIZ_LEAD_KEYS } = require('./formsSheets')

test('quiz: lead columns come first, then questions, then UTM', () => {
  const cols = computeColumns(SCHEMA, {}, QUIZ_LEAD_KEYS)
  assert.deepStrictEqual(cols, {
    club: 2, first_name: 3, last_name: 4, email: 5, phone: 6,
    f_name: 7, f_days: 8, utm_source: 9, utm_medium: 10, utm_campaign: 11,
  })
  assert.deepStrictEqual(buildHeaderRow(SCHEMA, cols), [
    'Submitted At', 'Club', 'First Name', 'Last Name', 'Email', 'Phone',
    'Name', 'Days', 'UTM Source', 'UTM Medium', 'UTM Campaign',
  ])
})

test('quiz: a question added after publish appends after existing columns', () => {
  const existing = computeColumns(SCHEMA, {}, QUIZ_LEAD_KEYS)
  const grown = computeColumns([...SCHEMA, { id: 'f_new', type: 'radio', label: 'New', options: ['a'] }], existing, QUIZ_LEAD_KEYS)
  assert.equal(grown.f_new, 12)
  assert.equal(grown.club, 2)
})

test('leadKeysFor: quizzes only', () => {
  assert.deepStrictEqual(leadKeysFor({ kind: 'quiz' }), QUIZ_LEAD_KEYS)
  assert.deepStrictEqual(leadKeysFor({ kind: 'form' }), [])
  assert.deepStrictEqual(leadKeysFor({}), [])
})
```

Run `cd auth && node --test src/services/formsSheets.test.js`. Expected: FAIL (`leadKeysFor` undefined).

- [ ] **Step 2: Implement in `formsSheets.js`**

After `UTM_LABELS` add:

```js
// Quiz submissions carry the club + contact fields in `data` alongside the
// question answers. These keys never collide with f_* field ids.
const QUIZ_LEAD_KEYS = ['club', 'first_name', 'last_name', 'email', 'phone']
const QUIZ_LEAD_LABELS = { club: 'Club', first_name: 'First Name', last_name: 'Last Name', email: 'Email', phone: 'Phone' }
const QUIZ_FOLDER_LABEL = 'Quiz Funnels'

function leadKeysFor(form) {
  return form && form.kind === 'quiz' ? QUIZ_LEAD_KEYS : []
}
```

Change `computeColumns` so the signature and first loop read:

```js
function computeColumns(schema, existing = {}, leadKeys = []) {
  const cols = { ...existing }
  let max = Math.max(1, ...Object.values(cols))
  for (const k of leadKeys) {
    if (!cols[k]) { max += 1; cols[k] = max }
  }
  for (const f of inputFields(schema)) {
```

(the rest is unchanged). In `buildHeaderRow`, change `const labels = { ...UTM_LABELS }` to `const labels = { ...UTM_LABELS, ...QUIZ_LEAD_LABELS }`.

In `locationNameFor`, add as the first line: `if (form.kind === 'quiz') return QUIZ_FOLDER_LABEL`.

In `ensureSheet`, change `computeColumns(form.schema, form.sheet_columns || {})` to `computeColumns(form.schema, form.sheet_columns || {}, leadKeysFor(form))`.

Add `QUIZ_LEAD_KEYS, leadKeysFor` to `module.exports`. Run the tests: PASS.

- [ ] **Step 3: Permission gate.** Replace `requireFormsBuilder` in `formsPermissions.js` with:

```js
// Module gates: admin tier and up, or an explicit RBAC grant for `permKey`.
// Mirrors the requireReportAccess pattern in middleware/role.js.
function makeModuleGate(permKey, label) {
  return async function moduleGate(req, res, next) {
    if (!req.staff) return res.status(401).json({ error: 'Authentication required' })
    if (roleLevel(req.staff.role) >= ADMIN_LEVEL) return next()
    try {
      const { getEffectivePermissions } = require('./permissions')
      const perms = await getEffectivePermissions(req.staff)
      if (perms.includes(permKey)) return next()
    } catch (err) {
      console.error(`[${permKey}] effective-perm check failed:`, err.message)
    }
    return res.status(403).json({ error: `${label} access requires admin or a ${permKey} grant` })
  }
}

const requireFormsBuilder = makeModuleGate('forms', 'Forms')
const requireQuizBuilder = makeModuleGate('quizzes', 'Quiz Funnels')

module.exports = { canAccessForm, requireFormsBuilder, requireQuizBuilder, makeModuleGate }
```

Append to `formsPermissions.test.js`:

```js
test('module gates: admin passes, missing staff 401', async () => {
  const { requireQuizBuilder } = require('./formsPermissions')
  let passed = false
  await requireQuizBuilder({ staff: { role: 'admin' } }, {}, () => { passed = true })
  assert.equal(passed, true)
  let status
  const res = { status(s) { status = s; return { json() {} } } }
  await requireQuizBuilder({}, res, () => {})
  assert.equal(status, 401)
})
```

Run `cd auth && node --test src/services/formsPermissions.test.js`. Expected: PASS. (If the existing test file uses `assert` from `node:assert`, reuse its import names.)

- [ ] **Step 4: Failing factory tests** in `auth/src/routes/formsHandlers.test.js`:

```js
const test = require('node:test')
const assert = require('node:assert/strict')

// formsHandlers requires services/supabase at import; give it dummy env so the
// client constructs without network (it's never called by these pure tests).
process.env.SUPABASE_URL ||= 'http://localhost'
process.env.SUPABASE_SERVICE_ROLE_KEY ||= 'test'
const { kindMatches, normalizeSettings } = require('./formsHandlers')

test('kindMatches isolates forms from quizzes; legacy rows count as forms', () => {
  assert.equal(kindMatches({ kind: 'quiz' }, 'quiz'), true)
  assert.equal(kindMatches({ kind: 'quiz' }, 'form'), false)
  assert.equal(kindMatches({ kind: 'form' }, 'quiz'), false)
  assert.equal(kindMatches({}, 'form'), true)
  assert.equal(kindMatches(null, 'form'), false)
})

test('normalizeSettings keeps the form-only keys', () => {
  assert.deepEqual(normalizeSettings({ success_message: ' hi ', allow_resubmit: 1, x: 2 }).settings,
    { success_message: 'hi', allow_resubmit: true })
})
```

Before writing it, check the env var names `services/supabase.js` reads (`grep -n process.env auth/src/services/supabase.js`) and use those exact names in the test.

- [ ] **Step 5: Move and convert to a factory**

```bash
git mv auth/src/routes/forms.js auth/src/routes/formsHandlers.js
```

Edit `formsHandlers.js`:

1. Imports: remove `requireFormsBuilder` from the formsPermissions import (keep `canAccessForm`). Add `const { normalizeQuizSettings } = require('../services/quizSchema')`. Add `DISPLAY_TYPES` to the formsSchema import.
2. Delete the module-level `const router = Router()`, `router.use(authenticate)` and `router.use(requireFormsBuilder)` lines.
3. Keep `normalizeSettings`, `CORPORATE_LEVEL`, `isCorporate` and `enrichAuditEvents` at module level. Add:

```js
// Legacy rows predate the kind column's default in code paths; treat missing as 'form'.
function kindMatches(form, kind) {
  return !!form && (form.kind || 'form') === kind
}
```

4. Replace `loadFormAccess` with a kind-aware version (a row of the other kind reads as not found):

```js
async function loadFormAccess(req, formId, kind) {
  const none = { form: null, shares: [], access: { view: false, edit: false } }
  const { data: form, error } = await supabaseAdmin.from('forms').select('*').eq('id', formId).maybeSingle()
  if (error) throw error
  if (!kindMatches(form, kind)) return none
  const { data: shares } = await supabaseAdmin.from('form_shares').select('*').eq('form_id', formId)
  return { form, shares: shares || [], access: canAccessForm(req.staff, form, shares || []) }
}
```

5. Wrap every `router.<verb>(...)` definition in:

```js
function buildFormsRouter({ kind, gate }) {
  const router = Router()
  router.use(authenticate)
  router.use(gate)
  const load = (req, id) => loadFormAccess(req, id, kind)
  // ... all existing route definitions, unchanged except for the edits below ...
  return router
}
```

Inside it, make these edits:
- Replace every `loadFormAccess(req, ` with `load(req, `.
- Remove the per-route `requireFormsBuilder` arguments on `GET /staff-directory` and `POST /`, since the gate is router-level.
- **GET /**: change `.select('*').order('updated_at', ...)` to `.select('*').eq('kind', kind).order('updated_at', { ascending: false })`. After `counts` is built, add:

```js
    const clubCounts = {}
    if (kind === 'quiz' && visibleIds.length) {
      const { data: qc } = await supabaseAdmin.from('quiz_clubs')
        .select('form_id').eq('active', true).in('form_id', visibleIds)
      for (const r of qc || []) clubCounts[r.form_id] = (clubCounts[r.form_id] || 0) + 1
    }
```

  and add `club_count: clubCounts[f.id] || 0,` to each mapped form.
- **GET /audit/all**: after building `q`, scope it to this kind:

```js
    const { data: kindRows } = await supabaseAdmin.from('forms').select('id').eq('kind', kind)
    const kindIds = (kindRows || []).map(r => r.id)
    if (!kindIds.length) return res.json({ events: [] })
    q = q.in('form_id', kindIds)
```

- **POST /**: at the top of the try, after the title check, add the quiz branch:

```js
    if (kind === 'quiz') {
      const row = {
        slug: makeSlug(title), title: String(title).trim(), description: description || null,
        owner_id: req.staff.id, location_id: null, kind: 'quiz', visibility: 'shared',
      }
      const { data, error } = await supabaseAdmin.from('forms').insert(row).select('*').single()
      if (error) throw error
      formsAudit.record(data.id, req.staff.id, 'created', { title: data.title, kind: 'quiz' })
      return res.json({ form: { ...data, access: { view: true, edit: true } } })
    }
```

  and add `kind: 'form',` to the existing `row` object.
- **PATCH /:id**:
  - In the schema branch, after `validateSchema` passes, add:

```js
      if (kind === 'quiz' && schema.some(f => DISPLAY_TYPES.includes(f.type))) {
        return res.status(400).json({ error: 'Quizzes only support question fields' })
      }
```

  - Guard the location block by changing `let locationChanged = false` to be followed by `if (kind === 'form') { ... }` wrapping the existing `if/else if` pair.
  - In the settings branch, replace the body with:

```js
      const v = kind === 'quiz' ? normalizeQuizSettings(settings, form.settings) : normalizeSettings(settings)
      if (!v.ok) return res.status(400).json({ error: v.error })
      patch.settings = kind === 'quiz' ? v.settings : { ...(form.settings || {}), ...v.settings }
      detail.settings = true
```

- **GET /:id/submissions**: select `id, data, submitted_at, synced_to_sheet, sync_error, location_id, webhook_status, webhook_attempts, webhook_error`. Build the query into `let q`, add `if (req.query.location_id) q = q.eq('location_id', req.query.location_id)` before `.range`, then attach club names:

```js
    const locIds = [...new Set((data || []).map(r => r.location_id).filter(Boolean))]
    const { data: locs } = locIds.length
      ? await supabaseAdmin.from('locations').select('id, name').in('id', locIds) : { data: [] }
    const locName = Object.fromEntries((locs || []).map(l => [l.id, l.name]))
    res.json({
      submissions: (data || []).map(r => ({ ...r, club_name: r.location_id ? (locName[r.location_id] || '') : '' })),
      total: count || 0,
    })
```

6. Replace the file's `module.exports = router` with `module.exports = { buildFormsRouter, loadFormAccess, kindMatches, normalizeSettings }`.

Create the new `auth/src/routes/forms.js`:

```js
const { buildFormsRouter } = require('./formsHandlers')
const { requireFormsBuilder } = require('../services/formsPermissions')

module.exports = buildFormsRouter({ kind: 'form', gate: requireFormsBuilder })
```

- [ ] **Step 6: Run the tests.** Run `cd auth && node --test src/`. Expected: all PASS, including the new `formsHandlers.test.js`. Also run `node -e "require('./src/routes/forms')"` with dummy env set; expected: no throw.

- [ ] **Step 7: Commit**

```bash
git add -A auth/src
git commit -m "feat(quizzes): forms router factory, quiz gate, quiz sheet columns"
```

### Task 5: Quiz routes, public routes, mounting

**Files:**
- Create: `auth/src/routes/quizzes.js`, `auth/src/routes/publicQuizzes.js`
- Modify: `auth/src/routes/publicForms.js`, `auth/src/index.js`, `auth/src/routes/admin.js`

**Interfaces:**
- Consumes: Task 2, 3 and 4 exports.
- Produces HTTP:
  - `GET /quizzes/:id/clubs -> {clubs: ClubRow[]}`
  - `PUT /quizzes/:id/clubs {clubs:[{location_id, active, ghl_webhook_url, ghl_tracking_snippet?}]} -> {clubs}`
  - `POST /quizzes/:id/clubs/:locationId/test-webhook -> {ok, status, response}`
  - `POST /quizzes/:id/submissions/:subId/retry-webhook -> state`
  - `GET /public/quizzes/:club/:slug -> {quiz}`
  - `POST /public/quizzes/:club/:slug/submit {answers, contact, utm} -> {ok, redirect_url}`
  - The rest of `/quizzes/*` mirrors `/forms/*`.

- [ ] **Step 1: `auth/src/routes/quizzes.js`**

```js
const rateLimit = require('express-rate-limit')
const { supabaseAdmin } = require('../services/supabase')
const { buildFormsRouter, loadFormAccess } = require('./formsHandlers')
const { requireQuizBuilder } = require('../services/formsPermissions')
const {
  CLUB_SLUGS, clubRowsView, planClubUpserts, buildWebhookPayload, sampleSubmission,
} = require('../services/quizSchema')
const { postJson, deliverWebhook } = require('../services/quizWebhook')
const formsAudit = require('../services/formsAudit')

// Quiz Funnels management API: the shared forms handlers (kind='quiz') plus
// the per-club webhook/tracking endpoints.
const router = buildFormsRouter({ kind: 'quiz', gate: requireQuizBuilder })
const load = (req, id) => loadFormAccess(req, id, 'quiz')

const testLimiter = rateLimit({
  windowMs: 60 * 1000, limit: 10, standardHeaders: true, legacyHeaders: false,
  message: { error: 'Too many test sends. Try again in a minute.' },
})

// The 7 clubs, as locations rows (other locations rows are not clubs).
async function clubLocations() {
  const { data, error } = await supabaseAdmin.from('locations').select('id, name').order('name')
  if (error) throw error
  return (data || []).filter(l => CLUB_SLUGS.includes(String(l.name).toLowerCase()))
}

async function clubsResponse(form) {
  const [locs, { data: rows }] = await Promise.all([
    clubLocations(),
    supabaseAdmin.from('quiz_clubs').select('*').eq('form_id', form.id),
  ])
  return clubRowsView(locs, rows || [], form)
}

router.get('/:id/clubs', async (req, res) => {
  try {
    const { form, access } = await load(req, req.params.id)
    if (!form || !access.view) return res.status(form ? 403 : 404).json({ error: form ? 'No access' : 'Not found' })
    res.json({ clubs: await clubsResponse(form) })
  } catch (err) {
    console.error('[quizzes] clubs load failed:', err.message)
    res.status(500).json({ error: 'Failed to load clubs' })
  }
})

router.put('/:id/clubs', async (req, res) => {
  try {
    const { form, access } = await load(req, req.params.id)
    if (!form || !access.edit) return res.status(form ? 403 : 404).json({ error: form ? 'No access' : 'Not found' })
    const input = Array.isArray(req.body?.clubs) ? req.body.clubs : null
    if (!input) return res.status(400).json({ error: 'clubs must be an array' })
    const [locs, { data: existing }] = await Promise.all([
      clubLocations(),
      supabaseAdmin.from('quiz_clubs').select('*').eq('form_id', form.id),
    ])
    const plan = planClubUpserts(form.id, input, existing || [], locs)
    if (!plan.ok) return res.status(400).json({ error: plan.error })
    if (plan.rows.length) {
      const { error } = await supabaseAdmin.from('quiz_clubs').upsert(plan.rows, { onConflict: 'form_id,location_id' })
      if (error) throw error
    }
    formsAudit.record(form.id, req.staff.id, 'clubs_updated', {
      active: plan.rows.filter(r => r.active).map(r => r.location_id),
    })
    res.json({ clubs: await clubsResponse(form) })
  } catch (err) {
    console.error('[quizzes] clubs save failed:', err.message)
    res.status(500).json({ error: 'Failed to save clubs' })
  }
})

router.post('/:id/clubs/:locationId/test-webhook', testLimiter, async (req, res) => {
  try {
    const { form, access } = await load(req, req.params.id)
    if (!form || !access.edit) return res.status(form ? 403 : 404).json({ error: form ? 'No access' : 'Not found' })
    const [{ data: club }, { data: loc }] = await Promise.all([
      supabaseAdmin.from('quiz_clubs').select('*').eq('form_id', form.id).eq('location_id', req.params.locationId).maybeSingle(),
      supabaseAdmin.from('locations').select('name').eq('id', req.params.locationId).maybeSingle(),
    ])
    if (!club?.ghl_webhook_url) return res.status(400).json({ error: 'Save a webhook URL for this club first' })
    const payload = buildWebhookPayload({ form, clubName: loc?.name || '', submission: sampleSubmission(form), test: true })
    const result = await postJson(club.ghl_webhook_url, payload)
    formsAudit.record(form.id, req.staff.id, 'webhook_test', { location_id: req.params.locationId, status: result.status })
    res.json({ ok: result.ok, status: result.status, response: result.text })
  } catch (err) {
    console.error('[quizzes] test webhook failed:', err.message)
    res.status(500).json({ error: 'Test send failed' })
  }
})

router.post('/:id/submissions/:subId/retry-webhook', async (req, res) => {
  try {
    const { form, access } = await load(req, req.params.id)
    if (!form || !access.edit) return res.status(form ? 403 : 404).json({ error: form ? 'No access' : 'Not found' })
    const { data: sub } = await supabaseAdmin.from('form_submissions')
      .select('id, form_id').eq('id', req.params.subId).maybeSingle()
    if (!sub || sub.form_id !== form.id) return res.status(404).json({ error: 'Not found' })
    const result = await deliverWebhook(sub.id)
    formsAudit.record(form.id, req.staff.id, 'webhook_retry', { submission_id: sub.id, status: result.webhook_status || 'skipped' })
    res.json(result)
  } catch (err) {
    console.error('[quizzes] retry webhook failed:', err.message)
    res.status(500).json({ error: 'Retry failed' })
  }
})

module.exports = router
```

- [ ] **Step 2: `auth/src/routes/publicQuizzes.js`**

```js
const { Router } = require('express')
const rateLimit = require('express-rate-limit')
const { supabaseAdmin } = require('../services/supabase')
const { validateSubmission, sanitizeUtm } = require('../services/formsSchema')
const { CLUB_SLUGS, publicQuizView, validateContact, quizSettingsWithDefaults } = require('../services/quizSchema')
const formsSheets = require('../services/formsSheets')
const formsAudit = require('../services/formsAudit')
const { deliverWebhook } = require('../services/quizWebhook')

// Public quiz renderer endpoints (no auth). A quiz is reachable only when it
// is published AND the club in the URL is active for it.
const router = Router()

const submitLimiter = rateLimit({
  windowMs: 60 * 1000, limit: 20, standardHeaders: true, legacyHeaders: false,
  message: { error: 'Too many submissions. Try again in a minute.' },
})

async function loadQuiz(clubSlug, slug) {
  const club = String(clubSlug || '').toLowerCase()
  if (!CLUB_SLUGS.includes(club)) return null
  const { data: form } = await supabaseAdmin.from('forms').select('*')
    .eq('slug', slug).eq('kind', 'quiz').eq('status', 'published').maybeSingle()
  if (!form) return null
  // CLUB_SLUGS are plain letters, so ilike here is a case-insensitive equals.
  const { data: location } = await supabaseAdmin.from('locations').select('id, name').ilike('name', club).maybeSingle()
  if (!location) return null
  const { data: clubRow } = await supabaseAdmin.from('quiz_clubs').select('*')
    .eq('form_id', form.id).eq('location_id', location.id).eq('active', true).maybeSingle()
  if (!clubRow) return null
  return { form, location, club: clubRow }
}

router.get('/:club/:slug', async (req, res) => {
  try {
    const ctx = await loadQuiz(req.params.club, req.params.slug)
    if (!ctx) return res.status(404).json({ error: 'This quiz is not available' })
    res.json({ quiz: publicQuizView(ctx.form, ctx.location, ctx.club) })
  } catch (err) {
    console.error('[publicQuizzes] fetch failed:', err.message)
    res.status(500).json({ error: 'Something went wrong. Try again.' })
  }
})

router.post('/:club/:slug/submit', submitLimiter, async (req, res) => {
  try {
    const ctx = await loadQuiz(req.params.club, req.params.slug)
    if (!ctx) return res.status(404).json({ error: 'This quiz is not available' })
    const body = req.body || {}
    const settings = quizSettingsWithDefaults(ctx.form.settings)
    const answers = validateSubmission(ctx.form.schema, body.answers)
    const contact = validateContact(body.contact, settings.contact_step)
    if (!answers.ok || !contact.ok) {
      return res.status(400).json({ errors: { ...answers.errors, ...contact.errors } })
    }
    const hasWebhook = !!ctx.club.ghl_webhook_url
    // Supabase backup first; Sheets + webhook run after the response.
    const { data: submission, error } = await supabaseAdmin.from('form_submissions').insert({
      form_id: ctx.form.id,
      location_id: ctx.location.id,
      data: { ...answers.cleaned, club: ctx.location.name, ...contact.cleaned },
      utm: sanitizeUtm(body.utm),
      webhook_status: hasWebhook ? 'pending' : 'none',
    }).select('*').single()
    if (error) throw error
    formsAudit.record(ctx.form.id, null, 'submission_received', { submission_id: submission.id, location_id: ctx.location.id })
    res.json({ ok: true, redirect_url: settings.thank_you.redirect_url || '' })

    // After the response: neither failure affects the lead. Failures are
    // recorded on the row and retried by the 10-minute sweeps.
    if (ctx.form.sheet_id) {
      formsSheets.appendSubmission(ctx.form, submission)
        .catch(err => console.error('[publicQuizzes] sheet append failed (backed up):', err.message))
    }
    if (hasWebhook) {
      deliverWebhook(submission.id)
        .catch(err => console.error('[publicQuizzes] webhook send threw:', err.message))
    }
  } catch (err) {
    console.error('[publicQuizzes] submit failed:', err.message)
    if (!res.headersSent) res.status(500).json({ error: 'Something went wrong. Try again.' })
  }
})

module.exports = router
```

- [ ] **Step 3: Keep quizzes off the forms public route.** In `publicForms.js` `loadPublished`, change `.eq('slug', slug).eq('status', 'published')` to `.eq('slug', slug).eq('kind', 'form').eq('status', 'published')`.

- [ ] **Step 4: Mount and start.** In `auth/src/index.js`:
  - After `app.use('/forms', require('./routes/forms'))`, add `app.use('/quizzes', require('./routes/quizzes'))`.
  - After `app.use('/public/forms', require('./routes/publicForms'))`, add `app.use('/public/quizzes', require('./routes/publicQuizzes'))`.
  - After the formsSheets start block, add:

```js
  // Quiz Funnels: GHL webhook retry sweep. Opt out via QUIZ_WEBHOOKS_DISABLED=1.
  try {
    require('./services/quizWebhook').start()
  } catch (err) {
    console.error('[quizWebhook] failed to start:', err.message)
  }
```

  Match the surrounding indentation and block style exactly.

- [ ] **Step 5: Allow the tile key.** In `auth/src/routes/admin.js` `CUSTOM_TILE_KEYS`, add `'quizzes'` right after `'forms'`.

- [ ] **Step 6: Verify.** Run `cd auth && node --test src/`. Expected: all PASS. Then run a boot smoke test with dummy env to catch require errors:

```bash
cd auth && node -e "process.env.SUPABASE_URL='http://localhost';process.env.SUPABASE_SERVICE_ROLE_KEY='x';require('./src/routes/quizzes');require('./src/routes/publicQuizzes');console.log('ok')"
```

Expected: `ok`. Use the env names found in Task 4 Step 4.

- [ ] **Step 7: Commit**

```bash
git add auth/src
git commit -m "feat(quizzes): club config, test/retry webhook, public quiz endpoints"
```

### Task 6: Portal API client + quiz defaults

**Files:**
- Modify: `portal/src/lib/api.js`
- Create: `portal/src/components/forms/quizDefaults.js`, `portal/src/components/forms/quizDefaults.test.mjs`

**Interfaces:**
- Produces:
  - `api.js`: `forms` (unchanged shape) and `quizzes`, which is the forms shape plus:
    - `submissions(id, offset, locationId)`
    - `clubs(id)`
    - `saveClubs(id, clubs)`
    - `testWebhook(id, locationId)`
    - `retryWebhook(id, subId)`
  - `quizDefaults.js`:
    - `QUIZ_DEFAULTS`
    - `quizSettingsFrom(s)`
    - `PIXEL_RE`, `GTM_RE`
    - `webhookBadge(sub) -> {label, tone}`

- [ ] **Step 1: Failing test** `quizDefaults.test.mjs`:

```js
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { quizSettingsFrom, webhookBadge, PIXEL_RE, GTM_RE } from './quizDefaults.js'

test('quizSettingsFrom fills every section', () => {
  const s = quizSettingsFrom({ tracking: { gtm_id: 'GTM-AAAA' } })
  assert.equal(s.tracking.gtm_id, 'GTM-AAAA')
  assert.equal(s.tracking.meta_pixel_id, '')
  assert.equal(s.contact_step.require_phone, true)
  assert.equal(typeof s.thank_you.heading, 'string')
})

test('webhookBadge', () => {
  assert.deepEqual(webhookBadge({ webhook_status: 'sent' }), { label: 'Sent to GHL', tone: 'green' })
  assert.deepEqual(webhookBadge({ webhook_status: 'failed', webhook_attempts: 2 }), { label: 'Retrying (2/5)', tone: 'amber' })
  assert.deepEqual(webhookBadge({ webhook_status: 'failed', webhook_attempts: 5 }), { label: 'Failed', tone: 'red' })
  assert.deepEqual(webhookBadge({ webhook_status: 'pending' }), { label: 'Sending', tone: 'gray' })
  assert.deepEqual(webhookBadge({ webhook_status: 'none' }), { label: 'No webhook', tone: 'gray' })
})

test('id regexes match backend', () => {
  assert.ok(PIXEL_RE.test('820682157231470'))
  assert.ok(GTM_RE.test('GTM-N4BRPV65'))
  assert.ok(!GTM_RE.test('gtm-n4'))
})
```

Run `cd portal && node --test src/components/forms/quizDefaults.test.mjs`. Expected: FAIL.

- [ ] **Step 2: Implement `quizDefaults.js`**

```js
// Mirrors auth/src/services/quizSchema.js DEFAULT_QUIZ_SETTINGS + validators.
export const QUIZ_DEFAULTS = {
  contact_step: {
    heading: 'Where should we send your results?', subtext: '',
    require_first_name: true, require_last_name: false, require_phone: true,
  },
  thank_you: { heading: "You're all set!", message: '', redirect_url: '' },
  tracking: { meta_pixel_id: '', gtm_id: '' },
}

export const PIXEL_RE = /^\d{6,20}$/
export const GTM_RE = /^GTM-[A-Z0-9]{4,12}$/
export const MAX_WEBHOOK_ATTEMPTS = 5

export function quizSettingsFrom(s) {
  const src = s && typeof s === 'object' ? s : {}
  return {
    contact_step: { ...QUIZ_DEFAULTS.contact_step, ...(src.contact_step || {}) },
    thank_you: { ...QUIZ_DEFAULTS.thank_you, ...(src.thank_you || {}) },
    tracking: { ...QUIZ_DEFAULTS.tracking, ...(src.tracking || {}) },
  }
}

export function webhookBadge(sub) {
  const n = sub?.webhook_attempts || 0
  switch (sub?.webhook_status) {
    case 'sent': return { label: 'Sent to GHL', tone: 'green' }
    case 'failed': return n >= MAX_WEBHOOK_ATTEMPTS
      ? { label: 'Failed', tone: 'red' }
      : { label: `Retrying (${n}/${MAX_WEBHOOK_ATTEMPTS})`, tone: 'amber' }
    case 'pending': return { label: 'Sending', tone: 'gray' }
    default: return { label: 'No webhook', tone: 'gray' }
  }
}
```

- [ ] **Step 3: API client.** In `portal/src/lib/api.js`, replace the `export const forms = {...}` block with:

```js
// Forms and Quiz Funnels share one backend handler set, mounted at /forms and /quizzes.
function makeFormsClient(base) {
  return {
    list: () => api(base),
    get: (id) => api(`${base}/${id}`),
    create: (body) => api(base, { method: 'POST', body: JSON.stringify(body) }),
    update: (id, body) => api(`${base}/${id}`, { method: 'PATCH', body: JSON.stringify(body) }),
    publish: (id) => api(`${base}/${id}/publish`, { method: 'POST' }),
    archive: (id) => api(`${base}/${id}/archive`, { method: 'POST' }),
    remove: (id) => api(`${base}/${id}`, { method: 'DELETE' }),
    addShare: (id, body) => api(`${base}/${id}/shares`, { method: 'POST', body: JSON.stringify(body) }),
    removeShare: (id, staffId) => api(`${base}/${id}/shares/${staffId}`, { method: 'DELETE' }),
    audit: (id) => api(`${base}/${id}/audit`),
    auditAll: (params = {}) => api(`${base}/audit/all?` + new URLSearchParams(params)),
    submissions: (id, offset = 0) => api(`${base}/${id}/submissions?offset=${offset}`),
    retrySync: (id) => api(`${base}/${id}/retry-sync`, { method: 'POST' }),
    staffDirectory: () => api(`${base}/staff-directory`),
  }
}

export const forms = makeFormsClient('/forms')

export const quizzes = {
  ...makeFormsClient('/quizzes'),
  submissions: (id, offset = 0, locationId = '') =>
    api(`/quizzes/${id}/submissions?offset=${offset}${locationId ? `&location_id=${encodeURIComponent(locationId)}` : ''}`),
  clubs: (id) => api(`/quizzes/${id}/clubs`),
  saveClubs: (id, clubs) => api(`/quizzes/${id}/clubs`, { method: 'PUT', body: JSON.stringify({ clubs }) }),
  testWebhook: (id, locationId) => api(`/quizzes/${id}/clubs/${locationId}/test-webhook`, { method: 'POST' }),
  retryWebhook: (id, subId) => api(`/quizzes/${id}/submissions/${subId}/retry-webhook`, { method: 'POST' }),
}
```

- [ ] **Step 4: Run the tests.** Run `cd portal && node --test src/components/forms/quizDefaults.test.mjs src/lib/apiPaths.test.mjs`. Expected: PASS. If `apiPaths.test.mjs` scrapes api.js for literal paths, update it to accept the factory, or keep literal strings. Read that test first.

- [ ] **Step 5: Commit**

```bash
git add portal/src/lib/api.js portal/src/components/forms/quizDefaults.js portal/src/components/forms/quizDefaults.test.mjs
git commit -m "feat(quizzes): portal API client and quiz defaults"
```

### Task 7: Quiz builder panels

**Files:**
- Create: `portal/src/components/forms/QuizSettingsPanels.jsx`, `QuizClubsPanel.jsx`, `QuizSubmissionsPanel.jsx`

**Interfaces:**
- Consumes: `quizzes` client and `quizDefaults` (Task 6).
- Produces:
  - `<QuizContactPanel value onChange disabled/>`
  - `<QuizThankYouPanel value onChange disabled/>`
  - `<QuizTrackingPanel value onChange disabled/>`

  (Each `value` is the matching settings section; `onChange(nextSection)`.)
  - `<QuizClubsPanel form api canEdit/>`
  - `<QuizSubmissionsPanel form api canEdit/>`

- [ ] **Step 1: `QuizSettingsPanels.jsx`**

```jsx
import { GTM_RE, PIXEL_RE } from './quizDefaults'

const inputClass = 'w-full px-3 py-2 bg-bg border border-border rounded-lg text-sm text-text-primary focus:outline-none focus:ring-2 focus:ring-wcs-red disabled:opacity-60'

function Card({ title, subtitle, children }) {
  return (
    <div className="bg-surface rounded-xl border border-border p-5 space-y-5">
      <div>
        <h3 className="text-sm font-bold text-text-primary">{title}</h3>
        {subtitle && <p className="text-xs text-text-muted mt-0.5">{subtitle}</p>}
      </div>
      {children}
    </div>
  )
}

function Field({ label, hint, children }) {
  return (
    <div>
      <label className="block text-xs font-semibold text-text-muted mb-1">{label}</label>
      {children}
      {hint && <p className="text-[11px] text-text-muted mt-1">{hint}</p>}
    </div>
  )
}

export function Toggle({ label, hint, checked, onChange, disabled }) {
  return (
    <div className="flex items-start justify-between gap-4">
      <div className="min-w-0">
        <p className="text-xs font-semibold text-text-primary">{label}</p>
        {hint && <p className="text-[11px] text-text-muted mt-0.5">{hint}</p>}
      </div>
      <button type="button" role="switch" aria-checked={checked} disabled={disabled} onClick={() => onChange(!checked)}
        className={`shrink-0 relative inline-flex h-6 w-11 items-center rounded-full transition-colors disabled:opacity-60 ${checked ? 'bg-wcs-red' : 'bg-border'}`}>
        <span className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${checked ? 'translate-x-6' : 'translate-x-1'}`} />
      </button>
    </div>
  )
}

export function QuizContactPanel({ value, onChange, disabled }) {
  const set = patch => onChange({ ...value, ...patch })
  return (
    <Card title="Contact step" subtitle="The last screen of the quiz. GHL tracking reads this form, so email is always collected.">
      <Field label="Heading">
        <input value={value.heading} onChange={e => set({ heading: e.target.value })} maxLength={200} disabled={disabled} className={inputClass} />
      </Field>
      <Field label="Subtext (optional)">
        <textarea value={value.subtext} onChange={e => set({ subtext: e.target.value })} rows={2} maxLength={500} disabled={disabled} className={inputClass} />
      </Field>
      <Toggle label="Require first name" checked={value.require_first_name} onChange={v => set({ require_first_name: v })} disabled={disabled} />
      <Toggle label="Require last name" checked={value.require_last_name} onChange={v => set({ require_last_name: v })} disabled={disabled} />
      <Toggle label="Require phone" checked={value.require_phone} onChange={v => set({ require_phone: v })} disabled={disabled} />
      <Toggle label="Require email" hint="Always on. GHL matches contacts by email." checked onChange={() => {}} disabled />
    </Card>
  )
}

export function QuizThankYouPanel({ value, onChange, disabled }) {
  const set = patch => onChange({ ...value, ...patch })
  const badRedirect = value.redirect_url && !/^https:\/\//i.test(value.redirect_url)
  return (
    <Card title="After submit" subtitle="What someone sees once they finish the quiz.">
      <Field label="Heading">
        <input value={value.heading} onChange={e => set({ heading: e.target.value })} maxLength={200} disabled={disabled} className={inputClass} />
      </Field>
      <Field label="Message (optional)">
        <textarea value={value.message} onChange={e => set({ message: e.target.value })} rows={3} maxLength={1000} disabled={disabled} className={inputClass} />
      </Field>
      <Field label="Redirect URL (optional)" hint={badRedirect ? 'Use a full https:// link.' : 'If set, people are sent here instead of seeing the message.'}>
        <input value={value.redirect_url} onChange={e => set({ redirect_url: e.target.value })} placeholder="https://westcoaststrength.com/thank-you" disabled={disabled} className={inputClass} />
      </Field>
    </Card>
  )
}

export function QuizTrackingPanel({ value, onChange, disabled }) {
  const set = patch => onChange({ ...value, ...patch })
  const pixelBad = value.meta_pixel_id && !PIXEL_RE.test(value.meta_pixel_id.trim())
  const gtmBad = value.gtm_id && !GTM_RE.test(value.gtm_id.trim().toUpperCase())
  return (
    <Card title="Tracking" subtitle="Loaded on every club's link for this quiz. GHL External Tracking is set per club on the Clubs tab.">
      <Field label="Meta Pixel ID (optional)" hint={pixelBad ? 'Digits only.' : 'Fires PageView on load and Lead on submit.'}>
        <input value={value.meta_pixel_id} onChange={e => set({ meta_pixel_id: e.target.value })} placeholder="820682157231470" disabled={disabled} className={inputClass} />
      </Field>
      <Field label="GTM container ID (optional)" hint={gtmBad ? 'Should look like GTM-XXXXXXX.' : 'Pushes quiz_start, quiz_step and quiz_submit to the dataLayer.'}>
        <input value={value.gtm_id} onChange={e => set({ gtm_id: e.target.value })} placeholder="GTM-XXXXXXX" disabled={disabled} className={inputClass} />
      </Field>
    </Card>
  )
}
```

- [ ] **Step 2: `QuizClubsPanel.jsx`**

```jsx
import { useEffect, useState } from 'react'
import { Toggle } from './QuizSettingsPanels'

const inputClass = 'w-full px-3 py-2 bg-bg border border-border rounded-lg text-sm text-text-primary focus:outline-none focus:ring-2 focus:ring-wcs-red disabled:opacity-60'

// Per-club switches, GHL webhook URL and GHL External Tracking snippet.
// Saved independently of the builder's Save (its own button).
export default function QuizClubsPanel({ form, api, canEdit }) {
  const [clubs, setClubs] = useState(null)
  const [snippets, setSnippets] = useState({}) // location_id -> pasted text (only sent when touched)
  const [dirty, setDirty] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [tests, setTests] = useState({}) // location_id -> { busy, result }
  const [copied, setCopied] = useState(null)

  async function load() {
    setError('')
    try {
      const res = await api.clubs(form.id)
      setClubs(res.clubs || [])
      setSnippets({})
      setDirty(false)
    } catch (err) { setError(err.message || 'Failed to load clubs') }
  }
  useEffect(() => { load() }, [form.id]) // eslint-disable-line react-hooks/exhaustive-deps

  function update(locationId, patch) {
    setClubs(cs => cs.map(c => (c.location_id === locationId ? { ...c, ...patch } : c)))
    setDirty(true)
    setNotice('')
  }

  async function save() {
    setSaving(true); setError(''); setNotice('')
    try {
      const body = clubs.map(c => {
        const row = { location_id: c.location_id, active: c.active, ghl_webhook_url: c.ghl_webhook_url }
        if (snippets[c.location_id] !== undefined) row.ghl_tracking_snippet = snippets[c.location_id]
        return row
      })
      const res = await api.saveClubs(form.id, body)
      setClubs(res.clubs || [])
      setSnippets({})
      setDirty(false)
      setNotice('Clubs saved.')
    } catch (err) { setError(err.message || 'Failed to save clubs') }
    finally { setSaving(false) }
  }

  async function sendTest(locationId) {
    setTests(t => ({ ...t, [locationId]: { busy: true } }))
    try {
      const r = await api.testWebhook(form.id, locationId)
      setTests(t => ({ ...t, [locationId]: { result: r.ok ? `GHL accepted it (HTTP ${r.status}).` : `GHL returned HTTP ${r.status || 'error'}: ${r.response || ''}`, ok: r.ok } }))
    } catch (err) {
      setTests(t => ({ ...t, [locationId]: { result: err.message || 'Test failed', ok: false } }))
    }
  }

  function copy(url, id) {
    navigator.clipboard.writeText(url)
    setCopied(id)
    setTimeout(() => setCopied(null), 1500)
  }

  if (!clubs) {
    return error
      ? <div className="bg-red-50 border border-red-200 text-wcs-red rounded-xl px-4 py-3 text-sm">{error}</div>
      : <div className="loading-card" />
  }

  const published = form.status === 'published'
  return (
    <div className="space-y-4">
      <div className="bg-surface rounded-xl border border-border p-5 flex flex-wrap items-center gap-3">
        <div className="flex-1 min-w-0">
          <h3 className="text-sm font-bold text-text-primary">Clubs</h3>
          <p className="text-xs text-text-muted mt-0.5">Turn the quiz on per club. Each club sends leads to its own GHL webhook and loads its own GHL tracking.</p>
        </div>
        {canEdit && (
          <button onClick={save} disabled={saving || !dirty}
            className="px-4 py-1.5 text-xs font-medium bg-wcs-red text-white rounded-lg hover:opacity-90 transition-opacity disabled:opacity-50">
            {saving ? 'Saving...' : 'Save Clubs'}
          </button>
        )}
      </div>
      {error && <div className="bg-red-50 border border-red-200 text-wcs-red rounded-xl px-4 py-3 text-sm">{error}</div>}
      {notice && <div className="bg-green-50 border border-green-200 text-green-700 rounded-xl px-4 py-3 text-sm">{notice}</div>}
      {!published && (
        <div className="bg-amber-50 border border-amber-200 text-amber-800 rounded-xl px-4 py-3 text-sm">Publish the quiz to make club links live.</div>
      )}
      {clubs.map(c => {
        const t = tests[c.location_id]
        return (
          <div key={c.location_id} className="bg-surface rounded-xl border border-border p-5 space-y-4">
            <Toggle label={c.name} hint={c.active ? 'Live at this club' : 'Off at this club'} checked={c.active}
              onChange={v => update(c.location_id, { active: v })} disabled={!canEdit} />
            {c.active && (
              <>
                <div>
                  <label className="block text-xs font-semibold text-text-muted mb-1">GHL inbound webhook URL</label>
                  <input value={c.ghl_webhook_url} onChange={e => update(c.location_id, { ghl_webhook_url: e.target.value })}
                    placeholder="https://services.leadconnectorhq.com/hooks/..." disabled={!canEdit} className={inputClass} />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-text-muted mb-1">GHL External Tracking snippet</label>
                  <textarea rows={2} disabled={!canEdit} className={`${inputClass} font-mono text-xs`}
                    value={snippets[c.location_id] ?? ''}
                    onChange={e => { setSnippets(s => ({ ...s, [c.location_id]: e.target.value })); setDirty(true); setNotice('') }}
                    placeholder={c.ghl_tracking_id ? `Saved: ${c.ghl_tracking_id} (paste a new snippet to replace)` : '<script src="https://.../js/external-tracking.js" data-tracking-id="tk_..."></script>'} />
                  <p className="text-[11px] text-text-muted mt-1">From GHL: Settings, External Tracking, Copy Script. {c.ghl_tracking_id ? `Current id: ${c.ghl_tracking_id}.` : 'Not set.'}</p>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  {canEdit && (
                    <button onClick={() => sendTest(c.location_id)} disabled={t?.busy || dirty || !c.ghl_webhook_url}
                      title={dirty ? 'Save clubs first' : undefined}
                      className="px-3 py-1.5 text-xs text-text-primary border border-border rounded-lg hover:bg-bg transition-colors disabled:opacity-50">
                      {t?.busy ? 'Sending...' : 'Send test'}
                    </button>
                  )}
                  {published && (
                    <button onClick={() => copy(c.url, c.location_id)}
                      className="px-3 py-1.5 text-xs text-wcs-red border border-border rounded-lg hover:bg-bg transition-colors">
                      {copied === c.location_id ? 'Copied!' : 'Copy link'}
                    </button>
                  )}
                  {published && <a href={c.url} target="_blank" rel="noreferrer" className="text-xs text-text-muted hover:underline truncate">{c.url}</a>}
                </div>
                {t?.result && (
                  <p className={`text-xs ${t.ok ? 'text-green-700' : 'text-wcs-red'}`}>{t.result}</p>
                )}
              </>
            )}
          </div>
        )
      })}
    </div>
  )
}
```

- [ ] **Step 3: `QuizSubmissionsPanel.jsx`**

```jsx
import { useEffect, useState } from 'react'
import { webhookBadge } from './quizDefaults'

const TONES = {
  green: 'bg-green-50 border border-green-200 text-green-700',
  amber: 'bg-amber-50 border border-amber-200 text-amber-700',
  red: 'bg-red-50 border border-red-200 text-wcs-red',
  gray: 'bg-gray-100 border border-gray-200 text-gray-600',
}

export default function QuizSubmissionsPanel({ form, api, canEdit }) {
  const [clubs, setClubs] = useState([])
  const [club, setClub] = useState('')
  const [rows, setRows] = useState(null)
  const [total, setTotal] = useState(0)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(null)

  async function load() {
    setError('')
    try {
      const res = await api.submissions(form.id, 0, club)
      setRows(res.submissions || [])
      setTotal(res.total || 0)
    } catch (err) { setError(err.message || 'Failed to load submissions') }
  }
  useEffect(() => { api.clubs(form.id).then(r => setClubs((r.clubs || []).filter(c => c.active))).catch(() => {}) }, [form.id]) // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { load() }, [form.id, club]) // eslint-disable-line react-hooks/exhaustive-deps

  async function retry(subId) {
    setBusy(subId)
    try { await api.retryWebhook(form.id, subId); await load() }
    catch (err) { setError(err.message || 'Retry failed') }
    finally { setBusy(null) }
  }

  return (
    <div className="space-y-4">
      <div className="bg-surface rounded-xl border border-border p-5 flex flex-wrap items-center gap-3">
        <div className="flex-1 min-w-0">
          <h3 className="text-sm font-bold text-text-primary">Submissions</h3>
          <p className="text-xs text-text-muted mt-0.5">{total} total. The Google Sheet has every answer.</p>
        </div>
        <select value={club} onChange={e => setClub(e.target.value)}
          className="px-3 py-2 bg-bg border border-border rounded-lg text-sm text-text-primary focus:outline-none focus:ring-2 focus:ring-wcs-red">
          <option value="">All clubs</option>
          {clubs.map(c => <option key={c.location_id} value={c.location_id}>{c.name}</option>)}
        </select>
        {form.sheet_id && (
          <a href={`https://docs.google.com/spreadsheets/d/${form.sheet_id}`} target="_blank" rel="noopener noreferrer"
            className="px-4 py-2 text-sm font-medium bg-wcs-red text-white rounded-lg hover:opacity-90 transition-opacity">Open Sheet ↗</a>
        )}
      </div>
      {error && <div className="bg-red-50 border border-red-200 text-wcs-red rounded-xl px-4 py-3 text-sm">{error}</div>}
      {rows === null ? <div className="loading-card" /> : rows.length === 0 ? (
        <div className="bg-surface rounded-xl border border-border p-10 text-center text-sm text-text-muted">No submissions yet.</div>
      ) : (
        <div className="bg-surface rounded-xl border border-border divide-y divide-border">
          {rows.map(r => {
            const b = webhookBadge(r)
            const name = [r.data?.first_name, r.data?.last_name].filter(Boolean).join(' ') || '(no name)'
            return (
              <div key={r.id} className="flex flex-wrap items-center gap-3 px-5 py-3">
                <div className="flex-1 min-w-0">
                  <div className="text-sm font-semibold text-text-primary truncate">{name}</div>
                  <div className="text-xs text-text-muted truncate">{r.data?.email} · {r.club_name} · {new Date(r.submitted_at).toLocaleString()}</div>
                </div>
                <span title={r.webhook_error || undefined} className={`px-2.5 py-1 rounded-full text-[11px] font-semibold ${TONES[b.tone]}`}>{b.label}</span>
                {canEdit && r.webhook_status === 'failed' && (
                  <button onClick={() => retry(r.id)} disabled={busy === r.id}
                    className="px-3 py-1.5 text-xs text-text-primary border border-border rounded-lg hover:bg-bg transition-colors disabled:opacity-50">
                    {busy === r.id ? 'Retrying...' : 'Retry'}
                  </button>
                )}
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
```

- [ ] **Step 4: Build check.** Run `cd portal && npx vite build`. Expected: build succeeds. (The panels aren't imported yet, so this only checks the tree still builds.)

- [ ] **Step 5: Commit**

```bash
git add portal/src/components/forms/QuizSettingsPanels.jsx portal/src/components/forms/QuizClubsPanel.jsx portal/src/components/forms/QuizSubmissionsPanel.jsx
git commit -m "feat(quizzes): contact, thank-you, tracking, clubs and submissions panels"
```

### Task 8: Builder + list `kind` support, and tile wiring

**Files:**
- Modify: `portal/src/components/forms/FormBuilder.jsx`, `FormsView.jsx`, `FormSharePanel.jsx`, `FormAuditPanel.jsx`
- Modify: `portal/src/components/ToolGrid.jsx`, `portal/src/App.jsx`, `portal/src/config/portalTiles.js`, `portal/src/config/changelog.js`

**Interfaces:**
- Consumes: Task 6 and Task 7 exports.
- Produces:
  - `<FormsView kind="quiz" onBack me/>`
  - `<FormBuilder kind="quiz" formId onBack me/>`
  - ToolGrid `onQuizzes` prop
  - App `showQuizzes`

- [ ] **Step 1: Share and Audit panels take an `api` prop.** In both `FormSharePanel.jsx` and `FormAuditPanel.jsx`:
  - Change the import to `import { forms as defaultFormsApi } from '../../lib/api'`.
  - Add `api: formsApi = defaultFormsApi` to the component's destructured props. The body keeps using `formsApi`.

- [ ] **Step 2: FormBuilder.**
  - Imports: change to `import { forms as defaultFormsApi, quizzes as quizzesApi } from '../../lib/api'`, and add:

```jsx
import { quizSettingsFrom } from './quizDefaults'
import { QuizContactPanel, QuizThankYouPanel, QuizTrackingPanel } from './QuizSettingsPanels'
import QuizClubsPanel from './QuizClubsPanel'
import QuizSubmissionsPanel from './QuizSubmissionsPanel'
```

  - Below `TABS` add:

```jsx
const QUIZ_TABS = [
  { key: 'build', label: 'Questions' },
  { key: 'contact', label: 'Contact' },
  { key: 'clubs', label: 'Clubs' },
  { key: 'tracking', label: 'Tracking' },
  { key: 'settings', label: 'After Submit' },
  { key: 'submissions', label: 'Submissions' },
  { key: 'share', label: 'Share' },
  { key: 'audit', label: 'Audit' },
]
```

  - Signature: `export default function FormBuilder({ formId, onBack, me, kind = 'form' })`. The first lines of the body become:

```jsx
  const isQuiz = kind === 'quiz'
  const formsApi = isQuiz ? quizzesApi : defaultFormsApi
  const tabs = isQuiz ? QUIZ_TABS : TABS
  const fieldTypes = isQuiz ? FIELD_TYPES.filter(t => !DISPLAY_TYPES.includes(t.type)) : FIELD_TYPES
```

  - State: add `const [quizSettings, setQuizSettings] = useState(() => quizSettingsFrom(null))`.
  - `settings` memo:

```jsx
  const settings = useMemo(
    () => (isQuiz ? quizSettings : { success_message: successMessage, allow_resubmit: allowResubmit }),
    [isQuiz, quizSettings, successMessage, allowResubmit]
  )
```

  - `syncLoaded`: after `const ar = ...`, add `const qs = quizSettingsFrom(set)` and `setQuizSettings(qs)`. In `setBaseline`, change `settings: { success_message: sm, allow_resubmit: ar }` to `settings: isQuiz ? qs : { success_message: sm, allow_resubmit: ar }`.
  - `publicUrl`: `const publicUrl = !isQuiz && form?.slug ? ... : ''`.
  - `publish()`: `setTab(isQuiz ? 'clubs' : 'qr')`.
  - Tab bar: map over `tabs` instead of `TABS`.
  - Add-field menu: map over `fieldTypes` instead of `FIELD_TYPES`.
  - Labels:
    - `Fields` heading becomes `{isQuiz ? 'Questions' : 'Fields'}`
    - `Add Field` becomes `{isQuiz ? 'Add Question' : 'Add Field'}`
    - load-error back button becomes `{isQuiz ? 'Back to Quiz Funnels' : 'Back to Forms'}`
    - `'Intro text (optional)'` becomes `{isQuiz ? 'Intro screen text (optional, leave blank to start on question 1)' : 'Intro text (optional)'}`
  - Settings tab: change `{tab === 'settings' && (` to `{tab === 'settings' && !isQuiz && (`, then add after that block:

```jsx
      {isQuiz && tab === 'settings' && (
        <QuizThankYouPanel value={quizSettings.thank_you} disabled={!canEdit}
          onChange={v => setQuizSettings(s => ({ ...s, thank_you: v }))} />
      )}
      {isQuiz && tab === 'contact' && (
        <QuizContactPanel value={quizSettings.contact_step} disabled={!canEdit}
          onChange={v => setQuizSettings(s => ({ ...s, contact_step: v }))} />
      )}
      {isQuiz && tab === 'tracking' && (
        <QuizTrackingPanel value={quizSettings.tracking} disabled={!canEdit}
          onChange={v => setQuizSettings(s => ({ ...s, tracking: v }))} />
      )}
      {isQuiz && tab === 'clubs' && <QuizClubsPanel form={form} api={formsApi} canEdit={canEdit} />}
      {isQuiz && tab === 'submissions' && <QuizSubmissionsPanel form={form} api={formsApi} canEdit={canEdit} />}
```

  - Share/Audit lines: pass `api={formsApi}` to `FormSharePanel` and `FormAuditPanel`.
  - `{tab === 'qr' && ...}` stays as is; the quiz tabs don't include `qr`.

- [ ] **Step 3: FormsView.**
  - Change the import to `import { forms as defaultFormsApi, quizzes as quizzesApi } from '../../lib/api'`.
  - Signature: `export default function FormsView({ onBack, me, kind = 'form' })`, then at the top of the body:

```jsx
  const isQuiz = kind === 'quiz'
  const formsApi = isQuiz ? quizzesApi : defaultFormsApi
```

  - Builder open: `<FormBuilder kind={kind} formId={openFormId} ... />`.
  - Heading: `{isQuiz ? 'Quiz Funnels' : 'Forms'}`. Description: `{isQuiz ? 'Build multi-step lead quizzes, turn them on per club, and send every answer to Google Sheets and GHL' : '<existing text>'}`.
  - Button: `{isQuiz ? 'New Quiz' : 'New Form'}`.
  - Tab labels: `[['forms', isQuiz ? 'Quizzes' : 'Forms'], ['submissions', 'Submissions']]`.
  - Hide the location `<select>` when `isQuiz` (wrap in `{!isQuiz && (...)}`).
  - Row subtitle (forms tab):

```jsx
<div className="text-xs text-text-muted">{f.owner_name} · {isQuiz ? `Live at ${f.club_count || 0} club${f.club_count === 1 ? '' : 's'}` : f.location_name}</div>
```

  - Submissions-tab subtitle: `{isQuiz ? 'Quiz' : f.location_name} · {f.submission_count} submissions`.
  - Empty states: use `isQuiz ? 'quizzes' : 'forms'` in the two "No forms…" messages.
  - Modal: `<CreateFormModal kind={kind} api={formsApi} me={me} .../>`. In `CreateFormModal({ kind, api, me, onClose, onCreated })`:
    - use `api.create(body)`
    - `const needsPicker = kind !== 'quiz' && locations.length > 1`
    - title text: `{kind === 'quiz' ? 'New Quiz' : 'New Form'}`
    - placeholder: `{kind === 'quiz' ? 'Find Your Fit' : 'Summer Bash Signup'}`
    - create button: `{kind === 'quiz' ? 'Create Quiz' : 'Create Form'}`
    - For quizzes, don't send `location_id` or `all_locations`. The `locationId` stays `''` because the picker is hidden and the one-location effect only sets it for forms: change that effect's condition to `kind !== 'quiz' && locations.length === 1`.

- [ ] **Step 4: ToolGrid.**
  - Add to `TILE_ICONS` (a question-mark-in-bubble outline):

```js
  quizzes: 'M8.228 9c.549-1.165 2.03-2 3.772-2 2.21 0 4 1.343 4 3 0 1.4-1.278 2.575-3.006 2.907-.542.104-.994.54-.994 1.093m0 3h.01M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0z',
```

  - Add `onQuizzes` to the destructured props (after `onForms`).
  - In `marketingCells`, after the forms cell:

```jsx
    onQuizzes && (roleIdx >= ROLE_LEVELS.admin || (visibleTools || []).includes('quizzes')) && (
      <SvgTileButton key="quizzes" onClick={() => { setShowMarketing(false); onQuizzes() }}
        iconPath={TILE_ICONS.quizzes} label="Quiz Funnels" desc="Lead quizzes" />
    ),
```

  - In the custom-board switch, after `case 'forms'`:

```jsx
        case 'quizzes':
          return onQuizzes && <SvgTileButton key={key} onClick={onQuizzes} iconPath={TILE_ICONS.quizzes} label="Quiz Funnels" desc="Lead quizzes" />
```

  - Marketing board tile desc: `"Campaigns, ads & forms"` becomes `"Campaigns, ads, forms & quizzes"`.

- [ ] **Step 5: App.jsx.** Mirror every `showForms` touchpoint (grep `showForms` / `setShowForms` / `tool:forms` first):
  - `const [showQuizzes, setShowQuizzes] = useState(false)` next to `showForms`.
  - `useEffect(() => { if (showQuizzes) logEvent('view.quizzes') }, [showQuizzes])`.
  - At every `setShowForms(false)` reset site, add `setShowQuizzes(false)` on the next line.
  - `isHome`: add `&& !showQuizzes` after `!showForms`.
  - Pinnables, after the `tool:forms` entry:
    `{ key: 'tool:quizzes', label: 'Quiz Funnels', desc: 'Lead quizzes', show: isAdmin || (user?.visible_tools || []).includes('quizzes'), open: () => setShowQuizzes(true) },`
  - Active-key chain: after `: showForms ? 'tool:forms'`, add `: showQuizzes ? 'tool:quizzes'`.
  - Render chain: after the `showForms ? (<FormsView .../>)` branch, add
    `) : showQuizzes ? (\n        <FormsView kind="quiz" onBack={handleBackToPortal} me={user.staff} />`
  - ToolGrid props: add `onQuizzes={() => setShowQuizzes(true)}` after `onForms`.

- [ ] **Step 6: Catalog + changelog.**
  - `portalTiles.js`: after the forms line, add `{ key: 'quizzes', label: 'Quiz Funnels', desc: 'Lead quizzes', group: 'tools' },`.
  - `changelog.js` `canSeeTool`: add `case 'quizzes': return idx >= ROLE_LEVELS.admin || (visibleTools || []).includes('quizzes')`, and add `'quizzes'` to the `tool` list in the header comment.
  - Add an entry at the top of the entries array with the next id (currently highest `16`, so `17`), keeping the existing object shape:

```js
  {
    id: 17, date: '2026-09-25',
    title: 'Quiz Funnels',
    body: 'Marketing now has Quiz Funnels: build a multi-step lead quiz, turn it on per club, and every answer lands in a Google Sheet and your club\'s GHL webhook. Find it under Marketing.',
    audience: { tool: 'quizzes' },
  },
```

  Check the neighbouring entries' exact keys before pasting.

- [ ] **Step 7: Verify.** Run:
  - `cd portal && node --test src/config/ src/components/forms/ src/lib/`. Expected: PASS (portalTiles test proves `'quizzes'` is in `CUSTOM_TILE_KEYS`; changelog tests pass).
  - `npx vite build`. Expected: success.
  - `cd ../auth && node --test src/`. Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add portal/src
git commit -m "feat(quizzes): Quiz Funnels tile, list and builder"
```

### Task 9: Open PR 1

- [ ] **Step 1:** Run `git fetch origin && git rebase origin/master`, then re-run `cd auth && node --test src/` and `cd portal && npx vite build`.
- [ ] **Step 2:** Push the branch, then run `gh pr create --base master --title "Quiz Funnels (Marketing): multi-step lead quizzes per club -> Sheets + GHL webhook + tracking"`. The body should cover: summary, migration 208 (not applied; apply at merge), the new env opt-out `QUIZ_WEBHOOKS_DISABLED`, the audit-constraint fix for `location_changed`, a test plan, and the Claude Code attribution line. Stop; do not merge.

---

## PR 2: wcs-forms-renderer

Set up: `cd C:/Users/justi/Desktop/wcs-forms-renderer && git fetch && git switch -c feat/quiz-page origin/main`.

### Task 10: Pure quiz + tracking helpers

**Files:**
- Create: `src/lib/quiz.js`, `src/lib/quiz.test.js`, `src/lib/tracking.js`, `src/lib/tracking.test.js`
- Modify: `package.json` (add `"test": "node --test src/lib/"`)

**Interfaces:**
- Produces:
  - `quiz.js`:
    - `CLUB_SLUGS`
    - `parseQuizPath(pathname) -> {club, slug} | null`
    - `AUTO_ADVANCE_TYPES`
    - `stepError(field, value) -> string`
    - `formatPhoneInput(raw)`
    - `progressPercent(index, total)`
  - `tracking.js`:
    - `trackingPlan(tracking) -> {ghl, pixel, gtm}`
    - `injectTracking(tracking)`
    - `trackEvent(name, params)`
    - `trackLead()`

- [ ] **Step 1: Failing tests**

`src/lib/quiz.test.js`:

```js
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { parseQuizPath, stepError, progressPercent, formatPhoneInput } from './quiz.js'

test('parseQuizPath: club + slug, case-insensitive, unknown club rejected', () => {
  assert.deepEqual(parseQuizPath('/q/salem/find-your-fit-k3x9'), { club: 'salem', slug: 'find-your-fit-k3x9' })
  assert.deepEqual(parseQuizPath('/q/Salem/Find-Your-Fit-K3X9/'), { club: 'salem', slug: 'find-your-fit-k3x9' })
  assert.equal(parseQuizPath('/q/portland/x'), null)
  assert.equal(parseQuizPath('/f/x'), null)
  assert.equal(parseQuizPath('/q/salem'), null)
})

test('stepError: required, email/phone/number shape', () => {
  assert.equal(stepError({ type: 'radio', required: true }, ''), 'Choose an answer to continue')
  assert.equal(stepError({ type: 'checkbox', required: true }, []), 'Choose at least one to continue')
  assert.equal(stepError({ type: 'short_text' }, ''), '')
  assert.equal(stepError({ type: 'email' }, 'nope'), 'Enter a valid email address')
  assert.equal(stepError({ type: 'phone' }, '(503) 555-01'), 'Enter a valid 10-digit phone number')
  assert.equal(stepError({ type: 'number' }, 'x'), 'Enter a number')
})

test('progress + phone format', () => {
  assert.equal(progressPercent(0, 4), 25)
  assert.equal(progressPercent(3, 4), 100)
  assert.equal(formatPhoneInput('15035550101'), '(503) 555-0101')
})
```

`src/lib/tracking.test.js`:

```js
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { trackingPlan } from './tracking.js'

test('trackingPlan keeps only valid ids and GHL hosts', () => {
  const good = trackingPlan({
    ghl: { src: 'https://link.msgsndr.com/js/external-tracking.js', tracking_id: 'tk_0123456789' },
    meta_pixel_id: '820682157231470', gtm_id: 'GTM-N4BRPV65',
  })
  assert.deepEqual(good, {
    ghl: { src: 'https://link.msgsndr.com/js/external-tracking.js', trackingId: 'tk_0123456789' },
    pixel: '820682157231470', gtm: 'GTM-N4BRPV65',
  })
  const bad = trackingPlan({
    ghl: { src: 'https://evil.com/js/external-tracking.js', tracking_id: 'tk_0123456789' },
    meta_pixel_id: 'abc', gtm_id: 'GTM-<x>',
  })
  assert.deepEqual(bad, { ghl: null, pixel: null, gtm: null })
  assert.deepEqual(trackingPlan(null), { ghl: null, pixel: null, gtm: null })
})
```

Add `"test": "node --test src/lib/"` to `package.json` scripts. Run `npm test`. Expected: FAIL (modules missing).

- [ ] **Step 2: `src/lib/quiz.js`**

```js
// Pure helpers for the quiz page. Keep CLUB_SLUGS in step with
// wcs-staff-portal auth/src/services/quizSchema.js.
export const CLUB_SLUGS = ['salem', 'keizer', 'eugene', 'springfield', 'clackamas', 'milwaukie', 'medford']

// Single-choice questions advance as soon as a card is tapped.
export const AUTO_ADVANCE_TYPES = new Set(['radio', 'dropdown'])

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/
const PHONE_RE = /^[2-9]\d{2}[2-9]\d{6}$/

export function parseQuizPath(pathname) {
  const m = String(pathname || '').match(/^\/q\/([a-z]+)\/([a-z0-9-]+)\/?$/i)
  if (!m) return null
  const club = m[1].toLowerCase()
  if (!CLUB_SLUGS.includes(club)) return null
  return { club, slug: m[2].toLowerCase() }
}

function blank(field, value) {
  if (field.type === 'checkbox') return !Array.isArray(value) || value.length === 0
  return value == null || String(value).trim() === ''
}

export function stepError(field, value) {
  if (blank(field, value)) {
    if (!field.required) return ''
    if (field.type === 'checkbox') return 'Choose at least one to continue'
    if (field.type === 'radio' || field.type === 'dropdown') return 'Choose an answer to continue'
    return 'This question is required'
  }
  const v = String(value).trim()
  if (field.type === 'email' && !EMAIL_RE.test(v)) return 'Enter a valid email address'
  if (field.type === 'phone' && !PHONE_RE.test(v.replace(/\D/g, '').replace(/^1(?=\d{10}$)/, ''))) return 'Enter a valid 10-digit phone number'
  if (field.type === 'number' && !Number.isFinite(Number(v))) return 'Enter a number'
  return ''
}

export function progressPercent(index, total) {
  if (!total) return 0
  return Math.round(((index + 1) / total) * 100)
}

// Same behavior as FormPage: auto-format to (999) 999-9999 while typing.
export function formatPhoneInput(raw) {
  let d = String(raw).replace(/\D/g, '')
  if (d.startsWith('1')) d = d.slice(1)
  d = d.slice(0, 10)
  if (d.length > 6) return `(${d.slice(0, 3)}) ${d.slice(3, 6)}-${d.slice(6)}`
  if (d.length > 3) return `(${d.slice(0, 3)}) ${d.slice(3)}`
  if (d.length > 0) return `(${d}`
  return ''
}
```

- [ ] **Step 3: `src/lib/tracking.js`**

```js
// Loads GHL External Tracking (per club), Meta Pixel and GTM for a quiz. The
// portal validates these ids on save; they are re-checked here before
// anything is injected into the page.
const GHL_HOST_SUFFIXES = ['msgsndr.com', 'leadconnectorhq.com', 'gohighlevel.com', 'westcoaststrength.com']
const TRACKING_ID_RE = /^tk_[A-Za-z0-9]{8,64}$/
const PIXEL_RE = /^\d{6,20}$/
const GTM_RE = /^GTM-[A-Z0-9]{4,12}$/

function safeGhlSrc(src) {
  try {
    const u = new URL(src)
    const host = u.hostname.toLowerCase()
    return u.protocol === 'https:'
      && GHL_HOST_SUFFIXES.some(h => host === h || host.endsWith('.' + h))
      && u.pathname.endsWith('/js/external-tracking.js')
  } catch { return false }
}

export function trackingPlan(tracking) {
  const t = tracking || {}
  const g = t.ghl
  return {
    ghl: g && safeGhlSrc(g.src) && TRACKING_ID_RE.test(g.tracking_id || '') ? { src: g.src, trackingId: g.tracking_id } : null,
    pixel: PIXEL_RE.test(t.meta_pixel_id || '') ? t.meta_pixel_id : null,
    gtm: GTM_RE.test(t.gtm_id || '') ? t.gtm_id : null,
  }
}

let injected = false

export function injectTracking(tracking) {
  if (injected || typeof document === 'undefined') return
  injected = true
  const plan = trackingPlan(tracking)

  if (plan.gtm) {
    window.dataLayer = window.dataLayer || []
    window.dataLayer.push({ 'gtm.start': Date.now(), event: 'gtm.js' })
    const s = document.createElement('script')
    s.async = true
    s.src = `https://www.googletagmanager.com/gtm.js?id=${plan.gtm}`
    document.head.appendChild(s)
  }

  if (plan.pixel) {
    // Standard Meta Pixel base code.
    /* eslint-disable */
    !function(f,b,e,v,n,t,s){if(f.fbq)return;n=f.fbq=function(){n.callMethod?
    n.callMethod.apply(n,arguments):n.queue.push(arguments)};if(!f._fbq)f._fbq=n;
    n.push=n;n.loaded=!0;n.version='2.0';n.queue=[];t=b.createElement(e);t.async=!0;
    t.src=v;s=b.getElementsByTagName(e)[0];s.parentNode.insertBefore(t,s)}(window,
    document,'script','https://connect.facebook.net/en_US/fbevents.js');
    /* eslint-enable */
    window.fbq('init', plan.pixel)
    window.fbq('track', 'PageView')
  }

  if (plan.ghl) {
    // GHL's docs place this before </body>; it watches the page for <form> submits.
    const s = document.createElement('script')
    s.src = plan.ghl.src
    s.setAttribute('data-tracking-id', plan.ghl.trackingId)
    s.defer = true
    document.body.appendChild(s)
  }
}

export function trackEvent(name, params = {}) {
  if (typeof window === 'undefined' || !window.dataLayer) return
  window.dataLayer.push({ event: name, ...params })
}

export function trackLead() {
  if (typeof window !== 'undefined' && typeof window.fbq === 'function') window.fbq('track', 'Lead')
}
```

- [ ] **Step 4: Run the tests.** Run `npm test`. Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add package.json src/lib
git commit -m "feat(quiz): path parsing, step validation and tracking helpers"
```

### Task 11: QuizPage + route + styles

**Files:**
- Create: `src/QuizPage.jsx`
- Modify: `src/App.jsx`, `src/styles.css`

**Interfaces:**
- Consumes: Task 10 helpers; API `GET/POST /public/quizzes/:club/:slug[/submit]` (Task 5).

- [ ] **Step 1: Read `src/FormPage.jsx` fully** (render states, error/notice markup, the class names used for `.state`, buttons and inputs) so QuizPage reuses the same CSS classes. Copy `renderFormatted` (and its `INLINE_RE`/`renderInline` helpers) from FormPage into a new `src/lib/richText.jsx`. Export `renderFormatted` and import it in both FormPage and QuizPage, which removes the duplicate from FormPage.

- [ ] **Step 2: `src/QuizPage.jsx`**

```jsx
import { useEffect, useRef, useState } from 'react'
import { AUTO_ADVANCE_TYPES, formatPhoneInput, progressPercent, stepError } from './lib/quiz.js'
import { injectTracking, trackEvent, trackLead } from './lib/tracking.js'
import { renderFormatted } from './lib/richText.jsx'

const API_BASE = import.meta.env.VITE_FORMS_API_URL || 'https://wcs-auth-api.onrender.com'
const UTM_KEYS = ['utm_source', 'utm_medium', 'utm_campaign']
function captureUtm() {
  try {
    const p = new URLSearchParams(window.location.search)
    return Object.fromEntries(UTM_KEYS.map(k => [k, (p.get(k) || '').trim()]).filter(([, v]) => v))
  } catch { return {} }
}
const CAPTURED_UTM = captureUtm()

// screen: 'intro' | number (question index) | 'contact' | 'done'
export default function QuizPage({ club, slug }) {
  const [status, setStatus] = useState('loading') // loading | unavailable | error | ready
  const [quiz, setQuiz] = useState(null)
  const [screen, setScreen] = useState('intro')
  const [answers, setAnswers] = useState({})
  const [contact, setContact] = useState({ first_name: '', last_name: '', email: '', phone: '' })
  const [errors, setErrors] = useState({})
  const [notice, setNotice] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const started = useRef(false)

  useEffect(() => {
    fetch(`${API_BASE}/public/quizzes/${encodeURIComponent(club)}/${encodeURIComponent(slug)}`)
      .then(async res => {
        if (res.status === 404) { setStatus('unavailable'); return }
        if (!res.ok) throw new Error('request failed')
        const body = await res.json()
        const q = body.quiz
        setQuiz(q)
        setAnswers(Object.fromEntries(q.schema.map(f => [f.id, f.type === 'checkbox' ? [] : ''])))
        setScreen(q.description ? 'intro' : 0)
        setStatus('ready')
        document.title = q.title
        injectTracking(q.tracking)
      })
      .catch(() => setStatus('error'))
  }, [club, slug])

  const questions = quiz?.schema || []
  const total = questions.length + 1 // + contact step
  const meta = quiz ? { quiz: quiz.slug, club: quiz.club_slug } : {}

  useEffect(() => {
    if (!quiz || typeof screen !== 'number') return
    if (!started.current) { started.current = true; trackEvent('quiz_start', meta) }
    trackEvent('quiz_step', { ...meta, step: screen + 1, total })
  }, [screen, quiz]) // eslint-disable-line react-hooks/exhaustive-deps

  function go(next) { setErrors({}); setNotice(''); setScreen(next); window.scrollTo(0, 0) }
  function nextFrom(i) { go(i + 1 < questions.length ? i + 1 : 'contact') }
  function back() {
    if (screen === 'contact') go(questions.length ? questions.length - 1 : 'intro')
    else if (typeof screen === 'number' && screen > 0) go(screen - 1)
    else if (quiz?.description) go('intro')
  }

  function answer(field, value, autoAdvance) {
    setAnswers(a => ({ ...a, [field.id]: value }))
    if (autoAdvance) {
      setErrors({})
      setTimeout(() => nextFrom(questions.indexOf(field)), 180)
    }
  }

  function tryNext(field) {
    const err = stepError(field, answers[field.id])
    if (err) { setErrors({ [field.id]: err }); return }
    nextFrom(questions.indexOf(field))
  }

  async function submit(e) {
    e.preventDefault()
    const step = quiz.contact_step
    const errs = {}
    if (step.require_first_name && !contact.first_name.trim()) errs.first_name = 'First name is required'
    if (step.require_last_name && !contact.last_name.trim()) errs.last_name = 'Last name is required'
    const emailErr = stepError({ type: 'email', required: true }, contact.email)
    if (emailErr) errs.email = emailErr === 'This question is required' ? 'Email is required' : emailErr
    const phoneErr = stepError({ type: 'phone', required: step.require_phone }, contact.phone)
    if (phoneErr) errs.phone = phoneErr === 'This question is required' ? 'Phone is required' : phoneErr
    if (Object.keys(errs).length) { setErrors(errs); return }
    setSubmitting(true); setNotice('')
    try {
      const res = await fetch(`${API_BASE}/public/quizzes/${encodeURIComponent(club)}/${encodeURIComponent(slug)}/submit`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ answers, contact, utm: CAPTURED_UTM }),
      })
      if (res.status === 429) { setNotice('Too many tries. Please wait a minute and submit again.'); return }
      if (res.status === 404) { setStatus('unavailable'); return }
      const body = await res.json().catch(() => ({}))
      if (res.status === 400 && body.errors) {
        const firstBad = questions.findIndex(f => body.errors[f.id])
        setErrors(body.errors)
        if (firstBad >= 0) setScreen(firstBad)
        return
      }
      if (!res.ok) throw new Error('submit failed')
      trackEvent('quiz_submit', meta)
      trackLead()
      if (body.redirect_url) { window.location.assign(body.redirect_url); return }
      go('done')
    } catch {
      setNotice('Something went wrong. Please try again.')
    } finally {
      setSubmitting(false)
    }
  }

  if (status === 'loading') return <div className="state"><p className="state-text">Loading...</p></div>
  if (status === 'unavailable') return <div className="state"><h1 className="state-title">This quiz isn't available</h1><p className="state-text">The link may be old, or the quiz may have ended.</p></div>
  if (status === 'error') return <div className="state"><h1 className="state-title">Something went wrong</h1><p className="state-text">Please refresh the page to try again.</p></div>

  if (screen === 'done') {
    return (
      <div className="state">
        <h1 className="state-title">{quiz.thank_you.heading || "You're all set!"}</h1>
        {quiz.thank_you.message && <p className="state-text">{renderFormatted(quiz.thank_you.message)}</p>}
      </div>
    )
  }

  const stepIndex = screen === 'intro' ? -1 : screen === 'contact' ? questions.length : screen
  return (
    <div className="quiz">
      {stepIndex >= 0 && (
        <div className="quiz-progress" aria-label={`Step ${stepIndex + 1} of ${total}`}>
          <div className="quiz-progress-bar" style={{ width: `${progressPercent(stepIndex, total)}%` }} />
        </div>
      )}

      {screen === 'intro' && (
        <div className="quiz-step">
          <h1 className="quiz-title">{quiz.title}</h1>
          <p className="quiz-help">{renderFormatted(quiz.description)}</p>
          <button className="quiz-next" onClick={() => go(0)}>Start</button>
        </div>
      )}

      {typeof screen === 'number' && (() => {
        const f = questions[screen]
        const v = answers[f.id]
        const err = errors[f.id]
        return (
          <div className="quiz-step" key={f.id}>
            <h1 className="quiz-question">{f.label}{f.required && <span className="req"> *</span>}</h1>
            {f.help_text && <p className="quiz-help">{renderFormatted(f.help_text)}</p>}
            {(f.type === 'radio' || f.type === 'dropdown') && (
              <div className="quiz-options">
                {f.options.map(o => (
                  <button key={o} type="button" className={`quiz-option ${v === o ? 'selected' : ''}`}
                    onClick={() => answer(f, o, AUTO_ADVANCE_TYPES.has(f.type))}>{o}</button>
                ))}
              </div>
            )}
            {f.type === 'checkbox' && (
              <div className="quiz-options">
                {f.options.map(o => {
                  const on = v.includes(o)
                  return (
                    <button key={o} type="button" className={`quiz-option ${on ? 'selected' : ''}`} aria-pressed={on}
                      onClick={() => answer(f, on ? v.filter(x => x !== o) : [...v, o], false)}>{o}</button>
                  )
                })}
              </div>
            )}
            {f.type === 'long_text' && (
              <textarea className="quiz-input" rows={4} value={v} onChange={e => answer(f, e.target.value, false)} />
            )}
            {['short_text', 'email', 'phone', 'number', 'date'].includes(f.type) && (
              <input className="quiz-input"
                type={{ short_text: 'text', email: 'email', phone: 'tel', number: 'number', date: 'date' }[f.type]}
                value={v}
                onChange={e => answer(f, f.type === 'phone' ? formatPhoneInput(e.target.value) : e.target.value, false)}
                onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); tryNext(f) } }} />
            )}
            {err && <p className="quiz-error">{err}</p>}
            <div className="quiz-nav">
              {(screen > 0 || quiz.description) && <button type="button" className="quiz-back" onClick={back}>Back</button>}
              {!AUTO_ADVANCE_TYPES.has(f.type) || v ? (
                <button type="button" className="quiz-next" onClick={() => tryNext(f)}>Next</button>
              ) : null}
            </div>
          </div>
        )
      })()}

      {screen === 'contact' && (
        // A real <form> with standard input names so GHL External Tracking can
        // read the contact on submit.
        <form className="quiz-step" onSubmit={submit} noValidate name="quiz-contact" id="quiz-contact">
          <h1 className="quiz-question">{quiz.contact_step.heading}</h1>
          {quiz.contact_step.subtext && <p className="quiz-help">{renderFormatted(quiz.contact_step.subtext)}</p>}
          <div className="quiz-contact-grid">
            <label className="quiz-label">First name{quiz.contact_step.require_first_name && ' *'}
              <input className="quiz-input" name="first_name" autoComplete="given-name" value={contact.first_name}
                onChange={e => setContact(c => ({ ...c, first_name: e.target.value }))} />
              {errors.first_name && <span className="quiz-error">{errors.first_name}</span>}
            </label>
            <label className="quiz-label">Last name{quiz.contact_step.require_last_name && ' *'}
              <input className="quiz-input" name="last_name" autoComplete="family-name" value={contact.last_name}
                onChange={e => setContact(c => ({ ...c, last_name: e.target.value }))} />
              {errors.last_name && <span className="quiz-error">{errors.last_name}</span>}
            </label>
          </div>
          <label className="quiz-label">Email *
            <input className="quiz-input" type="email" name="email" autoComplete="email" value={contact.email}
              onChange={e => setContact(c => ({ ...c, email: e.target.value }))} />
            {errors.email && <span className="quiz-error">{errors.email}</span>}
          </label>
          <label className="quiz-label">Phone{quiz.contact_step.require_phone && ' *'}
            <input className="quiz-input" type="tel" name="phone" autoComplete="tel" value={contact.phone}
              onChange={e => setContact(c => ({ ...c, phone: formatPhoneInput(e.target.value) }))} />
            {errors.phone && <span className="quiz-error">{errors.phone}</span>}
          </label>
          {notice && <p className="quiz-error">{notice}</p>}
          <div className="quiz-nav">
            <button type="button" className="quiz-back" onClick={back}>Back</button>
            <button type="submit" className="quiz-next" disabled={submitting}>{submitting ? 'Sending...' : 'Submit'}</button>
          </div>
        </form>
      )}
    </div>
  )
}
```

- [ ] **Step 3: Route.** In `src/App.jsx`, `import QuizPage from './QuizPage.jsx'` and `import { parseQuizPath } from './lib/quiz.js'`. At the top of `App()`:

```jsx
  const quizMatch = parseQuizPath(window.location.pathname)
  if (quizMatch) {
    return (
      <Shell>
        <QuizPage club={quizMatch.club} slug={quizMatch.slug} />
      </Shell>
    )
  }
```

- [ ] **Step 4: Styles.** Append to `src/styles.css`. Use the variables already defined at the top of the file (read it first). If the names differ from `--red`, `--border`, `--text`, `--muted`, `--bg`, substitute them.

```css
/* ---- Quiz funnel ---- */
.quiz { display: flex; flex-direction: column; gap: 20px; }
.quiz-progress { height: 6px; background: var(--border, #e5e7eb); border-radius: 999px; overflow: hidden; }
.quiz-progress-bar { height: 100%; background: var(--red, #c8102e); transition: width 0.25s ease; }
.quiz-step { display: flex; flex-direction: column; gap: 16px; animation: quiz-in 0.2s ease; }
@keyframes quiz-in { from { opacity: 0; transform: translateY(6px); } to { opacity: 1; transform: none; } }
.quiz-title { font-size: 1.6rem; font-weight: 800; margin: 0; }
.quiz-question { font-size: 1.3rem; font-weight: 700; margin: 0; line-height: 1.3; }
.quiz-help { color: var(--muted, #6b7280); margin: 0; }
.quiz-options { display: grid; gap: 10px; }
.quiz-option { text-align: left; padding: 16px 18px; border: 2px solid var(--border, #e5e7eb); border-radius: 14px;
  background: #fff; font-size: 1rem; font-weight: 600; cursor: pointer; transition: border-color 0.15s, background 0.15s; }
.quiz-option:hover { border-color: var(--red, #c8102e); }
.quiz-option.selected { border-color: var(--red, #c8102e); background: rgba(200, 16, 46, 0.06); }
.quiz-input { width: 100%; box-sizing: border-box; padding: 14px 16px; border: 2px solid var(--border, #e5e7eb);
  border-radius: 12px; font-size: 1rem; margin-top: 6px; }
.quiz-input:focus { outline: none; border-color: var(--red, #c8102e); }
.quiz-label { display: block; font-weight: 600; font-size: 0.9rem; }
.quiz-contact-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; }
@media (max-width: 480px) { .quiz-contact-grid { grid-template-columns: 1fr; } }
.quiz-error { color: var(--red, #c8102e); font-size: 0.85rem; font-weight: 500; display: block; margin-top: 6px; }
.quiz-nav { display: flex; justify-content: space-between; gap: 12px; margin-top: 4px; }
.quiz-next { margin-left: auto; padding: 14px 28px; border: 0; border-radius: 12px; background: var(--red, #c8102e);
  color: #fff; font-weight: 700; font-size: 1rem; cursor: pointer; }
.quiz-next:disabled { opacity: 0.6; }
.quiz-back { padding: 14px 18px; border: 0; background: transparent; color: var(--muted, #6b7280); font-weight: 600; cursor: pointer; }
.req { color: var(--red, #c8102e); }
```

- [ ] **Step 5: Verify.** Run `npm test && npm run build`. Expected: tests PASS and the build succeeds. Then run `npm run dev`, open `http://localhost:5173/q/portland/x`, and confirm the "Page not found" shell appears (the unknown club falls through to the existing not-found branch). A full click-through needs PR 1 deployed.

- [ ] **Step 6: Commit and open PR 2**

```bash
git add src package.json
git commit -m "feat(quiz): one-question-per-screen quiz page at /q/<club>/<slug> with GHL/Meta/GTM tracking"
git push -u origin feat/quiz-page
gh pr create --base main --title "Quiz funnel page: /q/<club>/<slug>" --body "<summary, depends on wcs-staff-portal Quiz Funnels PR (merge that first), test plan, attribution>"
```

Stop; do not merge.

---

## Post-merge (Justin-driven, not tasks)

1. Merge PR 1. Apply migration 208 to prod (`ybopxxydsuwlbwxiuzve`) with explicit consent, then run `notify pgrst, 'reload schema'`.
2. Merge PR 2. Workers Builds deploys automatically.
3. End to end at one club:
   - Paste that club's GHL snippet and webhook URL, then Send test and map fields in GHL.
   - Submit one real quiz and check: Sheet row with the Club column, webhook `sent`, contact in GHL with External Tracking attribution, and events in Pixel Helper and GTM preview.
