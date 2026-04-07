# WCS Auth Service, Credential Vault & SSO — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add authentication, role-based tool visibility, encrypted credential vault, and cross-machine SSO to WCS Staff Portal.

**Architecture:** New Node/Express API service (`auth/`) in the same repo, backed by Supabase (Postgres + Auth). Portal gets a login screen and tool filtering. Electron gets login flow and auto-fill via IPC.

**Tech Stack:** Node.js, Express, Supabase (Postgres + Auth), AES-256-GCM (Node crypto), React 19, Electron 33, Tailwind 4

**Spec:** `docs/superpowers/specs/2026-04-07-auth-vault-sso-design.md`

---

## File Structure

### New Files

```
auth/
├── package.json
├── .env.example
├── src/
│   ├── index.js                  # Express app entry point
│   ├── middleware/
│   │   ├── auth.js               # JWT verification, attaches req.staff
│   │   └── role.js               # requireRole() factory
│   ├── routes/
│   │   ├── auth.js               # POST /auth/login, /auth/change-password, GET /auth/me
│   │   ├── vault.js              # GET/POST/PUT/DELETE /vault/credentials
│   │   ├── admin.js              # GET/POST/PUT/DELETE /admin/staff
│   │   └── config.js             # GET /config/locations, PUT /config/locations/:id, GET /config/tools
│   ├── services/
│   │   ├── vault.js              # Credential CRUD with encryption
│   │   └── supabase.js           # Supabase client initialization
│   └── utils/
│       └── crypto.js             # AES-256-GCM encrypt/decrypt
└── seed/
    └── seed.js                   # Seed locations, role_tool_visibility, admin account

portal/src/
├── components/
│   ├── LoginScreen.jsx           # Email/password login form
│   └── AdminConfig.jsx           # Kiosk location + ABC URL config (admin only)
└── lib/
    └── api.js                    # API client (fetch wrapper with auth headers)

launcher/src/
└── auth.js                       # Auth module — login, token, API calls
```

### Modified Files

```
portal/src/App.jsx                # Add login state, tool filtering, logout button
portal/src/components/ToolGrid.jsx # Accept filtered tools prop instead of importing all
portal/src/config/tools.json      # Already has "id" field — used as tool_key
launcher/src/main.js              # Add login window, auth IPC, logout on idle
launcher/src/config.js            # Read C:\WCS\config.json, add API_URL
launcher/src/abc-scraper.js       # Add credential receive via IPC, auto-fill
```

---

## Phase 1: Auth API + Database

### Task 1: Supabase Project Setup & Schema

**Files:**
- Create: `auth/seed/seed.js`

This task is manual Supabase dashboard work + seed script.

- [ ] **Step 1: Create Supabase project**

Go to https://supabase.com/dashboard and create a new project named `wcs-staff-portal`. Note the project URL and anon key. Go to Settings > API and note the `service_role` key and `JWT Secret`.

- [ ] **Step 2: Run schema SQL in Supabase SQL Editor**

Go to SQL Editor in the Supabase dashboard and run:

```sql
-- Locations table
CREATE TABLE locations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT UNIQUE NOT NULL,
  abc_url TEXT NOT NULL,
  booking_url TEXT,
  vip_survey_url TEXT,
  created_at TIMESTAMPTZ DEFAULT now()
);

-- Staff profile table (linked to auth.users)
CREATE TABLE staff (
  id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  email TEXT UNIQUE NOT NULL,
  display_name TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('front_desk', 'personal_trainer', 'manager', 'director', 'admin')),
  must_change_password BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

-- Staff-locations junction
CREATE TABLE staff_locations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  staff_id UUID NOT NULL REFERENCES staff(id) ON DELETE CASCADE,
  location_id UUID NOT NULL REFERENCES locations(id) ON DELETE CASCADE,
  is_primary BOOLEAN DEFAULT false,
  created_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE(staff_id, location_id)
);

-- Credential vault
CREATE TABLE credential_vault (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  staff_id UUID NOT NULL REFERENCES staff(id) ON DELETE CASCADE,
  service TEXT NOT NULL,
  encrypted_username TEXT NOT NULL,
  encrypted_password TEXT NOT NULL,
  location_id UUID REFERENCES locations(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE(staff_id, service, location_id)
);

-- Role-tool visibility
CREATE TABLE role_tool_visibility (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  role TEXT NOT NULL CHECK (role IN ('front_desk', 'personal_trainer', 'manager', 'director', 'admin')),
  tool_key TEXT NOT NULL,
  visible BOOLEAN DEFAULT true,
  UNIQUE(role, tool_key)
);

-- Updated_at trigger for staff
CREATE OR REPLACE FUNCTION update_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER staff_updated_at
  BEFORE UPDATE ON staff
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

CREATE TRIGGER credential_vault_updated_at
  BEFORE UPDATE ON credential_vault
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();
```

- [ ] **Step 3: Write the seed script**

Create `auth/seed/seed.js`:

```javascript
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') })
const { createClient } = require('@supabase/supabase-js')

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
)

const LOCATIONS = [
  { name: 'Salem', abc_url: '', booking_url: 'https://api.westcoaststrength.com/widget/booking/Gq92GXsDRAgTGZeHh7mx', vip_survey_url: 'https://api.westcoaststrength.com/widget/survey/FkrsORfLFVMiVS26LV9V' },
  { name: 'Keizer', abc_url: '', booking_url: 'https://api.westcoaststrength.com/widget/booking/8qFo1GnePy0mCgV9avWW', vip_survey_url: 'https://api.westcoaststrength.com/widget/survey/HXB00WKKe6srvgSmfwI7' },
  { name: 'Eugene', abc_url: '', booking_url: 'https://api.westcoaststrength.com/widget/booking/0c9CNdZ65NainMcStWXo', vip_survey_url: 'https://api.westcoaststrength.com/widget/survey/xKYTE6V7QXKVpkUfWTFi' },
  { name: 'Springfield', abc_url: '', booking_url: 'https://api.westcoaststrength.com/widget/booking/PEyaqnkjmBN5tLpo6I9F', vip_survey_url: 'https://api.westcoaststrength.com/widget/survey/uM48yWzOBhXhUBsG1fhW' },
  { name: 'Clackamas', abc_url: '', booking_url: 'https://api.westcoaststrength.com/widget/booking/yOvDLsZMAboTVjv9c2HC', vip_survey_url: 'https://api.westcoaststrength.com/widget/survey/Z9zEHwjGfQaMIYy9OueF' },
  { name: 'Milwaukie', abc_url: '', booking_url: 'https://api.westcoaststrength.com/widget/booking/Gq92GXsDRAgTGZeHh7mx', vip_survey_url: 'https://api.westcoaststrength.com/widget/survey/FkrsORfLFVMiVS26LV9V' },
  { name: 'Medford', abc_url: '', booking_url: 'https://api.westcoaststrength.com/widget/booking/Gq92GXsDRAgTGZeHh7mx', vip_survey_url: 'https://api.westcoaststrength.com/widget/survey/FkrsORfLFVMiVS26LV9V' },
]

const TOOLS = ['grow', 'abc', 'wheniwork', 'paychex', 'gmail', 'drive']
const ROLES = ['front_desk', 'personal_trainer', 'manager', 'director', 'admin']

async function seed() {
  // Seed locations
  const { error: locError } = await supabase
    .from('locations')
    .upsert(LOCATIONS, { onConflict: 'name' })
  if (locError) throw new Error('Failed to seed locations: ' + locError.message)
  console.log('Seeded 7 locations')

  // Seed role_tool_visibility (all visible by default)
  const visibility = []
  for (const role of ROLES) {
    for (const tool_key of TOOLS) {
      visibility.push({ role, tool_key, visible: true })
    }
  }
  const { error: visError } = await supabase
    .from('role_tool_visibility')
    .upsert(visibility, { onConflict: 'role,tool_key' })
  if (visError) throw new Error('Failed to seed visibility: ' + visError.message)
  console.log('Seeded role_tool_visibility (' + visibility.length + ' rows)')

  // Create initial admin user
  const adminEmail = process.env.ADMIN_EMAIL || 'admin@wcstrength.com'
  const adminPassword = process.env.ADMIN_PASSWORD || 'changeme123'

  const { data: authUser, error: authError } = await supabase.auth.admin.createUser({
    email: adminEmail,
    password: adminPassword,
    email_confirm: true,
  })
  if (authError) {
    if (authError.message.includes('already been registered')) {
      console.log('Admin user already exists, skipping')
    } else {
      throw new Error('Failed to create admin user: ' + authError.message)
    }
  } else {
    const { error: staffError } = await supabase.from('staff').insert({
      id: authUser.user.id,
      email: adminEmail,
      display_name: 'Admin',
      role: 'admin',
      must_change_password: true,
    })
    if (staffError) throw new Error('Failed to create staff record: ' + staffError.message)

    // Assign admin to all locations
    const { data: locs } = await supabase.from('locations').select('id')
    const assignments = locs.map((loc, i) => ({
      staff_id: authUser.user.id,
      location_id: loc.id,
      is_primary: i === 0,
    }))
    const { error: assignError } = await supabase.from('staff_locations').insert(assignments)
    if (assignError) throw new Error('Failed to assign locations: ' + assignError.message)
    console.log('Created admin user: ' + adminEmail)
  }

  console.log('Seed complete!')
}

seed().catch(err => { console.error(err); process.exit(1) })
```

