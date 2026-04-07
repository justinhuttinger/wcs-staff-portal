# WCS Admin Panel, Custom Tiles & Credential Auto-Capture — Design Spec

**Date:** 2026-04-07
**Status:** Approved
**Author:** Justin Huttinger + Claude

---

## Overview

Add an admin panel UI to the portal for managing staff and custom tiles, plus Chrome-style credential auto-capture in the Electron app. Admin-only features accessible from the portal header.

### Goals

1. Admins can create/edit/delete staff members, assign roles and locations
2. Admins can create per-location custom tool tiles
3. Staff credentials are auto-captured on first login to each platform (ABC, GHL, WhenIWork, Paychex)
4. Auto-captured credentials stored in the encrypted vault for auto-fill on subsequent logins

### Non-Goals

- No manual credential entry UI (auto-capture only)
- No role-based visibility for custom tiles (all custom tiles visible to all roles at their location)
- No credential sharing between staff

---

## 1. Custom Tiles — Database & API

### New Table: `custom_tiles`

| Column | Type | Constraints |
|--------|------|-------------|
| id | UUID | PK, default gen_random_uuid() |
| label | TEXT | NOT NULL |
| description | TEXT | |
| url | TEXT | NOT NULL |
| icon | TEXT | Emoji or icon name |
| location_id | UUID | FK -> locations(id) ON DELETE CASCADE |
| created_by | UUID | FK -> staff(id) ON DELETE SET NULL |
| created_at | TIMESTAMPTZ | DEFAULT now() |
| | | UNIQUE(url, location_id) |

### API Routes (added to `auth/src/routes/config.js`)

**GET /config/tiles?location_id=xxx**
- Auth: Bearer JWT
- If `location_id` provided: returns tiles for that location
- If no `location_id` and user is admin: returns tiles for all locations the admin is assigned to
- Used by ToolGrid (with location_id) and AdminTilesTab (without, to see all)

**POST /config/tiles**
- Auth: Bearer JWT (admin only)
- Body: `{ label, description?, url, icon?, location_id }`

**PUT /config/tiles/:id**
- Auth: Bearer JWT (admin only)
- Body: `{ label?, description?, url?, icon? }`

**DELETE /config/tiles/:id**
- Auth: Bearer JWT (admin only)

### Portal Integration

The ToolGrid merges two sources:
1. Built-in tools from `tools.json`, filtered by `visible_tools` from `/auth/me`
2. Custom tiles from `GET /config/tiles?location_id=xxx`

Custom tiles render as the same card component as built-in tools, with the emoji/icon displayed in the icon circle.

---

## 2. Admin Panel UI

### Entry Point

Admin/director sees an "Admin" button in the portal header. Clicking it sets `showAdmin = true` in App.jsx, which renders `<AdminPanel>` instead of `<ToolGrid>`. A "Back to Portal" button returns to tools.

### Admin View — Two Tabs

**Staff Tab (`AdminStaffTab.jsx`):**
- Table listing all staff at the admin's location(s)
- Columns: Name, Email, Role, Locations, Actions
- "Add Staff" button opens an inline form below the table:
  - Email (text input)
  - Display Name (text input)
  - Role (dropdown: front_desk, personal_trainer, manager, director, admin)
  - Locations (multi-select checkboxes of all 7 locations)
  - Temporary Password (text input)
  - [Create] [Cancel] buttons
- Each staff row has:
  - Edit button → inline edit of role, display name, locations
  - Delete button → confirmation prompt, then deletes

**API calls:**
- `GET /admin/staff` — list staff
- `POST /admin/staff` — create staff
- `PUT /admin/staff/:id` — update staff
- `DELETE /admin/staff/:id` — delete staff

**Tiles Tab (`AdminTilesTab.jsx`):**
- Table listing custom tiles grouped by location
- Columns: Label, URL, Location, Icon, Actions
- "Add Tile" button opens an inline form:
  - Label (text input)
  - Description (text input, optional)
  - URL (text input)
  - Icon (text input — emoji)
  - Location (dropdown of all 7 locations)
  - [Create] [Cancel] buttons
- Each tile row has Edit and Delete actions

