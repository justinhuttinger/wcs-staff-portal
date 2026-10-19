# Coaching: Training Rebuild (Kahunas parity) — Design

**Date:** 2026-10-19
**Status:** Draft for review
**Repos:** `wcs-staff-portal` (auth API, portal, migrations) and `wcs-member` (member PWA + Cloudflare Worker)

## Why

WCS trainers use Kahunas with their PT clients and like it because it is easy,
mainly for workouts and diet. Justin wants that experience inside WCS's own
platform, rebuilt "as closely as I can" to Kahunas: trainers work in the staff
portal, clients work in the existing WCS member app
(`mobileapp.westcoaststrength.com`). Every member will eventually have the
member app; a trainer "upgrades" a member to a client to unlock coaching.

The member app already has a first-pass training feature (tiers, programs,
set logging, messages, habits, nutrition targets). Justin wants the training
part redone: how programs and workouts are built and used. Prod holds only
test data (1 training member, 1 program, 11 sessions), so the schema can be
replaced rather than migrated.

This is **project 1 of several**. Later projects, each with its own design:
weekly check-ins (forms, photos, measurements, coach review), meal plans
(YMove food database), habits redo, supplements, content vault.

## Goals

1. A Kahunas-style **program builder** in the portal: days, sections
   (Warm up / Workout / Cool down), exercises picked from a video library,
   per-exercise sets / reps / RIR / rest / notes, drag to reorder, per-day
   instructions, automatic **total volume sets per muscle**.
2. An **exercise library** backed by YMove (1,413 real-person HD videos with
   muscles, equipment, instructions, cues), plus WCS custom exercises.
3. **Templates**: a WCS template library; assign a template to a client
   (client gets an independent copy), save any client program as a template.
4. A trainer **Coaching** workspace in the portal, open to personal trainers,
   modeled on Kahunas's coach dashboard, client list and client profile.
5. A member-app **workout experience**: today's workout, exercise video and
   cues, last time's numbers, set logging, automatic rest timer, finish
   summary, history and per-exercise progress.

## Non-goals (this project)

- Weekly check-in forms, progress photos, measurements, Q&A intake.
- Meal plans / food database (YMove nutrition API is noted for that project).
- Rebuilding habits or nutrition targets (they keep working as they are).
- Supplements, content vault, calendar changes, broadcasts changes.
- **Email automations, packages, billing** — these live in GHL. Never build.
- Kahunas's "simple" free-text program type.
- **Program import** (Excel / CSV / Google Sheets → draft program, exercise
  names matched to the library). Wanted, but deferred to its own later
  project; the format question (one WCS sheet layout vs. trainers' own
  layouts read by AI) gets decided then. Nothing in this design should block it.
- Native apps. The member app stays a PWA.

## Anti-goals

- Editing a program must never break or orphan a client's logged history
  (the current builder does exactly this: `PUT /programs/:id` deletes and
  re-inserts the tree, and `memberapp_set_logs.exercise_id` goes null).
- The YMove API key must never reach a browser.
- Trainers must not see or edit clients who aren't theirs (managers see their
  club, admins see all).
- Not a "looks like Kahunas but harder to use" result: trainers should be able
  to build a 4-day program from a template in a couple of minutes.

## Reference: what Kahunas does (observed in the WCS trial, 2026-10-19)

Screenshots: `scratchpad/kahunas/*.png` from the brainstorm session.

- **Program list:** name, created, type, number of days, tags, clients using
  it, last edit; search; "Add Workout Program".
- **Program builder:** Program Title, Tags, Program Overview, then Day tabs.
  Each day: Day Name, three sections **Warm up / Workout / Cool down** each
  with "Add an Exercise", and day **Instructions**. Save & Close.
- **Program preview:** day tabs (Push A, Pull A, Legs A…), a **Total Volume
  Sets** strip of muscle chips (e.g. Chest 10, Front Delts 9.5, Triceps 11 —
  half sets for secondary muscles), then exercise rows labelled **A, B, C…**
  with drag handle, thumbnail, name, Sets, Reps (ranges like 8-12), RIR,
  Rest (min/sec), Notes.
- **Exercise library:** 1,718 exercises, search + filter, tags by body part.
- **Clients list:** stat tiles (active, archived, new last 7 days, deactivated,
  new check-ins, new messages, renewing); table with package, last check-in,
  check-in day, status, actions.
