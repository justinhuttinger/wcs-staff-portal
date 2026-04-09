# GHL Sync Service Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a standalone Node.js sync service that pulls Contacts, Opportunities, Pipelines, and Custom Fields from 7 GHL sub-accounts into Supabase, replacing the buggy sync code in the auth API.

**Architecture:** Standalone Express background worker on Render. Full sync on startup + daily at 3am PST. Delta sync every 10 minutes. Processes locations sequentially with 650ms rate-limit delays. All downstream reporting queries hit Supabase directly.

**Tech Stack:** Node.js, Express 4, @supabase/supabase-js 2, axios, node-cron 3, dotenv

---

## Important Context

### Existing Code Being Replaced
- `auth/src/routes/sync.js` — current buggy sync (no rate limiting, broken pagination, upserts one-at-a-time)
- `auth/src/index.js` — cron job at lines 36-76 that runs the sync hourly
- Reports at `auth/src/routes/reports.js` query `ghl_contacts` with **flat custom field columns** (e.g., `member_sign_date`, `sale_team_member`) — NOT JSONB

### Schema Migration Note
The new schema uses `custom_fields JSONB` instead of flat columns. Reports will need updating to use `custom_fields->>'field_key'` syntax OR we add generated columns. This plan builds the sync service first; reports migration is a follow-up task.

### Existing Table Columns Referenced by Reports
Reports query these flat columns on `ghl_contacts`: `member_sign_date`, `sale_team_member`, `same_day_sale`, `membership_type`, `origin`, `day_one_booking_date`, `day_one_date`, `day_one_sale`, `day_one_trainer`, `day_one_booking_team_member`, `day_one_status`, `show_or_no_show`, `pt_sign_date`, `pt_sale_type`, `pt_value`, `vip_count`

Reports query these columns on `ghl_opportunities`: `pipeline_name`, `stage_name`, `status`, `contact_name`, `assigned_to`, `monetary_value`, `created_date`

### GHL API Key Source
The existing code reads API keys from the `locations` table in Supabase (`ghl_api_key`, `ghl_location_id` columns). The new spec uses env vars per location. We'll use env vars as the spec says — the `ghl_locations` table will store the mapping.

---

## File Structure

```
ghl-sync/
├── src/
│   ├── index.js                 # Express app entry + startup sequence
│   ├── scheduler.js             # node-cron job definitions
│   ├── ghl/
│   │   ├── client.js            # Axios wrapper with rate limiting, pagination, retry
│   │   ├── contacts.js          # Contact fetch + transform
│   │   ├── opportunities.js     # Opportunity fetch + transform
│   │   ├── pipelines.js         # Pipeline/stage metadata fetch
│   │   └── customFields.js      # Custom field definitions fetch
│   ├── db/
│   │   ├── supabase.js          # Supabase client singleton
│   │   ├── upsertContacts.js    # Batch upsert contacts (chunks of 500)
│   │   ├── upsertOpportunities.js
│   │   ├── upsertPipelines.js   # Upsert pipelines + stages
│   │   └── upsertCustomFields.js
│   ├── sync/
│   │   ├── fullSync.js          # Full sync orchestrator (all locations, all entities)
│   │   ├── deltaSync.js         # Incremental sync (contacts/opps since last run)
│   │   └── syncLog.js           # Write results to ghl_sync_log
│   └── config/
│       └── locations.js         # Location ID mapping from env vars
├── migrations/
│   └── 001_ghl_sync_schema.sql  # All table DDL
├── .env.example
├── package.json
└── render.yaml
```

---

## Task 1: Project Scaffolding

**Files:**
- Create: `ghl-sync/package.json`
- Create: `ghl-sync/.env.example`
- Create: `ghl-sync/render.yaml`

- [ ] **Step 1: Create package.json**

```json
{
  "name": "wcs-ghl-sync",
  "version": "1.0.0",
  "private": true,
  "scripts": {
    "start": "node src/index.js",
    "dev": "node --watch src/index.js"
  },
  "dependencies": {
    "@supabase/supabase-js": "^2.49.0",
    "axios": "^1.7.0",
    "node-cron": "^3.0.0",
    "express": "^4.21.0",
    "dotenv": "^16.4.0"
  }
}
```

- [ ] **Step 2: Create .env.example**

```env
# GHL
GHL_API_KEY=
GHL_BASE_URL=https://services.leadconnectorhq.com

# GHL Sub-account Location IDs
GHL_LOCATION_SALEM=
GHL_LOCATION_KEIZER=
GHL_LOCATION_EUGENE=
GHL_LOCATION_SPRINGFIELD=
GHL_LOCATION_CLACKAMAS=
GHL_LOCATION_MILWAUKIE=
GHL_LOCATION_MEDFORD=

# Supabase
SUPABASE_URL=
SUPABASE_SERVICE_ROLE_KEY=

# Sync config
SYNC_INTERVAL_MINUTES=10
FULL_SYNC_HOUR=3
CONTACTS_PAGE_SIZE=100
OPPS_PAGE_SIZE=100
PORT=3000

# API protection
SYNC_SECRET=
```

- [ ] **Step 3: Create render.yaml**

```yaml
services:
  - type: worker
    name: ghl-sync
    runtime: node
    buildCommand: npm install
    startCommand: node src/index.js
    envVars:
      - key: NODE_ENV
        value: production
```

- [ ] **Step 4: Install dependencies**

Run: `cd ghl-sync && npm install`

- [ ] **Step 5: Commit**

```bash
git add ghl-sync/package.json ghl-sync/package-lock.json ghl-sync/.env.example ghl-sync/render.yaml
git commit -m "feat(ghl-sync): scaffold standalone sync service"
```

---

## Task 2: Database Migration

**Files:**
- Create: `ghl-sync/migrations/001_ghl_sync_schema.sql`

- [ ] **Step 1: Create the migration file**