- [ ] **Step 4: Commit**

```bash
git add auth/seed/seed.js
git commit -m "feat: add database seed script for locations, role visibility, and admin user"
```

---

### Task 2: Express App Scaffold + Supabase Client

**Files:**
- Create: `auth/package.json`
- Create: `auth/.env.example`
- Create: `auth/src/index.js`
- Create: `auth/src/services/supabase.js`

- [ ] **Step 1: Initialize auth package**

Create `auth/package.json`:

```json
{
  "name": "wcs-auth-api",
  "version": "1.0.0",
  "private": true,
  "scripts": {
    "start": "node src/index.js",
    "dev": "node --watch src/index.js",
    "seed": "node seed/seed.js"
  },
  "dependencies": {
    "@supabase/supabase-js": "^2.49.0",
    "cors": "^2.8.5",
    "dotenv": "^16.4.0",
    "express": "^4.21.0"
  }
}
```

- [ ] **Step 2: Create .env.example**

Create `auth/.env.example`:

```
SUPABASE_URL=https://your-project.supabase.co
SUPABASE_SERVICE_ROLE_KEY=your-service-role-key
SUPABASE_JWT_SECRET=your-jwt-secret
VAULT_ENCRYPTION_KEY=your-64-char-hex-string
PORT=3001
ADMIN_EMAIL=admin@wcstrength.com
ADMIN_PASSWORD=changeme123
```

- [ ] **Step 3: Create Supabase client service**

Create `auth/src/services/supabase.js`:

```javascript
const { createClient } = require('@supabase/supabase-js')

// Service role client — bypasses RLS, used for admin operations
const supabaseAdmin = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
)

// Anon client — used for user-facing auth (signIn)
const supabaseAnon = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY // We use service role for all server-side operations
)

module.exports = { supabaseAdmin }
```

- [ ] **Step 4: Create Express app**

Create `auth/src/index.js`:

```javascript
require('dotenv').config()
const express = require('express')
const cors = require('cors')

const app = express()
app.use(cors())
app.use(express.json())

// Health check
app.get('/health', (req, res) => res.json({ status: 'ok' }))

// Routes (added in subsequent tasks)
// app.use('/auth', require('./routes/auth'))
// app.use('/vault', require('./routes/vault'))
// app.use('/admin', require('./routes/admin'))
// app.use('/config', require('./routes/config'))

const PORT = process.env.PORT || 3001
app.listen(PORT, () => console.log(`WCS Auth API listening on port ${PORT}`))
```

- [ ] **Step 5: Install dependencies**

Run: `cd auth && npm install`
Expected: `node_modules/` created, `package-lock.json` generated

- [ ] **Step 6: Test health endpoint**

Run: `cd auth && node src/index.js &` then `curl http://localhost:3001/health`
Expected: `{"status":"ok"}`
Kill the server after verifying.

- [ ] **Step 7: Commit**

```bash
git add auth/package.json auth/.env.example auth/src/index.js auth/src/services/supabase.js auth/package-lock.json
git commit -m "feat: scaffold Express auth API with Supabase client"
```

---

### Task 3: Auth Middleware

**Files:**
- Create: `auth/src/middleware/auth.js`
- Create: `auth/src/middleware/role.js`

- [ ] **Step 1: Create JWT auth middleware**

Create `auth/src/middleware/auth.js`:

```javascript
const jwt = require('jsonwebtoken')
const { supabaseAdmin } = require('../services/supabase')

async function authenticate(req, res, next) {
  const header = req.headers.authorization
  if (!header || !header.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Missing or invalid authorization header' })
  }

  const token = header.slice(7)

  try {
    const payload = jwt.verify(token, process.env.SUPABASE_JWT_SECRET)
    const userId = payload.sub

    // Fetch staff profile + locations
    const { data: staff, error } = await supabaseAdmin
      .from('staff')
      .select('id, email, display_name, role, must_change_password')
      .eq('id', userId)
      .single()

    if (error || !staff) {
      return res.status(401).json({ error: 'Staff account not found' })
    }

    const { data: staffLocs } = await supabaseAdmin
      .from('staff_locations')
      .select('location_id, is_primary')
      .eq('staff_id', userId)

    req.staff = {
      ...staff,
      location_ids: (staffLocs || []).map(sl => sl.location_id),
      primary_location_id: (staffLocs || []).find(sl => sl.is_primary)?.location_id || null,
    }

    next()
  } catch (err) {
    return res.status(401).json({ error: 'Invalid or expired token' })
  }
}

module.exports = authenticate
```

Note: Add `jsonwebtoken` dependency.

- [ ] **Step 2: Create role middleware**

Create `auth/src/middleware/role.js`:

```javascript
const ROLE_HIERARCHY = ['front_desk', 'personal_trainer', 'manager', 'director', 'admin']

function requireRole(minimumRole) {
  const minLevel = ROLE_HIERARCHY.indexOf(minimumRole)
  if (minLevel === -1) throw new Error('Invalid role: ' + minimumRole)

  return (req, res, next) => {
    const userLevel = ROLE_HIERARCHY.indexOf(req.staff.role)
    if (userLevel < minLevel) {
      return res.status(403).json({ error: 'Insufficient role. Requires: ' + minimumRole })
    }
    next()
  }
}

module.exports = { requireRole, ROLE_HIERARCHY }
```

- [ ] **Step 3: Install jsonwebtoken**

Run: `cd auth && npm install jsonwebtoken`

- [ ] **Step 4: Commit**

```bash
git add auth/src/middleware/auth.js auth/src/middleware/role.js auth/package.json auth/package-lock.json
git commit -m "feat: add JWT auth and role-based access middleware"
```

---

### Task 4: Auth Routes

**Files:**
- Create: `auth/src/routes/auth.js`
- Modify: `auth/src/index.js`

- [ ] **Step 1: Create auth routes**

Create `auth/src/routes/auth.js`:

```javascript
const { Router } = require('express')
const { supabaseAdmin } = require('../services/supabase')
const authenticate = require('../middleware/auth')
const { createClient } = require('@supabase/supabase-js')

const router = Router()

// POST /auth/login — public
router.post('/login', async (req, res) => {
  const { email, password } = req.body
  if (!email || !password) {
    return res.status(400).json({ error: 'Email and password required' })
  }

  // Use a fresh anon-level client for signIn so the JWT is user-scoped
  const anonClient = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY)

  const { data: authData, error: authError } = await anonClient.auth.signInWithPassword({
    email,
    password,
  })

  if (authError) {
    return res.status(401).json({ error: 'Invalid email or password' })
  }

  // Fetch staff profile
  const { data: staff, error: staffError } = await supabaseAdmin
    .from('staff')
    .select('id, email, display_name, role, must_change_password')
    .eq('id', authData.user.id)
    .single()

  if (staffError || !staff) {
    return res.status(401).json({ error: 'Staff account not found' })
  }

  // Fetch locations
  const { data: staffLocs } = await supabaseAdmin
    .from('staff_locations')
    .select('location_id, is_primary, locations(id, name)')
    .eq('staff_id', staff.id)

  const locations = (staffLocs || []).map(sl => ({
    id: sl.locations.id,
    name: sl.locations.name,
    is_primary: sl.is_primary,
  }))

  res.json({
    token: authData.session.access_token,
    staff: {
      id: staff.id,
      email: staff.email,
      display_name: staff.display_name,
      role: staff.role,
      locations,
    },
    must_change_password: staff.must_change_password,
  })
})

// POST /auth/change-password — authenticated
router.post('/change-password', authenticate, async (req, res) => {
  const { new_password } = req.body
  if (!new_password || new_password.length < 8) {
    return res.status(400).json({ error: 'Password must be at least 8 characters' })
  }

  const { error: updateError } = await supabaseAdmin.auth.admin.updateUserById(
    req.staff.id,
    { password: new_password }
  )

  if (updateError) {
    return res.status(500).json({ error: 'Failed to update password' })
  }

  await supabaseAdmin
    .from('staff')
    .update({ must_change_password: false })
    .eq('id', req.staff.id)

  res.json({ message: 'Password updated' })
})

// GET /auth/me — authenticated
router.get('/me', authenticate, async (req, res) => {
  // Fetch locations with details
  const { data: staffLocs } = await supabaseAdmin
    .from('staff_locations')
    .select('location_id, is_primary, locations(id, name, abc_url, booking_url, vip_survey_url)')
    .eq('staff_id', req.staff.id)

  const locations = (staffLocs || []).map(sl => ({
    ...sl.locations,
    is_primary: sl.is_primary,
  }))

  // Fetch visible tools for this role
  const { data: visibility } = await supabaseAdmin
    .from('role_tool_visibility')
    .select('tool_key')
    .eq('role', req.staff.role)
    .eq('visible', true)

  const visible_tools = (visibility || []).map(v => v.tool_key)

  res.json({
    staff: {
      id: req.staff.id,
      email: req.staff.email,
      display_name: req.staff.display_name,
      role: req.staff.role,
      locations,
    },
    visible_tools,
  })
})

module.exports = router
```

