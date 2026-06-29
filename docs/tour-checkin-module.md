# Tour Check-In module (standalone front-desk gym-tour app)

**Status:** live · standalone public app · migrations **067, 068, 069** applied.
**Updated:** 2026-06-27.

## What it does

A prospect arrives for a gym tour and a Go High Level survey is submitted, which
fires a webhook to the WCS auth API. The auth API records the prospect, and a
**standalone, login-free app** (one secret URL per location) shows a **live
queue** on the front-desk iPad: profile photo, name, email, phone, "Ready for a
tour" badge. A staffer taps a card, picks the **tour member** who gave the tour,
records the **outcome** (and optionally books a Day One), adds notes, and saves.
On save the entry is sent out via the location's **outbound webhook** and then
**deleted** - the iPad is a transient live queue, not a record store.

New arrivals are surfaced three ways: a 2s queue poll (while open), an in-app
**chime + flashing banner** (while open), and **Web Push** (even when the app is
closed or the iPad is locked).

```
GHL "Survey Submitted" webhook
      │  (flat payload, same shape sent to prospects-documents/ABC)
      ▼
POST /webhooks/tour-intake  ──►  tour_intakes (status='ready')  ──►  Web Push to the location's iPads
      ▲                                  │
      │ poll every 2s                    │ GET /public/tour/:token
      │                                  ▼
iPad  ◄──────────  Standalone app at  /tour.html?token=<token>  (no login)
                                         │  staff taps a card, records outcome
                                         ▼  PATCH /public/tour/:token/intake/:id
                                  fire outbound webhook, then DELETE the row
```

## How to open it (no login)