- **Client profile:** header stats (start / current weight, total weeks,
  last active), tabs: Dashboard, Checkins, Gallery, Q&A, Nutrition,
  Supplements, Workout, Calendar, Daily Habits, Logs, Billing. Dashboard shows
  activity log, client notes, latest check-ins, latest client data.
- **Coach dashboard:** latest clients, latest check-ins, latest messages,
  quick "Add Client / Add Workout Program / Add Nutrition Plan".

## Design

### 1. Exercise library

New table `memberapp_exercises` — our own library row per exercise, whatever
the video source:

| column | notes |
|---|---|
| `id` uuid pk | what programs and logs reference |
| `source` | `'free'`, `'ymove'` or `'custom'` |
| `source_id` | YMove exercise uuid (unique with source) |
| `slug`, `name` | |
| `primary_muscle` | YMove `muscleGroup` |
| `secondary_muscles` text[] | YMove `secondaryMuscles` |
| `equipment`, `category`, `difficulty` | |
| `instructions` text[], `cues` text[] | YMove `instructions`, `importantPoints` |
| `thumbnail_url` | static, cacheable per YMove docs |
| `has_video` bool | |
| `video_url` | only for custom/WCS-owned videos (e.g. R2/Stream) |
| `is_active`, `created_by`, timestamps | |

- **YMove sync:** a backend job pulls `GET /exercises?excludeVideos=1` (does
  not consume video minutes) and upserts metadata by `source_id`. Run on
  demand from an admin button and nightly. Never stores signed video URLs.
- **Before the YMove key exists (decided 2026-10-19: build without it):**
  the library is seeded from free-exercise-db (public-domain, ~870 exercises
  with still images, muscles, equipment, instructions) as `source='free'`,
  plus the template exercises. Everything is built and testable with images
  only. When the key arrives, the sync **links** YMove exercises onto
  existing rows by normalized name (keeping our `id`, so programs and logs
  are untouched), adds the rest as new rows, and the video button lights up
  wherever `has_video` is true. Unmatched `free` rows stay as image-only. The
  sync and video route ship in code but no-op without `YMOVE_API_KEY`.
- **Video playback:** video URLs are pre-signed and expire after 48h, so
  they are fetched at play time by the backend (`GET /exercises/:id`) and
  handed to the client. Builder's call: cache the signed URL server-side for
  up to ~24h per exercise to save video minutes.
- **Custom exercises:** trainers can add an exercise (name, primary muscle,
  equipment, optional notes; optional video link later). Custom rows are
  visible to all WCS trainers.
- **Swapping vendors later:** because programs reference our `id`, Gym Visual
  or WCS-filmed videos can replace YMove per exercise without touching programs.
- **Cancellation duty:** YMove terms require deleting cached data if the
  subscription ends. Synced metadata must be removable by `source='ymove'`.

### 2. Programs and templates (one schema, not two)

Replace `memberapp_programs / _program_days / _program_exercises` and the
parallel `memberapp_template_*` tables with one tree used by both:

- `memberapp_programs`: `id`, `kind` (`'template'|'client'`), `member_id` and
  `club_number` (null for templates), `name`, `overview`, `tags` text[],
  template facets (`goal`, `level`, `days_per_week`, `equipment`),
  `coach_staff_id`, `owner_staff_id` (templates: null = WCS library, else
  that trainer's private template), `source_template_id`, `starts_on`, `ends_on`,
  `is_active`, `created_by`, timestamps.
- `memberapp_program_days`: `id`, `program_id`, `position`, `name`,
  `instructions`.
- `memberapp_program_items`: `id`, `day_id`, `section`
  (`'warmup'|'workout'|'cooldown'`), `position`, `superset_group` (nullable;
  items sharing a group in the same section render as A1/A2), `exercise_id` →
  `memberapp_exercises`, `sets` int, `reps` text (`"8-12"`, `"AMRAP"`,
  `"30s"`), `weight` text, `rir` text, `rest_seconds` int, `notes`.

Rules:
- **Saving is a diff, not delete-and-reinsert.** Days and items keep stable
  ids; removed items are deleted, edited items are updated in place.
- **Assigning a template deep-copies** it into a `kind='client'` program with
  `source_template_id` set. Later template edits don't touch client copies.
- **Save as template** deep-copies the other way.
- Duplicate day, duplicate program, archive program.
- Scheduling keeps today's behavior: the live program is the most recently
  started active program; future `starts_on` = scheduled next block.
- Existing 14 templates are re-seeded into the new shape; each exercise name
  is matched to a library exercise (manual mapping table in the seed script),
  unmatched names become custom exercises.

**Volume per muscle** (Kahunas "Total Volume Sets"): for each day, sum `sets`
of Workout-section items: 1.0 to `primary_muscle`, 0.5 to each
`secondary_muscles` entry. Shown per day in the builder and preview, and as a
weekly total on the program.

### 3. Workout sessions and logs

- `memberapp_workout_sessions` stays (member, program, day, performed_on,
  started_at, completed_at, notes) plus `duration_seconds`.
- `memberapp_set_logs`: `session_id`, `program_item_id` (nullable, `on delete
  set null`), **`exercise_id`** (library, not null), **`exercise_name`**
  (snapshot), `extra_position` (for exercises added/swapped mid-session),
  `set_number`, `reps`, `weight`, `rir`, `note`. Unique on (`session_id`,
  `program_item_id`, `set_number`) for prescribed items; on (`session_id`,
  `extra_position`, `set_number`) for extras.
- "Last time" and per-exercise progress key on `exercise_id`, so they work
  across program changes and different programs.
- Existing test rows in these tables are dropped.

### 4. Portal: Coaching workspace (trainer side)

A new portal tile **Coaching**, separate from Admin → Member App.

**Access**
- New permission (e.g. `tile:coaching`) in the roles grid; granted to
  personal trainers, managers and up.
- API gate: a coaching route group allowing team_member+ **with the coaching
  permission**. Scope on every request: trainers → clients where
  `coach_staff_id = me`; managers → clients at their club(s); admin/corporate
  → all.
- Fix the existing actor bug: routes read `req.user`, but auth sets
  `req.staff`, so `created_by`/message `staff_id` are lost today.

**Screens** (desktop-first, works on phone; existing portal card patterns)
- **Dashboard:** my clients (count, trained this week, not trained in 7+
  days), latest completed workouts, latest messages, quick actions (Add
  client, New program).
- **Clients:** list with stat tiles and a table: client, club, current
  program, last workout, workouts this week, status. Search, filter.
  **Add client** = find a member (abc_members search) → upgrade to training
  tier → coach = me (managers can pick a coach) → optionally assign a
  template.
- **Client profile:** header (name, club, member since, coach, last active in
  app, current program, workouts this week), tabs:
  - **Dashboard:** activity log (program assigned/updated, workouts
    completed), client notes (free text, trainer-only), latest workouts.
  - **Workout:** current + scheduled + past programs; open the builder on the
    client's copy; assign template; schedule next block.
  - **Logs:** every session, set by set, with "vs last time".
  - **Progress:** per-exercise charts (best set weight, estimated 1RM,
    volume).
  - **Messages:** the existing coach thread.
  - Habits / Nutrition: link to the existing views for now.
- **Programs:** template library (search, tags, goal/level/days filters,
  clients-using count) + New program.
- **Program builder:** Kahunas layout — title, tags, overview; day tabs (add,
  rename, duplicate, delete, reorder); per day: three sections each with
  "Add an exercise", item rows labelled A, B, C (A1/A2 for supersets) with
  drag handle, thumbnail, name, Sets, Reps, Weight, RIR, Rest, Notes; day
  instructions; volume chips. **Exercise picker** modal: search, muscle and
  equipment filters, thumbnail grid, tap to preview video + cues, add one or
  several. Save / Save & close.
- **Exercise library:** browse/search the library, preview videos, add a
  custom exercise.

Admin → Member App keeps tiers, broadcasts and the member list; its program
builder is removed in favor of Coaching.

### 5. Member app: workout experience (client side)

In `wcs-member`, replacing the current Training screens. Existing member-app
look (Prohibition/Inter, red accent, white cards). Phone-first.

- **Training home:** current program name and coach, this week's days with
  done ticks (resets Monday, as today), "Start" on the next undone day.
- **Day view:** sections Warm up / Workout / Cool down, exercise rows with
  thumbnail, prescribed sets × reps, RIR, rest; supersets grouped; day
  instructions.
- **Exercise view:** video (fetched fresh via the Worker; plays inline,
  loops, muted), instructions and cues, prescribed sets, **last time's sets**.
- **Logging:** a row per prescribed set prefilled from last time; enter
  weight and reps (RIR optional); tick a set → **rest timer starts
  automatically** with the prescribed rest; add/remove a set; supersets
  alternate. Logs save as they go (works with a flaky gym connection: queue
  and retry).
- **Finish:** summary (duration, total sets, volume, PRs vs history),
  optional note to coach (posts into the coach thread).
- **History:** past sessions; tap an exercise → progress chart.
- Video keys stay in the Worker: add a `YMOVE_API_KEY` Worker secret and a
  `GET /api/me/exercises/:id/video` route returning a fresh signed URL.

### 6. Build order (one PR each, per repo)

1. **Migration + library**: new tables, YMove sync job, library API
   (portal `auth/`). Next migration number is 238.
2. **Builder + templates**: program/template API (diff save, assign, save as
   template), re-seeded templates, portal builder + exercise picker.
3. **Coaching workspace**: permission, scoped API, dashboard, clients,
   client profile, fix actor bug; remove Admin's old builder.
4. **Member app** (`wcs-member`): new training screens, video route, logging,
   history/progress.

## Constraints

- Portal: React 19 + Vite + Tailwind, existing card patterns, dark-backdrop
  rule. Auth API: Express on Render. Supabase prod `ybopxxydsuwlbwxiuzve`.
- Member app: separate repo, Cloudflare Worker serving the PWA + `/api/*`,
  reads Supabase with the service key; deploy is a manual `wrangler deploy`.
- Migrations are applied at merge, with consent.
- YMove: `X-API-Key` header, base `https://exercise-api.ymove.app/api/v2`,
  Pro plan billed yearly (no unique-exercise cap); 7-day trial to test first.

## Decided by Justin

- Rebuild Kahunas as closely as practical; build everything except
  automations and billing "like Kahunas".
- Clients use the WCS member app; trainers upgrade members to clients.
- Redo the existing training feature (programs and workouts) first.
- Video is preferred; use **YMove** for the exercise library.
- Build now without the YMove key; free-exercise-db fills in until it lands.
- No Kahunas import: trainers rebuild their clients from templates.

## Calls made in this design (not yet confirmed by Justin)

- Start-from-template-and-adjust is the main trainer flow; from-scratch also
  supported.
- One schema for templates and client programs.
- Coaching is a new portal tile open to trainers, scoped to their own clients.
- Trainers can upgrade a member to a client themselves.
- RIR and weight are optional fields; rest timer auto-starts.
- Old test programs/logs are dropped, not migrated. **The member app's
  Training tab may be broken between PR 1 and PR 4** (sandbox, allowlisted,
  test data only), so old tables are dropped and replaced in place; no
  parallel tables.
- **Templates:** one shared WCS library (`kind='template'`, `owner_staff_id`
  null) plus each trainer's own templates (`owner_staff_id` = them, visible
  only to them). "Save as template" saves to *my* templates; managers+ can
  publish one to the WCS library. Only managers+ edit WCS templates.
- **Client lifecycle:** `memberapp_members` gains `status`
  (`active|archived`), `archived_at`. A trainer can upgrade any active member
  at their club (no ABC/GHL package check) and becomes their coach. Trainer or
  manager can archive: the member drops back to basic tier and loses the
  Training tab; programs and logs are kept. Managers reassign a client's
  coach (single or bulk "move all of X's clients to Y"). Client tiles are
  active / new last 7 days / trained this week / not trained 7+ days / archived.
- **Logs key on the program item, not the exercise:** unique on
  (`session_id`, `program_item_id`, `set_number`); a member can add an
  extra exercise or swap one mid-session (logged with `program_item_id` null
  and an `extra_position`). "Last time" matches by `exercise_id`.
- **Video loads on tap**, not autoplay on every row; signed URLs cached
  server-side, so the Pro plan's 25k video minutes cover expected use.
- **Push (member side only):** member gets a push when a program is assigned
  or their next block starts, and when the coach messages (exists). Trainers
  see new completed workouts and notes on the Coaching dashboard; no trainer
  push in this project.

## Left to the builder

Exact component breakdown, chart library, YMove sync cadence and URL cache
TTL, drag-and-drop library choice, empty states and copy.
