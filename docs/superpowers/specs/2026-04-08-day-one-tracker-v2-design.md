# Day One Tracker v2 — Design Spec

**Date:** 2026-04-08  
**Scope:** New "Day One Tracker" tile — pulls appointments from GHL "Day One" calendar, trainers fill in outcomes, writes results back to GHL contact custom fields

---

## Overview

A new portal tile that lets trainers see their upcoming and past Day One appointments pulled directly from GHL, mark outcomes (show/no-show → sale/no-sale → details), and write those results back to the GHL contact's custom fields. Built as a separate tile alongside the existing "Day One" for A/B testing.

---

## 1. Data Flow

```
GHL Calendar API ──GET──→ Auth API ──→ Portal UI (trainer sees appointments)
                                            │
                                     trainer fills outcome
                                            │
                                            ▼
                          Auth API ──PUT──→ GHL Contacts API (update custom fields)
```

No local database storage — appointments are fetched live from GHL each time. Results are written directly to GHL contact custom fields.

---

## 2. Backend: Auth API Routes

New route file: `auth/src/routes/dayOneTracker.js`

### GET /day-one-tracker/appointments

Pulls events from the GHL Calendar API for the "Day One" calendar group.

**Query params:**
- `location_slug` (required) — which location's GHL to query
- `start_date`, `end_date` — date range (defaults to current month)

**Logic:**
1. Look up location's GHL API key from env vars (same pattern as ghl-sync)
2. Call GHL API: `GET /calendars/events` with params:
   - `locationId` = GHL location ID
   - `calendarId` or `groupId` = "Day One" calendar group (need to discover the calendar ID first via `GET /calendars/` and filter by group name)
   - `startTime`, `endTime` = ISO date range
3. For each event, extract: contact name, contact ID, appointment time, assigned staff (calendar user), status
4. **Role filtering:**
   - `manager` and above: return ALL appointments
   - Below manager: filter to only appointments where the assigned user's email matches `req.staff.email`
5. Return sorted by appointment time (most recent first)

**Response:**
```json
{
  "appointments": [
    {
      "id": "ghl_event_id",
      "contact_id": "ghl_contact_id",
      "contact_name": "John Smith",
      "contact_email": "john@example.com",
      "appointment_time": "2026-04-08T10:00:00Z",
      "assigned_user": "trainer@wcs.com",
      "assigned_user_name": "Mike Johnston",
      "status": "confirmed",
      "day_one_status": "Completed",
      "day_one_sale": "Sale"
    }
  ]
}
```

The `day_one_status` and `day_one_sale` fields come from the contact's existing custom fields (fetched alongside), so the UI can show which ones are already filled in vs pending.

### POST /day-one-tracker/submit

Writes Day One outcome back to the GHL contact's custom fields.

**Body:**
```json
{
  "contact_id": "ghl_contact_id",
  "location_slug": "salem",
  "show_no_show": "Show",
  "sale_result": "Sale",
  "pt_sale_type": "3 Month PT",
  "why_no_sale": null
}
```

**Logic:**
1. Look up location's GHL API key
2. Look up the custom field IDs for this location from `ghl_custom_field_defs` table (field_key → ID mapping):
   - `contact.day_one_status` → "Completed" (if Show) or "No Show"
   - `contact.show_or_no_show` → "Show" or "No Show"
   - `contact.day_one_sale` → "Sale" or "No Sale" (only if Show)
   - `contact.pt_sale_type` → value from dropdown (only if Sale)
   - `contact.why_no_sale` → value from dropdown (only if No Sale)
3. Call GHL API: `PUT /contacts/:contactId` with `customFields` array
4. Return success/failure

**Auth:** Requires authentication. Any staff role can submit for their own appointments. Managers can submit for any.

### GET /day-one-tracker/field-options

Returns the dropdown options for PT sale types and no-sale reasons.

**Query params:** `location_slug`

**Logic:** Query `ghl_custom_field_defs` for fields with keys `contact.pt_sale_type` and `contact.why_no_sale` at this location. Return their `picklistOptions`.