- [ ] **Step 2: Wire auth routes into Express app**

In `auth/src/index.js`, uncomment and add:

```javascript
// After app.use(express.json()), add:
app.use('/auth', require('./routes/auth'))
```

- [ ] **Step 3: Create .env file locally for testing**

Create `auth/.env` (NOT committed — already in .gitignore):
```
SUPABASE_URL=<your-supabase-url>
SUPABASE_SERVICE_ROLE_KEY=<your-service-role-key>
SUPABASE_JWT_SECRET=<your-jwt-secret>
VAULT_ENCRYPTION_KEY=<run: node -e "console.log(require('crypto').randomBytes(32).toString('hex'))">
PORT=3001
```

- [ ] **Step 4: Run seed, then test login**

Run seed: `cd auth && npm run seed`

Then start the server: `npm run dev`

Test login:
```bash
curl -X POST http://localhost:3001/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email":"admin@wcstrength.com","password":"changeme123"}'
```
Expected: JSON with `token`, `staff` object (role=admin, locations array), `must_change_password: true`

- [ ] **Step 5: Test /auth/me with the token**

```bash
TOKEN=<token from login response>
curl http://localhost:3001/auth/me -H "Authorization: Bearer $TOKEN"
```
Expected: JSON with staff profile, locations with full details, `visible_tools` array with all 6 tools

- [ ] **Step 6: Commit**

```bash
git add auth/src/routes/auth.js auth/src/index.js
git commit -m "feat: add auth routes — login, change-password, me"
```

---

## Phase 2: Credential Vault

### Task 5: AES-256-GCM Crypto Module

**Files:**
- Create: `auth/src/utils/crypto.js`

- [ ] **Step 1: Create the crypto module**

Create `auth/src/utils/crypto.js`:

```javascript
const crypto = require('crypto')

const ALGORITHM = 'aes-256-gcm'
const IV_LENGTH = 16
const AUTH_TAG_LENGTH = 16

function getKey() {
  const hex = process.env.VAULT_ENCRYPTION_KEY
  if (!hex || hex.length !== 64) {
    throw new Error('VAULT_ENCRYPTION_KEY must be a 64-character hex string (32 bytes)')
  }
  return Buffer.from(hex, 'hex')
}

function encrypt(plaintext) {
  const key = getKey()
  const iv = crypto.randomBytes(IV_LENGTH)
  const cipher = crypto.createCipheriv(ALGORITHM, key, iv)

  const encrypted = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()])
  const authTag = cipher.getAuthTag()

  // Store as: base64(IV + authTag + ciphertext)
  const combined = Buffer.concat([iv, authTag, encrypted])
  return combined.toString('base64')
}

function decrypt(encoded) {
  const key = getKey()
  const combined = Buffer.from(encoded, 'base64')

  const iv = combined.subarray(0, IV_LENGTH)
  const authTag = combined.subarray(IV_LENGTH, IV_LENGTH + AUTH_TAG_LENGTH)
  const ciphertext = combined.subarray(IV_LENGTH + AUTH_TAG_LENGTH)

  const decipher = crypto.createDecipheriv(ALGORITHM, key, iv)
  decipher.setAuthTag(authTag)

  const decrypted = Buffer.concat([decipher.update(ciphertext), decipher.final()])
  return decrypted.toString('utf8')
}

module.exports = { encrypt, decrypt }
```

- [ ] **Step 2: Quick manual test**

Run:
```bash
cd auth && node -e "
require('dotenv').config()
const { encrypt, decrypt } = require('./src/utils/crypto')
const original = 'my-secret-password'
const enc = encrypt(original)
console.log('Encrypted:', enc)
const dec = decrypt(enc)
console.log('Decrypted:', dec)
console.log('Match:', original === dec)
"
```
Expected: `Match: true`

- [ ] **Step 3: Commit**

```bash
git add auth/src/utils/crypto.js
git commit -m "feat: add AES-256-GCM encryption module for credential vault"
```

---

### Task 6: Vault Service + Routes

**Files:**
- Create: `auth/src/services/vault.js`
- Create: `auth/src/routes/vault.js`
- Modify: `auth/src/index.js`

- [ ] **Step 1: Create vault service**

Create `auth/src/services/vault.js`:

```javascript
const { supabaseAdmin } = require('./supabase')
const { encrypt, decrypt } = require('../utils/crypto')

async function storeCredential(staffId, service, username, password, locationId) {
  const encrypted_username = encrypt(username)
  const encrypted_password = encrypt(password)

  const row = {
    staff_id: staffId,
    service,
    encrypted_username,
    encrypted_password,
    location_id: locationId || null,
  }

  const { data, error } = await supabaseAdmin
    .from('credential_vault')
    .upsert(row, { onConflict: 'staff_id,service,location_id' })
    .select()
    .single()

  if (error) throw error
  return data
}

async function getCredentials(staffId, service, locationId) {
  let query = supabaseAdmin
    .from('credential_vault')
    .select('id, staff_id, service, encrypted_username, encrypted_password, location_id, created_at, updated_at')
    .eq('staff_id', staffId)

  if (service) query = query.eq('service', service)
  if (locationId) query = query.eq('location_id', locationId)

  const { data, error } = await query
  if (error) throw error

  return (data || []).map(row => ({
    id: row.id,
    staff_id: row.staff_id,
    service: row.service,
    username: decrypt(row.encrypted_username),
    password: decrypt(row.encrypted_password),
    location_id: row.location_id,
  }))
}

async function getCredentialById(id) {
  const { data, error } = await supabaseAdmin
    .from('credential_vault')
    .select('*')
    .eq('id', id)
    .single()

  if (error) return null
  return data
}

async function updateCredential(id, username, password) {
  const updates = {}
  if (username) updates.encrypted_username = encrypt(username)
  if (password) updates.encrypted_password = encrypt(password)

  const { data, error } = await supabaseAdmin
    .from('credential_vault')
    .update(updates)
    .eq('id', id)
    .select()
    .single()

  if (error) throw error
  return data
}

async function deleteCredential(id) {
  const { error } = await supabaseAdmin
    .from('credential_vault')
    .delete()
    .eq('id', id)

  if (error) throw error
}

module.exports = { storeCredential, getCredentials, getCredentialById, updateCredential, deleteCredential }
```

- [ ] **Step 2: Create vault routes**

Create `auth/src/routes/vault.js`:

```javascript
const { Router } = require('express')
const authenticate = require('../middleware/auth')
const { requireRole, ROLE_HIERARCHY } = require('../middleware/role')
const vault = require('../services/vault')

const router = Router()

// All vault routes require authentication
router.use(authenticate)

// GET /vault/credentials?service=abc&location_id=xxx
router.get('/credentials', async (req, res) => {
  try {
    const credentials = await vault.getCredentials(
      req.staff.id,
      req.query.service,
      req.query.location_id
    )
    res.json({ credentials })
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch credentials' })
  }
})

// POST /vault/credentials
router.post('/credentials', async (req, res) => {
  const { staff_id, service, username, password, location_id } = req.body

  if (!staff_id || !service || !username || !password) {
    return res.status(400).json({ error: 'staff_id, service, username, and password are required' })
  }

  // Ownership check: if storing for someone else, require director+
  if (staff_id !== req.staff.id) {
    const userLevel = ROLE_HIERARCHY.indexOf(req.staff.role)
    const directorLevel = ROLE_HIERARCHY.indexOf('director')
    if (userLevel < directorLevel) {
      return res.status(403).json({ error: 'Only directors and above can manage other staff credentials' })
    }
  }

  try {
    const data = await vault.storeCredential(staff_id, service, username, password, location_id)
    res.status(201).json({ credential: { id: data.id, service, staff_id, location_id: location_id || null } })
  } catch (err) {
    res.status(500).json({ error: 'Failed to store credential' })
  }
})

// PUT /vault/credentials/:id
router.put('/credentials/:id', async (req, res) => {
  const { username, password } = req.body

  const existing = await vault.getCredentialById(req.params.id)
  if (!existing) return res.status(404).json({ error: 'Credential not found' })

  // Ownership check
  if (existing.staff_id !== req.staff.id) {
    const userLevel = ROLE_HIERARCHY.indexOf(req.staff.role)
    const directorLevel = ROLE_HIERARCHY.indexOf('director')
    if (userLevel < directorLevel) {
      return res.status(403).json({ error: 'Only directors and above can manage other staff credentials' })
    }
  }

  try {
    await vault.updateCredential(req.params.id, username, password)
    res.json({ message: 'Credential updated' })
  } catch (err) {
    res.status(500).json({ error: 'Failed to update credential' })
  }
})

// DELETE /vault/credentials/:id — director+ only
router.delete('/credentials/:id', requireRole('director'), async (req, res) => {
  const existing = await vault.getCredentialById(req.params.id)
  if (!existing) return res.status(404).json({ error: 'Credential not found' })

  try {
    await vault.deleteCredential(req.params.id)
    res.json({ message: 'Credential deleted' })
  } catch (err) {
    res.status(500).json({ error: 'Failed to delete credential' })
  }
})

module.exports = router
```

