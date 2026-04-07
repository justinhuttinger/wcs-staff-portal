# WCS Auth Service, Credential Vault & SSO — Design Spec

**Date:** 2026-04-07
**Status:** Approved
**Author:** Justin Huttinger + Claude

---

## Overview

Add authentication, role-based tool visibility, an encrypted credential vault, and cross-machine SSO to the WCS Staff Portal. This introduces a new Node/Express API service (`auth/`) backed by Supabase (Postgres + Auth), deployed as a separate Render web service alongside the existing static portal.

### Goals

1. Staff log into the Electron kiosk app with email/password
2. Roles control which tools are visible on the portal
3. Admins pre-load third-party credentials (ABC, GHL, WhenIWork, Paychex) into an encrypted vault
4. Electron auto-fills login forms using server-decrypted credentials — never stores raw creds
5. Staff can log into any kiosk at their assigned location(s) and get their tools + credentials
6. Admins configure kiosk location + ABC URL through the app

### Non-Goals

- No location switcher UI — location is machine-level, set by admin
- No RBAC on actions (roles only control tool visibility for now)
- No email-based onboarding flows — admin creates accounts directly
- No key rotation (design supports it, not built initially)

---

## Architecture

```
┌────────────────┐    HTTPS    ┌────────────────┐    SQL     ┌──────────────┐
│  Electron App  │◄──────────►│  wcs-auth-api  │◄─────────►│   Supabase   │
│  (launcher/)   │            │  (auth/)        │           │  (Postgres)  │
└───────┬────────┘            │  Node/Express   │           └──────────────┘
        │                     │  on Render      │
        │ loads               └────────────────┘
        ▼                            ▲
┌────────────────┐    HTTPS          │
│  Portal React  │──────────────────┘
│  (portal/)     │
└────────────────┘
```

- **Portal** remains a static Vite/React site on Render — now with login screen and tool filtering
- **Auth API** is a new Express service on Render — handles auth, vault, admin, config
- **Supabase** provides Postgres (data) + Auth (password hashing, JWT issuance)
- **Electron** calls the auth API, stores JWT in memory, passes decrypted creds to preloads

---

## Database Schema

### `locations`

| Column | Type | Constraints |
|--------|------|-------------|
| id | UUID | PK, default gen_random_uuid() |
| name | TEXT | UNIQUE NOT NULL |
| abc_url | TEXT | NOT NULL |
| booking_url | TEXT | |
| vip_survey_url | TEXT | |
| created_at | TIMESTAMPTZ | DEFAULT now() |

Seeded with: Salem, Keizer, Eugene, Springfield, Clackamas, Milwaukie, Medford.

### `staff`

| Column | Type | Constraints |
|--------|------|-------------|
| id | UUID | PK, references auth.users(id) |
| email | TEXT | UNIQUE NOT NULL |
| display_name | TEXT | NOT NULL |
| role | TEXT | NOT NULL, CHECK (role IN ('front_desk', 'personal_trainer', 'manager', 'director', 'admin')) |
| must_change_password | BOOLEAN | DEFAULT true |
| created_at | TIMESTAMPTZ | DEFAULT now() |
| updated_at | TIMESTAMPTZ | DEFAULT now() |

Linked 1:1 with Supabase Auth's `auth.users`. Supabase handles password hashing and JWT issuance; this table adds role + profile.

### `staff_locations`

| Column | Type | Constraints |
|--------|------|-------------|
| id | UUID | PK, default gen_random_uuid() |
| staff_id | UUID | FK -> staff(id) ON DELETE CASCADE |
| location_id | UUID | FK -> locations(id) ON DELETE CASCADE |
| is_primary | BOOLEAN | DEFAULT false |
| created_at | TIMESTAMPTZ | DEFAULT now() |
| | | UNIQUE(staff_id, location_id) |

Junction table for multi-location staff assignment.

### `credential_vault`

| Column | Type | Constraints |
|--------|------|-------------|
| id | UUID | PK, default gen_random_uuid() |
| staff_id | UUID | FK -> staff(id) ON DELETE CASCADE |
| service | TEXT | NOT NULL (abc, ghl, wheniwork, paychex) |
| encrypted_username | TEXT | NOT NULL |
| encrypted_password | TEXT | NOT NULL |
| location_id | UUID | FK -> locations(id), NULLABLE (some creds are global) |
| created_at | TIMESTAMPTZ | DEFAULT now() |
| updated_at | TIMESTAMPTZ | DEFAULT now() |
| | | UNIQUE(staff_id, service, location_id) |

