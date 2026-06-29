# Tour Check-In — standalone public app (design spec)

**Date:** 2026-06-27
**Status:** approved, pending implementation plan
**Repo:** wcs-staff-portal (worktree `feat/tour-checkin-standalone`)
**Supersedes:** the in-portal mobile Tour Check-In tile shipped in PR #368 (`docs/tour-checkin-module.md`).

## Goal

Turn the front-desk Tour Check-In feature from an auth-gated tile inside the
mobile staff portal into a **standalone, login-free app** that opens straight to
a location's tour queue on its iPad. Add a Tour Member selector (from ABC
employees), a tighter outcome set, an in-app "Book Day One" step with pre-filled
contact data, an outbound per-location webhook, and an admin page to manage the
per-location URL, webhook, and Day One link.

## Access model

- The app is **not gated by login**. Instead, each location has an
  **unguessable per-location URL**: `https://<portal-host>/tour/:token` where
  `token` is a long random secret. No login screen; opens directly to that
  location's queue.
- Rationale: the queue shows prospect PII (name, photo, email, phone). A
  guessable public URL would expose PII to anyone. The secret-token link gives
  the "no login, always available" UX without parking PII at a public address.
  Tokens are **revocable/regenerable** from the admin page if a link leaks.
- It is "its own app" via a **public route in the existing portal SPA** (own URL,
  own UI, skips the auth/`getMe()` flow) — **no separate Render deploy**.

## Data model (migration 068)

### New table `tour_location_config`
```sql
CREATE TABLE IF NOT EXISTS tour_location_config (
  location_id     uuid PRIMARY KEY REFERENCES locations(id),
  public_token    text NOT NULL UNIQUE,
  webhook_url     text,
  day_one_base_url text,
  active          boolean NOT NULL DEFAULT true,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.tour_location_config ENABLE ROW LEVEL SECURITY;
```
- Seed one row per existing location with a freshly generated `public_token`
  (e.g. 32 hex chars). `webhook_url` / `day_one_base_url` start null.
- RLS enabled, **no policy** — service-role only, matching `035_enable_rls_all_tables`.

### Alter `tour_intakes`
```sql
ALTER TABLE tour_intakes ADD COLUMN IF NOT EXISTS tour_member text;
```
- `tour_member` = the ABC employee who ran the tour (free text name captured at
  save). `completed_by` (FK to staff) stays null — there is no logged-in staffer.

## Backend — public endpoints (auth service, NO JWT, token-gated)

Mounted on a router that does **not** use the `authenticate` middleware. Each
endpoint resolves `:token` → `tour_location_config` row → `location_id`, and
404s on unknown/inactive tokens.

| Method & path | Purpose |
|---|---|
| `GET /public/tour/:token` | Resolve location; return `{ location_name, day_one_base_url, ready[], completed[] }` scoped to that location. |
| `GET /public/tour/:token/employees` | All **active** ABC employees for the location's club, **sorted A–Z** (`abc_employees`). |
| `PATCH /public/tour/:token/intake/:id` | Body `{ tour_member, outcome, notes }`. Validate the intake belongs to the token's location. Set `status='completed'`, `completed_at=now()`, store `tour_member/outcome/notes`. If `webhook_url` is set, POST the outcome payload (fire-and-forget, non-fatal on error). |

**Location → ABC club mapping:** the employee query filters `abc_employees` by
the location's ABC club number. Implementation must reuse the existing
location→club mapping already used by ABC features (e.g. check-ins / POS
employee resolution); resolving the exact source is a plan task.

**Webhook payload (on outcome save):**
```json
{ "location_id": "...", "location_name": "...", "intake_id": "...",
  "contact_name": "...", "contact_email": "...", "contact_phone": "...",
  "tour_member": "...", "outcome": "...", "notes": "...", "completed_at": "..." }
```

**Security notes:**
- Public router mounted separately so it is never behind `authenticate`.
- `:token` only ever exposes/edits a single location's intakes; no cross-location
  access, no employee data beyond names for the dropdown.