- [ ] **Step 3: Wire vault routes into Express app**

In `auth/src/index.js`, add after the auth route:

```javascript
app.use('/vault', require('./routes/vault'))
```

- [ ] **Step 4: Test vault CRUD**

Start server, login to get token, then:

```bash
# Store a credential
curl -X POST http://localhost:3001/vault/credentials \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $TOKEN" \
  -d '{"staff_id":"<your-user-id>","service":"abc","username":"testuser","password":"testpass"}'

# Fetch credentials
curl http://localhost:3001/vault/credentials?service=abc \
  -H "Authorization: Bearer $TOKEN"
```
Expected: POST returns 201 with credential ID. GET returns decrypted username/password.

- [ ] **Step 5: Commit**

```bash
git add auth/src/services/vault.js auth/src/routes/vault.js auth/src/index.js
git commit -m "feat: add credential vault service and routes with AES-256-GCM encryption"
```

---

## Phase 3: Admin & Config Routes

### Task 7: Admin Staff Management Routes

**Files:**
- Create: `auth/src/routes/admin.js`
- Modify: `auth/src/index.js`

- [ ] **Step 1: Create admin routes**

Create `auth/src/routes/admin.js`:

```javascript
const { Router } = require('express')
const { supabaseAdmin } = require('../services/supabase')
const authenticate = require('../middleware/auth')
const { requireRole } = require('../middleware/role')

const router = Router()

router.use(authenticate)

// GET /admin/staff — manager+ (returns staff at caller's locations)
router.get('/staff', requireRole('manager'), async (req, res) => {
  try {
    // Get staff IDs at the caller's locations
    const { data: locStaff } = await supabaseAdmin
      .from('staff_locations')
      .select('staff_id')
      .in('location_id', req.staff.location_ids)

    const staffIds = [...new Set((locStaff || []).map(ls => ls.staff_id))]

    if (staffIds.length === 0) return res.json({ staff: [] })

    const { data: staffList } = await supabaseAdmin
      .from('staff')
      .select('id, email, display_name, role, must_change_password, created_at')
      .in('id', staffIds)
      .order('display_name')

    // Attach locations to each staff member
    const { data: allLocs } = await supabaseAdmin
      .from('staff_locations')
      .select('staff_id, location_id, is_primary, locations(id, name)')
      .in('staff_id', staffIds)

    const staffWithLocs = (staffList || []).map(s => ({
      ...s,
      locations: (allLocs || [])
        .filter(sl => sl.staff_id === s.id)
        .map(sl => ({ id: sl.locations.id, name: sl.locations.name, is_primary: sl.is_primary })),
    }))

    res.json({ staff: staffWithLocs })
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch staff' })
  }
})

// POST /admin/staff — director+
router.post('/staff', requireRole('director'), async (req, res) => {
  const { email, display_name, role, location_ids, temp_password } = req.body

  if (!email || !display_name || !role || !location_ids?.length || !temp_password) {
    return res.status(400).json({ error: 'email, display_name, role, location_ids, and temp_password are required' })
  }

  try {
    // Create Supabase Auth user
    const { data: authUser, error: authError } = await supabaseAdmin.auth.admin.createUser({
      email,
      password: temp_password,
      email_confirm: true,
    })

    if (authError) {
      return res.status(400).json({ error: authError.message })
    }

    // Create staff record
    const { error: staffError } = await supabaseAdmin.from('staff').insert({
      id: authUser.user.id,
      email,
      display_name,
      role,
      must_change_password: true,
    })

    if (staffError) {
      // Rollback: delete auth user
      await supabaseAdmin.auth.admin.deleteUser(authUser.user.id)
      return res.status(500).json({ error: 'Failed to create staff record' })
    }

    // Assign locations
    const assignments = location_ids.map((locId, i) => ({
      staff_id: authUser.user.id,
      location_id: locId,
      is_primary: i === 0,
    }))

    const { error: assignError } = await supabaseAdmin.from('staff_locations').insert(assignments)
    if (assignError) {
      return res.status(500).json({ error: 'Staff created but location assignment failed' })
    }

    res.status(201).json({
      staff: {
        id: authUser.user.id,
        email,
        display_name,
        role,
        must_change_password: true,
      },
    })
  } catch (err) {
    res.status(500).json({ error: 'Failed to create staff' })
  }
})

// PUT /admin/staff/:id — director+
router.put('/staff/:id', requireRole('director'), async (req, res) => {
  const { role, location_ids, display_name } = req.body
  const staffId = req.params.id

  try {
    // Update staff fields
    const updates = {}
    if (role) updates.role = role
    if (display_name) updates.display_name = display_name

    if (Object.keys(updates).length > 0) {
      const { error } = await supabaseAdmin.from('staff').update(updates).eq('id', staffId)
      if (error) return res.status(500).json({ error: 'Failed to update staff' })
    }

    // Update location assignments if provided
    if (location_ids) {
      // Remove existing assignments
      await supabaseAdmin.from('staff_locations').delete().eq('staff_id', staffId)

      // Insert new assignments
      const assignments = location_ids.map((locId, i) => ({
        staff_id: staffId,
        location_id: locId,
        is_primary: i === 0,
      }))
      const { error } = await supabaseAdmin.from('staff_locations').insert(assignments)
      if (error) return res.status(500).json({ error: 'Failed to update location assignments' })
    }

    res.json({ message: 'Staff updated' })
  } catch (err) {
    res.status(500).json({ error: 'Failed to update staff' })
  }
})

// DELETE /admin/staff/:id — admin only
router.delete('/staff/:id', requireRole('admin'), async (req, res) => {
  const staffId = req.params.id

  try {
    // Delete from staff table (cascades to staff_locations and credential_vault)
    const { error: staffError } = await supabaseAdmin.from('staff').delete().eq('id', staffId)
    if (staffError) return res.status(500).json({ error: 'Failed to delete staff record' })

    // Delete from Supabase Auth
    const { error: authError } = await supabaseAdmin.auth.admin.deleteUser(staffId)
    if (authError) return res.status(500).json({ error: 'Staff record deleted but auth user removal failed' })

    res.json({ message: 'Staff deleted' })
  } catch (err) {
    res.status(500).json({ error: 'Failed to delete staff' })
  }
})

module.exports = router
```

- [ ] **Step 2: Wire admin routes into Express app**

In `auth/src/index.js`, add:

```javascript
app.use('/admin', require('./routes/admin'))
```

- [ ] **Step 3: Commit**

```bash
git add auth/src/routes/admin.js auth/src/index.js
git commit -m "feat: add admin staff management routes — CRUD with role checks"
```

---

### Task 8: Config Routes (Locations + Tools)

**Files:**
- Create: `auth/src/routes/config.js`
- Modify: `auth/src/index.js`

- [ ] **Step 1: Create config routes**

Create `auth/src/routes/config.js`:

```javascript
const { Router } = require('express')
const { supabaseAdmin } = require('../services/supabase')
const authenticate = require('../middleware/auth')
const { requireRole } = require('../middleware/role')

const router = Router()

router.use(authenticate)

// GET /config/locations
router.get('/locations', async (req, res) => {
  const { data, error } = await supabaseAdmin
    .from('locations')
    .select('id, name, abc_url, booking_url, vip_survey_url')
    .order('name')

  if (error) return res.status(500).json({ error: 'Failed to fetch locations' })
  res.json({ locations: data })
})

// PUT /config/locations/:id — admin only
router.put('/locations/:id', requireRole('admin'), async (req, res) => {
  const { abc_url, booking_url, vip_survey_url } = req.body
  const updates = {}
  if (abc_url !== undefined) updates.abc_url = abc_url
  if (booking_url !== undefined) updates.booking_url = booking_url
  if (vip_survey_url !== undefined) updates.vip_survey_url = vip_survey_url

  if (Object.keys(updates).length === 0) {
    return res.status(400).json({ error: 'No fields to update' })
  }

  const { data, error } = await supabaseAdmin
    .from('locations')
    .update(updates)
    .eq('id', req.params.id)
    .select()
    .single()

  if (error) return res.status(500).json({ error: 'Failed to update location' })
  res.json({ location: data })
})

// GET /config/tools — returns tools filtered by caller's role
router.get('/tools', async (req, res) => {
  const { data, error } = await supabaseAdmin
    .from('role_tool_visibility')
    .select('tool_key, visible')
    .eq('role', req.staff.role)

  if (error) return res.status(500).json({ error: 'Failed to fetch tool visibility' })

  const visible_tools = (data || []).filter(t => t.visible).map(t => t.tool_key)
  res.json({ visible_tools })
})

module.exports = router
```

- [ ] **Step 2: Wire config routes into Express app**

In `auth/src/index.js`, add:

```javascript
app.use('/config', require('./routes/config'))
```

- [ ] **Step 3: Verify all 4 route groups are wired**

`auth/src/index.js` should now have:

```javascript
app.use('/auth', require('./routes/auth'))
app.use('/vault', require('./routes/vault'))
app.use('/admin', require('./routes/admin'))
app.use('/config', require('./routes/config'))
```