```sql
-- GHL Sync Schema
-- Run in WCS Supabase project (existing project ID: ybopxxydsuwlbwxiuzve)

-- LOCATIONS lookup
CREATE TABLE IF NOT EXISTS ghl_locations (
  id            TEXT PRIMARY KEY,
  name          TEXT NOT NULL,
  slug          TEXT NOT NULL,
  created_at    TIMESTAMPTZ DEFAULT now()
);

-- PIPELINES
CREATE TABLE IF NOT EXISTS ghl_pipelines (
  id            TEXT PRIMARY KEY,
  location_id   TEXT NOT NULL REFERENCES ghl_locations(id),
  name          TEXT NOT NULL,
  synced_at     TIMESTAMPTZ DEFAULT now()
);

-- PIPELINE STAGES
CREATE TABLE IF NOT EXISTS ghl_pipeline_stages (
  id            TEXT PRIMARY KEY,
  pipeline_id   TEXT NOT NULL REFERENCES ghl_pipelines(id),
  name          TEXT NOT NULL,
  position      INTEGER,
  synced_at     TIMESTAMPTZ DEFAULT now()
);

-- CUSTOM FIELD DEFINITIONS
CREATE TABLE IF NOT EXISTS ghl_custom_field_defs (
  id            TEXT PRIMARY KEY,
  location_id   TEXT NOT NULL REFERENCES ghl_locations(id),
  name          TEXT NOT NULL,
  field_key     TEXT,
  data_type     TEXT,
  synced_at     TIMESTAMPTZ DEFAULT now()
);

-- CONTACTS (new table — does NOT replace existing ghl_contacts yet)
CREATE TABLE IF NOT EXISTS ghl_contacts_v2 (
  id                  TEXT PRIMARY KEY,
  location_id         TEXT NOT NULL REFERENCES ghl_locations(id),
  first_name          TEXT,
  last_name           TEXT,
  full_name           TEXT,
  email               TEXT,
  phone               TEXT,
  date_of_birth       DATE,
  address             JSONB,
  tags                TEXT[],
  source              TEXT,
  assigned_user_id    TEXT,
  assigned_user_name  TEXT,
  dnd                 BOOLEAN DEFAULT false,
  type                TEXT,
  custom_fields       JSONB,
  created_at_ghl      TIMESTAMPTZ,
  updated_at_ghl      TIMESTAMPTZ,
  synced_at           TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_ghl_contacts_v2_location ON ghl_contacts_v2(location_id);
CREATE INDEX IF NOT EXISTS idx_ghl_contacts_v2_email ON ghl_contacts_v2(email);
CREATE INDEX IF NOT EXISTS idx_ghl_contacts_v2_updated ON ghl_contacts_v2(updated_at_ghl);
CREATE INDEX IF NOT EXISTS idx_ghl_contacts_v2_tags ON ghl_contacts_v2 USING GIN(tags);

-- OPPORTUNITIES (new table — does NOT replace existing ghl_opportunities yet)
CREATE TABLE IF NOT EXISTS ghl_opportunities_v2 (
  id                  TEXT PRIMARY KEY,
  location_id         TEXT NOT NULL REFERENCES ghl_locations(id),
  contact_id          TEXT REFERENCES ghl_contacts_v2(id),
  pipeline_id         TEXT REFERENCES ghl_pipelines(id),
  stage_id            TEXT REFERENCES ghl_pipeline_stages(id),
  pipeline_name       TEXT,
  stage_name          TEXT,
  name                TEXT,
  status              TEXT,
  monetary_value      NUMERIC(12,2),
  assigned_user_id    TEXT,
  assigned_user_name  TEXT,
  source              TEXT,
  custom_fields       JSONB,
  lost_reason         TEXT,
  created_at_ghl      TIMESTAMPTZ,
  updated_at_ghl      TIMESTAMPTZ,
  closed_at           TIMESTAMPTZ,
  synced_at           TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_ghl_opps_v2_location ON ghl_opportunities_v2(location_id);
CREATE INDEX IF NOT EXISTS idx_ghl_opps_v2_pipeline ON ghl_opportunities_v2(pipeline_id);
CREATE INDEX IF NOT EXISTS idx_ghl_opps_v2_stage ON ghl_opportunities_v2(stage_id);
CREATE INDEX IF NOT EXISTS idx_ghl_opps_v2_status ON ghl_opportunities_v2(status);
CREATE INDEX IF NOT EXISTS idx_ghl_opps_v2_updated ON ghl_opportunities_v2(updated_at_ghl);
CREATE INDEX IF NOT EXISTS idx_ghl_opps_v2_contact ON ghl_opportunities_v2(contact_id);

-- SYNC LOG
CREATE TABLE IF NOT EXISTS ghl_sync_log (
  id              BIGSERIAL PRIMARY KEY,
  sync_type       TEXT NOT NULL,
  entity          TEXT NOT NULL,
  location_id     TEXT,
  records_fetched INTEGER DEFAULT 0,
  records_upserted INTEGER DEFAULT 0,
  errors          JSONB,
  started_at      TIMESTAMPTZ NOT NULL,
  completed_at    TIMESTAMPTZ,
  duration_ms     INTEGER
);

-- SYNC STATE (for delta sync tracking)
CREATE TABLE IF NOT EXISTS ghl_sync_state (
  key         TEXT PRIMARY KEY,
  value       TEXT,
  updated_at  TIMESTAMPTZ DEFAULT now()
);

INSERT INTO ghl_sync_state (key, value)
VALUES ('last_delta_sync', NULL)
ON CONFLICT DO NOTHING;
```

**NOTE:** Tables are named `ghl_contacts_v2` and `ghl_opportunities_v2` to avoid collision with the existing tables the reports currently use. Once reports are migrated, we rename these and drop the old ones.

- [ ] **Step 2: Run migration in Supabase**

Run via Supabase SQL editor or CLI: execute the full SQL file against the WCS project.

- [ ] **Step 3: Verify tables exist**

Run in Supabase SQL editor:
```sql
SELECT table_name FROM information_schema.tables
WHERE table_schema = 'public' AND table_name LIKE 'ghl_%'
ORDER BY table_name;
```

Expected: `ghl_contacts_v2`, `ghl_custom_field_defs`, `ghl_locations`, `ghl_opportunities_v2`, `ghl_pipeline_stages`, `ghl_pipelines`, `ghl_sync_log`, `ghl_sync_state` (plus existing old tables).

- [ ] **Step 4: Commit**

