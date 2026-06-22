# Media Visual Search Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let staff search the shared "Media" Google Drive folder by what is *in* each photo/video (e.g. "deadlift") using multimodal embeddings, not by filename.

**Architecture:** A recurring `ghl-sync` job crawls the Drive folder, embeds photos and sampled video frames via Voyage `voyage-multimodal-3.5`, and stores 1024-dim vectors in Supabase pgvector. The `auth` API embeds the text query and runs a cosine-ANN RPC to return matches; a new "Media Library" page in `portal` renders the results. `auth` and `ghl-sync` never call each other except one secret-guarded manual-reindex trigger; they coordinate through the shared database.

**Tech Stack:** Node.js, Express, `@supabase/supabase-js` (service role), Postgres + pgvector, Voyage multimodal embeddings (REST), `sharp`, `ffmpeg-static`, React + Vite + Tailwind v4.

## Global Constraints

- Work only in the worktree `C:\Users\justi\wcs-staff-portal-media-search` on branch `feat/media-search`. pnpm repo; worktree uses a node_modules junction — never recursive-delete it, use `git worktree remove`.
- Do NOT touch `ghl-sync/src/firstContactPick.js` or any `SpeedToLeadAudit.jsx` (another session owns speed-to-lead).
- Open a PR at the end; do NOT merge.
- Embedding model: `voyage-multimodal-3.5`, 1024 dims. Endpoint `POST https://api.voyageai.com/v1/multimodalembeddings`. `input_type:"document"` when indexing, `"query"` when searching. Batch ≤1000 inputs / ≤320k tokens; image ≤20MB / ≤16M px.
- All DB access is server-side via the Supabase **service role**. New tables get `ENABLE ROW LEVEL SECURITY` with **no policy** (matches repo standard; service role bypasses RLS).
- Migrations are plain numbered SQL; next free number in `auth/migrations/` is `052`. Use `CREATE TABLE IF NOT EXISTS` / `CREATE INDEX IF NOT EXISTS`.
- Backend unit tests use Node's built-in `node:test` + `node:assert/strict`, run with `node <file>`. Integration (Drive/Voyage/ffmpeg/route wiring) is verified manually with documented commands — matches repo norms (no route-level test harness exists).
- No em-dashes in any user-facing copy.
- New env vars (document, don't hardcode): ghl-sync — `VOYAGE_API_KEY`, `MEDIA_ROOT_FOLDER_ID`, `MEDIA_VIDEO_FRAME_INTERVAL_SEC` (default 5), `MEDIA_INDEX_HOUR` (UTC, default 8), `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`; auth — `VOYAGE_API_KEY`, `GHL_SYNC_URL`, `SYNC_SECRET`.

---

## File Structure

**Database**
- Create `auth/migrations/052_media_search.sql` — pgvector ext, `media_assets`, `media_embeddings`, indexes, RLS, `match_media_embeddings` RPC.

**ghl-sync (indexer)**
- Create `ghl-sync/src/google/driveClient.js` — Drive OAuth token (from `app_config`) + crawl/download helpers.
- Create `ghl-sync/src/media/voyageClient.js` — multimodal embedding client + request builder.
- Create `ghl-sync/src/media/imagePrep.js` — downscale image buffer to ≤2MP JPEG, build data URL.
- Create `ghl-sync/src/media/locationPath.js` — derive `location` + `folder_path` during traversal (pure).
- Create `ghl-sync/src/media/diff.js` — diff Drive listing vs DB rows (pure).
- Create `ghl-sync/src/media/videoFrames.js` — sample frames from a video file via ffmpeg.
- Create `ghl-sync/src/media/mediaIndex.js` — orchestrator: walk → diff → embed → upsert/delete. Exports `runMediaIndex()`.
- Modify `ghl-sync/src/scheduler.js` — register the daily media-index cron.
- Modify `ghl-sync/src/index.js` — add `POST /api/media/reindex` (secret-guarded).
- Modify `ghl-sync/package.json` — add `sharp`, `ffmpeg-static`.
- Create tests: `ghl-sync/test/voyageClient.test.js`, `ghl-sync/test/imagePrep.test.js`, `ghl-sync/test/locationPath.test.js`, `ghl-sync/test/diff.test.js`.

**auth (search API)**
- Create `auth/src/services/voyageQuery.js` — embed a text query.
- Create `auth/src/routes/media.js` — `POST /media/search`, `GET /media/thumbnail/:driveFileId`, `POST /media/reindex` (admin → proxies ghl-sync).
- Modify `auth/src/index.js` — mount `app.use('/media', require('./routes/media'))`.

**portal (UI)**
- Create `portal/src/components/AuthImg.jsx` — authed image via blob URL.
- Create `portal/src/components/MediaLibraryView.jsx` — search page.
- Modify `portal/src/lib/api.js` — add `searchMedia`, `fetchMediaThumbBlob`, `reindexMedia`.
- Modify `portal/src/App.jsx` — view state flag + conditional render + callback.
- Modify `portal/src/components/ToolGrid.jsx` — gated tile (corporate+).

---

## Task 1: Database migration (tables + RPC)

**Files:**
- Create: `auth/migrations/052_media_search.sql`

**Interfaces:**
- Produces tables `media_assets`, `media_embeddings` and RPC `match_media_embeddings(query_embedding vector(1024), match_count int, filter_location text, filter_kind text)` returning `(asset_id uuid, drive_file_id text, kind text, title text, location text, folder_path text, web_view_link text, mime_type text, frame_time_seconds numeric, similarity float)`.

- [ ] **Step 1: Write the migration**

```sql
-- 052_media_search.sql
-- Visual search over the shared "Media" Drive folder. ghl-sync crawls the
-- folder and writes one media_assets row per file plus one or more
-- media_embeddings rows (1 per photo, N per sampled video frame). The auth
-- API embeds the text query and calls match_media_embeddings() for cosine ANN.
-- All access is server-side via the service role, so RLS is enabled with no
-- policy (denies anon/authenticated PostgREST; service role bypasses it).

CREATE EXTENSION IF NOT EXISTS vector;

CREATE TABLE IF NOT EXISTS media_assets (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  drive_file_id       text NOT NULL UNIQUE,
  kind                text NOT NULL,                 -- 'image' | 'video'
  title               text,
  mime_type           text,
  location            text,                          -- top-level folder (Salem/Eugene/.../Etc.)
  folder_path         text,                          -- path under the Media root
  file_size           bigint,
  drive_modified_time timestamptz,
  md5                 text,                          -- Drive md5Checksum (change detection)
  web_view_link       text,
  status              text NOT NULL DEFAULT 'indexed', -- 'indexed' | 'error'
  error               text,
  indexed_at          timestamptz,
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_media_assets_location ON media_assets(location);
CREATE INDEX IF NOT EXISTS idx_media_assets_kind ON media_assets(kind);

CREATE TABLE IF NOT EXISTS media_embeddings (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  asset_id           uuid NOT NULL REFERENCES media_assets(id) ON DELETE CASCADE,
  embedding          vector(1024) NOT NULL,
  frame_time_seconds numeric,                        -- null for photos
  created_at         timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_media_embeddings_asset ON media_embeddings(asset_id);
CREATE INDEX IF NOT EXISTS idx_media_embeddings_hnsw
  ON media_embeddings USING hnsw (embedding vector_cosine_ops);

CREATE OR REPLACE FUNCTION media_assets_touch_updated_at()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN NEW.updated_at := now(); RETURN NEW; END; $$;

DROP TRIGGER IF EXISTS trg_media_assets_updated_at ON media_assets;
CREATE TRIGGER trg_media_assets_updated_at
  BEFORE UPDATE ON media_assets
  FOR EACH ROW EXECUTE FUNCTION media_assets_touch_updated_at();

ALTER TABLE public.media_assets     ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.media_embeddings ENABLE ROW LEVEL SECURITY;

-- Cosine ANN search, deduped to the best-matching frame per asset.
CREATE OR REPLACE FUNCTION match_media_embeddings(
  query_embedding vector(1024),
  match_count     int  DEFAULT 40,
  filter_location text DEFAULT NULL,
  filter_kind     text DEFAULT NULL
) RETURNS TABLE (
  asset_id uuid, drive_file_id text, kind text, title text, location text,
  folder_path text, web_view_link text, mime_type text,
  frame_time_seconds numeric, similarity float
) LANGUAGE sql STABLE AS $$
  SELECT * FROM (
    SELECT DISTINCT ON (a.id)
      a.id AS asset_id, a.drive_file_id, a.kind, a.title, a.location,
      a.folder_path, a.web_view_link, a.mime_type, e.frame_time_seconds,
      1 - (e.embedding <=> query_embedding) AS similarity
    FROM media_embeddings e
    JOIN media_assets a ON a.id = e.asset_id
    WHERE (filter_location IS NULL OR a.location = filter_location)
      AND (filter_kind IS NULL OR a.kind = filter_kind)
    ORDER BY a.id, e.embedding <=> query_embedding
  ) t
  ORDER BY t.similarity DESC
  LIMIT match_count;
$$;
```

- [ ] **Step 2: Apply the migration to the correct Supabase project**

Use the Supabase MCP: call `list_projects`, identify the wcs-staff-portal project (same one holding `marketing_efforts` / `ghl_contacts_v2`), then `apply_migration` with name `052_media_search` and the SQL above. If unsure which project, confirm with the user before applying.

- [ ] **Step 3: Verify the schema landed**

Via Supabase MCP `execute_sql`:
```sql
select table_name from information_schema.tables where table_name in ('media_assets','media_embeddings');
select proname from pg_proc where proname = 'match_media_embeddings';
select extname from pg_extension where extname = 'vector';
```
Expected: both tables, the function, and the `vector` extension all present.

- [ ] **Step 4: Commit**

```bash
git add auth/migrations/052_media_search.sql
git commit -m "feat(media-search): add pgvector tables + match RPC (migration 052)"
```

---

## Task 2: Voyage embedding client (ghl-sync)

**Files:**
- Modify: `ghl-sync/package.json` (add `sharp`, `ffmpeg-static`)
- Create: `ghl-sync/src/media/voyageClient.js`
- Test: `ghl-sync/test/voyageClient.test.js`

**Interfaces:**
- Produces: `buildMultimodalBody(items, inputType)` → request body object, and `async embedMultimodal(items, inputType)` → `number[][]` (one 1024-dim vector per item). `items` is an array where each element is `{ text?: string, imageDataUrl?: string }`.

- [ ] **Step 1: Add dependencies**

```bash
cd ghl-sync && npm install sharp@^0.33.0 ffmpeg-static@^5.2.0
```
Expected: both added to `ghl-sync/package.json` dependencies; lockfile updated.

- [ ] **Step 2: Write the failing test**

```javascript
// ghl-sync/test/voyageClient.test.js
const test = require('node:test')
const assert = require('node:assert/strict')
const { buildMultimodalBody } = require('../src/media/voyageClient')

test('buildMultimodalBody wraps text + image into Voyage content format', () => {
  const body = buildMultimodalBody(
    [{ imageDataUrl: 'data:image/jpeg;base64,AAAA' }, { text: 'deadlift' }],
    'document'
  )
  assert.equal(body.model, 'voyage-multimodal-3.5')
  assert.equal(body.input_type, 'document')
  assert.equal(body.inputs.length, 2)
  assert.deepEqual(body.inputs[0].content[0], { type: 'image_url', image_url: 'data:image/jpeg;base64,AAAA' })
  assert.deepEqual(body.inputs[1].content[0], { type: 'text', text: 'deadlift' })
})
```

- [ ] **Step 3: Run test to verify it fails**

Run: `cd ghl-sync && node test/voyageClient.test.js`
Expected: FAIL — cannot find module `../src/media/voyageClient`.

- [ ] **Step 4: Implement the client**

```javascript
// ghl-sync/src/media/voyageClient.js
const VOYAGE_URL = 'https://api.voyageai.com/v1/multimodalembeddings'
const MODEL = 'voyage-multimodal-3.5'

// items: [{ text?, imageDataUrl? }]. Each becomes one input with one content part.
function buildMultimodalBody(items, inputType) {
  return {
    model: MODEL,
    input_type: inputType,
    inputs: items.map((it) => {
      const content = []
      if (it.imageDataUrl) content.push({ type: 'image_url', image_url: it.imageDataUrl })
      if (it.text) content.push({ type: 'text', text: it.text })
      return { content }
    }),
  }
}

async function embedMultimodal(items, inputType) {
  const key = process.env.VOYAGE_API_KEY
  if (!key) throw new Error('VOYAGE_API_KEY not set')
  if (!items.length) return []
  const res = await fetch(VOYAGE_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + key },
    body: JSON.stringify(buildMultimodalBody(items, inputType)),
  })
  const data = await res.json()
  if (!res.ok) throw new Error('Voyage error ' + res.status + ': ' + JSON.stringify(data))
  // Response: { data: [{ embedding: number[] }, ...] } preserving input order.
  return data.data.map((d) => d.embedding)
}

module.exports = { buildMultimodalBody, embedMultimodal, MODEL }
```

- [ ] **Step 5: Run test to verify it passes**

Run: `cd ghl-sync && node test/voyageClient.test.js`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add ghl-sync/package.json ghl-sync/package-lock.json ghl-sync/src/media/voyageClient.js ghl-sync/test/voyageClient.test.js
git commit -m "feat(media-search): Voyage multimodal embedding client"
```

---

## Task 3: Image prep — downscale to ≤2MP (ghl-sync)

**Files:**
- Create: `ghl-sync/src/media/imagePrep.js`
- Test: `ghl-sync/test/imagePrep.test.js`

**Interfaces:**
- Produces: `async toEmbedInput(buffer)` → `{ imageDataUrl: string }` where the image is re-encoded JPEG at ≤2,000,000 px (Voyage's max-charge threshold) and ≤20MB.

- [ ] **Step 1: Write the failing test**

```javascript
// ghl-sync/test/imagePrep.test.js
const test = require('node:test')
const assert = require('node:assert/strict')
const sharp = require('sharp')
const { toEmbedInput } = require('../src/media/imagePrep')

test('toEmbedInput downscales a large image to <= 2MP jpeg data url', async () => {
  const big = await sharp({ create: { width: 3000, height: 3000, channels: 3, background: '#888' } })
    .jpeg().toBuffer()
  const { imageDataUrl } = await toEmbedInput(big)
  assert.match(imageDataUrl, /^data:image\/jpeg;base64,/)
  const out = Buffer.from(imageDataUrl.split(',')[1], 'base64')
  const meta = await sharp(out).metadata()
  assert.ok(meta.width * meta.height <= 2_000_000, `pixels ${meta.width * meta.height} should be <= 2MP`)
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd ghl-sync && node test/imagePrep.test.js`
Expected: FAIL — cannot find module `../src/media/imagePrep`.

- [ ] **Step 3: Implement**

```javascript
// ghl-sync/src/media/imagePrep.js
const sharp = require('sharp')

const MAX_PIXELS = 2_000_000 // Voyage caps charge at 2MP; no value embedding larger.

// Re-encode any image buffer to a JPEG data URL sized for Voyage.
async function toEmbedInput(buffer) {
  const img = sharp(buffer, { failOn: 'none' }).rotate() // honor EXIF orientation
  const meta = await img.metadata()
  const px = (meta.width || 0) * (meta.height || 0)
  let pipeline = img
  if (px > MAX_PIXELS) {
    const scale = Math.sqrt(MAX_PIXELS / px)
    pipeline = img.resize(Math.round((meta.width || 0) * scale))
  }
  const out = await pipeline.jpeg({ quality: 80 }).toBuffer()
  return { imageDataUrl: 'data:image/jpeg;base64,' + out.toString('base64') }
}

module.exports = { toEmbedInput, MAX_PIXELS }
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd ghl-sync && node test/imagePrep.test.js`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add ghl-sync/src/media/imagePrep.js ghl-sync/test/imagePrep.test.js
git commit -m "feat(media-search): image downscale prep for embeddings"
```

---

## Task 4: Location + folder path derivation (ghl-sync)

**Files:**
- Create: `ghl-sync/src/media/locationPath.js`
- Test: `ghl-sync/test/locationPath.test.js`

**Interfaces:**
- Produces: `deriveLocation(folderPathSegments)` → top-level segment string (or `null`), and `joinFolderPath(folderPathSegments)` → `'Salem/2025'`. `folderPathSegments` is the array of folder names from directly under the Media root down to (but not including) the file.

- [ ] **Step 1: Write the failing test**

```javascript
// ghl-sync/test/locationPath.test.js
const test = require('node:test')
const assert = require('node:assert/strict')
const { deriveLocation, joinFolderPath } = require('../src/media/locationPath')

test('deriveLocation returns the top-level folder under the Media root', () => {
  assert.equal(deriveLocation(['Salem', '2025', '6-5-26']), 'Salem')
  assert.equal(deriveLocation(['Etc.', 'AD MEDIA']), 'Etc.')
  assert.equal(deriveLocation([]), null)
})

test('joinFolderPath joins segments with forward slashes', () => {
  assert.equal(joinFolderPath(['Salem', '2025']), 'Salem/2025')
  assert.equal(joinFolderPath([]), '')
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd ghl-sync && node test/locationPath.test.js`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

```javascript
// ghl-sync/src/media/locationPath.js
function deriveLocation(segments) {
  return segments && segments.length ? segments[0] : null
}
function joinFolderPath(segments) {
  return (segments || []).join('/')
}
module.exports = { deriveLocation, joinFolderPath }
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd ghl-sync && node test/locationPath.test.js`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add ghl-sync/src/media/locationPath.js ghl-sync/test/locationPath.test.js
git commit -m "feat(media-search): location/path derivation helpers"
```

---

## Task 5: Drive listing vs DB diff (ghl-sync)

**Files:**
- Create: `ghl-sync/src/media/diff.js`
- Test: `ghl-sync/test/diff.test.js`

**Interfaces:**
- Consumes: nothing.
- Produces: `diffDriveVsDb(driveFiles, dbRows)` → `{ toEmbed: driveFile[], toDelete: dbRow[] }`. `driveFile` has `{ id, md5, modifiedTime }`; `dbRow` has `{ drive_file_id, md5, drive_modified_time }`. A file is `toEmbed` if new, or if `md5` differs (falling back to `modifiedTime` when `md5` is absent). A db row is `toDelete` if its `drive_file_id` is not in the current Drive listing.

- [ ] **Step 1: Write the failing test**

```javascript
// ghl-sync/test/diff.test.js
const test = require('node:test')
const assert = require('node:assert/strict')
const { diffDriveVsDb } = require('../src/media/diff')

test('diff flags new, changed, and deleted files', () => {
  const drive = [
    { id: 'a', md5: 'h1', modifiedTime: '2026-01-01T00:00:00Z' }, // unchanged
    { id: 'b', md5: 'h2new', modifiedTime: '2026-02-01T00:00:00Z' }, // changed md5
    { id: 'c', md5: 'h3', modifiedTime: '2026-03-01T00:00:00Z' }, // new
  ]
  const db = [
    { drive_file_id: 'a', md5: 'h1', drive_modified_time: '2026-01-01T00:00:00Z' },
    { drive_file_id: 'b', md5: 'h2old', drive_modified_time: '2026-01-15T00:00:00Z' },
    { drive_file_id: 'd', md5: 'h4', drive_modified_time: '2026-01-01T00:00:00Z' }, // gone from drive
  ]
  const { toEmbed, toDelete } = diffDriveVsDb(drive, db)
  assert.deepEqual(toEmbed.map((f) => f.id).sort(), ['b', 'c'])
  assert.deepEqual(toDelete.map((r) => r.drive_file_id), ['d'])
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd ghl-sync && node test/diff.test.js`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

```javascript
// ghl-sync/src/media/diff.js
function diffDriveVsDb(driveFiles, dbRows) {
  const byId = new Map(dbRows.map((r) => [r.drive_file_id, r]))
  const driveIds = new Set(driveFiles.map((f) => f.id))
  const toEmbed = driveFiles.filter((f) => {
    const row = byId.get(f.id)
    if (!row) return true // new
    if (f.md5 && row.md5) return f.md5 !== row.md5
    return String(f.modifiedTime) !== String(row.drive_modified_time) // md5 missing -> fall back
  })
  const toDelete = dbRows.filter((r) => !driveIds.has(r.drive_file_id))
  return { toEmbed, toDelete }
}
module.exports = { diffDriveVsDb }
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd ghl-sync && node test/diff.test.js`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add ghl-sync/src/media/diff.js ghl-sync/test/diff.test.js
git commit -m "feat(media-search): drive-vs-db diff logic"
```

---

## Task 6: Drive client — token + recursive crawl + download (ghl-sync)

**Files:**
- Create: `ghl-sync/src/google/driveClient.js`

**Interfaces:**
- Consumes: `ghl-sync/src/db/supabase.js` (default export `supabase`).
- Produces:
  - `async getAccessToken()` → string (reads/refreshes the shared token in `app_config`).
  - `async walkMediaTree(rootId)` → `Array<{ id, name, mimeType, md5, modifiedTime, size, webViewLink, kind, segments }>` for every image/video under `rootId`. `kind` is `'image'|'video'`; `segments` is the folder-name path under the root.
  - `async downloadToTemp(fileId)` → string temp file path (caller deletes).
  - `async downloadBuffer(fileId)` → Buffer.
  - `async fetchThumbnail(fileId)` → `{ buffer: Buffer, contentType: string }` (uses Drive `thumbnailLink` resized, else falls back to `alt=media`).

This task is integration-shaped (live Drive). No unit test; verify manually against the real folder.

- [ ] **Step 1: Implement the Drive client**

```javascript
// ghl-sync/src/google/driveClient.js
const fs = require('fs')
const os = require('os')
const path = require('path')
const { pipeline } = require('stream/promises')
const supabase = require('../db/supabase')

const DRIVE_FILES = 'https://www.googleapis.com/drive/v3/files'

async function getStoredTokens() {
  const { data } = await supabase.from('app_config').select('value').eq('key', 'google_business_tokens').single()
  return data?.value ? JSON.parse(data.value) : null
}
async function storeTokens(tokens) {
  await supabase.from('app_config').upsert(
    { key: 'google_business_tokens', value: JSON.stringify(tokens) }, { onConflict: 'key' }
  )
}
async function refreshAccessToken(refreshToken) {
  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: process.env.GOOGLE_CLIENT_ID,
      client_secret: process.env.GOOGLE_CLIENT_SECRET,
      refresh_token: refreshToken,
      grant_type: 'refresh_token',
    }),
  })
  const data = await res.json()
  if (data.error) throw new Error(data.error_description || data.error)
  return data.access_token
}
async function getAccessToken() {
  const tokens = await getStoredTokens()
  if (!tokens?.refresh_token) throw new Error('Google Business not authorized (app_config.google_business_tokens missing)')
  if (tokens.access_token && tokens.expires_at && Date.now() < tokens.expires_at - 300000) return tokens.access_token
  const access = await refreshAccessToken(tokens.refresh_token)
  tokens.access_token = access
  tokens.expires_at = Date.now() + 3600 * 1000
  await storeTokens(tokens)
  return access
}

async function driveList(params, token) {
  const url = DRIVE_FILES + '?' + new URLSearchParams({
    supportsAllDrives: 'true', includeItemsFromAllDrives: 'true', corpora: 'allDrives', ...params,
  })
  const r = await fetch(url, { headers: { Authorization: 'Bearer ' + token } })
  const data = await r.json()
  if (data.error) throw new Error(data.error.message || 'Drive list error')
  return data
}

function kindOf(mimeType) {
  if (mimeType && mimeType.startsWith('image/')) return 'image'
  if (mimeType && mimeType.startsWith('video/')) return 'video'
  return null
}

// BFS the folder tree; collect image/video leaves with their folder path.
async function walkMediaTree(rootId) {
  const token = await getAccessToken()
  const out = []
  const queue = [{ id: rootId, segments: [] }]
  while (queue.length) {
    const { id, segments } = queue.shift()
    let pageToken
    do {
      const data = await driveList({
        q: `'${id.replace(/'/g, "\\'")}' in parents and trashed=false`,
        fields: 'nextPageToken,files(id,name,mimeType,md5Checksum,modifiedTime,size,webViewLink)',
        pageSize: '1000', ...(pageToken ? { pageToken } : {}),
      }, token)
      for (const f of data.files || []) {
        if (f.mimeType === 'application/vnd.google-apps.folder') {
          queue.push({ id: f.id, segments: [...segments, f.name] })
        } else {
          const kind = kindOf(f.mimeType)
          if (!kind) continue
          out.push({
            id: f.id, name: f.name, mimeType: f.mimeType, md5: f.md5Checksum || null,
            modifiedTime: f.modifiedTime, size: f.size ? Number(f.size) : null,
            webViewLink: f.webViewLink, kind, segments,
          })
        }
      }
      pageToken = data.nextPageToken
    } while (pageToken)
  }
  return out
}