- Reuse the existing 6 MB JSON body parser consideration is not needed here
  (these endpoints don't receive base64 photos).

## Backend — admin endpoints (auth service, admin-only JWT)

| Method & path | Purpose |
|---|---|
| `GET /admin/tour-locations` | List all locations joined with their `tour_location_config` (token, webhook_url, day_one_base_url, active). |
| `PUT /admin/tour-locations/:locationId` | Upsert `webhook_url`, `day_one_base_url`, `active`. |
| `POST /admin/tour-locations/:locationId/regenerate-token` | Generate a new `public_token` (invalidates the old URL). |

Gated by the existing admin auth pattern in `auth/src/routes/admin.js`.

## Frontend — public check-in app

New top-level public route `/tour/:token` rendered **before/outside** the
authenticated app shell (no `getMe()` requirement). New component
`TourCheckinApp` (replaces `portal/src/mobile/components/MobileTourCheckin.jsx`).

Behavior:
- Fetches `GET /public/tour/:token` on mount; **polls every 20s** for new arrivals.
- **Ready** and **Completed** tabs (same as today).
- **Readable header**: light header bar with dark text (fixes the current
  unreadable title on a dark background).
- **Larger person tiles**: bigger avatar/photo and text for the people on the list.
- Tap a tile → outcome modal, in this exact order:
  1. **Tour Member** dropdown — ABC employees A–Z, fetched from
     `GET /public/tour/:token/employees`. **Asked every tour** (no persistence).
  2. **Tour Outcome** — exactly four options:
     `Membership Sale` · `Started Trial` · `Started VIP Pass` · `Only Tour`.
  3. **Book Day One** — a slide-up **in-app overlay (iframe)** loading the
     location's `day_one_base_url` with query params pre-filled:
     `first_name`, `last_name`, `email`, `phone` (+ best-effort team-member param).
     Includes an automatic **"Open in new tab"** fallback link in case GHL blocks
     iframe embedding (`X-Frame-Options`/CSP).
  4. **Notes** textarea.
  5. **Save** → `PATCH .../intake/:id` (also triggers the webhook server-side).
- Copy interactions use the standard **"Copied!" confirmation animation**.

## Frontend — remove from mobile portal

- `portal/src/mobile/MobileApp.jsx`: remove the `case 'tour-checkin'` route and
  the now-unused `TourIcon` (verify no other usage).
- `portal/src/mobile/components/HomeScreen.jsx`: remove the `Tour Check-In` tile
  entry from `allTiles`.
- Remove/replace `MobileTourCheckin.jsx` (logic migrates into `TourCheckinApp`).

## Frontend — admin page

New admin component (mirroring `portal/src/components/admin/OnlineJoinLocations.jsx`
structure) listing all locations; per location:
- **Check-in app URL** — full `https://<portal-host>/tour/<token>`, with a
  **copy button** (Copied! animation) and a **Regenerate token** action.
- **Outbound webhook URL** field.
- **Day One base calendar link** field.
- Save via `PUT /admin/tour-locations/:locationId`.

## Known-unknowns to verify against real data (non-blocking)

1. **Day One prefill params** — GHL booking widgets reliably accept
   `first_name/last_name/email/phone`; the team-member param varies. Confirm
   against one real Day One link once entered in the admin page (same approach
   used to confirm the photo field).
2. **iframe embedding** — if GHL refuses embedding, the new-tab fallback covers it.

## Out of scope

- Desktop layout (mobile/iPad-first by request).
- Making "Book Day One" actually create the appointment server-side (it opens the
  GHL calendar for the staffer to complete).
- Per-staff identity/audit on the public app (no login by design).

## Migration / rollout

1. Apply migration 068 via Supabase MCP `apply_migration` (name
   `tour_location_config_and_tour_member`), seeding tokens for all locations.
2. Deploy auth service (new public + admin routes) and portal (public route +
   admin page; mobile tile removed).
3. In Admin → Tour Check-In, paste each location's Day One base link; copy each
   location's check-in URL onto its iPad.
4. Verify the team-member prefill param against a real Day One link; adjust if needed.
