# Coaching PR 3: The Coaching tile (trainer workspace) — Implementation Plan

**Spec:** `docs/superpowers/specs/2026-10-19-coaching-training-design.md` section 4 + "Calls made in this design" (client lifecycle, templates, push). **Builds on PR 2** (merged to master before this starts): `/coaching` router (`auth/src/routes/coaching.js`), `auth/src/lib/coachingPrograms.js`, portal `portal/src/components/coaching/*` (ProgramBuilder, ExercisePicker, ProgramPreview, TemplateLibrary, coachingApi, volume), migration 239 tables. Read PR 2's plan `docs/superpowers/plans/2026-10-19-coaching-pr2-programs.md` and its code first.

**Goal:** A new portal tile **Coaching** — Kahunas's coach side — open to trainers, scoped to their own clients (managers: their clubs; corporate/admin: all). Dashboard, Clients list, Client profile, Programs (template library), Exercise library. Moves training out of Admin → Member App.

## Global constraints
- Worktree `C:/Users/justi/portal-coaching-tile`, branch `feat/coaching-tile` off `origin/master`. Never touch the main checkout. Junction `auth\node_modules` and `portal\node_modules` from `C:\Users\justi\wcs-staff-portal\...`; remove junctions with `cmd /c rmdir` when done (don't remove the worktree).
- Migration **240** `auth/migrations/240_coaching_tile.sql` — NOT applied by you; no prod writes.
- Same test/build/commit rules as PR 2 (auth test glob baseline = 8 pre-existing failures; `pnpm build` in portal; commit trailers `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>` + `Claude-Session: https://claude.ai/code/session_01JB71RaEst954zuQyPDJ4u6`; PR body ends with `🤖 Generated with [Claude Code](https://claude.com/claude-code)` + blank line + that session URL). No new npm deps (SVG charts).
- Portal UI: match existing tile/screen patterns (look at how other full-screen tools open from `ToolGrid.jsx` / `App.jsx`, e.g. `trainerAvail`), dark-backdrop rule (every block in a card), works on desktop and phone (portal has mobile views — follow how other tiles handle mobile, e.g. `portal/src/config/portalTiles.js` and mobile nav). Omit empty rows in lists. Copy buttons show "Copied!".

## Migration 240
- Tile catalog, following `auth/migrations/086_catalog_trainer_avail.sql`: `permission_catalog ('coaching','Coaching','Tools','team_member')`; `role_tool_visibility` true ONLY for `manager, director, corporate, admin` with `on conflict do nothing` (front desk staff are `team_member` since migration 010, so seeding team_member/lead would hand the tile to all front desk). Trainers are granted 'coaching' per person in Admin -> Roles & Permissions (staff_permission_overrides). Idempotent. (Revised after review of #1172.)
- `memberapp_members`: add `status text not null default 'active' check (status in ('active','archived'))`, `archived_at timestamptz`, `upgraded_at timestamptz`, `upgraded_by text`.
- `memberapp_client_notes`: `member_id, club_number` (pk together), `body text`, `updated_by text`, `updated_at` — trainer-only notes (Kahunas "Client Notes").
- RLS enabled on new table.

## Access model (auth)
- `/coaching` router gate changes from `requireRole('manager')` to `requireTile('coaching')` (`auth/src/middleware/tile.js`). `/exercises` likewise (keep `POST /exercises/sync` admin-only).
- One pure scope function in `auth/src/lib/coachingScope.js` (+ tests): `scopeFor(staff, { allowedClubNumbers }) -> { all:true } | { coachStaffId } | { clubNumbers:[...] }` — corporate/admin/director (use `canSeeAllLocations`) → all; manager+ → their clubs' `club_number`s (map `req.staff.location_ids` → club numbers via the club registry, `auth/src/config/clubs*` / `locations` — find the existing mapping used by other member-scoped routes); below manager → `coachStaffId = staff.id`. `canAccessClient(scope, { club_number, coach_staff_id })`.
- Every `/coaching` program/session/client route enforces it: client programs via their member; templates per PR 2 rules (WCS library readable by all with the tile; editable by manager+; private templates by owner or manager+).
- Fix `auth/src/routes/memberApp.js` `actor()` to read `req.staff` (it reads `req.user`, so `created_by`/message `staff_id` are lost) and set message `staff_id` from `req.staff.id`.

## API additions (`/coaching`)
- `GET /coaching/dashboard` → `{ counts:{ active, newLast7, trainedThisWeek, notTrained7, archived }, latestWorkouts:[{ member, day_name, completed_at, total_sets, note }](10), unreadMessages:[{ member, last_body, at }] , scheduledStarting:[...] }` within scope.
- `GET /coaching/clients?status=active|archived&q=` → `[{ member_id, club_number, name, email, club_name, coach:{id,name}, current_program:{id,name}, last_workout_on, workouts_this_week, status, upgraded_at }]`.
- `GET /coaching/members/search?q=` → active `abc_members` within scope's clubs (trainers: their assigned clubs; if a trainer has no location_ids, their clubs = clubs of their existing clients, else none) with current tier/status.
- `POST /coaching/clients` `{ member_id, club_number, coach_staff_id?, template_id?, starts_on? }` → upsert `memberapp_members` tier 'training', status 'active', `coach_staff_id` = me (managers may pick another coach), `upgraded_at/by`; if `template_id`, copy it to the client (reuse PR 2 copy helper); push the member (`notifyMember` from `auth/src/lib/memberAppPush.js`): "Your coach has set up your training program".
- `PATCH /coaching/clients/:memberId` `{ club_number, status?, coach_staff_id? }` — archive (trainer of the client or manager+) → status 'archived', tier 'basic', `archived_at`; reactivate; reassign coach (manager+ only).
- `POST /coaching/clients/reassign` `{ from_staff_id, to_staff_id }` (manager+, within scope) → bulk move.
- `GET /coaching/clients/:memberId?club_number=` → profile header `{ member (name, email, phone, club, member since from abc_members), coach, status, last_active_in_app (latest memberapp session/login/sets timestamp you can find), current_program, scheduled_programs, workouts_this_week, total_workouts }`, `activity:[{ at, kind:'program_assigned'|'program_updated'|'workout_completed'|'message', text }]` (derive from rows; no new log table), `notes`.
- `PUT /coaching/clients/:memberId/notes` `{ club_number, body }`.
- `GET /coaching/clients/:memberId/progress?club_number=&exercise_id=` → per-exercise points `{ performed_on, bestWeight, bestReps, est1rm (Epley), volume }` + list of exercises the client has logged (for the picker).
- `GET /coaching/coaches` → staff with the coaching tile in scope (for reassign/pick coach).
- When PR 2's `POST /coaching/programs/:id/copy` assigns to a client or a client's program `starts_on` is today, push the member (program assigned). Keep it best-effort (never fail the request on push errors).

## Portal
- Tile: key `coaching`, label "Coaching", desc "Clients & programs", gated by `visibleTools.includes('coaching')` in ToolGrid + `portalTiles.js` + mobile equivalents + changelog entry ("Coaching: build programs and coach clients in the member app").
- `portal/src/components/coaching/CoachingApp.jsx` — full-screen tool with left nav (desktop) / top tabs (phone): **Dashboard**, **Clients**, **Programs**, **Exercises**.
  - Dashboard: stat cards (Active clients, Trained this week, Not trained 7+ days, New last 7 days), Latest workouts list (click → client Logs), Messages needing a reply, quick actions (Add client, New program).
  - Clients: stat tiles + table (client, club, program, last workout, this week, status), search, Active/Archived toggle, Add client (search member → pick template optional → start date → create).
  - Client profile (Kahunas header + tabs): header card (name, club, coach, status pill, member since, last active, current program, workouts this week) with actions (Assign template, New program, Message, Archive/Reactivate, Reassign for managers). Tabs: **Dashboard** (activity timeline, Client notes editable, latest workouts), **Workout** (current / scheduled / past programs; open ProgramBuilder on the client copy; schedule next block), **Logs** (sessions set-by-set with "vs last time" deltas), **Progress** (exercise select + SVG line chart est. 1RM / best weight + table), **Messages** (reuse `MemberAppMessages.jsx`), **Habits** / **Nutrition** (reuse existing `MemberAppHabits.jsx` / `MemberAppNutrition.jsx`).
  - Programs: PR 2's `TemplateLibrary` (WCS / Mine filter).
  - Exercises: library browser (search, muscle/equipment filters, preview with video when available, add/edit own custom exercise).
- Admin → Member App: remove the programs/templates UI there (it now lives in Coaching); keep tiers, broadcasts, member list, habits/nutrition/messages if still useful, plus a "Open in Coaching" link on a member.

## Tasks
1. Migration 240 + `coachingScope.js` (TDD).
2. Gate + scope enforcement on existing `/coaching` and `/exercises` routes; memberApp actor fix.
3. Client/dashboard/progress/notes/coaches endpoints (pure helpers TDD: stats, activity derivation, Epley/progress points, "trained this week" Monday boundary in America/Los_Angeles).
4. Portal Coaching app + tile wiring + Admin cleanup. `pnpm build`.
5. Push, open PR "Coaching PR 3: Coaching tile for trainers" with merge-time steps (apply 240 → reload schema). Save this plan as `docs/superpowers/plans/2026-10-19-coaching-pr3-coaching-tile.md`.

## Review focus
- A trainer cannot read or write another trainer's client by guessing member_id (every route scoped).
- A trainer with no assigned clubs and no clients sees an empty, friendly state, not every member.
- Archiving keeps programs and logs; the member loses the Training tab (tier basic).
- Manager reassign only within their clubs.
- Push failures never break assign/upgrade.