async function downloadBuffer(fileId) {
  const token = await getAccessToken()
  const r = await fetch(`${DRIVE_FILES}/${fileId}?alt=media&supportsAllDrives=true`, {
    headers: { Authorization: 'Bearer ' + token },
  })
  if (!r.ok) throw new Error('Drive download failed ' + r.status)
  return Buffer.from(await r.arrayBuffer())
}

// Stream large files (videos) to a temp path instead of buffering in memory.
async function downloadToTemp(fileId) {
  const token = await getAccessToken()
  const r = await fetch(`${DRIVE_FILES}/${fileId}?alt=media&supportsAllDrives=true`, {
    headers: { Authorization: 'Bearer ' + token },
  })
  if (!r.ok || !r.body) throw new Error('Drive stream failed ' + r.status)
  const tmp = path.join(os.tmpdir(), `media-${fileId}-${process.pid}.bin`)
  await pipeline(r.body, fs.createWriteStream(tmp))
  return tmp
}

async function fetchThumbnail(fileId) {
  const token = await getAccessToken()
  // Get thumbnailLink, then fetch a resized version.
  const m = await fetch(`${DRIVE_FILES}/${fileId}?fields=thumbnailLink&supportsAllDrives=true`, {
    headers: { Authorization: 'Bearer ' + token },
  }).then((r) => r.json())
  if (m.thumbnailLink) {
    const link = m.thumbnailLink.replace(/=s\d+$/, '=s640')
    const r = await fetch(link, { headers: { Authorization: 'Bearer ' + token } })
    if (r.ok) return { buffer: Buffer.from(await r.arrayBuffer()), contentType: r.headers.get('content-type') || 'image/jpeg' }
  }
  const buf = await downloadBuffer(fileId)
  return { buffer: buf, contentType: 'image/jpeg' }
}

