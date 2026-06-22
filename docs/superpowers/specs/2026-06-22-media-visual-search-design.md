# Media Visual Search — Design

**Date:** 2026-06-22
**Repo:** wcs-staff-portal (monorepo: `auth/` API, `ghl-sync/` workers, `portal/` React app)
**Branch:** `feat/media-search`

## Goal

Let staff search the WCS shared "Media" Google Drive folder by **what is in a photo or video**, not by filename. Searching `deadlift` returns every photo (and video moment) of someone deadlifting. Powered by multimodal embeddings so text queries match image/video content in a shared vector space.

## Scope (v1)

- **In:** ~4,856 photos + ~66 videos under the Media root folder (8 location subtrees: Salem, Eugene, Springfield, Clackamas, Keizer, Milwaukie, Medford, Etc.). Recursive crawl, semantic search UI, nightly + on-demand re-index, video frame-level matching with deep links to the matched timestamp.
- **Out (later):** LLM captioning/auto-tagging, writing tags back to Drive, social-caption generation, per-photo lazy enrichment.

## Decisions (locked)

- **Embedding provider:** Voyage `voyage-multimodal-3.5` (1024-dim). Image + text in one space. REST: `POST https://api.voyageai.com/v1/multimodalembeddings`, `inputs[].content[]` with `{type:"text"}` and `{type:"image_url", image_url:"data:image/jpeg;base64,..."}`. `input_type:"document"` when indexing, `"query"` when searching. Batch ≤1000 inputs / ≤320k tokens; image ≤20MB / ≤16M px. Pricing $0.60/billion pixels with **150B pixels/month free** — backfill (~10B px) and ongoing updates are effectively free.
- **v1 covers photos AND video** (frame sampling).
- **Indexer home:** a recurring job in `ghl-sync` (matches existing sync pattern; server-side only). Plus a manual `POST /api/media/reindex` trigger.
- **Sync method:** polling with `md5Checksum` + `modifiedTime` diffing — no Drive push webhooks.
- **Search API home:** `auth/` route, role-gated to corporate/marketing/admin (like Marketing Tracker).

## Architecture

```
Drive "Media" folder ──► [ghl-sync] media-index job ──► Voyage API ──► Supabase (pgvector)
   (existing OAuth)        backfill + incremental                          │
                                                                           ▼
   Portal UI  ◄──── [auth] /api/media/search ◄──── query embed ◄──── ANN search
```

Reuses the existing Google Drive OAuth integration (`auth/src/routes/googleBusiness.js` `getAccessToken()`, as used by `driveFolders.js`). No new GCP service account.

## Data model (Supabase migration `052`)

Enable `pgvector`. Two tables, RLS enabled (no policy — service-role only, per repo standard).

### `media_assets` — one row per Drive file
- `id` uuid pk
- `drive_file_id` text unique not null
- `kind` text not null  — `image` | `video`
- `title` text
- `mime_type` text
- `location` text  — top-level folder name (Salem/Eugene/…/Etc.)
- `folder_path` text  — full path under Media root
- `file_size` bigint
- `drive_modified_time` timestamptz
- `md5` text  — Drive `md5Checksum`, for change detection
- `thumbnail_cached` text  — optional cached thumbnail ref/data
- `web_view_link` text
- `status` text default `'indexed'`  — `indexed` | `pending` | `error`
- `indexed_at` timestamptz
- `created_at` / `updated_at` timestamptz default now()

### `media_embeddings` — one row per embedding unit
- `id` uuid pk
- `asset_id` uuid not null references `media_assets(id)` on delete cascade
- `embedding` vector(1024) not null
- `frame_time_seconds` numeric null  — null for photos; set per sampled video frame
- `created_at` timestamptz default now()
- Index: HNSW on `embedding` `vector_cosine_ops`.

A photo → 1 embedding row. A video → N frame rows, enabling deep-link-to-moment results.

## Indexer job (`ghl-sync`)

Per run:
1. Recursively list image/* and video/* files under `MEDIA_ROOT_FOLDER_ID` (Drive REST `files.list`, fields incl. `id, name, mimeType, md5Checksum, modifiedTime, size, parents, webViewLink`). Reuse `getAccessToken()`; paginate via `nextPageToken`.
2. Derive `location` (top-level folder) and `folder_path` during traversal.
3. Diff vs `media_assets`:
   - **New / changed** (`md5` or `modifiedTime` differs) → (re)embed.
   - **Deleted in Drive** → delete asset (cascade removes embeddings).
4. Embed:
   - **Photo:** download bytes (authed), downscale to ≤2MP, base64 → Voyage (`document`, batched). Upsert asset + 1 embedding.
   - **Video:** download, `ffmpeg` sample 1 frame / 5s (configurable `MEDIA_VIDEO_FRAME_INTERVAL_SEC`), downscale each, embed each frame. Upsert asset + N frame rows. Use `ffmpeg-static` (no system ffmpeg on Render).
5. Mark `status`/`indexed_at`; record errors without aborting the whole run.

**Backfill** = first run against an empty table. **Schedule:** nightly via existing ghl-sync scheduling + manual `POST /api/media/reindex`.

Throttle Voyage calls and downloads; cap concurrency to stay friendly to Drive + memory on Render.

## Search API (`auth`)

- `POST /api/media/search` — body `{ query, location?, kind?, year?, limit? }`.
  - Embed `query` via Voyage (`input_type:"query"`).
  - pgvector cosine ANN over `media_embeddings`, join `media_assets`, apply filters, dedupe video frames to best-matching frame per asset.
  - Return: asset metadata, similarity score, `web_view_link`, thumbnail proxy URL, and for video the matched `frame_time_seconds` + a Drive deep link to that moment.
  - Role-gated: corporate/marketing/admin (`requireRole` / existing report-access pattern).
- `GET /api/media/thumbnail/:driveFileId` — authenticated proxy that streams the Drive thumbnail (the folder is private, so raw Drive thumbnail URLs won't render in the browser). Cached.
- `POST /api/media/reindex` — admin-only manual trigger for the ghl-sync job.

## Frontend (`portal/src`)

New page **"Media Library"** (`/media`), nav entry gated corporate/marketing/admin:
- Search bar (semantic query).
- Filters: location, photo/video, year.
- Results grid of thumbnails (via proxy). Click → lightbox or open in Drive.
- Video tiles show matched timestamp ("match at 0:42") linking to that moment.

## Config / env

- `VOYAGE_API_KEY`
- `MEDIA_ROOT_FOLDER_ID` (the Media root Drive folder id)
- `MEDIA_VIDEO_FRAME_INTERVAL_SEC` (default 5)

## Risks / to verify in build

- **Drive access:** the portal's connected Google account must be able to read the Media folder (currently shared with justin@wcstrength.com). Verify the connected account == an account with access; otherwise share the folder to it or add it.
- **Render memory:** large video downloads (up to ~860MB) + ffmpeg. Stream to a temp file, sample, delete; cap one video at a time.
- **HNSW build** on ~5k+ rows is trivial; revisit index params only if recall/latency needs it.

## Guardrails (operational)

- Work in isolated worktree `../wcs-staff-portal-media-search` off `master`.
- pnpm; worktree uses a node_modules junction — never recursive-delete the worktree, use `git worktree remove`.
- Do not touch `firstContactPick.js` or `SpeedToLeadAudit.jsx` (owned by another session).
- Open a PR; do not merge.

## Out of scope (explicit)

LLM captioning, auto-tagging, write-back to Drive, social-caption generation. Revisit as a v2 if filtering on fine attributes or readable descriptions becomes needed.