- [ ] **Step 4: Commit**

```bash
git add auth/src/routes/config.js auth/src/index.js
git commit -m "feat: add config routes — locations CRUD and role-based tool visibility"
```

---

## Phase 4: Portal Login + Tool Filtering

### Task 9: Portal API Client

**Files:**
- Create: `portal/src/lib/api.js`

- [ ] **Step 1: Create the API client**

Create `portal/src/lib/api.js`:

```javascript
const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:3001'

let authToken = null

export function setToken(token) {
  authToken = token
}

export function getToken() {
  return authToken
}

export function clearToken() {
  authToken = null
}

export async function api(path, options = {}) {
  const headers = { 'Content-Type': 'application/json', ...options.headers }
  if (authToken) {
    headers['Authorization'] = 'Bearer ' + authToken
  }

  const res = await fetch(API_URL + path, { ...options, headers })
  const data = await res.json()

  if (!res.ok) {
    throw new Error(data.error || 'Request failed')
  }

  return data
}

export async function login(email, password) {
  const data = await api('/auth/login', {
    method: 'POST',
    body: JSON.stringify({ email, password }),
  })
  setToken(data.token)
  return data
}

export async function changePassword(newPassword) {
  return api('/auth/change-password', {
    method: 'POST',
    body: JSON.stringify({ new_password: newPassword }),
  })
}

export async function getMe() {
  return api('/auth/me')
}
```

- [ ] **Step 2: Commit**

```bash
git add portal/src/lib/api.js
git commit -m "feat: add portal API client with auth token management"
```

---

### Task 10: Login Screen Component

**Files:**
- Create: `portal/src/components/LoginScreen.jsx`

- [ ] **Step 1: Create LoginScreen component**

Create `portal/src/components/LoginScreen.jsx`:

```jsx
import { useState } from 'react'
import { login, changePassword } from '../lib/api'

export default function LoginScreen({ onLogin }) {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)

  // Change password state
  const [mustChange, setMustChange] = useState(false)
  const [newPassword, setNewPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [staffData, setStaffData] = useState(null)

  async function handleLogin(e) {
    e.preventDefault()
    setError('')
    setLoading(true)

    try {
      const data = await login(email, password)
      if (data.must_change_password) {
        setMustChange(true)
        setStaffData(data)
      } else {
        onLogin(data)
      }
    } catch (err) {
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }

  async function handleChangePassword(e) {
    e.preventDefault()
    setError('')

    if (newPassword.length < 8) {
      setError('Password must be at least 8 characters')
      return
    }
    if (newPassword !== confirmPassword) {
      setError('Passwords do not match')
      return
    }

    setLoading(true)
    try {
      await changePassword(newPassword)
      onLogin({ ...staffData, must_change_password: false })
    } catch (err) {
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }

  if (mustChange) {
    return (
      <div className="min-h-screen bg-bg flex items-center justify-center">
        <div className="bg-surface rounded-2xl border border-border p-8 w-full max-w-sm">
          <h1 className="text-xl font-bold text-text-primary mb-1">Change Password</h1>
          <p className="text-sm text-text-muted mb-6">You must set a new password before continuing.</p>

          <form onSubmit={handleChangePassword} className="flex flex-col gap-4">
            <input
              type="password"
              placeholder="New password"
              value={newPassword}
              onChange={e => setNewPassword(e.target.value)}
              className="w-full px-4 py-3 rounded-lg border border-border bg-bg text-text-primary text-sm focus:outline-none focus:ring-2 focus:ring-wcs-red"
              autoFocus
            />
            <input
              type="password"
              placeholder="Confirm new password"
              value={confirmPassword}
              onChange={e => setConfirmPassword(e.target.value)}
              className="w-full px-4 py-3 rounded-lg border border-border bg-bg text-text-primary text-sm focus:outline-none focus:ring-2 focus:ring-wcs-red"
            />
            {error && <p className="text-sm text-wcs-red">{error}</p>}
            <button
              type="submit"
              disabled={loading}
              className="w-full py-3 rounded-lg bg-wcs-red text-white font-semibold text-sm hover:bg-wcs-red-hover transition-colors disabled:opacity-50"
            >
              {loading ? 'Updating...' : 'Set Password'}
            </button>
          </form>
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-bg flex items-center justify-center">
      <div className="bg-surface rounded-2xl border border-border p-8 w-full max-w-sm">
        <div className="text-center mb-6">
          <h1 className="text-2xl font-black text-text-primary">
            <span className="bg-gradient-to-r from-wcs-red to-[#fc8181] bg-clip-text text-transparent">WCS</span>
            {' '}Staff Portal
          </h1>
          <p className="text-sm text-text-muted mt-1">Sign in to continue</p>
        </div>

        <form onSubmit={handleLogin} className="flex flex-col gap-4">
          <input
            type="email"
            placeholder="Email"
            value={email}
            onChange={e => setEmail(e.target.value)}
            className="w-full px-4 py-3 rounded-lg border border-border bg-bg text-text-primary text-sm focus:outline-none focus:ring-2 focus:ring-wcs-red"
            autoFocus
          />
          <input
            type="password"
            placeholder="Password"
            value={password}
            onChange={e => setPassword(e.target.value)}
            className="w-full px-4 py-3 rounded-lg border border-border bg-bg text-text-primary text-sm focus:outline-none focus:ring-2 focus:ring-wcs-red"
          />
          {error && <p className="text-sm text-wcs-red">{error}</p>}
          <button
            type="submit"
            disabled={loading}
            className="w-full py-3 rounded-lg bg-wcs-red text-white font-semibold text-sm hover:bg-wcs-red-hover transition-colors disabled:opacity-50"
          >
            {loading ? 'Signing in...' : 'Sign In'}
          </button>
        </form>
      </div>
    </div>
  )
}
```

- [ ] **Step 2: Commit**

```bash
git add portal/src/components/LoginScreen.jsx
git commit -m "feat: add login screen with forced password change flow"
```

---

### Task 11: Wire Login + Tool Filtering into App

**Files:**
- Modify: `portal/src/App.jsx`
- Modify: `portal/src/components/ToolGrid.jsx`

- [ ] **Step 1: Update App.jsx with auth state**

Replace the full contents of `portal/src/App.jsx` with:

```jsx
import { useState, useEffect } from 'react'
import ToolGrid from './components/ToolGrid'
import IdleOverlay from './components/IdleOverlay'
import LoginScreen from './components/LoginScreen'
import useIdleTimer from './hooks/useIdleTimer'
import { getMe, clearToken } from './lib/api'

function getParam(key) {
  return new URLSearchParams(window.location.search).get(key)
}

export default function App() {
  const [user, setUser] = useState(null)       // { staff, visible_tools }
  const [loading, setLoading] = useState(false)
  const abcUrl = getParam('abc_url')
  const locationParam = getParam('location')

  const { isIdle, resetTimer } = useIdleTimer(10 * 60 * 1000)

  useEffect(() => {
    document.title = 'WCS Staff Portal'
  }, [])

  // Logout on idle
  useEffect(() => {
    if (isIdle && user) {
      handleLogout()
    }
  }, [isIdle])

  // Prevent accidental close
  useEffect(() => {
    const handleBeforeUnload = (e) => {
      e.preventDefault()
      e.returnValue = ''
    }
    window.addEventListener('beforeunload', handleBeforeUnload)
    return () => window.removeEventListener('beforeunload', handleBeforeUnload)
  }, [])

  async function handleLogin(data) {
    setLoading(true)
    try {
      const meData = await getMe()
      setUser(meData)
    } catch {
      setUser({
        staff: data.staff,
        visible_tools: [],
      })
    }
    setLoading(false)
    resetTimer()
  }

  function handleLogout() {
    clearToken()
    setUser(null)
  }

  if (!user) {
    return <LoginScreen onLogin={handleLogin} />
  }

  const location = user.staff.locations?.find(l => l.is_primary)?.name || locationParam || 'Salem'

  return (
    <div className="min-h-screen bg-bg flex flex-col">
      <header className="flex items-center justify-between px-8 py-6 max-w-3xl mx-auto w-full">
        <div>
          <h1 className="text-2xl font-black text-text-primary tracking-[-0.5px]">
            <span className="bg-gradient-to-r from-wcs-red to-[#fc8181] bg-clip-text text-transparent">WCS</span>
            {' '}Staff Portal
          </h1>
          <p className="text-xs text-text-muted mt-0.5">{user.staff.display_name}</p>
        </div>
        <div className="flex items-center gap-4">
          <span className="text-sm font-semibold text-text-muted uppercase tracking-[0.8px]">{location}</span>
          <button
            onClick={handleLogout}
            className="text-xs text-text-muted hover:text-wcs-red transition-colors"
          >
            Sign Out
          </button>
        </div>
      </header>

      <main className="flex-1 flex items-start pt-4">
        <ToolGrid abcUrl={abcUrl} location={location} visibleTools={user.visible_tools} />
      </main>

      {isIdle && <IdleOverlay onDismiss={resetTimer} />}
    </div>
  )
}
```

- [ ] **Step 2: Update ToolGrid to accept visibleTools prop**