module.exports = { getAccessToken, walkMediaTree, downloadBuffer, downloadToTemp, fetchThumbnail }
```

- [ ] **Step 2: Manual verification — crawl the real folder**

Create a throwaway script `ghl-sync/scripts/_probe-media.js`:
```javascript
require('dotenv').config()
const { walkMediaTree } = require('../src/google/driveClient')
;(async () => {
  const files = await walkMediaTree(process.env.MEDIA_ROOT_FOLDER_ID)
  const img = files.filter((f) => f.kind === 'image').length
  const vid = files.filter((f) => f.kind === 'video').length
  console.log({ total: files.length, img, vid, sample: files.slice(0, 3) })
})().catch((e) => { console.error(e); process.exit(1) })
```
Run (with `MEDIA_ROOT_FOLDER_ID=1tZiYf1_eBdzx-50-HNtFKahBqQ57Dlyb` and Google + Supabase env set):
`cd ghl-sync && node scripts/_probe-media.js`
Expected: ~4,900 total with image/video split close to the crawl (≈4,856 images / ≈66 videos), and `segments` like `["Salem","2025"]`. Then delete the probe script.

If it errors with "Google Business not authorized," the shared Drive account cannot see the folder — share the Media folder to that account (or note for the user) before continuing.

- [ ] **Step 3: Commit**

```bash
git add ghl-sync/src/google/driveClient.js
git commit -m "feat(media-search): ghl-sync Drive client (token + crawl + download)"
```

---

## Task 7: Video frame sampling (ghl-sync)

**Files:**
- Create: `ghl-sync/src/media/videoFrames.js`

**Interfaces:**
- Produces: `async sampleFrames(videoPath, intervalSec)` → `Array<{ buffer: Buffer, timeSeconds: number }>`. Extracts one frame every `intervalSec` seconds as JPEG, scaled so the long edge ≤ 1280px.

Integration-shaped (needs ffmpeg). Verify manually on one downloaded clip.

- [ ] **Step 1: Implement**

```javascript
// ghl-sync/src/media/videoFrames.js
const fs = require('fs')
const os = require('os')
const path = require('path')
const { spawn } = require('child_process')
const ffmpegPath = require('ffmpeg-static')

