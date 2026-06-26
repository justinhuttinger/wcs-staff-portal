# Tour Check-In module (front-desk gym-tour queue)

**Status:** code merged · **migration must be applied manually** (see step 1).
**Added:** 2026-06-26 · branch `claude/gym-tour-booking-module-4vyres`.

## What it does

A prospect arrives for a gym tour. A Go High Level form is filled out, which
fires a webhook to the WCS auth API. The auth API records the prospect, and the
mobile portal shows a **live queue** on the iPad: profile photo, name, email,
phone, and a "Ready for a tour" badge. A staffer taps the card, records the
**tour outcome** + **notes**, and the entry clears from the queue.

```
GHL form submitted
      │  (webhook, same flat payload already sent to prospects-documents/ABC)
      ▼
POST /webhooks/tour-intake   ──►  tour_intakes table (status = 'ready')
      ▲                                   │
      │ poll every 20s                    │ GET /tour-intake?location_id=&status=ready
      │                                   ▼
iPad  ◄──────────────────────  Mobile "Tour Check-In" screen  (/mobile  #tour-checkin)
                                          │  staff taps a card
                                          ▼  PATCH /tour-intake/:id { status, outcome, notes }
                                  status = 'completed'
```

## How to open it

- URL: **`/mobile`** then the **Tour Check-In** tile (hash route `#tour-checkin`).
- Available to **lead and above** (same gate as the rest of the mobile app).
- Tabs: **Ready** (open queue) and **Completed** (history). The Ready tab
  background-polls every 20s so new arrivals appear without a reload.

## Outcomes the form captures

Outcome (one of) + free-text notes:

`Joined` · `Started Trial` · `Booked Day One` · `Thinking It Over` · `Not Interested`

> Edit the `OUTCOMES` array in
> `portal/src/mobile/components/MobileTourCheckin.jsx` to change these.

---

## Step 1 — Apply the database migration (REQUIRED, do this first)

The table does **not** exist until you apply it. Until then, the webhook and the
queue will return errors (nothing else in the portal is affected — it's all new,
additive code).

Apply via the **Supabase MCP `apply_migration`** (the way every other migration
in this repo is applied) with name `tour_intakes`, **or** paste the SQL into the
Supabase SQL editor. The canonical copy lives at
`auth/migrations/067_tour_intakes.sql`:

```sql
CREATE TABLE IF NOT EXISTS tour_intakes (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  received_at   timestamptz NOT NULL DEFAULT now(),
  ghl_contact_id  text,
  contact_name    text,
  contact_email   text,
  contact_phone   text,
  photo_base64    text,                       -- data URL; null -> show initials
  location_id     uuid REFERENCES locations(id),
  status          text NOT NULL DEFAULT 'ready',   -- ready | completed | cancelled
  outcome         text,
  notes           text,
  completed_at    timestamptz,
  completed_by    uuid REFERENCES staff(id),
  raw             jsonb
);

CREATE INDEX IF NOT EXISTS idx_tour_intakes_location_status
  ON tour_intakes(location_id, status, received_at DESC);
CREATE INDEX IF NOT EXISTS idx_tour_intakes_received
  ON tour_intakes(received_at DESC);

ALTER TABLE public.tour_intakes ENABLE ROW LEVEL SECURITY;
```

RLS is enabled with **no policy** — matching the project-wide posture
(`035_enable_rls_all_tables`): all access is server-side via the Supabase
service role, which bypasses RLS, so this just denies the public roles.

Verify: `select * from tour_intakes limit 1;` should return 0 rows (not an error).

## Step 2 — Set the webhook secret (if not already set)

The endpoint reuses the existing `GHL_WEBHOOK_SECRET` env var on the auth
service (same secret the other GHL webhooks use). If that's already set in
Render, nothing to do. If it's unset, the endpoint accepts unauthenticated
posts (backward-compat behavior shared by the other GHL webhooks) — set it to
lock the endpoint down.

## Step 3 — Point the GHL form/workflow at the endpoint

GHL fires the **same payload** to multiple webhook URLs in a workflow, so add
**our** endpoint as an additional webhook action alongside the existing
prospects-documents/ABC one — they don't conflict.

- **URL:** `https://<auth-service-host>/webhooks/tour-intake?secret=<GHL_WEBHOOK_SECRET>`
  (or send the secret as the `x-webhook-secret` header instead of the query param)
- **Method:** `POST`, JSON body.

---

## Webhook contract

`POST /webhooks/tour-intake` reads the established **flat GHL payload** (same
shape as the day-one webhook: `contact_id` + `location.id` + form/contact fields
as top-level keys by label). It is tolerant of field-name variants:

| Field        | Keys it looks for (first non-empty wins)                                   | Fallback |
|--------------|-----------------------------------------------------------------------------|----------|
| contact id   | `contact_id`, `contactId`, `contact.id`                                      | —        |
| location     | `location.id`, `location_id`, `locationId` → mapped to `locations.ghl_location_id` | —  |
| name         | `full_name`, `name`, `Full Name`, else `first_name`+`last_name` variants     | GHL contact lookup |
| email        | `email`, `Email`, `contact.email`                                           | GHL contact lookup |
| phone        | `phone`, `Phone`, `contact.phone`                                           | GHL contact lookup |
| photo        | `photo_base64`, `photo`, `Photo`, `Profile Photo`, `profile_photo`, `image`, `Image` | none (card shows initials) |

If name/email/phone are missing from the payload, the handler falls back to a
GHL **contacts API** lookup using the location's `ghl_api_key` (same approach as
`routes/tours.js`). The full raw payload is stored in `tour_intakes.raw`.

### Profile photo (base64)

The photo arrives **in the webhook as base64**. The handler accepts either a
bare base64 string (assumed JPEG) or a full `data:image/...;base64,...` data URL,
and stores it in `photo_base64`. The card renders it directly; when absent it
shows a colored circle with the prospect's initials.

> ⚠️ **Confirm the real field name.** I guessed the photo's field label from the
> list above. Pull one real payload (see "Finding a real payload" below) and, if
> the photo key differs, add it to the `pickKey([...])` list for the photo in
> `auth/src/routes/webhooks.js` (`/tour-intake` handler). Same goes for
> confirming the name/email/phone keys.

> ⚠️ **Body size.** Base64 photos can exceed Express's default 100 kb JSON
> limit. `auth/src/index.js` registers a `6mb` JSON parser for the
> `/webhooks/tour-intake` path *before* the global parser so large bodies are
> accepted. If photos are bigger, raise that limit.

## API endpoints (auth service)

| Method & path             | Auth        | Purpose |
|---------------------------|-------------|---------|
| `POST /webhooks/tour-intake` | webhook secret | GHL → insert a `ready` intake |
| `GET  /tour-intake?location_id=&status=` | staff JWT | Location-scoped queue list |
| `PATCH /tour-intake/:id`  | staff JWT   | Record outcome/notes, set status `completed`/`cancelled` |

`GET`/`PATCH` are location-scoped: a staffer only sees/edits intakes for
locations in their `req.staff.location_ids`.

## Finding a real GHL payload (to confirm field names)

Two ways, since there is **no Render MCP** connected to the Claude session:

1. **In-app (easiest):** the auth service already logs real GHL day-one
   payloads to the `ghl_dayone_webhooks` table, surfaced in the portal under
   **Admin → Webhook Logs** (`GET /admin/webhook-logs`, admin only). Open a
   recent entry and inspect its `payload` JSON — that's the real flat shape.
   The tour form will send the same envelope.
2. **Render logs:** the `/tour-intake` handler logs errors with a `[tour-intake]`
   prefix. After wiring the GHL webhook, watch the auth service logs in the
   Render dashboard while submitting a test form, and inspect the stored
   `tour_intakes.raw` for that test row.

## Files in this change

**Backend (`auth/`)**
- `migrations/067_tour_intakes.sql` — the table (apply manually, step 1).
- `src/routes/webhooks.js` — `POST /webhooks/tour-intake` handler.
- `src/routes/tourIntake.js` — `GET` list + `PATCH` update (location-scoped).
- `src/index.js` — mounts `/tour-intake`; registers the 6 mb body parser for
  the webhook path.

**Frontend (`portal/`)**
- `src/mobile/components/MobileTourCheckin.jsx` — the queue screen + outcome modal.
- `src/mobile/MobileApp.jsx` — `#tour-checkin` route.
- `src/mobile/components/HomeScreen.jsx` — Home tile.
- `src/lib/api.js` — `getTourIntakes`, `updateTourIntake`.

## Open follow-ups

- [ ] **Confirm the photo field name** (and name/email/phone keys) against a real
      payload, then tighten `pickKey([...])` in the webhook handler.
- [ ] **"Book a Day One"** is currently just an outcome *label*. If you want the
      button to actually create the Day One appointment (via the existing Day One
      flow) instead of only recording that it happened, that's a follow-up.
- [ ] **Desktop version** — this is mobile-first by request; a desktop view can
      reuse the same `/tour-intake` endpoints later.