- Each location has an **unguessable URL**: `https://<portal-host>/tour.html?token=<token>`.
  (It is a physical Vite entry `tour.html` with the token in the query string, NOT
  a path route - the static host doesn't apply the SPA catch-all, so path routes
  like `/tour/:token` 404. See PR #372.)
- **Not gated by login** - opens straight to that location's queue, so it can live
  permanently on the front-desk iPad.
- Get/copy the URL in the portal under **Admin → Tour Check-In** (admin only); that
  page can also **Regenerate** the URL if a link ever leaks.
- The queue background-polls every **2s**; there is **no Completed tab** (completed
  tours are deleted, see lifecycle above).

## The check-in flow (per prospect)

Tap a card, then in order:

1. **Tour member** - dropdown sourced from the location's GHL **"Day One Booking
   Team Member"** custom-field options (`GET /public/tour/:token/employees`), which
   ghl-sync keeps in sync from the live ABC per-club roster. Falls back to the
   `abc_employees` table. (PR #373 - the table is deduped one-row-per-employee so
   multi-club people like owners are dropped from some clubs; the GHL field is the
   source of truth.) Asked every tour.
2. **Tour outcome** - one of: `Membership Sale` · `Started Trial` · `Started VIP
   Pass` · `Only Tour`.
3. **Book Day One** - opens the location's Day One calendar in an in-app overlay,
   prefilled with the prospect's name/email/phone and the selected tour member
   (`contact.day_one_booking_team_member`). An **"Open in new tab"** fallback is
   always present in case the calendar host blocks iframe embedding.
4. **Notes**.
5. **Save** - fires the location's outbound webhook (if configured) and deletes the row.

## Notifications (new-arrival alerting)

The iPad is alerted to a new tour in three complementary ways:

- **2s poll** - the queue refreshes and the new card appears. Only runs while the
  app is open and foregrounded.
- **In-app chime + flash banner** (PR #380) - when a new row appears, a loud
  two-tone chime plays (twice) and a big red "🔔 \<name\> just checked in" banner
  drops down for 6s. **Audio is unlocked on the first touch** because iOS blocks
  audio started outside a user gesture - so tap the iPad once after loading. This
  is the primary alert for the usual case (kiosk app left open).
- **Web Push** (PR #379) - when the GHL webhook creates a row, the server pushes a
  notification to every subscription registered for that location, so staff are
  alerted **even when the app is closed or the screen is locked**.

### iOS Web Push requirements (Apple constraints, not code)

- Works only for a **Home Screen web app** on **iOS/iPadOS 16.4+**. Per iPad,
  one-time: open the tour URL in Safari → Share → **Add to Home Screen** → open it
  from the new icon → tap **Enable alerts**. The app shows Add-to-Home-Screen
  guidance until installed, then an "Enable alerts" button.
- iOS will **not** pop a notification *banner* while the web app is in the
  **foreground** (it delivers quietly) - which is why the in-app chime/flash exist.
- For banner + sound when the app is closed/locked, the iPad's Settings →
  Notifications for the installed app must have Sounds + Banners on, device not silenced.
- `apple-mobile-web-app-capable` (in `tour.html`) makes iOS use the current
  `?token=` URL as the Home Screen start URL and run standalone. There is no W3C
  manifest by design (would lose the per-location token).

## Admin (portal: Admin → Tour Check-In, admin only)

Per location:
- **Check-in app URL** - copyable (with "Copied!" confirmation) + **Regenerate**.
- **Day One base calendar link** - the prefill is appended to this.
- **Outbound webhook URL** - optional; called when an outcome is saved.

Backed by `GET/PUT /admin/tour-locations` + `POST /admin/tour-locations/:id/regenerate-token`.
Gotcha (PR #371): `tour_location_config.public_token` is NOT NULL no-default, so an
upsert that omits it 500s even with ON CONFLICT - the admin PUT must always carry it.

## Data model

- **`tour_location_config`** (migration 068): `location_id` (PK), `public_token`
  (unique secret URL), `webhook_url`, `day_one_base_url`, `active`, timestamps.
- **`tour_intakes`** (migration 067 + `tour_member` in 068): the queue rows. Webhook
  inserts `status='ready'` with `ghl_contact_id`, name/email/phone, `photo_base64`
  (base64 data URL), `location_id`, `raw`. Completed rows are deleted (no history kept).
- **`tour_push_subscriptions`** (migration 069): one row per subscribed iPad -
  `location_id` (FK, cascade), `endpoint` (unique), `p256dh`, `auth`, timestamps.
- All three: RLS enabled, **no policy** (service-role only, per repo convention).

## Inbound webhook (GHL → us)

`POST /webhooks/tour-intake` reads the flat GHL payload (same shape as the day-one
webhook); tolerant of field-name variants. The prospect photo arrives under the GHL
key **`Member Profile Photo`** as a bare base64 JPEG (PR #369); `normalizePhoto`
prefixes it as a data URL. The auth service registers a 6 MB JSON parser for this
path. After inserting the row it fires `sendTourArrival()` (fire-and-forget push).

> **Note:** an earlier "prefire" experiment (fire the webhook + a separate base64
> photo from the survey page in the browser *before* submit, for speed-to-lead) was
> built (#374) then **discontinued and reverted** (#377). The row is now created
> only by the GHL "Survey Submitted" webhook. CORS for `wcs<loc>.app` survey
> origins, the `/webhooks/tour-intake-photo` endpoint, and the email/phone dedup
> were all removed.

## Public API (auth service, NO login, gated by `:token`)

| Method & path | Purpose |
|---|---|
| `GET /public/tour/:token` | Location name, Day One link, `vapid_public_key`, ready queue |
| `GET /public/tour/:token/employees` | Tour-member options (GHL field, A-Z) |
| `PATCH /public/tour/:token/intake/:id` | Save outcome → fire webhook → delete row |
| `POST /public/tour/:token/subscribe` | Register this iPad's Web Push subscription |

Every endpoint resolves the token to one location and is scoped to it.

## Outbound webhook payload (on outcome save)

```json
{ "location_id": "...", "location_name": "...", "intake_id": "...",
  "contact_id": "...", "contact_name": "...", "contact_email": "...",
  "contact_phone": "...", "tour_member": "...", "outcome": "...",
  "notes": "...", "completed_at": "..." }
```

`contact_id` is the GHL contact id (added in #377) so downstream automation can act
on the contact. The photo is intentionally **not** included.

## Deploy / config

- Auth service env (Render): `GHL_WEBHOOK_SECRET` (inbound `?secret=`), and for push
  **`VAPID_PUBLIC_KEY` / `VAPID_PRIVATE_KEY` / `VAPID_SUBJECT`** (mailto:). Push
  no-ops cleanly if VAPID keys are absent. Generate a keypair with web-push or the
  P-256 snippet used on 2026-06-27.
- Dependency: `web-push` in `auth/`. **The repo uses pnpm** (pnpm-lock.yaml is
  canonical); add deps with `pnpm install --lockfile-only` to update the lockfile.
- Render auto-deploys auth + portal on merge to master.

## Files

**Backend (`auth/`)**
- `migrations/067_tour_intakes.sql`, `068_tour_location_config.sql`, `069_tour_push_subscriptions.sql`
- `src/routes/webhooks.js` - inbound `POST /webhooks/tour-intake` (+ fires push)
- `src/routes/publicTour.js` - public token-gated queue, employees, save (delete), subscribe
- `src/routes/tourAdmin.js` - admin per-location config
- `src/lib/tourWebhook.js` - outbound webhook payload builder (incl. `contact_id`)
- `src/lib/tourPush.js` - Web Push send (web-push + VAPID); prunes dead subs
- `src/config/clubMap.js` - location name → ABC club number
- `src/config/ghlLocations.js` - `getLocationBySlug` (GHL id + apiKey per location)

**Frontend (`portal/`)**
- `src/tour/TourCheckinApp.jsx` - the standalone app (queue, outcome modal, push enable, chime/flash)
- `src/tour/main.jsx` - entry; registers the service worker
- `tour.html` - physical Vite entry (apple PWA meta tags)
- `public/sw.js` - service worker (push + notificationclick), served at `/sw.js`
- `src/lib/dayOnePrefill.js` - Day One calendar prefill URL builder
- `src/lib/api.js` - `publicTour` (no-auth: get/employees/saveOutcome/subscribe) + `tourAdmin`
- `src/components/admin/TourCheckinLocations.jsx` - admin page

## Change history (PRs)

- #368 original in-portal mobile tile · #369 photo key fix · #370 standalone app
- #371 admin save fix · #372 `/tour.html` entry (404 fix) · #373 tour-member from GHL field
- #374 prefire experiment (merged) → **#377 reverted it** + forwards `contact_id`
- #375 poll 5s → #378 poll 2s · #379 iPad Web Push · #380 in-app chime + flash

---

## Next / future work (not built yet)

### Fast ABC lookup of the tour contact
**Goal:** when a prospect checks in (or while touring), let staff **quickly search
our ABC database for that contact** - to see if they're already in ABC (existing
member, former member, or an already-created prospect) and surface their info,
right from the tour card.

**Why:** the front desk wants to know immediately whether the walk-in already
exists in ABC before/while giving the tour (avoid duplicate prospects, recognize a
returning member, pull history).

**Suggested approach (to design when we pick this up):**
- **Fast path:** search the **already-synced `abc_members` Supabase table** by
  email → phone → name (it's local, so it's instant). This is almost certainly the
  right "fast" answer the request is asking for. May also check `abc_employees`
  / prospects depending on what we've synced.
- **Live path (fallback / on-demand):** call the ABC API for a fresh lookup if the
  member isn't in the synced table or we need live detail. ABC client lives in
  `ghl-sync` (see `reference_*` ABC memories for club codes, field shapes,
  pacific-time and dedupe gotchas).
- **UI:** a "Look up in ABC" action on the tour card (and/or auto-match on arrival),
  showing match status + key fields (member id, status, dues, tenure, last visit).
- **Open questions for next session:** exactly which ABC fields to show; auto-match
  vs manual search; whether to link the tour intake to the matched ABC member id;
  whether this lives in the standalone iPad app (no login) or a separate view.

Start the next session with the `brainstorming` skill on this section.