// Extract 1 frame per intervalSec seconds into a temp dir, return buffers + timestamps.
async function sampleFrames(videoPath, intervalSec) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'frames-'))
  const pattern = path.join(dir, 'f-%05d.jpg')
  const fps = `1/${intervalSec}`
  await new Promise((resolve, reject) => {
    const args = ['-i', videoPath, '-vf', `fps=${fps},scale='min(1280,iw)':-2`, '-q:v', '4', pattern]
    const proc = spawn(ffmpegPath, args, { stdio: ['ignore', 'ignore', 'pipe'] })
    let stderr = ''
    proc.stderr.on('data', (d) => { stderr += d.toString() })
    proc.on('error', reject)
    proc.on('close', (code) => (code === 0 ? resolve() : reject(new Error('ffmpeg exited ' + code + ': ' + stderr.slice(-500)))))
  })
  const files = fs.readdirSync(dir).filter((n) => n.endsWith('.jpg')).sort()
  const frames = files.map((name, i) => ({
    buffer: fs.readFileSync(path.join(dir, name)),
    timeSeconds: i * intervalSec, // frame i ~ i*interval seconds in
  }))
  fs.rmSync(dir, { recursive: true, force: true })
  return frames
}

module.exports = { sampleFrames }
```

- [ ] **Step 2: Manual verification**

Throwaway `ghl-sync/scripts/_probe-frames.js`:
```javascript
require('dotenv').config()
const { downloadToTemp } = require('../src/google/driveClient')
const { sampleFrames } = require('../src/media/videoFrames')
const fs = require('fs')
;(async () => {
  // A small Medford clip id from the earlier crawl:
  const tmp = await downloadToTemp('1YGnjjXrlX_IroupnVuVbhU84nO_XS821')
  const frames = await sampleFrames(tmp, 5)
  console.log({ frameCount: frames.length, firstBytes: frames[0]?.buffer.length, times: frames.map((f) => f.timeSeconds).slice(0, 5) })
  fs.unlinkSync(tmp)
})().catch((e) => { console.error(e); process.exit(1) })
```
Run: `cd ghl-sync && node scripts/_probe-frames.js`
Expected: a frame count > 0 with ascending `timeSeconds` (0, 5, 10, ...). Delete the probe script after.

- [ ] **Step 3: Commit**

```bash
git add ghl-sync/src/media/videoFrames.js
git commit -m "feat(media-search): ffmpeg video frame sampling"
```

---

## Task 8: Indexer orchestrator (ghl-sync)

**Files:**
- Create: `ghl-sync/src/media/mediaIndex.js`

**Interfaces:**
- Consumes: `driveClient` (`walkMediaTree`, `downloadBuffer`, `downloadToTemp`), `voyageClient.embedMultimodal`, `imagePrep.toEmbedInput`, `videoFrames.sampleFrames`, `diff.diffDriveVsDb`, `locationPath.deriveLocation`/`joinFolderPath`, `ghl-sync/src/db/supabase.js`.
- Produces: `async runMediaIndex()` → `{ embedded, deleted, errors }`. Guards against concurrent runs via a module-level flag.

Integration-shaped. Verify by indexing a small slice, then the full folder.

- [ ] **Step 1: Implement**

```javascript
// ghl-sync/src/media/mediaIndex.js
const fs = require('fs')
const supabase = require('../db/supabase')
const { walkMediaTree, downloadBuffer, downloadToTemp } = require('../google/driveClient')
const { embedMultimodal } = require('./voyageClient')
const { toEmbedInput } = require('./imagePrep')
const { sampleFrames } = require('./videoFrames')
const { diffDriveVsDb } = require('./diff')
const { deriveLocation, joinFolderPath } = require('./locationPath')