**API calls:**
- `GET /config/tiles` — list all tiles (filter by admin's locations client-side, or add location filtering)
- `POST /config/tiles` — create tile
- `PUT /config/tiles/:id` — update tile
- `DELETE /config/tiles/:id` — delete tile

### New Components

```
portal/src/components/
├── AdminPanel.jsx        # Container: header with back button + tab switching
├── AdminStaffTab.jsx     # Staff table + add/edit forms
└── AdminTilesTab.jsx     # Tiles table + add/edit forms
```

### Styling

Follows existing portal theme: white cards, `#f4f5f7` background, `#e53e3e` accent, Inter font. Tables use `border-border` dividers. Forms match the existing login screen input styling.

---

## 3. Credential Auto-Capture

### Generic Credential Capture Preload (`launcher/src/credential-capture.js`)

Injected into every tool tab (ABC, Grow, WhenIWork, Paychex). Runs with `contextIsolation: false` for direct DOM access.

**Detection logic:**
1. On `DOMContentLoaded`, scan for `<form>` elements containing `input[type="password"]`
2. Also use MutationObserver to detect dynamically rendered login forms (SPAs)
3. When a form with a password field is found, attach a `submit` event listener
4. On submit, capture:
   - Username: the first `input[type="email"]`, `input[type="text"]`, or `input[name*="user"]` in the same form
   - Password: the `input[type="password"]` value
5. Map the current URL domain to a service name:
   - `abcfinancial.com` → `abc`
   - `gohighlevel.com` or `westcoaststrength.com` → `ghl`
   - `wheniwork.com` → `wheniwork`
   - `paychex.com` → `paychex`
   - Unknown domains → use the domain as service name
6. Send via IPC: `ipcRenderer.send('credential-captured', { service, username, password })`

### Main Process Handler (in `launcher/src/main.js`)

When `credential-captured` fires:
1. Check if user is logged in (`auth.isLoggedIn()`)
2. Check if credential already exists in cache (`auth.getCachedCredential(service)`)
3. If new credential, or username/password changed → send IPC to portal tab: `portal-view.webContents.send('show-save-prompt', { service, username })`
4. Wait for response from portal (`save-credential-response`)
5. If user clicks Save → call `POST /vault/credentials` via `auth.request()` then update cache
6. If user dismisses → do nothing

### Save Credential Toast (`portal/src/components/SaveCredentialToast.jsx`)

Rendered in App.jsx when `window.wcsElectron` receives a `show-save-prompt` event.

- Appears at the top of the viewport as a slim banner
- Shows: "Save login for [Service Name]?" with [Save] and [Not now] buttons
- Auto-dismisses after 10 seconds
- On Save → sends IPC back to main process with confirmation
- On dismiss → sends IPC with decline

### Preload Bridge Updates

**`launcher/src/portal-preload.js`** — add:
- `onSavePrompt(callback)` — registers listener for `show-save-prompt` events
- `respondSavePrompt(accepted, data)` — sends save/decline back to main process

### Tab Preload Injection (`launcher/src/tabs.js`)

Tool tabs get the `credential-capture.js` preload. The logic for which preload to use:
- Portal tab → `portal-preload.js` (contextIsolation: true)
- ABC tab → `abc-scraper.js` AND `credential-capture.js` behavior merged (contextIsolation: false)
- Other tool tabs (Grow, WhenIWork, Paychex) → `credential-capture.js` (contextIsolation: false)

Since ABC already has a preload (`abc-scraper.js`), the credential capture logic is added directly to `abc-scraper.js` rather than creating a second preload.

### Files Changed/Created

| File | Change |
|------|--------|
| `launcher/src/credential-capture.js` | NEW — generic login form detector |
| `launcher/src/abc-scraper.js` | Add credential capture (same logic as credential-capture.js) |
| `launcher/src/main.js` | Add credential-captured handler, save-prompt IPC |
| `launcher/src/tabs.js` | Inject credential-capture.js preload on non-ABC tool tabs |
| `launcher/src/portal-preload.js` | Add save-prompt IPC bridge |
| `portal/src/components/SaveCredentialToast.jsx` | NEW — toast UI |
| `portal/src/App.jsx` | Render SaveCredentialToast, listen for IPC |

---

## 4. Portal API Client Updates

Add to `portal/src/lib/api.js`:

```
GET    /admin/staff           → getStaff()
POST   /admin/staff           → createStaff(data)
PUT    /admin/staff/:id       → updateStaff(id, data)
DELETE /admin/staff/:id       → deleteStaff(id)
GET    /config/tiles          → getTiles(locationId)
POST   /config/tiles          → createTile(data)
PUT    /config/tiles/:id      → updateTile(id, data)
DELETE /config/tiles/:id      → deleteTile(id)
GET    /config/locations      → getLocations()
```

---

## 5. App.jsx Changes

- Add `showAdmin` state (boolean)
- Add "Admin" button in header (visible to admin/director roles)
- When `showAdmin` is true, render `<AdminPanel onBack={() => setShowAdmin(false)} />` instead of `<ToolGrid>`
- ToolGrid fetches custom tiles via `/config/tiles?location_id=xxx` and merges with built-in tools
- Render `<SaveCredentialToast>` when Electron sends save prompt

---

## Implementation Phases

1. **Custom tiles backend** — SQL table, API routes in config.js
2. **Admin panel UI** — AdminPanel, AdminStaffTab, AdminTilesTab components
3. **ToolGrid custom tiles** — merge built-in + custom tiles in ToolGrid
4. **API client functions** — add admin/tiles/locations helpers to api.js
5. **Credential capture preload** — credential-capture.js + abc-scraper.js update
6. **Save credential flow** — main.js handler + portal-preload bridge + SaveCredentialToast
7. **App.jsx integration** — admin button, showAdmin state, toast rendering