Credentials encrypted with AES-256-GCM server-side. `location_id` is nullable for services that aren't location-specific (e.g. personal Paychex login).

### `role_tool_visibility`

| Column | Type | Constraints |
|--------|------|-------------|
| id | UUID | PK, default gen_random_uuid() |
| role | TEXT | NOT NULL, same CHECK as staff.role |
| tool_key | TEXT | NOT NULL (grow, abc, wheniwork, paychex, gmail, drive) |
| visible | BOOLEAN | DEFAULT true |
| | | UNIQUE(role, tool_key) |

Seed with all tools visible for all roles. Admin adjusts as needed.

---

## Auth Service API

### Project Structure

```
auth/
├── package.json
├── .env.example
├── src/
│   ├── index.js              # Express app setup, middleware, listen
│   ├── middleware/
│   │   ├── auth.js           # JWT verification via Supabase
│   │   └── role.js           # requireRole('manager') factory
│   ├── routes/
│   │   ├── auth.js           # /auth/login, /auth/change-password, /auth/me
│   │   ├── vault.js          # /vault/credentials CRUD
│   │   ├── admin.js          # /admin/staff CRUD
│   │   └── config.js         # /config/locations, /config/tools
│   ├── services/
│   │   ├── vault.js          # encrypt/decrypt + credential CRUD
│   │   └── supabase.js       # Supabase client init
│   └── utils/
│       └── crypto.js         # AES-256-GCM encrypt/decrypt
└── seed/
    └── seed.js               # Seed locations + role_tool_visibility
```

### Dependencies

```
express, cors, @supabase/supabase-js, dotenv
```

No ORM, no passport, no extra crypto libs. Node's built-in `crypto` handles encryption.

### Environment Variables

```
SUPABASE_URL                # Supabase project URL
SUPABASE_SERVICE_ROLE_KEY   # For admin user creation
SUPABASE_JWT_SECRET         # For token verification
VAULT_ENCRYPTION_KEY        # AES-256 key, 32 bytes hex
PORT                        # Render assigns this
```

### Routes

#### Auth Routes

**POST /auth/login**
- Body: `{ email, password }`
- Calls Supabase Auth `signInWithPassword`
- Returns: `{ token, staff: { id, email, display_name, role, locations }, must_change_password }`
- Public (no auth required)

**POST /auth/change-password**
- Auth: Bearer JWT
- Body: `{ new_password }`
- Updates password via Supabase Auth, sets `must_change_password = false`

**GET /auth/me**
- Auth: Bearer JWT
- Returns: `{ staff profile, role, locations, visible_tools }`
- Used by Electron on launch to validate stored token

#### Vault Routes

**GET /vault/credentials**
- Auth: Bearer JWT
- Query: `?service=abc&location_id=xxx` (optional filters)
- Returns decrypted credentials belonging to authenticated user only

**POST /vault/credentials**
- Auth: Bearer JWT
- Body: `{ staff_id, service, username, password, location_id? }`
- If `staff_id` matches authenticated user: any role allowed
- If `staff_id` differs from authenticated user: director+ required
- Enforced in route handler, not middleware

**PUT /vault/credentials/:id**
- Auth: Bearer JWT
- Same ownership rules: own credentials = any role, other staff's credentials = director+

**DELETE /vault/credentials/:id**
- Auth: Bearer JWT (admin/director only)

#### Admin Routes

**GET /admin/staff**
- Auth: Bearer JWT (manager+)
- Returns staff at caller's location(s)

**POST /admin/staff**
- Auth: Bearer JWT (director+)
- Body: `{ email, display_name, role, location_ids, temp_password }`
- Creates Supabase Auth user + staff record + location assignments

**PUT /admin/staff/:id**
- Auth: Bearer JWT (director+)
- Body: `{ role?, location_ids?, display_name? }`

**DELETE /admin/staff/:id**
- Auth: Bearer JWT (admin only)

#### Config Routes

**GET /config/locations**
- Auth: Bearer JWT
- Returns all locations

**PUT /config/locations/:id**
- Auth: Bearer JWT (admin only)
- Body: `{ abc_url?, booking_url?, vip_survey_url? }`

**GET /config/tools**
- Auth: Bearer JWT
- Returns tools filtered by caller's role visibility

### Middleware

**Auth middleware:** Verifies JWT using Supabase JWT secret. Queries `staff` + `staff_locations` to attach `req.staff = { id, role, location_ids }` to all requests.