const FRAME_INTERVAL = Number(process.env.MEDIA_VIDEO_FRAME_INTERVAL_SEC || 5)
const PHOTO_BATCH = 50

let running = false

async function upsertAsset(file) {
  const row = {
    drive_file_id: file.id, kind: file.kind, title: file.name, mime_type: file.mimeType,
    location: deriveLocation(file.segments), folder_path: joinFolderPath(file.segments),
    file_size: file.size, drive_modified_time: file.modifiedTime, md5: file.md5,
    web_view_link: file.webViewLink, status: 'indexed', error: null, indexed_at: new Date().toISOString(),
  }
  const { data, error } = await supabase.from('media_assets').upsert(row, { onConflict: 'drive_file_id' }).select('id').single()
  if (error) throw error
  // Replace any prior embeddings for this asset (handles re-index of changed files).
  await supabase.from('media_embeddings').delete().eq('asset_id', data.id)
  return data.id
}

async function indexPhotos(photos) {
  let embedded = 0
  for (let i = 0; i < photos.length; i += PHOTO_BATCH) {
    const batch = photos.slice(i, i + PHOTO_BATCH)
    const inputs = []
    const owners = []
    for (const f of batch) {
      try {
        const buf = await downloadBuffer(f.id)
        const { imageDataUrl } = await toEmbedInput(buf)
        inputs.push({ imageDataUrl }); owners.push(f)
      } catch (e) { await markError(f, e) }
    }
    if (!inputs.length) continue
    const vecs = await embedMultimodal(inputs, 'document')
    for (let j = 0; j < owners.length; j++) {
      const assetId = await upsertAsset(owners[j])
      await supabase.from('media_embeddings').insert({ asset_id: assetId, embedding: vecs[j], frame_time_seconds: null })
      embedded++
    }
  }
  return embedded
}

async function indexVideo(file) {
  const tmp = await downloadToTemp(file.id)
  try {
    const frames = await sampleFrames(tmp, FRAME_INTERVAL)
    if (!frames.length) return 0
    const assetId = await upsertAsset(file)
    // Embed frames in batches of PHOTO_BATCH.
    for (let i = 0; i < frames.length; i += PHOTO_BATCH) {
      const slice = frames.slice(i, i + PHOTO_BATCH)
      const inputs = []
      for (const fr of slice) inputs.push((await toEmbedInput(fr.buffer)))
      const vecs = await embedMultimodal(inputs, 'document')
      const rows = vecs.map((v, k) => ({ asset_id: assetId, embedding: v, frame_time_seconds: slice[k].timeSeconds }))
      await supabase.from('media_embeddings').insert(rows)
    }
    return 1
  } finally {
    fs.existsSync(tmp) && fs.unlinkSync(tmp)
  }
}

async function markError(file, e) {
  console.error('[MediaIndex] failed', file.id, e.message)
  await supabase.from('media_assets').upsert(
    { drive_file_id: file.id, kind: file.kind, title: file.name, status: 'error', error: String(e.message).slice(0, 500) },
    { onConflict: 'drive_file_id' }
  )
}

async function runMediaIndex() {
  if (running) return { skipped: true }
  running = true
  const stats = { embedded: 0, deleted: 0, errors: 0 }
  try {
    const root = process.env.MEDIA_ROOT_FOLDER_ID
    if (!root) throw new Error('MEDIA_ROOT_FOLDER_ID not set')
    const drive = await walkMediaTree(root)
    const { data: dbRows, error } = await supabase.from('media_assets').select('drive_file_id, md5, drive_modified_time')
    if (error) throw error
    const { toEmbed, toDelete } = diffDriveVsDb(drive, dbRows || [])

    const photos = toEmbed.filter((f) => f.kind === 'image')
    const videos = toEmbed.filter((f) => f.kind === 'video')
    console.log(`[MediaIndex] toEmbed=${toEmbed.length} (img=${photos.length} vid=${videos.length}) toDelete=${toDelete.length}`)

    stats.embedded += await indexPhotos(photos)
    for (const v of videos) {
      try { stats.embedded += await indexVideo(v) } catch (e) { stats.errors++; await markError(v, e) }
    }
    if (toDelete.length) {
      const ids = toDelete.map((r) => r.drive_file_id)
      await supabase.from('media_assets').delete().in('drive_file_id', ids)
      stats.deleted = ids.length
    }
    console.log('[MediaIndex] done', stats)
    return stats
  } finally {
    running = false
  }
}

