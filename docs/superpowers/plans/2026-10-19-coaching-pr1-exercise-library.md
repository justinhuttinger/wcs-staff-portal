# Coaching PR 1: Exercise Library Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give the portal backend its own exercise library table, seeded from free-exercise-db, with a YMove sync and a signed-video route that ship ready but stay off until `YMOVE_API_KEY` is set.

**Architecture:** A new `memberapp_exercises` table is the single library every later PR references by `id`. Pure mapping/matching logic lives in `auth/src/lib/exerciseLibrary.js` (unit-tested with `node:test`); the YMove HTTP client and the sync job are thin services around it; a new `/exercises` Express router exposes search, custom create/edit, video and sync. This PR does **not** touch the existing program tables or Admin builder (that is PR 2), so nothing live breaks.

**Tech Stack:** Node/Express (`auth/`), `@supabase/supabase-js` service client (`auth/src/services/supabase.js`), `node-cron`, `node:test` + `node:assert`, Postgres migration in `auth/migrations/`.

**Spec:** `docs/superpowers/specs/2026-10-19-coaching-training-design.md` (section 1, plus "Before the YMove key exists").

## Global Constraints

- Migration number: **238** (`auth/migrations/238_memberapp_exercises.sql`). Applied to prod only at merge, with Justin's consent, then `notify pgrst, 'reload schema'`.
- Running the seed script against prod is a prod DB write: only at merge, with explicit consent.
- `source` ∈ `'free' | 'ymove' | 'custom'`; unique on `(source, source_id)` where `source_id` is not null.
- YMove: base `https://exercise-api.ymove.app/api/v2`, header `X-API-Key`. Metadata sync always passes `excludeVideos=1` (no video minutes). Signed video URLs are **never stored in the DB**; in-memory cache ≤ 24h.
- The YMove key never reaches a browser. Without `YMOVE_API_KEY`, sync is a no-op returning `{ skipped: 'no_key' }` and the video route returns `503 { error: 'Video not available yet' }`.
- free-exercise-db pinned to commit `f00c92c7dcf1216a928a52c3706c7ce8e2f71ed5` (Unlicense). Images served from `https://cdn.jsdelivr.net/gh/yuhonas/free-exercise-db@f00c92c7dcf1216a928a52c3706c7ce8e2f71ed5/exercises/<images[0]>`.
- Canonical muscle vocabulary = free-exercise-db's 17 lowercase names: `abdominals, abductors, adductors, biceps, calves, chest, forearms, glutes, hamstrings, lats, lower back, middle back, neck, quadriceps, shoulders, traps, triceps`. Unknown YMove values are lowercased and passed through (mapping refined when the key arrives).
- Route gate this PR: `authenticate` + `requireRole('manager')` (PR 3 opens it to trainers via the coaching permission). `POST /exercises/sync` is `requireRole('admin')`.
- Actor is `req.staff?.email || req.staff?.id || 'unknown'` (do **not** copy memberApp.js's `req.user` bug).
- Commits end with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`. Work only in a worktree branch `feat/coaching-exercise-library` off `origin/master`.

## Review Focus

- **Re-running the seed or sync twice** must not duplicate rows; it updates in place by `(source, source_id)` → test in Task 2 (`upsert plan is idempotent`).
- **A YMove exercise whose name matches a `free` row** must link onto that row (keep `id`, set `source='ymove'`, `source_id`, `has_video`) rather than create a duplicate; names differing only in case/punctuation/"dumbbell"↔"db" still match → Task 2 tests.
- **A custom exercise must not be editable through the API if it isn't `source='custom'`** (trainers can't rewrite library rows) → Task 4 test `PUT on a non-custom row is 403`.
- **YMove down / 429 / bad key** during sync must leave the library untouched and report the error, never half-delete → Task 3 test `sync aborts without writes on fetch error`.
- **Search with odd input** (empty `q`, `q` with `%`/`,`/`(` characters that break PostgREST `or()` filters) returns sane results, not a 500 → Task 4 test `search escapes PostgREST metacharacters`.

---

### Task 1: Migration 238 — `memberapp_exercises`

**Files:**
- Create: `auth/migrations/238_memberapp_exercises.sql`

**Interfaces:**
- Produces: table `public.memberapp_exercises` with columns `id uuid pk default gen_random_uuid()`, `source text not null check (source in ('free','ymove','custom'))`, `source_id text`, `slug text`, `name text not null`, `name_key text not null` (normalized name, see Task 2), `primary_muscle text`, `secondary_muscles text[] not null default '{}'`, `equipment text`, `category text`, `difficulty text`, `instructions text[] not null default '{}'`, `cues text[] not null default '{}'`, `thumbnail_url text`, `has_video boolean not null default false`, `video_url text` (custom/WCS-owned only), `is_active boolean not null default true`, `created_by text`, `created_at`, `updated_at timestamptz not null default now()`.

- [ ] **Step 1: Write the migration** in the house style of `189_memberapp_habits.sql` (header comment explaining why, `create table if not exists`, RLS enabled, no policies — service key only). Include:
  - `create unique index memberapp_exercises_source_uidx on public.memberapp_exercises (source, source_id) where source_id is not null;`
  - `create index memberapp_exercises_name_key_idx on public.memberapp_exercises (name_key);`
  - `create index memberapp_exercises_muscle_idx on public.memberapp_exercises (primary_muscle) where is_active;`
  - `create extension if not exists pg_trgm;` and a trigram GIN index on `name` for search (`gin (name gin_trgm_ops)`).
- [ ] **Step 2: Verify the SQL parses** by running it against a Supabase **branch or local Postgres** if available; otherwise `execute_sql` a `begin; <migration>; rollback;` on prod is **not** allowed without consent — instead lint by eye and leave it for the merge-time apply. Note in the PR which was done.
- [ ] **Step 3: Commit** `feat(coaching): migration 238 memberapp_exercises`.

---

### Task 2: Library mapping and name matching (pure)

**Files:**
- Create: `auth/src/lib/exerciseLibrary.js`
- Test: `auth/src/lib/exerciseLibrary.test.js`

**Interfaces:**
- Produces:
  - `MUSCLES: string[]` (the 17 canonical names above)
  - `nameKey(name: string): string` — lowercase, `&`→`and`, strip punctuation, collapse spaces, synonyms `db`→`dumbbell`, `bb`→`barbell`, `kb`→`kettlebell`, `ez bar`/`e-z curl bar`→`ez bar`, strip trailing `s` on the last word.
  - `fromFreeDb(row, sha: string): ExerciseRow` → `{ source:'free', source_id: row.id, slug: row.id, name, name_key, primary_muscle: row.primaryMuscles[0] ?? null, secondary_muscles: [...rest of primaryMuscles, ...row.secondaryMuscles], equipment: row.equipment ?? null, category: row.category, difficulty: row.level, instructions: row.instructions, cues: [], thumbnail_url: <jsDelivr URL of images[0]> or null, has_video:false }`
  - `fromYmove(ex): ExerciseRow` → `{ source:'ymove', source_id: ex.id, slug: ex.slug, name: ex.title, name_key, primary_muscle: lower(ex.muscleGroup), secondary_muscles: lower(ex.secondaryMuscles), equipment: lower(ex.equipment), category: ex.category, difficulty: ex.difficulty, instructions: ex.instructions ?? [], cues: ex.importantPoints ?? [], thumbnail_url: ex.thumbnailUrl ?? null, has_video: !!ex.hasVideo }`
  - `planUpsert(existing: Row[], incoming: ExerciseRow[]): { updates: {id, row}[], inserts: ExerciseRow[] }` — an incoming row updates the existing row with the same `(source, source_id)`; else, **for `ymove` incoming only**, links onto an existing `free` row with the same `name_key` that has not already been linked (one-to-one); else inserts. Never touches `custom` rows.

- [ ] **Step 1: Write failing tests** (`node:test`), including:
  - `nameKey('DB Bench Press') === nameKey('Dumbbell bench press')`; `nameKey('E-Z Curl Bar Curls') === nameKey('ez bar curl')`; `nameKey('  Pull-Up ') === 'pull up'`.
  - `fromFreeDb` on the `3_4_Sit-Up` sample: `primary_muscle === 'abdominals'`, `thumbnail_url` ends with `/exercises/3_4_Sit-Up/0.jpg` and contains the pinned sha, `has_video === false`.
  - `fromYmove` maps `title`→`name`, `importantPoints`→`cues`, lowercases muscles, `has_video` true when `hasVideo`.
  - `upsert plan is idempotent`: planning the same free rows against rows already present yields 0 inserts and only updates.
  - `ymove links onto a free row by name_key`: existing free "Dumbbell Bench Press" + incoming ymove "DB Bench Press" → one update on the free row's id, 0 inserts.
  - `two ymove rows with the same name_key link only one; the other inserts`.
  - `custom rows are never matched` even with identical `name_key`.
- [ ] **Step 2: Run** `node --test auth/src/lib/exerciseLibrary.test.js` — expect FAIL (module not found).
- [ ] **Step 3: Implement** the functions above.
- [ ] **Step 4: Run** the same command — expect all PASS.
- [ ] **Step 5: Commit** `feat(coaching): exercise library mapping + name matching`.

---

### Task 3: YMove client, sync job, free-exercise-db seed

**Files:**
- Create: `auth/src/services/ymoveClient.js`
- Create: `auth/src/services/exerciseSync.js`
- Create: `auth/scripts/seed-exercise-library.js`
- Test: `auth/src/services/exerciseSync.test.js`
- Modify: `auth/src/app.js` (start cron next to `startMemberAppBroadcastCron`, ~line 488)

**Interfaces:**
- Consumes: Task 2 `fromYmove`, `fromFreeDb`, `planUpsert`.
- Produces:
  - `ymoveClient.isConfigured(): boolean` (reads `process.env.YMOVE_API_KEY`)
  - `ymoveClient.listAllExercises({ fetchImpl = fetch } = {}): Promise<object[]>` — pages `GET /exercises?excludeVideos=1&pageSize=50&page=N` until `page >= pagination.totalPages`; throws on non-2xx (include status and, for 429, `retryAfterMs`).
  - `ymoveClient.getExerciseVideo(sourceId, { fetchImpl } = {}): Promise<{ videoUrl, hlsUrl, thumbnailUrl, durationSecs }>` — `GET /exercises/:id`; picks `isPrimary` from `videos[]`, falling back to top-level `videoUrl`/`videoHlsUrl`.
  - `exerciseSync.applyRows(rows: ExerciseRow[], { db = supabaseAdmin } = {}): Promise<{ inserted, updated }>` — loads existing rows (`id, source, source_id, name_key`), runs `planUpsert`, writes inserts in batches of 200, updates by id, sets `updated_at`.
  - `exerciseSync.syncYmove({ client = ymoveClient, db } = {}): Promise<{ skipped: 'no_key' } | { inserted, updated, total }>` — fetches **everything first**, then writes; on any fetch error throws before any write.
  - `exerciseSync.startExerciseSyncCron()` — `node-cron` `'15 3 * * *'` with `{ timezone: 'America/Los_Angeles' }`; logs and swallows errors.
  - Script: `node auth/scripts/seed-exercise-library.js` — fetches `https://raw.githubusercontent.com/yuhonas/free-exercise-db/<sha>/dist/exercises.json`, maps with `fromFreeDb`, calls `applyRows`, prints `{ inserted, updated }`. Loads dotenv like `seed-program-templates.js`.

- [ ] **Step 1: Write failing tests** with a fake `db` (an object recording `insert`/`update` calls and returning canned `select` rows) and a fake client:
  - `syncYmove skips without a key` → `{ skipped: 'no_key' }`, no db calls.
  - `sync aborts without writes on fetch error` → fake client `listAllExercises` rejects; assert rejection and zero recorded writes.
  - `sync links and inserts` → existing free row + 2 ymove rows (one matching) → `{ inserted: 1, updated: 1 }`.
  - `listAllExercises pages until totalPages` → fake `fetchImpl` returning 2 pages; asserts `X-API-Key` header sent and `excludeVideos=1` in every URL.
- [ ] **Step 2: Run** `node --test auth/src/services/exerciseSync.test.js` — expect FAIL.
- [ ] **Step 3: Implement** client, sync and seed script; wire `startExerciseSyncCron()` in `app.js` beside the broadcast cron.
- [ ] **Step 4: Run** the tests — expect PASS. Then `npm test --prefix auth` — expect no new failures vs `origin/master`.
- [ ] **Step 5: Commit** `feat(coaching): YMove client, nightly sync, free-exercise-db seed`.

---

### Task 4: `/exercises` API

**Files:**
- Create: `auth/src/routes/exercises.js`
- Test: `auth/src/routes/exercises.test.js`
- Modify: `auth/src/app.js` (mount `app.use('/exercises', require('./routes/exercises'))` next to `/member-app`, ~line 254)

**Interfaces:**
- Consumes: Task 3 `ymoveClient.getExerciseVideo`, `exerciseSync.syncYmove`; Task 2 `nameKey`, `MUSCLES`.
- Produces (all JSON; PR 2's picker and PR 4's Worker rely on these shapes):
  - `GET /exercises?q=&muscle=&equipment=&source=&page=1&pageSize=24` → `{ exercises: Exercise[], total, page, pageSize }`; `pageSize` max 50; only `is_active`; ordered by name. `Exercise` = `{ id, source, name, primary_muscle, secondary_muscles, equipment, category, difficulty, thumbnail_url, has_video }`.
  - `GET /exercises/facets` → `{ muscles: MUSCLES, equipment: string[] }` (distinct active equipment).
  - `GET /exercises/:id` → `{ exercise: Exercise & { instructions, cues } }` or 404.
  - `POST /exercises` body `{ name, primary_muscle, secondary_muscles?, equipment?, instructions?, cues? }` → 201 `{ exercise }` with `source:'custom'`, `created_by` = actor. 400 if `name` blank or `primary_muscle` not in `MUSCLES`.
  - `PUT /exercises/:id` same body → `{ exercise }`; **403 if the row is not `custom`**.
  - `GET /exercises/:id/video` → `{ videoUrl, hlsUrl, thumbnailUrl, durationSecs }`. `custom` with `video_url` → that URL; `ymove` → `getExerciseVideo(source_id)` cached in a module `Map` for 24h; otherwise or without key → 503 `{ error: 'Video not available yet' }`.
  - `POST /exercises/sync` (admin) → result of `syncYmove()`.
  - Export pure helper `escapeSearch(q: string): string` used in the `ilike` filter.

- [ ] **Step 1: Write failing tests** for the pure parts and handler logic (inject `db`/client via a small `createRouter({ db, client })` factory exported alongside the default router, so tests don't need Supabase):
  - `search escapes PostgREST metacharacters`: `escapeSearch('a,b(c)%_')` contains no raw `,`, `(`, `)`; `%`/`_` escaped.
  - `POST rejects unknown muscle` → 400.
  - `PUT on a non-custom row is 403`.
  - `video route 503 without key for ymove rows`; `custom row with video_url returns it`.
  - `video cache reuses a fresh URL within 24h` (fake client called once for two requests).
- [ ] **Step 2: Run** `node --test auth/src/routes/exercises.test.js` — expect FAIL.
- [ ] **Step 3: Implement** the router (gates per Global Constraints) and mount it.
- [ ] **Step 4: Run** the tests, then `npm test --prefix auth` — expect PASS / no new failures.
- [ ] **Step 5: Commit** `feat(coaching): /exercises library API`.

---

### Task 5: PR

- [ ] **Step 1:** Push `feat/coaching-exercise-library`; open PR "Coaching PR 1: exercise library (free-exercise-db now, YMove-ready)". Body: what ships, that it is backend-only and touches no live tables, **merge-time steps** (apply migration 238 with consent → `notify pgrst, 'reload schema'` → run `node auth/scripts/seed-exercise-library.js` with consent → `YMOVE_API_KEY` on Render later), test output. End with the Claude Code attribution line.
- [ ] **Step 2:** Update memory `project_coaching_training.md` (new) with PR number, "migr 238 apply at merge + seed", and the 4-PR roadmap; add its line to `MEMORY.md`.

---

## Next plans (written after this PR is open)

- PR 2 — program/template schema replacement (drops old program/template/session tables), diff-save API, template re-seed mapped to the library, portal builder + exercise picker.
- PR 3 — Coaching tile + permission, scoped API, dashboard, clients, client profile, actor-bug fix, remove Admin builder.
- PR 4 — `wcs-member` training screens, video route in the Worker, logging/rest timer/history.