```bash
git add ghl-sync/migrations/001_ghl_sync_schema.sql
git commit -m "feat(ghl-sync): add database migration for sync schema"
```

---

## Task 3: Config + Supabase Client

**Files:**
- Create: `ghl-sync/src/config/locations.js`
- Create: `ghl-sync/src/db/supabase.js`

- [ ] **Step 1: Create locations config**

```js
require('dotenv').config();

const LOCATIONS = [
  { id: process.env.GHL_LOCATION_SALEM,       name: 'Salem',       slug: 'salem' },
  { id: process.env.GHL_LOCATION_KEIZER,      name: 'Keizer',      slug: 'keizer' },
  { id: process.env.GHL_LOCATION_EUGENE,      name: 'Eugene',      slug: 'eugene' },
  { id: process.env.GHL_LOCATION_SPRINGFIELD, name: 'Springfield', slug: 'springfield' },
  { id: process.env.GHL_LOCATION_CLACKAMAS,   name: 'Clackamas',   slug: 'clackamas' },
  { id: process.env.GHL_LOCATION_MILWAUKIE,   name: 'Milwaukie',   slug: 'milwaukie' },
  { id: process.env.GHL_LOCATION_MEDFORD,     name: 'Medford',     slug: 'medford' },
].filter(loc => loc.id); // Skip locations without configured IDs

module.exports = LOCATIONS;
```

- [ ] **Step 2: Create Supabase client**

```js
const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

module.exports = supabase;
```

- [ ] **Step 3: Commit**

```bash
git add ghl-sync/src/config/locations.js ghl-sync/src/db/supabase.js
git commit -m "feat(ghl-sync): add location config and supabase client"
```

---

## Task 4: GHL API Client

**Files:**
- Create: `ghl-sync/src/ghl/client.js`

- [ ] **Step 1: Implement the GHL client**

```js
const axios = require('axios');

const BASE_URL = process.env.GHL_BASE_URL || 'https://services.leadconnectorhq.com';
const API_KEY = process.env.GHL_API_KEY;

const ghlClient = axios.create({
  baseURL: BASE_URL,
  headers: {
    'Authorization': `Bearer ${API_KEY}`,
    'Version': '2021-07-28',
    'Content-Type': 'application/json',
  },
});

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function get(path, params = {}) {
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const res = await ghlClient.get(path, { params });
      return res.data;
    } catch (err) {
      if (err.response?.status === 429 && attempt < 3) {
        console.warn(`[GHL] Rate limited on ${path}, retrying in 5s (attempt ${attempt}/3)`);
        await sleep(5000);
        continue;
      }
      throw err;
    }
  }
}

/**
 * Paginate through a GHL endpoint using cursor-based pagination.
 * @param {string} path - API path
 * @param {object} baseParams - Base query params (e.g., locationId, limit)
 * @param {string} itemsKey - Key in response containing the array (e.g., 'contacts')
 * @param {object} options
 * @param {'cursor'|'offset'} options.paginationType - 'cursor' uses last item ID, 'offset' uses numeric offset
 * @param {string} options.cursorParam - Query param name for pagination (default: 'startAfter')
 * @param {number} options.maxRecords - Safety cap (default: 50000)
 */
async function getPaginated(path, baseParams, itemsKey, options = {}) {
  const {
    paginationType = 'cursor',
    cursorParam = 'startAfter',
    maxRecords = 50000,
  } = options;

  const allItems = [];
  let cursor = null;
  let offset = 0;
  let pageNum = 0;
  const limit = baseParams.limit || 100;
  const locationId = baseParams.locationId || baseParams.location_id || 'unknown';

  while (true) {
    const params = { ...baseParams };

    if (paginationType === 'cursor' && cursor) {
      params[cursorParam] = cursor;
    } else if (paginationType === 'offset' && offset > 0) {
      params[cursorParam] = offset;
    }

    const data = await get(path, params);
    const items = data[itemsKey] || [];
    pageNum++;

    console.log(`[GHL] Fetched page ${pageNum} for ${itemsKey} @ ${locationId}: ${items.length} records`);

    allItems.push(...items);

    if (items.length < limit || allItems.length >= maxRecords) {
      break;
    }

    if (paginationType === 'cursor') {
      cursor = items[items.length - 1]?.id;
      if (!cursor) break;
    } else {
      offset += limit;
    }

    await sleep(650); // Rate limit: ~100 req/min
  }

  return allItems;
}

module.exports = { get, getPaginated, sleep };
```

- [ ] **Step 2: Commit**

```bash
git add ghl-sync/src/ghl/client.js
git commit -m "feat(ghl-sync): GHL API client with pagination and rate limiting"
```

---

## Task 5: Contact Fetch + Transform

**Files:**
- Create: `ghl-sync/src/ghl/contacts.js`

- [ ] **Step 1: Implement contacts module**

```js
const { getPaginated } = require('./client');

const PAGE_SIZE = parseInt(process.env.CONTACTS_PAGE_SIZE) || 100;

async function fetchAllContacts(locationId) {
  return getPaginated(
    '/contacts/',
    { locationId, limit: PAGE_SIZE },
    'contacts',
    { paginationType: 'cursor', cursorParam: 'startAfter' }
  );
}

async function fetchContactsDelta(locationId, sinceDate) {
  // startAfterDate returns contacts updated after this ISO date
  // Overlap by 5 minutes to avoid missing records
  const overlap = new Date(new Date(sinceDate).getTime() - 5 * 60 * 1000);
  return getPaginated(
    '/contacts/',
    { locationId, limit: PAGE_SIZE, startAfterDate: overlap.toISOString() },
    'contacts',
    { paginationType: 'cursor', cursorParam: 'startAfter' }
  );
}

function transformContact(raw, locationId) {
  // Transform customFields array [{id, value}] → JSONB object {id: value}
  const customFields = {};
  for (const field of (raw.customFields || [])) {
    if (field.id && field.value !== undefined && field.value !== null) {
      customFields[field.id] = field.value;
    }
  }

  return {
    id: raw.id,
    location_id: locationId,
    first_name: raw.firstName || null,
    last_name: raw.lastName || null,
    full_name: raw.name || [raw.firstName, raw.lastName].filter(Boolean).join(' ') || null,
    email: raw.email || null,
    phone: normalizePhone(raw.phone),
    date_of_birth: raw.dateOfBirth || null,
    address: raw.address ? {
      line1: raw.address.line1 || raw.address.address1 || null,
      city: raw.address.city || null,
      state: raw.address.state || null,
      zip: raw.address.postalCode || raw.address.zip || null,
    } : null,
    tags: raw.tags || [],
    source: raw.source || null,
    assigned_user_id: raw.assignedTo || null,
    assigned_user_name: null, // GHL doesn't include user name in list endpoint
    dnd: raw.dnd || false,
    type: raw.type || null,
    custom_fields: Object.keys(customFields).length > 0 ? customFields : null,
    created_at_ghl: raw.dateAdded || raw.createdAt || null,
    updated_at_ghl: raw.dateUpdated || raw.updatedAt || null,
    synced_at: new Date().toISOString(),
  };
}

function normalizePhone(phone) {
  if (!phone) return null;
  // Strip everything except digits and leading +
  return phone.replace(/[^\d+]/g, '') || null;
}

module.exports = { fetchAllContacts, fetchContactsDelta, transformContact };
```

