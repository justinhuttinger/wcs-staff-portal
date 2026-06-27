# Tour Check-In module (standalone front-desk gym-tour app)

**Status:** standalone public app · **migrations 067 + 068 applied**.
**Updated:** 2026-06-27.

## What it does

A prospect arrives for a gym tour. A Go High Level form is filled out, which
fires a webhook to the WCS auth API. The auth API records the prospect, and a
**standalone, login-free app** (one secret URL per location) shows a **live
queue** on the iPad: profile photo, name, email, phone, and a "Ready for a tour"
badge. A staffer taps a card, picks the **tour member** who gave the tour, records
the **outcome** (and optionally books a Day One), adds notes, and the entry clears.

```
GHL form submitted
      │  (webhook, same flat payload sent to prospects-documents/ABC)
      ▼
POST /webhooks/tour-intake   ──►  tour_intakes table (status = 'ready')
      ▲                                   │
      │ poll every 20s                    │ GET /public/tour/:token
      │                                   ▼
iPad  ◄────────────  Standalone app at  /tour/:token  (no login)
                                          │  staff taps a card
                                          ▼  PATCH /public/tour/:token/intake/:id
                                  status = 'completed'  (+ outbound webhook if set)
```

## How to open it (no login)

- Each location has an **unguessable URL**: `https://<portal-host>/tour/<token>`.
- It is **not gated by login** - it opens straight to that location's queue, so it
  can live permanently on the front-desk iPad.
- Get/copy the URL in the portal under **Admin → Tour Check-In** (admin only).
  That page can also **Regenerate** the URL if a link ever leaks.
- Tabs: **Ready** (open queue) and **Completed** (history). Ready background-polls
  every 20s so new arrivals appear without a reload.

## The check-in flow (per prospect)

Tap a card, then in order:

1. **Tour member** - dropdown of that location's **active ABC employees** (A-Z),
   asked every tour. Served from `GET /public/tour/:token/employees`.
2. **Tour outcome** - one of: `Membership Sale` · `Started Trial` ·
   `Started VIP Pass` · `Only Tour`.
3. **Book Day One** - opens that location's Day One calendar in an in-app overlay,
   pre-filled with the prospect's name/email/phone (and the selected tour member).
   An **"Open in new tab"** link is always present as a fallback in case the
   calendar host blocks iframe embedding.
4. **Notes**.
5. **Save** - marks the intake completed and (if configured) fires the location's
   outbound webhook.

## Admin (portal: Admin → Tour Check-In, admin only)

Per location:
- **Check-in app URL** - copyable (with a "Copied!" confirmation) + **Regenerate**.
- **Day One base calendar link** - the GHL booking link prefill is appended to.
- **Outbound webhook URL** - optional; called when an outcome is saved.

Backed by `GET/PUT /admin/tour-locations` + `POST /admin/tour-locations/:id/regenerate-token`.

## Data model

- **`tour_location_config`** (migration 068): `location_id` (PK), `public_token`
  (unique, the secret URL), `webhook_url`, `day_one_base_url`, `active`, timestamps.
  Seeded with a token per location. RLS enabled, no policy (service-role only).
- **`tour_intakes`** (migration 067, + `tour_member` added in 068): the queue rows.
  Webhook inserts `status='ready'`; the public PATCH sets `tour_member`, `outcome`,
  `notes`, `status='completed'`, `completed_at`. `completed_by` stays null (no login).

## Webhook contract (inbound, GHL → us)

`POST /webhooks/tour-intake` reads the flat GHL payload (same shape as the day-one
webhook). Tolerant of field-name variants; the prospect photo arrives under the GHL
key **`Member Profile Photo`** as a bare base64 JPEG (confirmed live). The auth
service registers a 6 MB JSON parser for this path so the base64 photo fits.

## Public API (auth service, NO login, gated by `:token`)

| Method & path | Purpose |
|---|---|
| `GET /public/tour/:token` | Location name, Day One link, ready + completed queues |
| `GET /public/tour/:token/employees` | Active ABC employees for the club, A-Z |
| `PATCH /public/tour/:token/intake/:id` | Save outcome, complete, fire webhook |

Every endpoint resolves the token to a single location and is scoped to it; a token
never exposes or mutates another location's data.

## Outbound webhook payload (on outcome save)

```json
{ "location_id": "...", "location_name": "...", "intake_id": "...",
  "contact_name": "...", "contact_email": "...", "contact_phone": "...",
  "tour_member": "...", "outcome": "...", "notes": "...", "completed_at": "..." }
```

## Known-unknowns to verify against real data

- **Day One team-member prefill** - GHL reliably honors `first_name/last_name/
  email/phone`; the team-member param name varies. Confirm against a real Day One
  link once entered in the admin page; adjust `team_member` in
  `portal/src/lib/dayOnePrefill.js` if GHL uses a different field.
- **iframe embedding** - if a calendar refuses to embed, the "Open in new tab"
  fallback is always available.

## Files

**Backend (`auth/`)**
- `migrations/067_tour_intakes.sql`, `migrations/068_tour_location_config.sql`
- `src/routes/webhooks.js` - inbound `POST /webhooks/tour-intake`
- `src/routes/publicTour.js` - public token-gated queue + employees + save
- `src/routes/tourAdmin.js` - admin per-location config
- `src/config/clubMap.js` - location name → ABC club number
- `src/lib/tourWebhook.js` - outbound webhook payload builder
- `src/index.js` - mounts `/public/tour` and `/admin/tour-locations`

**Frontend (`portal/`)**
- `src/tour/TourCheckinApp.jsx` - the standalone app (route `/tour/:token`)
- `src/App.jsx` - public route short-circuit before the auth gate
- `src/lib/dayOnePrefill.js` - Day One calendar prefill URL builder
- `src/lib/api.js` - `publicTour` (no-auth) + `tourAdmin` helpers
- `src/components/admin/TourCheckinLocations.jsx` - admin page
- (removed) the old in-portal mobile Tour Check-In tile
