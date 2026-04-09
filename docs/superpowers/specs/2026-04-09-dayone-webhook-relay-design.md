# Day One Completion Webhook Relay

**Date:** 2026-04-09
**Status:** Approved
**Scope:** ghl-sync service + auth API route + portal admin tile

## Problem

GHL's built-in automations are not reliably firing on Day One calendar events. Staff need post-appointment SMS messages sent to contacts after their Day One session completes.

## Solution

Poll GHL calendar events during each delta sync cycle, detect completed Day One appointments, and POST a webhook back to a per-location GHL workflow trigger URL. GHL workflows then handle the SMS send.

## Architecture

### Where It Lives

New module `ghl-sync/src/webhooks/dayOneWebhook.js` inside the existing ghl-sync background worker service.

### Trigger

Called at the end of each delta sync cycle in `scheduler.js` — after contacts/opportunities sync completes. No new cron job needed. Runs every ~10 minutes.

### Flow

1. For each of the 7 locations, fetch today's Day One calendar events using GHL Calendar API (`GET /calendars/events` with calendar group discovery)
2. Filter to events where `endTime < now` AND `appointmentStatus !== "cancelled"`
3. Query `ghl_dayone_webhooks` table — skip any events already successfully sent
4. For remaining events, fetch GHL users for the location (`GET /users/`) to resolve `assignedUserId` to trainer name + phone
5. POST webhook payload to that location's configured webhook URL
6. Record the result (sent/failed) in `ghl_dayone_webhooks`

### Calendar Discovery

Reuses the same logic as `dayOneTracker.js` — searches for calendars with "day one", "dayone", or "day 1" in the name (case-insensitive). Caches results per location to avoid repeated lookups.

## Database

### New Table: `ghl_dayone_webhooks`

| Column | Type | Purpose |
|--------|------|---------|
| `id` | uuid (PK) | Auto-generated, default `gen_random_uuid()` |
| `event_id` | text NOT NULL | GHL calendar event ID |
| `location_id` | text NOT NULL | GHL location ID |
| `contact_id` | text | GHL contact ID |
| `webhook_url` | text | URL that was posted to |
| `payload` | jsonb | Full payload sent |
| `status` | text NOT NULL | `sent` or `failed` |
| `error` | text | Error message if failed |
| `sent_at` | timestamptz | When the webhook fired |
| `created_at` | timestamptz | Default `now()` |

**Unique constraint** on `(event_id, location_id)` — prevents duplicate sends across restarts.

## Webhook Payload

```json
{
  "contactId": "abc123",
  "contactName": "John Smith",
  "contactEmail": "john@example.com",
  "contactPhone": "+15035551234",
  "trainerName": "Jane Trainer",
  "trainerPhone": "+15035555678",
  "appointmentId": "evt_123",
  "appointmentStart": "2026-04-09T09:00:00",
  "appointmentEnd": "2026-04-09T10:00:00",
  "locationSlug": "salem"
}
```

- `contactPhone`, `contactEmail`, `contactName` from the calendar event object
- `trainerName`, `trainerPhone` from GHL Users API (`GET /users/?locationId=...`), resolved via `assignedUserId` on the event
- `appointmentStart`/`appointmentEnd` as ISO strings

## Configuration

### Environment Variables (ghl-sync Render service)

7 new env vars — one webhook URL per location:

```
GHL_WEBHOOK_DAYONE_SALEM=https://services.leadconnectorhq.com/hooks/...
GHL_WEBHOOK_DAYONE_KEIZER=https://services.leadconnectorhq.com/hooks/...
GHL_WEBHOOK_DAYONE_EUGENE=https://services.leadconnectorhq.com/hooks/...
GHL_WEBHOOK_DAYONE_SPRINGFIELD=https://services.leadconnectorhq.com/hooks/...
GHL_WEBHOOK_DAYONE_CLACKAMAS=https://services.leadconnectorhq.com/hooks/...
GHL_WEBHOOK_DAYONE_MILWAUKIE=https://services.leadconnectorhq.com/hooks/...
GHL_WEBHOOK_DAYONE_MEDFORD=https://services.leadconnectorhq.com/hooks/...
```

**Graceful skip:** If a location's webhook URL env var is not set, skip that location with a console warning. This allows incremental rollout — one location at a time as GHL workflows are created.

### Location Config Update

`ghl-sync/src/config/locations.js` — each location object gets a `dayOneWebhookUrl` field mapped from its env var.

## Error Handling

- **POST failure** (network error, non-2xx): Record in `ghl_dayone_webhooks` with `status: 'failed'` and error message. No immediate retry.
- **Natural retry:** Next delta sync cycle (10 min later) will see the event hasn't been successfully sent and retry it. The unique constraint uses an upsert — failed rows get updated to `sent` on successful retry.
- **Logging:** Console logs for each send/failure. Optionally log to `ghl_sync_log` with `sync_type: 'dayone_webhook'`.

### Edge Cases

- **Cancelled appointments:** Skipped — `appointmentStatus === "cancelled"` events are filtered out before webhook check.
- **Service restart mid-day:** Dedup table ensures no double-sends; on restart, picks up any missed events from today.
- **No events today:** Quick no-op per location — just the calendar fetch call.
- **GHL Users API fails:** Log warning, send webhook without trainer phone (set to `null`). Contact info is still available from the event itself.

## Admin Webhook Log Tile

### Portal UI

New tile "Webhooks" in the Admin Panel under System Status section (alongside Sync Status).

**Table view:**
- Columns: Date/Time, Location, Contact Name, Trainer, Status (sent/failed), Error (if any)
- Click row to expand and show full JSON payload
- Filters: Location dropdown, status filter (all/sent/failed), date range picker
- Sorted newest first, paginated at 25 per page

**Component:** `portal/src/components/admin/WebhookLogs.jsx`

### API Route

`GET /admin/webhook-logs` on the auth API

- Query params: `location_id`, `status`, `start_date`, `end_date`, `page`, `limit`
- Returns: `{ logs: [...], total: number }`
- Role gate: manager and above
- Queries `ghl_dayone_webhooks` table in Supabase

**Route file:** `auth/src/routes/admin.js` (add to existing admin routes)

## Files Changed/Created

| File | Action | Purpose |
|------|--------|---------|
| `ghl-sync/src/webhooks/dayOneWebhook.js` | Create | Core webhook logic — fetch events, filter, send |
| `ghl-sync/src/config/locations.js` | Modify | Add `dayOneWebhookUrl` field per location |
| `ghl-sync/src/scheduler.js` | Modify | Call `dayOneWebhook.run()` after each delta sync |
| `auth/src/routes/admin.js` | Modify | Add `GET /admin/webhook-logs` endpoint |
| `portal/src/components/admin/WebhookLogs.jsx` | Create | Admin tile for viewing webhook history |
| `portal/src/components/admin/AdminPanel.jsx` | Modify | Add Webhooks tile to admin panel |

## GHL Setup Required (Manual)

For each location, Justin needs to:
1. Create a new Workflow in GHL
2. Add an "Inbound Webhook" trigger — this generates a URL
3. Build the SMS action in the workflow using the payload fields
4. Copy the webhook URL into the Render env var for that location