- [ ] **Step 2: Commit**

```bash
git add ghl-sync/src/ghl/contacts.js
git commit -m "feat(ghl-sync): contact fetch with cursor pagination and transform"
```

---

## Task 6: Opportunity, Pipeline, Custom Field Fetchers

**Files:**
- Create: `ghl-sync/src/ghl/opportunities.js`
- Create: `ghl-sync/src/ghl/pipelines.js`
- Create: `ghl-sync/src/ghl/customFields.js`

- [ ] **Step 1: Implement opportunities module**

```js
const { getPaginated } = require('./client');

const PAGE_SIZE = parseInt(process.env.OPPS_PAGE_SIZE) || 100;

async function fetchAllOpportunities(locationId) {
  return getPaginated(
    '/opportunities/search',
    { location_id: locationId, limit: PAGE_SIZE },
    'opportunities',
    { paginationType: 'offset', cursorParam: 'startAfter' }
  );
}

async function fetchOpportunitiesDelta(locationId, sinceDate) {
  // Overlap by 5 minutes
  const overlap = new Date(new Date(sinceDate).getTime() - 5 * 60 * 1000);
  return getPaginated(
    '/opportunities/search',
    { location_id: locationId, limit: PAGE_SIZE, date: overlap.toISOString() },
    'opportunities',
    { paginationType: 'offset', cursorParam: 'startAfter' }
  );
}

function transformOpportunity(raw, locationId) {
  const customFields = {};
  for (const field of (raw.customFields || [])) {
    if (field.id && field.value !== undefined && field.value !== null) {
      customFields[field.id] = field.value;
    }
  }

  return {
    id: raw.id,
    location_id: locationId,
    contact_id: raw.contactId || null,
    pipeline_id: raw.pipelineId || null,
    stage_id: raw.pipelineStageId || null,
    pipeline_name: raw.pipelineName || raw.pipeline?.name || null,
    stage_name: raw.stageName || raw.stage?.name || null,
    name: raw.name || null,
    status: raw.status || null,
    monetary_value: raw.monetaryValue != null ? parseFloat(raw.monetaryValue) : null,
    assigned_user_id: raw.assignedTo || null,
    assigned_user_name: null,
    source: raw.source || null,
    custom_fields: Object.keys(customFields).length > 0 ? customFields : null,
    lost_reason: raw.lostReasonId || null,
    created_at_ghl: raw.createdAt || null,
    updated_at_ghl: raw.updatedAt || null,
    closed_at: raw.closedAt || raw.closedDate || null,
    synced_at: new Date().toISOString(),
  };
}

module.exports = { fetchAllOpportunities, fetchOpportunitiesDelta, transformOpportunity };
```

- [ ] **Step 2: Implement pipelines module**

```js
const { get } = require('./client');

async function fetchPipelines(locationId) {
  const data = await get('/opportunities/pipelines', { locationId });
  const pipelines = data.pipelines || [];

  return pipelines.map(p => ({
    id: p.id,
    name: p.name,
    stages: (p.stages || []).map(s => ({
      id: s.id,
      name: s.name,
      position: s.position || 0,
    })),
  }));
}

module.exports = { fetchPipelines };
```

- [ ] **Step 3: Implement custom fields module**

```js
const { get } = require('./client');

async function fetchCustomFields(locationId) {
  const data = await get(`/locations/${locationId}/customFields`);
  const fields = data.customFields || [];

  return fields.map(f => ({
    id: f.id,
    name: f.name,
    field_key: f.fieldKey || null,
    data_type: f.dataType || null,
  }));
}

module.exports = { fetchCustomFields };
```

- [ ] **Step 4: Commit**

```bash
git add ghl-sync/src/ghl/opportunities.js ghl-sync/src/ghl/pipelines.js ghl-sync/src/ghl/customFields.js
git commit -m "feat(ghl-sync): opportunity, pipeline, and custom field fetchers"
```

---

## Task 7: Upsert Layer

**Files:**
- Create: `ghl-sync/src/db/upsertContacts.js`
- Create: `ghl-sync/src/db/upsertOpportunities.js`
- Create: `ghl-sync/src/db/upsertPipelines.js`
- Create: `ghl-sync/src/db/upsertCustomFields.js`

- [ ] **Step 1: Implement contact upsert with batching**

```js
const supabase = require('./supabase');

const BATCH_SIZE = 500;

async function upsertContacts(contacts) {
  let upserted = 0;
  const errors = [];

  for (let i = 0; i < contacts.length; i += BATCH_SIZE) {
    const batch = contacts.slice(i, i + BATCH_SIZE);
    const { error, count } = await supabase
      .from('ghl_contacts_v2')
      .upsert(batch, { onConflict: 'id', count: 'exact' });

    if (error) {
      console.error(`[DB] Contact upsert batch error:`, error.message);
      errors.push({ batch: Math.floor(i / BATCH_SIZE), error: error.message });
    } else {
      upserted += count || batch.length;
    }
  }

  return { upserted, errors };
}

module.exports = { upsertContacts };
```