**Response:**
```json
{
  "pt_sale_types": ["3 Month PT", "6 Month PT", "12 Month PT"],
  "no_sale_reasons": ["Not interested", "Price", "Wants to think about it"]
}
```

---

## 3. GHL API Details

**Base URL:** `https://services.leadconnectorhq.com`  
**Auth:** Bearer token (per-location API key, same as ghl-sync)  
**Version header:** `2021-07-28`

**Endpoints used:**
- `GET /calendars/` — list calendars to find "Day One" calendar IDs
- `GET /calendars/events` — get events for a calendar
- `GET /contacts/:id` — get contact's current custom field values
- `PUT /contacts/:id` — update contact's custom fields

**Rate limiting:** Same as ghl-sync client — retry on 429, sleep 650ms between calls.

**API key source:** The auth API needs the same per-location GHL API keys as ghl-sync. Add them to the auth API's environment variables on Render:
- `GHL_API_KEY_SALEM`, `GHL_API_KEY_KEIZER`, etc.
- `GHL_LOCATION_SALEM`, `GHL_LOCATION_KEIZER`, etc.

Create a shared config module: `auth/src/config/ghlLocations.js` (same structure as `ghl-sync/src/config/locations.js`).

---

## 4. Frontend: DayOneTrackerView

New component: `portal/src/components/DayOneTrackerView.jsx`

### Layout

**Header:** "Day One Tracker" with back button, location selector (pill tabs), date range picker

**Appointment List:** Cards showing:
- Contact name
- Appointment date/time
- Assigned trainer name
- Status badge: Pending (yellow), Completed (green), No Show (red)

**Managers see:** All trainers' appointments + trainer name on each card  
**Trainers see:** Only their own appointments

### Outcome Flow (modal/overlay)

When trainer clicks a pending card:

**Step 1 — Show or No Show?**
Two large buttons: "Show" (green) / "No Show" (red)

If No Show → submits immediately with `show_no_show: "No Show"` → card turns red → done.

**Step 2 — Sale or No Sale?** (only if Show)
Two large buttons: "Sale" (green) / "No Sale" (gray)

**Step 3a — What did they sell?** (only if Sale)
Dropdown of PT sale types (from `/field-options` endpoint). Submit button.

**Step 3b — Why no sale?** (only if No Sale)
Dropdown of no-sale reasons (from `/field-options` endpoint). Submit button.

On submit → calls `POST /day-one-tracker/submit` → card updates to show result.

---

## 5. Portal Integration

### ToolGrid tile

Add a new hardcoded tile in `ToolGrid.jsx` (like Day One and Tours):
- Label: "Day One Tracker"
- Icon: clipboard/checkmark emoji
- Click handler: `onDayOneTracker()`
- Visible to: `personal_trainer` role and above

### App.jsx

Add `showDayOneTracker` state, render `DayOneTrackerView` when active.

---

## 6. Role-Based Access

| Role | Can See | Can Submit |
|------|---------|------------|
| front_desk | — (no tile) | — |
| personal_trainer | Own appointments only | Own only |
| lead | Own appointments only | Own only |
| manager | ALL appointments | Any |
| director | ALL appointments | Any |
| admin | ALL appointments | Any |

---

## 7. Files

### New files
| File | Purpose |
|------|---------|
| `auth/src/routes/dayOneTracker.js` | 3 endpoints: appointments, submit, field-options |
| `auth/src/config/ghlLocations.js` | Shared GHL location config (API keys from env) |
| `portal/src/components/DayOneTrackerView.jsx` | Main tracker view with appointment list |

### Modified files
| File | Change |
|------|--------|
| `auth/src/index.js` | Register `/day-one-tracker` routes |
| `portal/src/lib/api.js` | Add `getDayOneAppointments`, `submitDayOneResult`, `getDayOneFieldOptions` |
| `portal/src/App.jsx` | Add `showDayOneTracker` state + conditional render |
| `portal/src/components/ToolGrid.jsx` | Add Day One Tracker tile |

### Render env vars needed (auth API)
- `GHL_API_KEY_SALEM` through `GHL_API_KEY_MEDFORD` (7 keys)
- `GHL_LOCATION_SALEM` through `GHL_LOCATION_MEDFORD` (7 location IDs)