**Role middleware:** Factory function `requireRole('manager')` that checks `req.staff.role` against hierarchy: `front_desk < personal_trainer < manager < director < admin`. Each level includes all permissions below it.

---

## Vault Encryption

### Algorithm: AES-256-GCM

- Authenticated encryption (confidentiality + integrity)
- Built into Node.js `crypto` module — no external dependencies
- Random 16-byte IV per encryption — same plaintext produces different ciphertext each time

### Encrypt/Decrypt Flow

```
Encrypt:
  1. Generate random 16-byte IV
  2. Create cipher with VAULT_ENCRYPTION_KEY + IV
  3. Encrypt plaintext → ciphertext + authTag (16 bytes)
  4. Store as base64(IV + authTag + ciphertext)

Decrypt:
  1. Decode base64 → extract IV (bytes 0-15) + authTag (bytes 16-31) + ciphertext (rest)
  2. Create decipher with VAULT_ENCRYPTION_KEY + IV
  3. Set authTag
  4. Decrypt → plaintext
```

### What Gets Encrypted

- `credential_vault.encrypted_username` — yes (could be email/ID)
- `credential_vault.encrypted_password` — yes
- All other fields (service, location_id, staff.email, staff.display_name) — no (needed for queries)

### Key Rotation (Future)

Design supports adding `key_version` column to `credential_vault`. Not built initially.

---

## Electron Integration

### Login Flow

1. App launches → shows login screen (BrowserView with login form)
2. Staff enters email + password → Electron main process calls `POST /auth/login`
3. On success: JWT + staff profile stored in main process memory (never disk)
4. If `must_change_password`: show password change screen before proceeding
5. Portal loads, calls `/auth/me` to get visible tools
6. Main process calls `/vault/credentials` to pre-fetch credentials

### Auto-Fill Flow

1. Staff clicks tool (e.g. "ABC Financial") → main process opens tab
2. Main process retrieves cached credentials for that service
3. Credentials passed to preload script via IPC
4. Preload watches for login form, fills username/password, submits
5. Credentials discarded from preload memory after fill

### Session Lifecycle

- JWT in memory only — app restart requires re-login
- Existing 10-min idle timer → triggers logout (clear JWT, return to login screen)
- Explicit logout button in portal header → same behavior

### Kiosk Configuration (Admin Only)

- Admin sees gear icon in portal header
- Can set location + ABC URL for this machine
- Stored in `C:\WCS\config.json` (replaces `abc-url.txt`)
- Machine-level config, persists across user logins

### Changes to Existing Files

| File | Change |
|------|--------|
| `launcher/src/main.js` | Add login window, JWT state, auth IPC handlers, logout on idle |
| `launcher/src/config.js` | Read `C:\WCS\config.json` (replaces `abc-url.txt`), add API base URL |
| `launcher/src/abc-scraper.js` | Add credential receive via IPC, auto-fill login forms |
| `portal/src/App.jsx` | Add login state, tool filtering by visibility, logout button |
| `portal/src/config/tools.json` | Add `key` field to each tool for visibility matching |

### New Files

| File | Purpose |
|------|---------|
| `launcher/src/auth.js` | Auth module — login, token storage, API calls |
| `portal/src/components/LoginScreen.jsx` | Email/password login form |
| `portal/src/components/AdminConfig.jsx` | Location + ABC URL config (admin only) |

---

## Render Deployment

- **Portal:** Static site (existing) — build from `portal/`, publish `dist/`
- **Auth API:** New web service — root directory `auth/`, start command `node src/index.js`
- Both services in the same GitHub repo, Render auto-detects root directory per service

---

## Seed Data

The seed script (`auth/seed/seed.js`) pre-populates:

1. **7 locations** with their ABC, booking, and VIP survey URLs (sourced from current `config.js` and `locations.js`)
2. **role_tool_visibility defaults** — all tools visible for all roles initially
3. **One admin account** — initial admin user for bootstrapping

---

## Implementation Phases

This spec covers a single cohesive system, but implementation should be phased:

1. **Phase 1: Auth API + DB** — Express service, Supabase schema, auth routes, seed data
2. **Phase 2: Vault** — encryption module, vault routes, credential CRUD
3. **Phase 3: Admin** — staff management routes, admin panel in portal
4. **Phase 4: Electron login** — login flow, JWT storage, session lifecycle
5. **Phase 5: Auto-fill** — vault integration in Electron, preload credential injection
6. **Phase 6: Kiosk config** — admin location/ABC URL config in Electron