- [ ] **Step 2: Implement opportunity upsert**

```js
const supabase = require('./supabase');

const BATCH_SIZE = 500;

async function upsertOpportunities(opportunities) {
  let upserted = 0;
  const errors = [];

  for (let i = 0; i < opportunities.length; i += BATCH_SIZE) {
    const batch = opportunities.slice(i, i + BATCH_SIZE);

    // Remove contact_id FK reference if contact doesn't exist yet
    // Use a simpler approach: set contact_id to null if FK would fail
    const { error, count } = await supabase
      .from('ghl_opportunities_v2')
      .upsert(batch, { onConflict: 'id', count: 'exact' });

    if (error) {
      // If FK violation, retry without contact_id
      if (error.code === '23503') {
        const batchNoFk = batch.map(o => ({ ...o, contact_id: null }));
        const retry = await supabase
          .from('ghl_opportunities_v2')
          .upsert(batchNoFk, { onConflict: 'id', count: 'exact' });
        if (retry.error) {
          errors.push({ batch: Math.floor(i / BATCH_SIZE), error: retry.error.message });
        } else {
          upserted += retry.count || batchNoFk.length;
        }
      } else {
        console.error(`[DB] Opportunity upsert batch error:`, error.message);
        errors.push({ batch: Math.floor(i / BATCH_SIZE), error: error.message });
      }
    } else {
      upserted += count || batch.length;
    }
  }

  return { upserted, errors };
}

module.exports = { upsertOpportunities };
```

- [ ] **Step 3: Implement pipeline + stage upsert**

```js
const supabase = require('./supabase');

async function upsertPipelines(pipelines, locationId) {
  let pipelinesUpserted = 0;
  let stagesUpserted = 0;
  const errors = [];

  for (const pipeline of pipelines) {
    const pipelineRow = {
      id: pipeline.id,
      location_id: locationId,
      name: pipeline.name,
      synced_at: new Date().toISOString(),
    };

    const { error: pError } = await supabase
      .from('ghl_pipelines')
      .upsert(pipelineRow, { onConflict: 'id' });

    if (pError) {
      errors.push({ pipeline: pipeline.id, error: pError.message });
      continue;
    }
    pipelinesUpserted++;

    // Upsert stages for this pipeline
    if (pipeline.stages.length > 0) {
      const stageRows = pipeline.stages.map(s => ({
        id: s.id,
        pipeline_id: pipeline.id,
        name: s.name,
        position: s.position,
        synced_at: new Date().toISOString(),
      }));

      const { error: sError, count } = await supabase
        .from('ghl_pipeline_stages')
        .upsert(stageRows, { onConflict: 'id', count: 'exact' });

      if (sError) {
        errors.push({ pipeline: pipeline.id, stagesError: sError.message });
      } else {
        stagesUpserted += count || stageRows.length;
      }
    }
  }

  return { pipelinesUpserted, stagesUpserted, errors };
}

module.exports = { upsertPipelines };
```

- [ ] **Step 4: Implement custom field upsert**

```js
const supabase = require('./supabase');

async function upsertCustomFields(fields, locationId) {
  let upserted = 0;
  const errors = [];

  const rows = fields.map(f => ({
    id: f.id,
    location_id: locationId,
    name: f.name,
    field_key: f.field_key,
    data_type: f.data_type,
    synced_at: new Date().toISOString(),
  }));

  if (rows.length === 0) return { upserted: 0, errors: [] };

  const { error, count } = await supabase
    .from('ghl_custom_field_defs')
    .upsert(rows, { onConflict: 'id', count: 'exact' });

  if (error) {
    errors.push({ error: error.message });
  } else {
    upserted = count || rows.length;
  }

  return { upserted, errors };
}

module.exports = { upsertCustomFields };
```

- [ ] **Step 5: Commit**

```bash
git add ghl-sync/src/db/
git commit -m "feat(ghl-sync): batch upsert layer for all entities"
```

---

## Task 8: Sync Log

**Files:**
- Create: `ghl-sync/src/sync/syncLog.js`

- [ ] **Step 1: Implement sync logging**

```js
const supabase = require('../db/supabase');

async function writeSyncLog({ syncType, entity, locationId, recordsFetched, recordsUpserted, errors, startedAt }) {
  const completedAt = new Date();
  const durationMs = completedAt.getTime() - new Date(startedAt).getTime();

  const { error } = await supabase
    .from('ghl_sync_log')
    .insert({
      sync_type: syncType,
      entity,
      location_id: locationId,
      records_fetched: recordsFetched,
      records_upserted: recordsUpserted,
      errors: errors.length > 0 ? errors : null,
      started_at: startedAt,
      completed_at: completedAt.toISOString(),
      duration_ms: durationMs,
    });

  if (error) {
    console.error(`[SyncLog] Failed to write log:`, error.message);
  }
}

module.exports = { writeSyncLog };
```

- [ ] **Step 2: Commit**

```bash
git add ghl-sync/src/sync/syncLog.js
git commit -m "feat(ghl-sync): sync log writer"
```

---

## Task 9: Full Sync Orchestrator

**Files:**
- Create: `ghl-sync/src/sync/fullSync.js`

- [ ] **Step 1: Implement full sync**

