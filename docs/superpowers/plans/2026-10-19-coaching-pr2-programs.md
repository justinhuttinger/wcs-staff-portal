# Coaching PR 2: Programs, Templates and the Builder — Implementation Plan

**Spec:** `docs/superpowers/specs/2026-10-19-coaching-training-design.md` (sections 2, 3, 4 "Program builder", and "Calls made in this design"). PR 1 (#1168, merged) shipped `memberapp_exercises` + `/exercises` API (`auth/src/routes/exercises.js`, `auth/src/lib/exerciseLibrary.js`).

**Goal:** Replace the old program / template / session tables with one Kahunas-style tree that references the exercise library, expose it through a new `/coaching` API with diff-saves (logged history never orphaned), re-seed the 14 WCS templates onto the library, and give the portal a Kahunas-style program builder + exercise picker, mounted for now where the old Admin → Member App program editor lived.

## Global constraints
- Worktree `C:/Users/justi/portal-coaching-programs`, branch `feat/coaching-programs` off `origin/master`. Never edit the main checkout `C:/Users/justi/wcs-staff-portal`. Junction node_modules: `cmd /c mklink /J <wt>\auth\node_modules C:\Users\justi\wcs-staff-portal\auth\node_modules` and the same for `portal\node_modules`. Remove junctions with `cmd /c rmdir` before any `git worktree remove`; never `Remove-Item -Recurse`.
- Migration **239** `auth/migrations/239_coaching_programs.sql`. Do NOT apply it; do not write to prod at all (reads via Supabase MCP are fine if available).
- Prod holds only test data in the old tables: drop and replace in place (`drop table ... cascade`). The member app (`wcs-member` Worker) training screens will break until PR 4 — accepted.
- Actor = `req.staff?.email || req.staff?.id || 'unknown'`; staff uuid = `req.staff?.id`. (memberApp.js's `actor()` reads `req.user` — a known bug; don't copy it. PR 3 fixes memberApp.js.)
- Gate for `/coaching` this PR: `authenticate` + `requireRole('manager')`. PR 3 opens it to trainers with per-client scoping — structure handlers so a `scope` check can be added in one place (e.g. a `loadProgramForStaff(req, id)` helper).
- Tests: `node:test` + `node:assert`, pure logic in `auth/src/lib/*.js` with `*.test.js` beside it. Run `node --test "src/**/*.test.js" "tests/**/*.test.js"` from `auth/`; master baseline is 8 pre-existing failures (groupXSeriesLink, blogAutomation x3, dayOneProgram x2, inventoryInvoiceParse, registerDefaultRoutes) — no new failures allowed. Portal: `pnpm build` in `portal/` must pass (and `pnpm lint` if it exists, no new errors in touched files).
- Portal UI: React 19 + Tailwind, match existing admin/memberapp component patterns and the portal's dark-backdrop rule (every content block in a card). No new npm dependencies: drag-and-drop via native HTML5 DnD with up/down buttons as an accessible fallback.
- Commits end with:
  `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`
  `Claude-Session: https://claude.ai/code/session_01JB71RaEst954zuQyPDJ4u6`

## Data model (migration 239)
Drop: `memberapp_set_logs, memberapp_workout_sessions, memberapp_program_exercises, memberapp_program_days, memberapp_programs, memberapp_template_exercises, memberapp_template_days, memberapp_program_templates` (cascade).

Create (RLS enabled, no policies, house comment style like `189_memberapp_habits.sql`):
- `memberapp_programs`: `id uuid pk`, `kind text not null check in ('template','client')`, `member_id text`, `club_number text`, `name text not null`, `overview text`, `tags text[] not null default '{}'`, `goal text`, `level text`, `days_per_week int`, `equipment text`, `coach_staff_id uuid`, `owner_staff_id uuid` (templates: null = WCS library, else that trainer's private template), `source_template_id uuid references memberapp_programs(id) on delete set null`, `starts_on date`, `ends_on date`, `is_active bool not null default true`, `created_by text`, `created_at`, `updated_at`. Check: `(kind='template' and member_id is null and club_number is null) or (kind='client' and member_id is not null and club_number is not null)`. Index `(member_id, club_number, is_active)`, `(kind, owner_staff_id)`.
- `memberapp_program_days`: `id`, `program_id → programs on delete cascade`, `position int not null default 0`, `name text not null`, `instructions text`.
- `memberapp_program_items`: `id`, `day_id → days on delete cascade`, `section text not null check in ('warmup','workout','cooldown')`, `position int not null default 0`, `superset_group text` (null = standalone), `exercise_id uuid not null references memberapp_exercises(id)`, `sets int check (sets between 0 and 20)`, `reps text`, `weight text`, `rir text`, `rest_seconds int check (rest_seconds between 0 and 3600)`, `notes text`.
- `memberapp_workout_sessions`: `id`, `member_id text not null`, `club_number text not null`, `program_id → programs on delete set null`, `day_id → days on delete set null`, `performed_on date not null default (now() at time zone 'America/Los_Angeles')::date`, `started_at timestamptz default now()`, `completed_at timestamptz`, `duration_seconds int`, `notes text`, `logged_by text` (staff email when a coach logs it; null = member). Index `(member_id, club_number, performed_on desc)`.
- `memberapp_set_logs`: `id`, `session_id → sessions on delete cascade`, `program_item_id → items on delete set null`, `exercise_id uuid not null references memberapp_exercises(id)`, `exercise_name text not null` (snapshot), `extra_position int` (exercises added/swapped mid-session), `set_number int not null`, `reps int`, `weight numeric(7,2)`, `rir numeric(3,1)`, `note text`, `created_at`. Partial unique indexes: `(session_id, program_item_id, set_number) where program_item_id is not null`; `(session_id, extra_position, set_number) where extra_position is not null`. Index `(exercise_id, created_at desc)` for "last time".

## Tasks

### Task 1 — Migration 239 + pure program logic
`auth/src/lib/coachingPrograms.js` (+ test). Produces:
- `SECTIONS = ['warmup','workout','cooldown']`
- `normaliseTree(body) -> { tree } | { error }` — trims/clamps: program fields (name required ≤120, overview ≤2000, tags ≤12 × ≤40 chars, goal/level/equipment ≤60, days_per_week 1–7 or null, starts_on/ends_on ISO date or null); `days[]` (≤14; name required ≤80; instructions ≤2000; optional `id`); `items[]` per day (≤40; `section` in SECTIONS else 'workout'; `exercise_id` uuid required — drop items without one; `sets` int 0–20 or null; reps/weight/rir ≤40; rest_seconds 0–3600 or null; notes ≤400; superset_group ≤4 chars or null; optional `id`). Positions come from array order.
- `planTreeDiff(stored, tree) -> { days: {insert:[], update:[], delete:[ids]}, items: {insert:[], update:[], delete:[ids]} }` — `stored` = `{ days:[{id, items:[{id}]}] }`. A day/item keeps its row only if its `id` exists in `stored` *under this program* (foreign or unknown ids are treated as new — never update another program's rows). Items moved between days are updates with a new `day_id`. New items under new days reference the day by its index (`day_index`) so the route can resolve ids after inserting days.
- `itemLabels(items) -> string[]` — Kahunas labels per section in order: A, B, C…; contiguous items sharing a non-null `superset_group` share a letter with numbers (A1, A2).
- `volumeByMuscle(items, exercisesById) -> { [muscle]: number }` — only `section==='workout'`; `sets` (null→0) × 1 to `primary_muscle`, × 0.5 to each `secondary_muscles` entry. Sum for a whole program by merging days.
- `copyTree(tree) -> tree` without ids (for duplicate/assign/save-as-template).
Tests must include: diff keeps ids of unchanged items; deleting an item only deletes that id; foreign id → insert; moving an item to another day = update with new day; new day with new items uses day_index; superset labels A1/A2 then B; volume 4 sets bench (chest primary, triceps+shoulders secondary) → chest 4, triceps 2, shoulders 2; warmup ignored.

### Task 2 — `/coaching` API
`auth/src/routes/coaching.js`, mounted in `auth/src/app.js` next to `/exercises`. Endpoints (JSON):
- `GET /coaching/programs?kind=template|client&member_id=&club_number=&q=` → `{ programs:[{ id, kind, name, overview, tags, goal, level, days_per_week, equipment, owner_staff_id, member_id, club_number, starts_on, ends_on, is_active, updated_at, day_count, clients_using }] }`. Templates visible = `owner_staff_id is null OR owner_staff_id = me`. `clients_using` = count of active client programs with `source_template_id = id`.
- `GET /coaching/programs/:id` → `{ program, days:[{ id, position, name, instructions, items:[{ id, section, position, superset_group, label, exercise_id, sets, reps, weight, rir, rest_seconds, notes, exercise:{ id, name, thumbnail_url, primary_muscle, secondary_muscles, equipment, has_video } }], volume:{} }], volume:{} }`.
- `POST /coaching/programs` body = tree + `kind` (+ `member_id`, `club_number`, `coach_staff_id` for client; templates get `owner_staff_id = me` unless body `publish:true` and role ≥ manager → null). 201 `{ program }`.
- `PUT /coaching/programs/:id` body = tree → diff save (Task 1). Only managers+ may edit a WCS-library template (owner null); a private template only by its owner or manager+.
- `POST /coaching/programs/:id/copy` body `{ kind, member_id?, club_number?, coach_staff_id?, starts_on?, name? }` → deep copy. Template→client = "assign" (sets `source_template_id`); client→template = "save as template" (owner = me); template→template = duplicate. 201 `{ program }`.
- `POST /coaching/programs/:id/publish` (manager+) → owner_staff_id = null.
- `PATCH /coaching/programs/:id` `{ is_active?, starts_on?, ends_on?, name? }` (archive/schedule).
- `DELETE /coaching/programs/:id` → templates only (client programs are archived, never deleted, so history keeps its program).
- `GET /coaching/sessions?member_id=&club_number=&limit=30` → `{ sessions:[{ id, performed_on, started_at, completed_at, duration_seconds, notes, logged_by, program_id, day_id, day_name, sets:[{ exercise_id, exercise_name, set_number, reps, weight, rir, note, program_item_id, extra_position }] }] }`.
Writes must not leave half a program: on a failed step after creating the program row in POST/copy, delete the program row and return 502.

Also in this task, remove from `auth/src/routes/memberApp.js` everything that touched dropped tables: the programs routes + `writeDays`, templates routes (`/templates*`, `/programs/:id/save-as-template`), sessions routes (`/sessions*`). Update the `/calendar` route to the new tables (sessions keep `performed_on`/`completed_at`; day names now via `memberapp_program_days.name`). Keep habits, nutrition, members, threads, broadcasts working. Tests for any pure helpers you extract.

### Task 3 — Template re-seed onto the library
Rewrite `auth/scripts/seed-program-templates.js` for the new tree: same 14 templates and prescriptions, organised into sections (put mobility/cardio warm-ups in `warmup`, stretches in `cooldown`, else `workout`), each exercise resolved to a library row by `nameKey` (from `auth/src/lib/exerciseLibrary.js`) against `memberapp_exercises` (prefer exact name_key; allow a small manual alias map in the script for names free-exercise-db spells differently, e.g. 'Goblet squat' → 'Goblet Squat', 'Chest press machine' → 'Machine Bench Press' — check the real names in https://raw.githubusercontent.com/yuhonas/free-exercise-db/f00c92c7dcf1216a928a52c3706c7ce8e2f71ed5/dist/exercises.json). Unmatched names are created as `source='custom'` exercises with a `primary_muscle` from an inline map in the script (every unmatched name must have one; the script fails listing any missing). Idempotent by template name among WCS-library templates (`kind='template' and owner_staff_id is null`). Put the pure name→exercise resolution in a testable function. Do not run it against prod.

### Task 4 — Portal: builder, picker, template library
Create `portal/src/components/coaching/`:
- `coachingApi.js` — fetch helpers for `/coaching/*` and `/exercises/*` using the portal's existing API helper (find how `MemberAppPrograms.jsx` calls the API and reuse it).
- `ExercisePicker.jsx` — modal: search box (debounced), muscle + equipment filters from `/exercises/facets`, thumbnail grid (thumbnail or a muscle-initial placeholder), click a card to preview (bigger image, instructions, cues; "Video" button calling `/exercises/:id/video` and playing it if 200, hidden/"no video yet" on 503), multi-select "Add N exercises". "Add your own" opens a small form → `POST /exercises`.
- `ProgramBuilder.jsx` — Kahunas layout: Program title, Tags (chips), Overview; day tabs (add, rename inline, duplicate, delete with confirm, reorder left/right); per day: Day name, three section cards Warm up / Workout / Cool down each listing item rows `[drag handle] [label A/B/A1] [thumb] [name] Sets | Reps | Weight | RIR | Rest (sec, shown as m:ss) | Notes [remove]` with "+ Add an exercise" opening the picker for that section; "Superset with next" toggle that assigns a shared `superset_group`; day Instructions textarea; a "Total Volume Sets" chip strip for the day (computed client-side with the same rules as `volumeByMuscle`; port the function to `portal/src/components/coaching/volume.js`). Template fields (goal, level, days/week, equipment) shown when kind=template. Save / Save & close; unsaved-changes guard on close. Saves send the tree with ids so the server diffs.
- `ProgramPreview.jsx` — read-only Kahunas preview (day tabs, volume chips, rows A–F with thumbnails) used by template library and client program list.
- `TemplateLibrary.jsx` — list (search, tag filter, goal/level/days filters, clients-using count, "WCS" vs "Mine" badge), open preview, New template, Edit, Duplicate, Publish to WCS (managers), Delete, and "Assign to client" (used from the client page).
Wire-in (temporary until PR 3's Coaching tile): in Admin → Member App member page, replace the old Programs tab with a client program list (current/scheduled/past, Assign template, New program, Edit → ProgramBuilder, Archive, Schedule start) and replace the old Templates screen with `TemplateLibrary`. Delete `MemberAppPrograms.jsx` / `MemberAppTemplates.jsx` and any now-dead session UI if nothing else uses them.
`pnpm build` must pass.

### Task 5 — PR
Push `feat/coaching-programs`, open PR "Coaching PR 2: Kahunas-style programs, templates and builder" against master with: what ships, migration 239 (drops old tables — test data only), merge-time steps (apply 239 → `notify pgrst, 'reload schema'` → run `node auth/scripts/seed-program-templates.js` after the exercise library seed), that wcs-member training is broken until PR 4, test results. End body with `🤖 Generated with [Claude Code](https://claude.com/claude-code)` then a blank line and `https://claude.ai/code/session_01JB71RaEst954zuQyPDJ4u6`. Save this plan as `docs/superpowers/plans/2026-10-19-coaching-pr2-programs.md` in the branch.

## Review focus
- Editing a program that has logged sets keeps `memberapp_set_logs.program_item_id` for unchanged items (diff, not replace).
- A PUT carrying another program's day/item ids must not modify that program.
- Picker with no YMove key: video button degrades cleanly (503 handled).
- Client program list: a program with future `starts_on` shows as scheduled, not current.
- Deleting a template that client programs were copied from leaves those copies intact (`source_template_id` set null).