module.exports = { runMediaIndex }
```

- [ ] **Step 2: Manual verification — small slice first**

Temporarily set `MEDIA_ROOT_FOLDER_ID` to the **Milwaukie** subfolder id `19LxQ_8Jt1DldftrJCo42tgomXsGU1zgy` (72 photos, no video). Throwaway `ghl-sync/scripts/_probe-index.js`:
```javascript
require('dotenv').config()
const { runMediaIndex } = require('../src/media/mediaIndex')
runMediaIndex().then((s) => { console.log('RESULT', s); process.exit(0) }).catch((e) => { console.error(e); process.exit(1) })
```
Run: `cd ghl-sync && node scripts/_probe-index.js`
Expected: `embedded` ≈ 72. Then via Supabase MCP `execute_sql`:
```sql
select count(*) from media_assets;            -- ~72
select count(*) from media_embeddings;        -- ~72
select location, count(*) from media_assets group by location;
```

- [ ] **Step 3: Manual verification — one video**

Set `MEDIA_ROOT_FOLDER_ID` to the **Medford** id `1JJXFpqQsjeYV2MaDob7yS-rh7BRmjR4i` (has loose videos) and re-run the probe (it will add Medford on top). Expected: `embedded` grows; `select count(*) from media_embeddings where frame_time_seconds is not null;` returns > 0 (video frames). Restore `MEDIA_ROOT_FOLDER_ID` to the real root afterward and delete the probe script.

- [ ] **Step 4: Commit**

```bash
git add ghl-sync/src/media/mediaIndex.js
git commit -m "feat(media-search): indexer orchestrator (photos + video frames)"
```

---

## Task 9: Schedule + manual trigger (ghl-sync)

**Files:**
- Modify: `ghl-sync/src/scheduler.js`
- Modify: `ghl-sync/src/index.js`

**Interfaces:**
- Consumes: `mediaIndex.runMediaIndex`.
- Produces: a daily cron + `POST /api/media/reindex` (guarded by existing `requireSecret`).

- [ ] **Step 1: Register the cron**

In `ghl-sync/src/scheduler.js`, add near the other `cron.schedule` blocks (and require at top: `const { runMediaIndex } = require('./media/mediaIndex')`):
```javascript
// Media library index — daily at MEDIA_INDEX_HOUR UTC (default 08:00 UTC ~ 1am PT).
const mediaIndexHour = Number(process.env.MEDIA_INDEX_HOUR || 8)
cron.schedule(`0 ${mediaIndexHour} * * *`, () => {
  console.log('[Scheduler] Starting media index...')
  runMediaIndex().catch((err) => console.error('[Scheduler] Media index failed:', err.message))
})
```

- [ ] **Step 2: Add the manual trigger endpoint**

In `ghl-sync/src/index.js`, near the other `/api/sync/*` routes (require at top: `const { runMediaIndex } = require('./media/mediaIndex')`):
```javascript
// POST /api/media/reindex — manual trigger (secret-guarded). Fires in background.
app.post('/api/media/reindex', requireSecret, (req, res) => {
  res.json({ status: 'started', message: 'Media index running in background' })
  runMediaIndex().catch((err) => console.error('[API] Media index failed:', err.message))
})
```

- [ ] **Step 3: Manual verification**

Start ghl-sync locally (`cd ghl-sync && node src/index.js`) and:
`curl -s -X POST localhost:3000/api/media/reindex -H "x-sync-secret: $SYNC_SECRET"`
Expected: `{"status":"started",...}` and `[API] Media index` logs appear. (If `SYNC_SECRET` unset locally, the header is not required.)

- [ ] **Step 4: Commit**

```bash
git add ghl-sync/src/scheduler.js ghl-sync/src/index.js
git commit -m "feat(media-search): daily cron + manual reindex endpoint"
```

---

## Task 10: Query embedding + search route + thumbnail proxy (auth)

**Files:**
- Create: `auth/src/services/voyageQuery.js`
- Create: `auth/src/routes/media.js`
- Modify: `auth/src/index.js` (mount)

**Interfaces:**
- Produces:
  - `voyageQuery.embedQuery(text)` → `number[]` (1024-dim, `input_type:"query"`).
  - Routes under `/media`: `POST /media/search`, `GET /media/thumbnail/:driveFileId`, `POST /media/reindex`.

- [ ] **Step 1: Implement the query embedder**

```javascript
// auth/src/services/voyageQuery.js
const VOYAGE_URL = 'https://api.voyageai.com/v1/multimodalembeddings'

async function embedQuery(text) {
  const key = process.env.VOYAGE_API_KEY
  if (!key) throw new Error('VOYAGE_API_KEY not set')
  const res = await fetch(VOYAGE_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + key },
    body: JSON.stringify({
      model: 'voyage-multimodal-3.5',
      input_type: 'query',
      inputs: [{ content: [{ type: 'text', text }] }],
    }),
  })
  const data = await res.json()
  if (!res.ok) throw new Error('Voyage query error ' + res.status + ': ' + JSON.stringify(data))
  return data.data[0].embedding
}

module.exports = { embedQuery }
```

- [ ] **Step 2: Implement the route**

```javascript
// auth/src/routes/media.js
// Media Library: semantic search over the indexed Drive media folder.
// Gated to corporate/marketing/admin (requireRole('corporate') covers all three
// in the role hierarchy). Thumbnails are proxied because the Drive folder is
// private and <img> can't send a Bearer token directly.
const { Router } = require('express')
const { supabaseAdmin } = require('../services/supabase')
const authenticate = require('../middleware/auth')
const { requireRole } = require('../middleware/role')
const { getAccessToken } = require('./googleBusiness')
const { embedQuery } = require('../services/voyageQuery')

const router = Router()
router.use(authenticate)
router.use(requireRole('corporate'))

const DRIVE_FILES = 'https://www.googleapis.com/drive/v3/files'

// POST /media/search { query, location?, kind?, limit? }
router.post('/search', async (req, res) => {
  try {
    const query = String(req.body.query || '').trim()
    if (!query) return res.status(400).json({ error: 'query required' })
    const limit = Math.min(Number(req.body.limit) || 40, 100)
    const filterLocation = req.body.location ? String(req.body.location) : null
    const filterKind = req.body.kind === 'image' || req.body.kind === 'video' ? req.body.kind : null

    const embedding = await embedQuery(query)
    const { data, error } = await supabaseAdmin.rpc('match_media_embeddings', {
      query_embedding: JSON.stringify(embedding), // pgvector accepts '[...]' text
      match_count: limit,
      filter_location: filterLocation,
      filter_kind: filterKind,
    })
    if (error) throw error
    res.json({ results: data || [] })
  } catch (err) {
    console.error('[Media] search error:', err.message)
    res.status(500).json({ error: err.message })
  }
})

// GET /media/thumbnail/:driveFileId — authenticated proxy for a Drive thumbnail.
router.get('/thumbnail/:driveFileId', async (req, res) => {
  try {
    const id = req.params.driveFileId
    const token = await getAccessToken()
    const meta = await fetch(`${DRIVE_FILES}/${id}?fields=thumbnailLink&supportsAllDrives=true`, {
      headers: { Authorization: 'Bearer ' + token },
    }).then((r) => r.json())
    let upstream
    if (meta.thumbnailLink) {
      upstream = await fetch(meta.thumbnailLink.replace(/=s\d+$/, '=s640'), { headers: { Authorization: 'Bearer ' + token } })
    }
    if (!upstream || !upstream.ok) {
      upstream = await fetch(`${DRIVE_FILES}/${id}?alt=media&supportsAllDrives=true`, { headers: { Authorization: 'Bearer ' + token } })
    }
    if (!upstream.ok) return res.status(404).end()
    res.set('Content-Type', upstream.headers.get('content-type') || 'image/jpeg')
    res.set('Cache-Control', 'private, max-age=86400')
    const buf = Buffer.from(await upstream.arrayBuffer())
    res.send(buf)
  } catch (err) {
    console.error('[Media] thumbnail error:', err.message)
    res.status(500).end()
  }
})

// POST /media/reindex — admin only; proxies to the ghl-sync worker.
router.post('/reindex', requireRole('admin'), async (req, res) => {
  try {
    const base = process.env.GHL_SYNC_URL
    if (!base) return res.status(503).json({ error: 'GHL_SYNC_URL not configured' })
    const r = await fetch(base.replace(/\/$/, '') + '/api/media/reindex', {
      method: 'POST', headers: { 'x-sync-secret': process.env.SYNC_SECRET || '' },
    })
    const data = await r.json().catch(() => ({}))
    res.status(r.status).json(data)
  } catch (err) {
    console.error('[Media] reindex proxy error:', err.message)
    res.status(500).json({ error: err.message })
  }
})

module.exports = router
```

- [ ] **Step 3: Mount the route**

In `auth/src/index.js`, alongside the other `app.use` feature mounts:
```javascript
app.use('/media', require('./routes/media'))
```

- [ ] **Step 4: Manual verification**

With auth running and Task 8's index populated, get a staff JWT (corporate+), then:
```bash
curl -s -X POST localhost:3001/media/search -H "Authorization: Bearer $JWT" \
  -H "Content-Type: application/json" -d '{"query":"deadlift","limit":10}' | head
```
Expected: `{"results":[{"drive_file_id":...,"similarity":0.x,...}]}` with plausible matches ordered by descending `similarity`. Then open a thumbnail:
`curl -s localhost:3001/media/thumbnail/<a_returned_drive_file_id> -H "Authorization: Bearer $JWT" -o /tmp/thumb.jpg && file /tmp/thumb.jpg`
Expected: a JPEG image.

- [ ] **Step 5: Commit**

```bash
git add auth/src/services/voyageQuery.js auth/src/routes/media.js auth/src/index.js
git commit -m "feat(media-search): auth search route, thumbnail proxy, reindex proxy"
```

---

## Task 11: Frontend — API helpers + AuthImg

**Files:**
- Modify: `portal/src/lib/api.js`
- Create: `portal/src/components/AuthImg.jsx`

**Interfaces:**
- Produces: `searchMedia({ query, location, kind, limit })` → `{ results }`; `fetchMediaThumbBlob(driveFileId)` → object URL string; `reindexMedia()` → `{ status }`. `AuthImg` renders an `<img>` whose source is fetched with the auth token.

- [ ] **Step 1: Add API helpers**

In `portal/src/lib/api.js`, add (the file already exposes `api()`, `API_URL`, and the in-memory `authToken`; reuse them — export `API_URL` and `authToken` getter if not already, or add a helper that reads the same token):
```javascript
export async function searchMedia({ query, location, kind, limit = 40 }) {
  return api('/media/search', { method: 'POST', body: JSON.stringify({ query, location, kind, limit }) })
}

export async function reindexMedia() {
  return api('/media/reindex', { method: 'POST' })
}

// Fetch a protected thumbnail with the bearer token and return an object URL.
export async function fetchMediaThumbBlob(driveFileId) {
  const res = await fetch(API_URL + '/media/thumbnail/' + encodeURIComponent(driveFileId), {
    headers: authToken ? { Authorization: 'Bearer ' + authToken } : {},
  })
  if (!res.ok) throw new Error('thumb ' + res.status)
  return URL.createObjectURL(await res.blob())
}
```
If `API_URL` / `authToken` are module-private, export them (e.g. `export { API_URL }` and a `export function getAuthToken(){ return authToken }`) and use the getter here. Keep the change minimal and consistent with the file's existing style.

- [ ] **Step 2: Create AuthImg**

```jsx
// portal/src/components/AuthImg.jsx
import { useEffect, useState } from 'react'
import { fetchMediaThumbBlob } from '../lib/api'

export default function AuthImg({ driveFileId, alt, className }) {
  const [src, setSrc] = useState(null)
  const [failed, setFailed] = useState(false)
  useEffect(() => {
    let url
    let alive = true
    fetchMediaThumbBlob(driveFileId)
      .then((u) => { if (alive) { url = u; setSrc(u) } })
      .catch(() => alive && setFailed(true))
    return () => { alive = false; if (url) URL.revokeObjectURL(url) }
  }, [driveFileId])
  if (failed) return <div className={(className || '') + ' bg-bg flex items-center justify-center text-tile-sub text-xs'}>no preview</div>
  if (!src) return <div className={(className || '') + ' bg-bg animate-pulse'} />
  return <img src={src} alt={alt || ''} className={className} loading="lazy" />
}
```

- [ ] **Step 3: Manual verification**

Lint/build: `cd portal && npm run build`
Expected: build succeeds (no import or syntax errors). Functional check happens in Task 13.

- [ ] **Step 4: Commit**

```bash
git add portal/src/lib/api.js portal/src/components/AuthImg.jsx
git commit -m "feat(media-search): portal API helpers + authed thumbnail image"
```

---

## Task 12: Frontend — Media Library page

**Files:**
- Create: `portal/src/components/MediaLibraryView.jsx`

**Interfaces:**
- Consumes: `searchMedia`, `reindexMedia` from `../lib/api`, `AuthImg`, `LOCATION_OPTIONS`-style config if present.
- Produces: default-exported component `MediaLibraryView({ onBack, userRole })`.

- [ ] **Step 1: Implement the page**

```jsx
// portal/src/components/MediaLibraryView.jsx
import { useState } from 'react'
import { searchMedia, reindexMedia } from '../lib/api'
import AuthImg from './AuthImg'

const LOCATIONS = ['Salem', 'Eugene', 'Springfield', 'Clackamas', 'Keizer', 'Milwaukie', 'Medford', 'Etc.']
const inputCls = 'px-3 py-2 rounded-lg border border-border bg-bg text-sm text-text-primary focus:outline-none focus:border-wcs-red'
const btnPrimary = 'px-4 py-2 rounded-lg bg-wcs-red text-white text-sm font-semibold hover:bg-wcs-red/90 transition-colors disabled:opacity-50'

function fmtTime(s) {
  if (s == null) return null
  const m = Math.floor(s / 60), sec = Math.floor(s % 60)
  return `${m}:${String(sec).padStart(2, '0')}`
}

export default function MediaLibraryView({ onBack, userRole }) {
  const [query, setQuery] = useState('')
  const [location, setLocation] = useState('')
  const [kind, setKind] = useState('')
  const [results, setResults] = useState([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(null)
  const [searched, setSearched] = useState(false)
  const [lightbox, setLightbox] = useState(null)

  async function runSearch(e) {
    e?.preventDefault()
    if (!query.trim()) return
    setLoading(true); setError(null)
    try {
      const { results } = await searchMedia({ query: query.trim(), location: location || undefined, kind: kind || undefined })
      setResults(results || []); setSearched(true)
    } catch (err) { setError(err.message) } finally { setLoading(false) }
  }

  return (
    <div className="max-w-6xl mx-auto p-4">
      <div className="flex items-center justify-between mb-4">
        <button onClick={onBack} className="text-sm text-tile-sub hover:text-text-primary">&larr; Back</button>
        {userRole === 'admin' && (
          <button onClick={() => reindexMedia().then(() => alert('Reindex started')).catch((e) => alert(e.message))}
            className="text-xs text-tile-sub hover:text-wcs-red">Reindex</button>
        )}
      </div>
      <h1 className="text-xl font-bold text-text-primary mb-1">Media Library</h1>
      <p className="text-sm text-tile-sub mb-4">Search photos and videos by what is in them, like "deadlift" or "front desk".</p>

      <form onSubmit={runSearch} className="flex flex-wrap gap-2 mb-5">
        <input className={inputCls + ' flex-1 min-w-[200px]'} placeholder="Search the media library..."
          value={query} onChange={(e) => setQuery(e.target.value)} />
        <select className={inputCls} value={location} onChange={(e) => setLocation(e.target.value)}>
          <option value="">All locations</option>
          {LOCATIONS.map((l) => <option key={l} value={l}>{l}</option>)}
        </select>
        <select className={inputCls} value={kind} onChange={(e) => setKind(e.target.value)}>
          <option value="">Photos and video</option>
          <option value="image">Photos</option>
          <option value="video">Video</option>
        </select>
        <button className={btnPrimary} disabled={loading}>{loading ? 'Searching...' : 'Search'}</button>
      </form>

      {error && <div className="text-sm text-wcs-red mb-3">{error}</div>}
      {searched && !loading && !results.length && <div className="text-sm text-tile-sub">No matches found.</div>}

      <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-3">
        {results.map((r) => (
          <button key={r.asset_id} onClick={() => setLightbox(r)}
            className="group relative rounded-lg overflow-hidden border border-border bg-surface aspect-square">
            <AuthImg driveFileId={r.drive_file_id} alt={r.title} className="w-full h-full object-cover" />
            {r.kind === 'video' && (
              <span className="absolute bottom-1 right-1 text-[10px] bg-black/70 text-white px-1.5 py-0.5 rounded">
                {r.frame_time_seconds != null ? 'match at ' + fmtTime(r.frame_time_seconds) : 'video'}
              </span>
            )}
            <span className="absolute top-1 left-1 text-[10px] bg-black/60 text-white px-1.5 py-0.5 rounded">{r.location}</span>
          </button>
        ))}
      </div>

      {lightbox && (
        <div className="fixed inset-0 z-50 bg-black/70 flex items-center justify-center p-4" onClick={() => setLightbox(null)}>
          <div className="bg-surface rounded-2xl border border-border max-w-2xl w-full p-4" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-sm font-bold text-text-primary truncate">{lightbox.title}</h3>
              <button onClick={() => setLightbox(null)} className="text-tile-sub hover:text-text-primary text-lg leading-none">&times;</button>
            </div>
            <AuthImg driveFileId={lightbox.drive_file_id} alt={lightbox.title} className="w-full max-h-[60vh] object-contain rounded-lg bg-bg" />
            <div className="flex items-center justify-between mt-3 text-xs text-tile-sub">
              <span>{lightbox.location} &middot; {lightbox.folder_path}</span>
              <a href={lightbox.web_view_link} target="_blank" rel="noreferrer" className="text-wcs-red font-semibold">Open in Drive</a>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
```

- [ ] **Step 2: Manual verification**

`cd portal && npm run build`
Expected: build succeeds.

- [ ] **Step 3: Commit**

```bash
git add portal/src/components/MediaLibraryView.jsx
git commit -m "feat(media-search): Media Library search page"
```

---

## Task 13: Frontend — wire navigation + tile

**Files:**
- Modify: `portal/src/App.jsx`
- Modify: `portal/src/components/ToolGrid.jsx`

**Interfaces:**
- Consumes: `MediaLibraryView`.
- Produces: a gated "Media Library" tile (visible at `roleIdx >= ROLE_LEVELS.corporate`) that opens the page.

- [ ] **Step 1: Add view state + render in App.jsx**

- Import at top: `import MediaLibraryView from './components/MediaLibraryView'`.
- Add state near the other view flags: `const [showMediaLibrary, setShowMediaLibrary] = useState(false)`.
- In the conditional render chain (next to `showMarketingTracker`), add a branch:
```jsx
) : showMediaLibrary ? (
  <MediaLibraryView onBack={() => setShowMediaLibrary(false)} userRole={user?.staff?.role} />
```
- Pass the callback into `ToolGrid` where the other `on*` props are passed: `onMediaLibrary={() => setShowMediaLibrary(true)}`.

- [ ] **Step 2: Add the tile in ToolGrid.jsx**

- Accept the new prop in the component signature alongside the other `on*` props: `onMediaLibrary`.
- In the Tools grid (next to the Marketing Tracker tile), add a gated tile:
```jsx
{onMediaLibrary && roleIdx >= ROLE_LEVELS.corporate && (
  <SvgTileButton label="Media Library" sub="Search photos by content" onClick={onMediaLibrary} icon={TILE_ICONS.media || TILE_ICONS.drive} />
)}
```
If `SvgTileButton` requires a specific icon key, add a `media` entry to `TILE_ICONS` (reuse an existing image/search SVG path already present in the file; if none fits, copy the `drive` icon path).

- [ ] **Step 3: Manual verification (end to end)**

Run the stack (auth on 3001, ghl-sync indexed, portal dev): `cd portal && npm run dev`. Log in as a corporate/admin user. Expected:
- "Media Library" tile appears for corporate+ and is absent for a team_member.
- Searching "deadlift" returns a grid of relevant photos; thumbnails load (AuthImg).
- A video result shows "match at m:ss"; clicking opens the lightbox with an "Open in Drive" link.

- [ ] **Step 4: Commit**

```bash
git add portal/src/App.jsx portal/src/components/ToolGrid.jsx
git commit -m "feat(media-search): navigation tile + view wiring for Media Library"
```

---

## Task 14: Full backfill + docs + PR

**Files:**
- Modify: `README.md` or the relevant env doc (add the new env vars), if an env reference file exists.

- [ ] **Step 1: Run the full backfill**

Ensure `MEDIA_ROOT_FOLDER_ID=1tZiYf1_eBdzx-50-HNtFKahBqQ57Dlyb` and all env set on the real ghl-sync. Trigger:
`curl -s -X POST $GHL_SYNC_URL/api/media/reindex -H "x-sync-secret: $SYNC_SECRET"`
Watch logs for `[MediaIndex] done`. Then verify counts via Supabase MCP:
```sql
select kind, count(*) from media_assets group by kind;                       -- ~4856 image / ~66 video
select count(*) from media_embeddings;                                       -- photos + all video frames
select count(*) from media_assets where status = 'error';                    -- investigate if > 0
```

- [ ] **Step 2: Document env vars**

Add the new variables (ghl-sync: `VOYAGE_API_KEY`, `MEDIA_ROOT_FOLDER_ID`, `MEDIA_VIDEO_FRAME_INTERVAL_SEC`, `MEDIA_INDEX_HOUR`, `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`; auth: `VOYAGE_API_KEY`, `GHL_SYNC_URL`, `SYNC_SECRET`) to wherever env is documented, and ensure they are set in Render for both services.

- [ ] **Step 3: Run all unit tests**

```bash
cd ghl-sync && node test/voyageClient.test.js && node test/imagePrep.test.js && node test/locationPath.test.js && node test/diff.test.js
```
Expected: all pass.

- [ ] **Step 4: Open the PR (do not merge)**

```bash
git push -u origin feat/media-search
gh pr create --title "Media Library: visual search over the Drive media folder" --body "<summary + test evidence>"
```

---

## Self-Review Notes

- **Spec coverage:** pgvector tables + RPC (Task 1) · Voyage embeddings (Tasks 2/10) · indexer in ghl-sync with photos + video frames (Tasks 3-8) · poll + md5 diff (Task 5) · nightly cron + manual reindex (Task 9) · search API role-gated to corporate+ (Task 10) · authenticated thumbnail proxy (Tasks 10/11) · Media Library page gated like Marketing Tracker (Tasks 12/13) · full backfill (Task 14). All spec sections map to a task.
- **Drive-account caveat** from the spec is enforced as a checkpoint in Task 6 Step 2 (fail loudly if the shared account can't see the folder).
- **Type consistency:** `runMediaIndex`, `embedMultimodal(items, inputType)`, `toEmbedInput(buffer) -> {imageDataUrl}`, `match_media_embeddings(query_embedding, match_count, filter_location, filter_kind)`, and the RPC return columns are used identically across tasks.
- **Known follow-ups (out of v1 scope):** mobile-specific page, LLM captioning/auto-tagging, Supabase Storage thumbnails instead of live proxy.