```js
const LOCATIONS = require('../config/locations');
const supabase = require('../db/supabase');
const { fetchCustomFields } = require('../ghl/customFields');
const { fetchPipelines } = require('../ghl/pipelines');
const { fetchAllContacts, transformContact } = require('../ghl/contacts');
const { fetchAllOpportunities, transformOpportunity } = require('../ghl/opportunities');
const { upsertContacts } = require('../db/upsertContacts');
const { upsertOpportunities } = require('../db/upsertOpportunities');
const { upsertPipelines } = require('../db/upsertPipelines');
const { upsertCustomFields } = require('../db/upsertCustomFields');
const { writeSyncLog } = require('./syncLog');

async function syncLocation(location, syncType) {
  console.log(`[Sync] Starting ${syncType} sync for ${location.name} (${location.id})`);

  // 1. Upsert location record
  await supabase.from('ghl_locations').upsert({
    id: location.id,
    name: location.name,
    slug: location.slug,
  }, { onConflict: 'id' });

  // 2. Custom fields
  let cfStart = new Date().toISOString();
  try {
    const rawFields = await fetchCustomFields(location.id);
    const cfResult = await upsertCustomFields(rawFields, location.id);
    console.log(`[Sync] ${location.name}: ${cfResult.upserted} custom field defs`);
    await writeSyncLog({ syncType, entity: 'custom_fields', locationId: location.id, recordsFetched: rawFields.length, recordsUpserted: cfResult.upserted, errors: cfResult.errors, startedAt: cfStart });
  } catch (err) {
    console.error(`[Sync] ${location.name} custom fields failed:`, err.message);
    await writeSyncLog({ syncType, entity: 'custom_fields', locationId: location.id, recordsFetched: 0, recordsUpserted: 0, errors: [{ error: err.message }], startedAt: cfStart });
  }

  // 3. Pipelines + stages
  let pipStart = new Date().toISOString();
  try {
    const rawPipelines = await fetchPipelines(location.id);
    const pipResult = await upsertPipelines(rawPipelines, location.id);
    console.log(`[Sync] ${location.name}: ${pipResult.pipelinesUpserted} pipelines, ${pipResult.stagesUpserted} stages`);
    await writeSyncLog({ syncType, entity: 'pipelines', locationId: location.id, recordsFetched: rawPipelines.length, recordsUpserted: pipResult.pipelinesUpserted, errors: pipResult.errors, startedAt: pipStart });
  } catch (err) {
    console.error(`[Sync] ${location.name} pipelines failed:`, err.message);
    await writeSyncLog({ syncType, entity: 'pipelines', locationId: location.id, recordsFetched: 0, recordsUpserted: 0, errors: [{ error: err.message }], startedAt: pipStart });
  }

  // 4. Contacts
  let ctStart = new Date().toISOString();
  try {
    const rawContacts = await fetchAllContacts(location.id);
    const contacts = rawContacts.map(c => transformContact(c, location.id));
    const ctResult = await upsertContacts(contacts);
    console.log(`[Sync] ${location.name}: ${rawContacts.length} contacts fetched, ${ctResult.upserted} upserted`);
    await writeSyncLog({ syncType, entity: 'contacts', locationId: location.id, recordsFetched: rawContacts.length, recordsUpserted: ctResult.upserted, errors: ctResult.errors, startedAt: ctStart });
  } catch (err) {
    console.error(`[Sync] ${location.name} contacts failed:`, err.message);
    await writeSyncLog({ syncType, entity: 'contacts', locationId: location.id, recordsFetched: 0, recordsUpserted: 0, errors: [{ error: err.message }], startedAt: ctStart });
  }

  // 5. Opportunities
  let opStart = new Date().toISOString();
  try {
    const rawOpps = await fetchAllOpportunities(location.id);
    const opps = rawOpps.map(o => transformOpportunity(o, location.id));
    const opResult = await upsertOpportunities(opps);
    console.log(`[Sync] ${location.name}: ${rawOpps.length} opportunities fetched, ${opResult.upserted} upserted`);
    await writeSyncLog({ syncType, entity: 'opportunities', locationId: location.id, recordsFetched: rawOpps.length, recordsUpserted: opResult.upserted, errors: opResult.errors, startedAt: opStart });
  } catch (err) {
    console.error(`[Sync] ${location.name} opportunities failed:`, err.message);
    await writeSyncLog({ syncType, entity: 'opportunities', locationId: location.id, recordsFetched: 0, recordsUpserted: 0, errors: [{ error: err.message }], startedAt: opStart });
  }

  console.log(`[Sync] Completed ${syncType} sync for ${location.name}`);
}

async function fullSync() {
  console.log(`[Sync] Starting full sync for ${LOCATIONS.length} locations`);
  const start = Date.now();

  for (const location of LOCATIONS) {
    await syncLocation(location, 'full');
  }

  const duration = ((Date.now() - start) / 1000).toFixed(1);
  console.log(`[Sync] Full sync complete in ${duration}s`);
}

async function fullSyncForLocation(slug) {
  const location = LOCATIONS.find(l => l.slug === slug);
  if (!location) throw new Error(`Location not found: ${slug}`);
  await syncLocation(location, 'full');
}

module.exports = { fullSync, fullSyncForLocation };
```

- [ ] **Step 2: Commit**

```bash
git add ghl-sync/src/sync/fullSync.js
git commit -m "feat(ghl-sync): full sync orchestrator for all locations"
```

---

## Task 10: Delta Sync

**Files:**
- Create: `ghl-sync/src/sync/deltaSync.js`

- [ ] **Step 1: Implement delta sync**