Replace the full contents of `portal/src/components/ToolGrid.jsx` with:

```jsx
import allTools from '../config/tools.json'
import ToolButton from './ToolButton'

export default function ToolGrid({ abcUrl, location, visibleTools }) {
  const tools = visibleTools && visibleTools.length > 0
    ? allTools.filter(t => visibleTools.includes(t.id))
    : allTools

  const getUrl = (tool) => {
    if (tool.id === 'abc') {
      const params = new URLSearchParams()
      if (abcUrl) params.set('abc_url', abcUrl)
      if (location) params.set('location', location)
      const qs = params.toString()
      return '/kiosk.html' + (qs ? '?' + qs : '')
    }
    return tool.url
  }

  return (
    <div className="grid grid-cols-2 sm:grid-cols-3 gap-5 p-8 max-w-3xl mx-auto w-full">
      {tools.map((tool) => (
        <ToolButton
          key={tool.id}
          label={tool.label}
          description={tool.description}
          icon={tool.icon}
          url={getUrl(tool)}
        />
      ))}
    </div>
  )
}
```

- [ ] **Step 3: Test in browser**

Run: `cd portal && npm run dev`

Open http://localhost:3000. Should see login screen. Sign in with admin credentials. Should see tool grid with user name in header and Sign Out button.

- [ ] **Step 4: Commit**

```bash
git add portal/src/App.jsx portal/src/components/ToolGrid.jsx
git commit -m "feat: add login flow, tool filtering by role, logout on idle"
```

---

## Phase 5: Electron Login + Auto-Fill

### Task 12: Electron Auth Module

**Files:**
- Create: `launcher/src/auth.js`
- Modify: `launcher/src/config.js`

- [ ] **Step 1: Update config.js to use config.json and add API URL**

Replace the full contents of `launcher/src/config.js` with:

```javascript
const path = require('path')
const fs = require('fs')

const WCS_DIR = 'C:\\WCS'
const CONFIG_FILE = path.join(WCS_DIR, 'config.json')
const ABC_URL_FILE = path.join(WCS_DIR, 'abc-url.txt')

function readConfig() {
  try {
    if (fs.existsSync(CONFIG_FILE)) {
      return JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf8'))
    }
  } catch (e) {}
  return {}
}

function writeConfig(config) {
  try {
    if (!fs.existsSync(WCS_DIR)) fs.mkdirSync(WCS_DIR, { recursive: true })
    fs.writeFileSync(CONFIG_FILE, JSON.stringify(config, null, 2))
  } catch (e) {}
}

function getAbcUrl() {
  // Prefer config.json, fallback to legacy abc-url.txt
  const config = readConfig()
  if (config.abc_url) return config.abc_url
  try {
    if (fs.existsSync(ABC_URL_FILE)) {
      return fs.readFileSync(ABC_URL_FILE, 'utf8').trim()
    }
  } catch (e) {}
  return ''
}

function getLocationFromArgs() {
  const arg = process.argv.find(a => a.startsWith('--location='))
  if (arg) return arg.split('=')[1]
  const config = readConfig()
  return config.location || 'Salem'
}

module.exports = {
  API_URL: process.env.WCS_API_URL || 'https://wcs-auth-api.onrender.com',
  PORTAL_URL: process.env.WCS_PORTAL_URL || 'https://wcs-staff-portal.onrender.com',
  getAbcUrl,
  getLocation: getLocationFromArgs,
  readConfig,
  writeConfig,
  TOOLS: {
    grow: 'https://app.westcoaststrength.com',
    wheniwork: 'https://app.wheniwork.com',
    paychex: 'https://myapps.paychex.com',
  },
  LOCATIONS: {
    Salem: { booking: 'https://api.westcoaststrength.com/widget/booking/Gq92GXsDRAgTGZeHh7mx', vip: 'https://api.westcoaststrength.com/widget/survey/FkrsORfLFVMiVS26LV9V' },
    Springfield: { booking: 'https://api.westcoaststrength.com/widget/booking/PEyaqnkjmBN5tLpo6I9F', vip: 'https://api.westcoaststrength.com/widget/survey/uM48yWzOBhXhUBsG1fhW' },
    Eugene: { booking: 'https://api.westcoaststrength.com/widget/booking/0c9CNdZ65NainMcStWXo', vip: 'https://api.westcoaststrength.com/widget/survey/xKYTE6V7QXKVpkUfWTFi' },
    Keizer: { booking: 'https://api.westcoaststrength.com/widget/booking/8qFo1GnePy0mCgV9avWW', vip: 'https://api.westcoaststrength.com/widget/survey/HXB00WKKe6srvgSmfwI7' },
    Clackamas: { booking: 'https://api.westcoaststrength.com/widget/booking/yOvDLsZMAboTVjv9c2HC', vip: 'https://api.westcoaststrength.com/widget/survey/Z9zEHwjGfQaMIYy9OueF' },
    Milwaukie: { booking: 'https://api.westcoaststrength.com/widget/booking/Gq92GXsDRAgTGZeHh7mx', vip: 'https://api.westcoaststrength.com/widget/survey/FkrsORfLFVMiVS26LV9V' },
    Medford: { booking: 'https://api.westcoaststrength.com/widget/booking/Gq92GXsDRAgTGZeHh7mx', vip: 'https://api.westcoaststrength.com/widget/survey/FkrsORfLFVMiVS26LV9V' },
  },
  WCS_DIR,
  ABC_URL_FILE,
  CONFIG_FILE,
}
```

- [ ] **Step 2: Create auth module**

Create `launcher/src/auth.js`:

```javascript
const { net } = require('electron')
const { API_URL } = require('./config')

let currentToken = null
let currentStaff = null
let cachedCredentials = {}

function request(method, path, body) {
  return new Promise((resolve, reject) => {
    const url = API_URL + path
    const options = { method, url }

    const req = net.request(options)
    req.setHeader('Content-Type', 'application/json')
    if (currentToken) {
      req.setHeader('Authorization', 'Bearer ' + currentToken)
    }

    let responseData = ''
    req.on('response', (response) => {
      response.on('data', (chunk) => { responseData += chunk.toString() })
      response.on('end', () => {
        try {
          const data = JSON.parse(responseData)
          if (response.statusCode >= 400) {
            reject(new Error(data.error || 'Request failed'))
          } else {
            resolve(data)
          }
        } catch {
          reject(new Error('Invalid response'))
        }
      })
    })

    req.on('error', reject)

    if (body) req.write(JSON.stringify(body))
    req.end()
  })
}

async function login(email, password) {
  const data = await request('POST', '/auth/login', { email, password })
  currentToken = data.token
  currentStaff = data.staff
  return data
}

async function fetchCredentials(service) {
  const path = '/vault/credentials' + (service ? '?service=' + service : '')
  const data = await request('GET', path)
  // Cache by service
  for (const cred of data.credentials) {
    cachedCredentials[cred.service] = cred
  }
  return data.credentials
}

async function fetchAllCredentials() {
  const data = await request('GET', '/vault/credentials')
  cachedCredentials = {}
  for (const cred of data.credentials) {
    cachedCredentials[cred.service] = cred
  }
  return data.credentials
}

function getCachedCredential(service) {
  return cachedCredentials[service] || null
}

function getStaff() { return currentStaff }
function getToken() { return currentToken }
function isLoggedIn() { return !!currentToken }

function logout() {
  currentToken = null
  currentStaff = null
  cachedCredentials = {}
}

module.exports = {
  login, logout, isLoggedIn,
  getStaff, getToken,
  fetchCredentials, fetchAllCredentials, getCachedCredential,
}
```

- [ ] **Step 3: Commit**

```bash
git add launcher/src/auth.js launcher/src/config.js
git commit -m "feat: add Electron auth module and update config to use config.json"
```

---

### Task 13: Electron Login Flow in Main Process

**Files:**
- Modify: `launcher/src/main.js`

- [ ] **Step 1: Update main.js with login flow**

Replace the full contents of `launcher/src/main.js` with:

```javascript
const { app, BrowserWindow, ipcMain } = require('electron')
const path = require('path')
const fs = require('fs')
const LOG_FILE = 'C:\\WCS\\app.log'
function log(msg) { try { fs.appendFileSync(LOG_FILE, new Date().toISOString() + ' ' + msg + '\n') } catch {} }
log('=== APP STARTING ===')
const { PORTAL_URL, getAbcUrl, getLocation, readConfig, writeConfig } = require('./config')
const TabManager = require('./tabs')
const { showOverlay, closeOverlay, onResize: onOverlayResize } = require('./overlay')
const { createTray } = require('./tray')
const auth = require('./auth')

const gotLock = app.requestSingleInstanceLock()
if (!gotLock) app.quit()

const TAB_BAR_HEIGHT = 40
let mainWindow = null
let tabManager = null
let loginWindow = null
let idleTimeout = null

function resetIdleTimer() {
  if (idleTimeout) clearTimeout(idleTimeout)
  if (!auth.isLoggedIn()) return
  idleTimeout = setTimeout(() => {
    log('IDLE TIMEOUT — logging out')
    handleLogout()
  }, 10 * 60 * 1000) // 10 minutes
}

function handleLogout() {
  auth.logout()
  if (idleTimeout) clearTimeout(idleTimeout)
  // Close all tabs
  if (tabManager) {
    for (const [id] of tabManager.tabs) {
      tabManager.closeTab(id)
    }
  }
  showLoginWindow()
}

function showLoginWindow() {
  if (loginWindow && !loginWindow.isDestroyed()) {
    loginWindow.focus()
    return
  }

  loginWindow = new BrowserWindow({
    width: 450,
    height: 500,
    parent: mainWindow,
    modal: true,
    frame: false,
    resizable: false,
    webPreferences: {
      preload: path.join(__dirname, 'login-preload.js'),
      contextIsolation: true,
    },
  })

  // Load the portal login page
  const loginUrl = PORTAL_URL + '?mode=electron-login'
  loginWindow.loadURL(loginUrl)
}

function closeLoginWindow() {
  if (loginWindow && !loginWindow.isDestroyed()) {
    loginWindow.close()
    loginWindow = null
  }
}

function startAuthenticatedSession() {
  closeLoginWindow()

  const location = getLocation()
  const abcUrl = getAbcUrl()
  const portalUrl = `${PORTAL_URL}?location=${location}` + (abcUrl ? `&abc_url=${encodeURIComponent(abcUrl)}` : '')

  // Create portal tab
  tabManager.createTab(portalUrl, 'Portal', {
    closable: false,
    preload: path.join(__dirname, 'portal-preload.js'),
  })

  // Pre-fetch all credentials
  auth.fetchAllCredentials().then(() => {
    log('Credentials cached for session')
  }).catch(err => {
    log('Failed to cache credentials: ' + err.message)
  })

  resetIdleTimer()
}

app.on('ready', () => {
  const { session } = require('electron')

  session.defaultSession.webRequest.onHeadersReceived((details, callback) => {
    const headers = { ...details.responseHeaders }
    delete headers['x-frame-options']
    delete headers['X-Frame-Options']
    callback({ responseHeaders: headers })
  })

  mainWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    title: 'WCS App',
    autoHideMenuBar: true,
    frame: false,
    titleBarStyle: 'hidden',
  })

  mainWindow.maximize()
  createTray(mainWindow)

  app.setLoginItemSettings({
    openAtLogin: true,
    path: app.getPath('exe'),
  })

  tabManager = new TabManager(mainWindow, TAB_BAR_HEIGHT)
  tabManager.initTabBar()

  // Show login first
  showLoginWindow()

  // Auth IPC from login preload
  ipcMain.handle('auth-login', async (e, email, password) => {
    try {
      const data = await auth.login(email, password)
      return { success: true, data }
    } catch (err) {
      return { success: false, error: err.message }
    }
  })

  ipcMain.on('auth-login-complete', () => {
    startAuthenticatedSession()
  })

  ipcMain.on('auth-logout', () => {
    handleLogout()
  })

  // Tab IPC
  ipcMain.on('switch-tab', (e, id) => tabManager.switchTo(id))
  ipcMain.on('close-tab', (e, id) => tabManager.closeTab(id))
  ipcMain.on('tabs-ready', () => tabManager.notifyTabBar())

  ipcMain.on('open-in-tab', (e, url) => {
    if (tabManager.onNewWindow) tabManager.onNewWindow(url)
  })

  // Window controls
  ipcMain.on('window-minimize', () => mainWindow.minimize())
  ipcMain.on('window-maximize', () => {
    if (mainWindow.isMaximized()) mainWindow.unmaximize()
    else mainWindow.maximize()
  })
  ipcMain.on('window-close', () => mainWindow.close())

  // ABC scraper IPC
  let latestMemberData = {}

  ipcMain.on('abc-member-data', (e, data) => { latestMemberData = data })

  ipcMain.on('abc-signup-detected', (e, data) => {
    latestMemberData = { ...latestMemberData, ...data }
    log('SIGNUP DETECTED - calling showOverlay')
    showOverlay(latestMemberData, mainWindow, tabManager)
    latestMemberData = {}
  })

  // Credential IPC — preload scripts request creds for auto-fill
  ipcMain.handle('get-credentials', async (e, service) => {
    const cred = auth.getCachedCredential(service)
    if (cred) return { username: cred.username, password: cred.password }
    // Try fetching if not cached
    try {
      await auth.fetchCredentials(service)
      const fetched = auth.getCachedCredential(service)
      if (fetched) return { username: fetched.username, password: fetched.password }
    } catch {}
    return null
  })

  // Kiosk config IPC (admin only)
  ipcMain.handle('get-kiosk-config', () => readConfig())
  ipcMain.handle('set-kiosk-config', (e, config) => {
    writeConfig(config)
    return { success: true }
  })

  // Reset idle timer on any user activity in the main window
  mainWindow.on('focus', resetIdleTimer)

  // Route new windows into tabs
  tabManager.onNewWindow = (url) => {
    resetIdleTimer()
    const abcUrl = getAbcUrl()
    if (url.includes('abcfinancial.com') || url.includes('kiosk.html')) {
      const abcDirect = abcUrl || 'https://prod02.abcfinancial.com'
      tabManager.createTab(abcDirect, 'ABC Financial', {
        preload: path.join(__dirname, 'abc-scraper.js'),
      })
    } else if (url.includes('gohighlevel.com') || url.includes('westcoaststrength.com/')) {
      tabManager.createTab(url, 'Grow')
    } else if (url.includes('wheniwork.com')) {
      tabManager.createTab(url, 'WhenIWork')
    } else if (url.includes('paychex.com')) {
      tabManager.createTab(url, 'Paychex')
    } else if (url !== 'about:blank' && !url.startsWith('chrome')) {
      tabManager.createTab(url, 'Loading...')
    }
  }

  app.on('web-contents-created', (event, contents) => {
    log('NEW WEBCONTENT: ' + contents.getType() + ' ' + contents.getURL())
    contents.on('did-finish-load', () => {
      log('LOADED: ' + contents.getType() + ' ' + contents.getURL())
    })
  })

  mainWindow.on('resize', () => {
    tabManager.layoutViews()
    onOverlayResize()
  })

  const { globalShortcut } = require('electron')
  globalShortcut.register('F12', () => {
    const active = tabManager.tabs.get(tabManager.activeTabId)
    if (active) active.view.webContents.openDevTools()
  })
})

app.on('window-all-closed', (e) => {
  if (!mainWindow || mainWindow.isDestroyed()) app.quit()
})
```

- [ ] **Step 2: Create login preload script**

Create `launcher/src/login-preload.js`:

```javascript
const { contextBridge, ipcRenderer } = require('electron')

contextBridge.exposeInMainWorld('wcsAuth', {
  login: (email, password) => ipcRenderer.invoke('auth-login', email, password),
  loginComplete: () => ipcRenderer.send('auth-login-complete'),
})
```

- [ ] **Step 3: Commit**

```bash
git add launcher/src/main.js launcher/src/login-preload.js
git commit -m "feat: add Electron login flow with modal login window and idle logout"
```

---

### Task 14: ABC Auto-Fill via Vault Credentials

**Files:**
- Modify: `launcher/src/abc-scraper.js`

- [ ] **Step 1: Add auto-fill to abc-scraper.js**

Add the following at the top of `launcher/src/abc-scraper.js`, after the existing `const { ipcRenderer } = require('electron')` line:

```javascript
// Auto-fill ABC login form with vault credentials
async function tryAutoFill() {
  try {
    const creds = await ipcRenderer.invoke('get-credentials', 'abc')
    if (!creds) return

    // Look for ABC login form fields
    const usernameField = document.querySelector('#Username, #username, input[name="Username"], input[name="username"]')
    const passwordField = document.querySelector('#Password, #password, input[name="Password"], input[name="password"]')
    const submitBtn = document.querySelector('input[type="submit"], button[type="submit"]')

    if (usernameField && passwordField) {
      usernameField.value = creds.username
      usernameField.dispatchEvent(new Event('input', { bubbles: true }))
      passwordField.value = creds.password
      passwordField.dispatchEvent(new Event('input', { bubbles: true }))

      // Auto-submit after a brief delay
      if (submitBtn) {
        setTimeout(() => submitBtn.click(), 300)
      }

      console.log('[WCS Scraper] Auto-filled ABC login')
    }
  } catch (err) {
    console.log('[WCS Scraper] Auto-fill skipped:', err.message)
  }
}
```

Then, inside the existing `window.addEventListener('DOMContentLoaded', () => { ... })` block, add at the beginning:

```javascript
  // Attempt auto-fill on login pages
  tryAutoFill()
```

- [ ] **Step 2: Commit**

```bash
git add launcher/src/abc-scraper.js
git commit -m "feat: add ABC Financial auto-fill from vault credentials"
```

---

## Phase 6: Kiosk Configuration

### Task 15: Admin Config Component in Portal

**Files:**
- Create: `portal/src/components/AdminConfig.jsx`
- Modify: `portal/src/App.jsx`

- [ ] **Step 1: Create AdminConfig component**

Create `portal/src/components/AdminConfig.jsx`:

```jsx
import { useState, useEffect } from 'react'

export default function AdminConfig({ isElectron, onClose }) {
  const [location, setLocation] = useState('')
  const [abcUrl, setAbcUrl] = useState('')
  const [saving, setSaving] = useState(false)
  const [message, setMessage] = useState('')

  const LOCATIONS = ['Salem', 'Keizer', 'Eugene', 'Springfield', 'Clackamas', 'Milwaukie', 'Medford']

  useEffect(() => {
    if (isElectron && window.wcsConfig) {
      window.wcsConfig.getConfig().then(config => {
        setLocation(config.location || '')
        setAbcUrl(config.abc_url || '')
      })
    }
  }, [isElectron])

  async function handleSave(e) {
    e.preventDefault()
    setSaving(true)
    setMessage('')

    try {
      if (isElectron && window.wcsConfig) {
        await window.wcsConfig.setConfig({ location, abc_url: abcUrl })
        setMessage('Saved! Restart the app for changes to take effect.')
      }
    } catch {
      setMessage('Failed to save configuration.')
    }

    setSaving(false)
  }

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50" onClick={onClose}>
      <div className="bg-surface rounded-2xl border border-border p-8 w-full max-w-sm" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-6">
          <h2 className="text-lg font-bold text-text-primary">Kiosk Configuration</h2>
          <button onClick={onClose} className="text-text-muted hover:text-text-primary text-xl">&times;</button>
        </div>

        <form onSubmit={handleSave} className="flex flex-col gap-4">
          <div>
            <label className="block text-sm font-medium text-text-secondary mb-1">Location</label>
            <select
              value={location}
              onChange={e => setLocation(e.target.value)}
              className="w-full px-4 py-3 rounded-lg border border-border bg-bg text-text-primary text-sm focus:outline-none focus:ring-2 focus:ring-wcs-red"
            >
              <option value="">Select location...</option>
              {LOCATIONS.map(loc => (
                <option key={loc} value={loc}>{loc}</option>
              ))}
            </select>
          </div>

          <div>
            <label className="block text-sm font-medium text-text-secondary mb-1">ABC Financial URL</label>
            <input
              type="url"
              placeholder="https://prod02.abcfinancial.com/..."
              value={abcUrl}
              onChange={e => setAbcUrl(e.target.value)}
              className="w-full px-4 py-3 rounded-lg border border-border bg-bg text-text-primary text-sm focus:outline-none focus:ring-2 focus:ring-wcs-red"
            />
          </div>

          {message && <p className="text-sm text-text-muted">{message}</p>}

          <button
            type="submit"
            disabled={saving}
            className="w-full py-3 rounded-lg bg-wcs-red text-white font-semibold text-sm hover:bg-wcs-red-hover transition-colors disabled:opacity-50"
          >
            {saving ? 'Saving...' : 'Save Configuration'}
          </button>
        </form>
      </div>
    </div>
  )
}
```

- [ ] **Step 2: Add gear icon and AdminConfig to App.jsx**

In `portal/src/App.jsx`, add the import at the top:

```javascript
import AdminConfig from './components/AdminConfig'
```

Add state for config panel inside the `App` component:

```javascript
const [showConfig, setShowConfig] = useState(false)
const isElectron = !!window.wcsConfig
const isAdmin = user?.staff?.role === 'admin' || user?.staff?.role === 'director'
```

Then in the header, after the location span and before the Sign Out button, add:

```jsx
{isAdmin && (
  <button
    onClick={() => setShowConfig(true)}
    className="text-text-muted hover:text-wcs-red transition-colors"
    title="Kiosk Configuration"
  >
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" className="w-5 h-5">
      <path strokeLinecap="round" strokeLinejoin="round" d="M9.594 3.94c.09-.542.56-.94 1.11-.94h2.593c.55 0 1.02.398 1.11.94l.213 1.281c.063.374.313.686.645.87.074.04.147.083.22.127.325.196.72.257 1.075.124l1.217-.456a1.125 1.125 0 0 1 1.37.49l1.296 2.247a1.125 1.125 0 0 1-.26 1.431l-1.003.827c-.293.241-.438.613-.431.992a7.723 7.723 0 0 1 0 .255c-.007.378.138.75.43.991l1.004.827c.424.35.534.955.26 1.43l-1.298 2.247a1.125 1.125 0 0 1-1.369.491l-1.217-.456c-.355-.133-.75-.072-1.076.124a6.47 6.47 0 0 1-.22.128c-.331.183-.581.495-.644.869l-.213 1.281c-.09.543-.56.941-1.11.941h-2.594c-.55 0-1.019-.398-1.11-.94l-.213-1.281c-.062-.374-.312-.686-.644-.87a6.52 6.52 0 0 1-.22-.127c-.325-.196-.72-.257-1.076-.124l-1.217.456a1.125 1.125 0 0 1-1.369-.49l-1.297-2.247a1.125 1.125 0 0 1 .26-1.431l1.004-.827c.292-.24.437-.613.43-.991a6.932 6.932 0 0 1 0-.255c.007-.38-.138-.751-.43-.992l-1.004-.827a1.125 1.125 0 0 1-.26-1.43l1.297-2.247a1.125 1.125 0 0 1 1.37-.491l1.216.456c.356.133.751.072 1.076-.124.072-.044.146-.086.22-.128.332-.183.582-.495.644-.869l.214-1.28Z" />
      <path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 1 1-6 0 3 3 0 0 1 6 0Z" />
    </svg>
  </button>
)}
```

And before the closing `</div>` of the root element, add:

```jsx
{showConfig && <AdminConfig isElectron={isElectron} onClose={() => setShowConfig(false)} />}
```

- [ ] **Step 3: Create config preload for Electron**

Create `launcher/src/config-preload.js`:

```javascript
const { contextBridge, ipcRenderer } = require('electron')

contextBridge.exposeInMainWorld('wcsConfig', {
  getConfig: () => ipcRenderer.invoke('get-kiosk-config'),
  setConfig: (config) => ipcRenderer.invoke('set-kiosk-config', config),
})
```

Note: This preload needs to be added to the portal tab's preload. In `launcher/src/main.js`, the portal tab creation already uses `portal-preload.js`. You'll need to merge `wcsConfig` into `portal-preload.js`.

- [ ] **Step 4: Add config bridge to portal-preload.js**

Add to the end of `launcher/src/portal-preload.js`:

```javascript
const { contextBridge, ipcRenderer } = require('electron')

contextBridge.exposeInMainWorld('wcsConfig', {
  getConfig: () => ipcRenderer.invoke('get-kiosk-config'),
  setConfig: (config) => ipcRenderer.invoke('set-kiosk-config', config),
})
```

- [ ] **Step 5: Commit**

```bash
git add portal/src/components/AdminConfig.jsx portal/src/App.jsx launcher/src/portal-preload.js
git commit -m "feat: add kiosk configuration panel for admins — location and ABC URL"
```

---

### Task 16: Final Integration Test + Deploy Config

**Files:**
- No new files — verification and deployment setup

- [ ] **Step 1: Add .gitignore entries**

Verify `auth/.env` is gitignored. In root `.gitignore`, ensure these lines exist:

```
.env
auth/.env
```

- [ ] **Step 2: Test full local flow**

1. Start auth API: `cd auth && npm run dev`
2. Start portal: `cd portal && npm run dev`
3. Open portal at http://localhost:3000
4. Login with admin credentials
5. Verify tools appear based on role
6. Verify Sign Out works
7. Test vault: use curl to store and retrieve credentials
8. Test admin: use curl to create a new staff member

- [ ] **Step 3: Add VITE_API_URL to portal build**

For production, add to portal's Render environment:
```
VITE_API_URL=https://wcs-auth-api.onrender.com
```

- [ ] **Step 4: Create Render web service for auth API**

In Render dashboard:
- New Web Service
- Connect to `justinhuttinger/wcs-staff-portal` repo
- Root Directory: `auth`
- Build Command: `npm install`
- Start Command: `npm start`
- Add environment variables: `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `SUPABASE_JWT_SECRET`, `VAULT_ENCRYPTION_KEY`, `PORT`

- [ ] **Step 5: Run seed in production**

After deploy, run seed via Render shell or locally with production env vars:
```bash
cd auth && SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... node seed/seed.js
```

- [ ] **Step 6: Commit any remaining changes**

```bash
git add -A
git commit -m "chore: finalize auth integration — gitignore, deploy config"
```

---

## Summary

| Phase | Tasks | What it delivers |
|-------|-------|-----------------|
| 1: Auth API + DB | Tasks 1-4 | Working login/logout, JWT auth, Supabase schema |
| 2: Vault | Tasks 5-6 | Encrypted credential storage + retrieval |
| 3: Admin + Config | Tasks 7-8 | Staff management, location config, tool visibility |
| 4: Portal Login | Tasks 9-11 | Login screen, tool filtering, logout in React app |
| 5: Electron Login | Tasks 12-14 | Electron login flow, auto-fill from vault |
| 6: Kiosk Config | Tasks 15-16 | Admin config panel, deployment |

Each phase produces independently testable functionality. Phase 1-3 can be tested entirely via curl. Phase 4 adds the portal UI. Phase 5-6 integrate with Electron.