```js
const LOCATIONS = require('../config/locations');
const supabase = require('../db/supabase');
const { fetchContactsDelta, transformContact } = require('../ghl/contacts');
const { fetchOpportunitiesDelta, transformOpportunity } = require('../ghl/opportunities');
const { upsertContacts } = require('../db/upsertContacts');
const { upsertOpportunities } = require('../db/upsertOpportunities');
const { writeSyncLog } = require('./syncLog');

async function getLastDeltaSync() {
  const { data } = await supabase
    .from('ghl_sync_state')
    .select('value')
    .eq('key', 'last_delta_sync')
    .single();

  return data?.value || null;
}

async function updateLastDeltaSync(timestamp) {
  await supabase
    .from('ghl_sync_state')
    .upsert({
      key: 'last_delta_sync',
      value: timestamp,
      updated_at: new Date().toISOString(),
    }, { onConflict: 'key' });
}

async function deltaSync() {
  const lastSync = await getLastDeltaSync();

  if (!lastSync) {
    console.log('[Delta] No previous delta sync found — skipping (full sync needed first)');
    return;
  }

  console.log(`[Delta] Starting delta sync since ${lastSync}`);
  const start = Date.now();
  const syncTimestamp = new Date().toISOString();

  for (const location of LOCATIONS) {
    // Contacts delta
    let ctStart = new Date().toISOString();
    try {
      const rawContacts = await fetchContactsDelta(location.id, lastSync);
      if (rawContacts.length > 0) {
        const contacts = rawContacts.map(c => transformContact(c, location.id));
        const result = await upsertContacts(contacts);
        console.log(`[Delta] ${location.name}: ${rawContacts.length} contacts updated, ${result.upserted} upserted`);
        await writeSyncLog({ syncType: 'delta', entity: 'contacts', locationId: location.id, recordsFetched: rawContacts.length, recordsUpserted: result.upserted, errors: result.errors, startedAt: ctStart });
      }
    } catch (err) {
      console.error(`[Delta] ${location.name} contacts failed:`, err.message);
      await writeSyncLog({ syncType: 'delta', entity: 'contacts', locationId: location.id, recordsFetched: 0, recordsUpserted: 0, errors: [{ error: err.message }], startedAt: ctStart });
    }

    // Opportunities delta
    let opStart = new Date().toISOString();
    try {
      const rawOpps = await fetchOpportunitiesDelta(location.id, lastSync);
      if (rawOpps.length > 0) {
        const opps = rawOpps.map(o => transformOpportunity(o, location.id));
        const result = await upsertOpportunities(opps);
        console.log(`[Delta] ${location.name}: ${rawOpps.length} opportunities updated, ${result.upserted} upserted`);
        await writeSyncLog({ syncType: 'delta', entity: 'opportunities', locationId: location.id, recordsFetched: rawOpps.length, recordsUpserted: result.upserted, errors: result.errors, startedAt: opStart });
      }
    } catch (err) {
      console.error(`[Delta] ${location.name} opportunities failed:`, err.message);
      await writeSyncLog({ syncType: 'delta', entity: 'opportunities', locationId: location.id, recordsFetched: 0, recordsUpserted: 0, errors: [{ error: err.message }], startedAt: opStart });
    }
  }

  await updateLastDeltaSync(syncTimestamp);
  const duration = ((Date.now() - start) / 1000).toFixed(1);
  console.log(`[Delta] Delta sync complete in ${duration}s`);
}

module.exports = { deltaSync };
```

- [ ] **Step 2: Commit**

```bash
git add ghl-sync/src/sync/deltaSync.js
git commit -m "feat(ghl-sync): delta sync with timestamp tracking"
```

---

## Task 11: Scheduler

**Files:**
- Create: `ghl-sync/src/scheduler.js`

- [ ] **Step 1: Implement scheduler**

```js
const cron = require('node-cron');
const { fullSync } = require('./sync/fullSync');
const { deltaSync } = require('./sync/deltaSync');

function startScheduler() {
  const intervalMinutes = process.env.SYNC_INTERVAL_MINUTES || 10;
  const fullSyncHour = process.env.FULL_SYNC_HOUR || 3; // PST
  // Convert PST to UTC: PST + 8 = UTC (or +7 during PDT)
  // Use 11 UTC = 3am PST (standard) or 10 UTC = 3am PDT
  const fullSyncHourUTC = (parseInt(fullSyncHour) + 8) % 24;

  // Delta sync every N minutes
  cron.schedule(`*/${intervalMinutes} * * * *`, () => {
    console.log('[Scheduler] Starting delta sync...');
    deltaSync().catch(err => console.error('[Scheduler] Delta sync failed:', err.message));
  });

  // Full re-sync daily
  cron.schedule(`0 ${fullSyncHourUTC} * * *`, () => {
    console.log('[Scheduler] Starting daily full sync...');
    fullSync().catch(err => console.error('[Scheduler] Full sync failed:', err.message));
  });

  console.log(`[Scheduler] Delta sync every ${intervalMinutes}m, full sync daily at ${fullSyncHour}:00 PST (${fullSyncHourUTC}:00 UTC)`);
}

module.exports = { startScheduler };
```

- [ ] **Step 2: Commit**

```bash
git add ghl-sync/src/scheduler.js
git commit -m "feat(ghl-sync): cron scheduler for delta and full sync"
```

---

## Task 12: Express App + API Endpoints

**Files:**
- Create: `ghl-sync/src/index.js`

- [ ] **Step 1: Implement Express app with all endpoints**

```js
require('dotenv').config();
const express = require('express');
const { fullSync, fullSyncForLocation } = require('./sync/fullSync');
const { deltaSync } = require('./sync/deltaSync');
const { startScheduler } = require('./scheduler');
const supabase = require('./db/supabase');

const app = express();
app.use(express.json());

const PORT = process.env.PORT || 3000;
const SYNC_SECRET = process.env.SYNC_SECRET;

// Auth middleware for POST endpoints
function requireSecret(req, res, next) {
  if (!SYNC_SECRET) return next(); // No secret configured = no auth (dev mode)
  if (req.headers['x-sync-secret'] !== SYNC_SECRET) {
    return res.status(401).json({ error: 'Invalid sync secret' });
  }
  next();
}

// Track running syncs to prevent overlap
let syncRunning = false;

// GET /health
app.get('/health', async (req, res) => {
  const { data: lastDelta } = await supabase
    .from('ghl_sync_log')
    .select('completed_at')
    .eq('sync_type', 'delta')
    .order('completed_at', { ascending: false })
    .limit(1)
    .single();

  const { data: lastFull } = await supabase
    .from('ghl_sync_log')
    .select('completed_at')
    .eq('sync_type', 'full')
    .order('completed_at', { ascending: false })
    .limit(1)
    .single();

  res.json({
    status: 'ok',
    uptime: process.uptime(),
    syncRunning,
    lastDelta: lastDelta?.completed_at || null,
    lastFull: lastFull?.completed_at || null,
  });
});

// POST /api/sync/full
app.post('/api/sync/full', requireSecret, (req, res) => {
  if (syncRunning) return res.status(409).json({ error: 'Sync already in progress' });
  syncRunning = true;
  res.json({ status: 'started', message: 'Full sync running in background' });
  fullSync()
    .catch(err => console.error('[API] Full sync failed:', err.message))
    .finally(() => { syncRunning = false; });
});

// POST /api/sync/delta
app.post('/api/sync/delta', requireSecret, (req, res) => {
  if (syncRunning) return res.status(409).json({ error: 'Sync already in progress' });
  syncRunning = true;
  res.json({ status: 'started', message: 'Delta sync running in background' });
  deltaSync()
    .catch(err => console.error('[API] Delta sync failed:', err.message))
    .finally(() => { syncRunning = false; });
});

// POST /api/sync/full/:locationSlug
app.post('/api/sync/full/:locationSlug', requireSecret, (req, res) => {
  if (syncRunning) return res.status(409).json({ error: 'Sync already in progress' });
  syncRunning = true;
  res.json({ status: 'started', message: `Full sync for ${req.params.locationSlug} running` });
  fullSyncForLocation(req.params.locationSlug)
    .catch(err => console.error(`[API] Full sync for ${req.params.locationSlug} failed:`, err.message))
    .finally(() => { syncRunning = false; });
});

// GET /api/sync/logs
app.get('/api/sync/logs', async (req, res) => {
  const limit = parseInt(req.query.limit) || 50;
  const { data, error } = await supabase
    .from('ghl_sync_log')
    .select('*')
    .order('started_at', { ascending: false })
    .limit(limit);

  if (error) return res.status(500).json({ error: error.message });
  res.json(data);
});

// GET /api/sync/status
app.get('/api/sync/status', async (req, res) => {
  const { data: lastDelta } = await supabase
    .from('ghl_sync_log')
    .select('*')
    .eq('sync_type', 'delta')
    .order('completed_at', { ascending: false })
    .limit(1)
    .single();

  const { data: lastFull } = await supabase
    .from('ghl_sync_log')
    .select('*')
    .eq('sync_type', 'full')
    .order('completed_at', { ascending: false })
    .limit(1)
    .single();

  const { count: contactCount } = await supabase
    .from('ghl_contacts_v2')
    .select('*', { count: 'exact', head: true });

  const { count: oppCount } = await supabase
    .from('ghl_opportunities_v2')
    .select('*', { count: 'exact', head: true });

  res.json({
    syncRunning,
    lastDelta,
    lastFull,
    recordCounts: {
      contacts: contactCount || 0,
      opportunities: oppCount || 0,
    },
  });
});

// Startup
async function main() {
  console.log('[Startup] GHL Sync Service starting...');

  // 1. Verify Supabase connection
  const { error } = await supabase.from('ghl_sync_state').select('key').limit(1);
  if (error) {
    console.error('[Startup] Supabase connection failed:', error.message);
    process.exit(1);
  }
  console.log('[Startup] Supabase connected');

  // 2. Run initial full sync
  console.log('[Startup] Running initial full sync...');
  syncRunning = true;
  try {
    await fullSync();
  } catch (err) {
    console.error('[Startup] Initial full sync failed:', err.message);
  }
  syncRunning = false;

  // 3. Start scheduler
  startScheduler();

  // 4. Start Express (needed even for worker — health checks + manual triggers)
  app.listen(PORT, () => console.log(`[API] Listening on :${PORT}`));
}

main();
```

- [ ] **Step 2: Commit**

```bash
git add ghl-sync/src/index.js
git commit -m "feat(ghl-sync): express app with health, sync triggers, and startup sequence"
```

---

## Task 13: Create .env File for Deployment

**Files:**
- Create: `ghl-sync/.env` (local only, NOT committed)

- [ ] **Step 1: Create local .env**

Copy `.env.example` to `.env` and fill in values:
- `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` — from existing WCS project
- `GHL_API_KEY` — the agency-level private integration token
- `GHL_LOCATION_*` — the 7 location IDs (these are in the existing `locations` table's `ghl_location_id` column)
- `SYNC_SECRET` — generate a random string

- [ ] **Step 2: Add .env to .gitignore**

Check that `ghl-sync/.env` is in `.gitignore`. If not, add it.

- [ ] **Step 3: Verify .env is NOT staged**

Run: `git status` — confirm `.env` does not appear in staged files.

---

## Task 14: Smoke Test

- [ ] **Step 1: Run the migration SQL in Supabase**

Execute `ghl-sync/migrations/001_ghl_sync_schema.sql` via Supabase SQL Editor.

- [ ] **Step 2: Start the service locally**

Run: `cd ghl-sync && npm run dev`

Watch for:
- `[Startup] Supabase connected`
- `[Startup] Running initial full sync...`
- `[GHL] Fetched page N for contacts @ ...` logs appearing
- `[Sync] Completed full sync for Salem` (and each location)
- `[Scheduler] Delta sync every 10m, full sync daily at 3:00 PST`
- `[API] Listening on :3000`

- [ ] **Step 3: Verify data in Supabase**

Run in SQL Editor:
```sql
SELECT 'contacts' AS entity, COUNT(*) FROM ghl_contacts_v2
UNION ALL
SELECT 'opportunities', COUNT(*) FROM ghl_opportunities_v2
UNION ALL
SELECT 'pipelines', COUNT(*) FROM ghl_pipelines
UNION ALL
SELECT 'stages', COUNT(*) FROM ghl_pipeline_stages
UNION ALL
SELECT 'custom_fields', COUNT(*) FROM ghl_custom_field_defs
UNION ALL
SELECT 'sync_logs', COUNT(*) FROM ghl_sync_log;
```

- [ ] **Step 4: Test API endpoints**

```bash
# Health check
curl http://localhost:3000/health

# Sync status
curl http://localhost:3000/api/sync/status

# Sync logs
curl http://localhost:3000/api/sync/logs?limit=10

# Manual delta sync
curl -X POST http://localhost:3000/api/sync/delta -H "x-sync-secret: YOUR_SECRET"

# Single location sync
curl -X POST http://localhost:3000/api/sync/full/salem -H "x-sync-secret: YOUR_SECRET"
```

- [ ] **Step 5: Final commit**

```bash
git add ghl-sync/
git commit -m "feat(ghl-sync): complete standalone GHL sync service"
```

---

## Follow-Up Tasks (Not in this plan)

1. **Deploy to Render** — create Background Worker service, set env vars from Render dashboard
2. **Migrate reports** — update `auth/src/routes/reports.js` to query `ghl_contacts_v2` / `ghl_opportunities_v2` (custom fields via JSONB `->>'key'` syntax or add generated columns)
3. **Remove old sync** — delete `auth/src/routes/sync.js` cron and route, clean up `auth/src/index.js`
4. **Add sync dashboard tile** — add a tile in the portal admin that hits `/api/sync/status` and `/api/sync/logs`
