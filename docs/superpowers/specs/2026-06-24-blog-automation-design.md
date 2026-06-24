# Automated Blog Post System — Design

**Date:** 2026-06-24
**Branch:** `feat/blog-automation`
**Status:** Approved design, pending spec review

## Summary

An automated SEO/AEO/GEO blog post generator built into the WCS Staff Portal's
**auth service**. On a weekly schedule it generates one location-specific blog
post per gym location, picks a relevant local photo from that location's Drive
folder via the existing Media Library embeddings, and **publishes it directly
and automatically to the WordPress site** (westcoaststrength.com). No email, no
human approval step. Failures alert via the existing GHL error-SMS webhook.

This replaces the old standalone `autoblogger` repo (Render web service, SQLite,
Unsplash images, email approval workflow). The new system reuses the old
WordPress integration but drops email/approval entirely, swaps Unsplash for the
portal's own location-tagged Drive photos, and raises the content quality bar to
cover SEO + AEO + GEO since nothing gets a human glance before going live.

## Decisions (locked during brainstorming)

| Question | Decision |
|---|---|
| Publish target | **Same WordPress site** (westcoaststrength.com REST API), reuse old integration |
| Human control | **Fully automatic** — scheduled generate + publish straight to live; portal shows history/logs only |
| Locations | **6: Salem, Keizer, Eugene, Springfield, Clackamas, Medford** (NOT Milwaukie) |
| Photo selection | **Smart semantic match** — reuse existing Media Library embeddings, already per-location/tagged |
| Cadence | **Weekly per location** (6 posts/week), category auto-rotated |
| Failure alerts | **Reuse the GHL error-SMS webhook** (`ALERT_WEBHOOK_URL` / `sendAlert`), no email |

## Non-goals (YAGNI)

- No email of any kind (approval, notification, or otherwise).
- No in-portal review queue or WordPress-draft step — publishing is autonomous.
- No new image embedding pipeline — photos are already indexed by the Media
  Library worker in `ghl-sync`.
- No editable per-location config UI in v1 (static config file; portal config
  can come later).
- Milwaukie is excluded.

## Architecture

Lives in the **auth service** (Node/Express on Render), mirroring the
`inventorySync` and Day One program-generator patterns (in-process `node-cron`,
job rows used as progress/history, `supabaseAdmin` for data).

```
auth/src/services/blogAutomation/
  index.js         # cron registration + runWeekly() orchestrator
  config.js        # per-location SEO config + Drive folder id + WP category (static)
  topics.js        # category list, per-location rotation + no-repeat
  generate.js      # multi-step SEO/AEO/GEO content generation (Claude)
  validate.js      # programmatic + model self-critique gate (autonomous safety)
  photo.js         # semantic photo pick (reuse embedQuery + match_media_embeddings)
  wordpress.js     # ported from autoblogger: media upload + publish + SEO meta + schema
  jobs.js          # blog_posts row lifecycle (createJob/setStatus/markPublished/markFailed)
  alerts.js        # ported sendAlert() -> GHL error-SMS webhook
auth/src/routes/blogAutomation.js   # portal API: history, status, manual "generate now"
```

Cron is registered from `auth/src/index.js`, gated by `BLOG_AUTOMATION_DISABLED`,
timezone `America/Los_Angeles` — exactly the `inventorySync` convention.

### Why the auth service (not the standalone repo)

The auth service already holds every dependency this needs: the Google Drive
OAuth token (`getAccessToken`), the Media Library semantic search
(`embedQuery` + `match_media_embeddings` RPC), the Anthropic client pattern,
Supabase admin access, and the `node-cron` scheduling convention. Resurrecting a
separate service would duplicate all of it and add another Render service to
operate. One module in auth is the smallest correct surface.

## Data model (one new migration)

### `blog_posts` (job + history, shape mirrors `pt_programs`)

| column | type | notes |
|---|---|---|
| id | uuid pk | |
| location | text | e.g. `Salem` (must match `media_assets.location` for photo filter) |
| category | text | rotated content category |
| topic | text | resolved topic string |
| status | text | `generating` \| `published` \| `failed` \| `skipped` |
| title | text | |
| slug | text | |
| meta_description | text | |
| focus_keyword | text | |
| content_html | text | final post body (with FAQ + JSON-LD) |
| faq_json | jsonb | structured FAQ used for FAQPage schema |
| image_asset_id | uuid | matched `media_assets.id` (nullable) |
| image_drive_id | text | Drive file id of chosen photo (nullable) |
| wp_post_id | bigint | WordPress post id once published |
| wp_url | text | live post URL |
| wp_media_id | bigint | uploaded featured-image media id |
| validation_report | jsonb | rubric result + programmatic check outcomes |
| error_message | text | on failure |
| created_at | timestamptz default now() | |
| published_at | timestamptz | |

Index on `(location, created_at desc)` for "recent posts per location" + topic
no-repeat lookups. RLS on, no policy (service-role only) per portal convention.

Topic no-repeat is a query against this table (last N topics/titles for a
location) — no separate table needed.

### Per-location config (`config.js`, static)

For each of the 6 locations: `location` key, `name`, `city`, `wpCategory`,
`driveFolderId` (the link you give me), `keywords[]`, `landmarks[]`,
`neighborhoods[]`, `localContext`, `enabled`. Medford gets fresh SEO context
(it postdates the old `autoblogger`). The Drive folder ids are committed
alongside the SEO context. (A portal-editable version is a later enhancement.)

## Generation flow (weekly cron, per location)

1. **Select** category (rotate from the location's last-used) + topic (skip
   recently used).
2. **Insert** `blog_posts` row, status `generating`.
3. **Generate** (multi-step Claude calls, Day One-style fan-out):
   - intro with a direct-answer opening paragraph,
   - H2/H3 body sections,
   - a 3–5 item **FAQ block**,
   - a "key takeaways" list,
   - natural local references,
   - title (50–60c), meta description (150–160c), focus keyword.
4. **Validate** (autonomous safety gate):
   - **Programmatic:** title present; meta 150–160c; min word count; valid HTML;
     FAQ present; correct location named; focus keyword appears.
   - **Model self-critique:** a Claude pass scoring the draft against a brand +
     accuracy rubric (on-brand voice, no hallucinated specific claims about the
     gym, no medical overreach, correct location, readability).
   - Fail → one regeneration attempt → still fail → mark `failed`, fire SMS
     alert, **skip publishing**. Never publish malformed/off-brand content.
5. **Photo:** `embedQuery(title/topic)` → `match_media_embeddings({
   filter_location: location, filter_kind: 'image', match_count: 5 })` → take top
   hit → download bytes from Drive (`getAccessToken` + `alt=media`). If no match,
   publish without a featured image (logged, not failed).
6. **Publish:** upload image to WP media → create WordPress post `status=publish`
   with category = location, content-type tag, SEO meta, and embedded
   Article + FAQPage + LocalBusiness JSON-LD.
7. **Record:** mark row `published` with `wp_post_id`, `wp_url`, `wp_media_id`.
8. **On any error:** mark `failed`, store `error_message`, fire `sendAlert(...)`.

Per-location runs are sequential with a small delay (rate-limit friendliness),
matching the old batch loop.

## SEO + AEO + GEO strategy

- **SEO (rank in Google):** focus keyword + local keywords woven naturally;
  optimized title + meta; H2/H3 structure; internal CTA to the local gym;
  `Article` + `LocalBusiness` JSON-LD; scannable paragraphs.
- **AEO (answer engines, featured snippets, "People Also Ask", voice):**
  question-style H2s each followed immediately by a concise direct answer; a
  real **FAQ section + `FAQPage` schema** — the extractable format answer
  engines prefer.
- **GEO (cited by ChatGPT / Perplexity / AI Overviews):** specific, factual,
  quotable statements; clear entity definitions (the gym, the city);
  stats/specifics over fluff; comprehensive topical coverage; authoritative
  tone. Encoded into the generation prompts and enforced by the validation
  rubric.

### Open implementation detail — SEO plugin

The schema must actually render on the live site. The old code wrote **Yoast**
meta keys (`_yoast_wpseo_metadesc`, `_yoast_wpseo_focuskw`). Before
implementation, confirm whether the site runs **Yoast or RankMath** (meta keys
and FAQ/Article schema emission differ). If unclear, detect it from the site
during planning. As a belt-and-suspenders fallback, the post body itself embeds
JSON-LD so schema exists regardless of plugin.

## Portal surface

A monitoring page (Admin tile or Marketing sub-page), gated to
corporate/marketing/admin:

- Recent posts per location with status + live links.
- Visible failures with error detail.
- Next scheduled run time.
- **"Generate now" button per location** — essential for testing the autonomous
  pipeline before trusting the weekly cron.

Read-only otherwise (publishing is automatic).

## Reuse map

| Need | Reused from |
|---|---|
| WordPress publish + media upload + SEO meta | port `autoblogger/src/wordpress.js` |
| Text→image semantic search | `auth/services/voyageQuery.embedQuery` + `match_media_embeddings` RPC |
| Drive image bytes | `getAccessToken()` (googleBusiness) + `DRIVE_FILES?alt=media` |
| Anthropic generation | Day One `dayOneProgram/anthropic.js` pattern |
| node-cron scheduling | `inventorySync` convention (env-gated, LA tz) |
| Error SMS | port `ghl-sync/src/alerts.js` `sendAlert()` (same `ALERT_WEBHOOK_URL`) |
| Job-row-as-progress | `dayOneProgram/jobs.js` pattern |

## Environment variables (auth service, Render)

Reuse existing where present; add the rest:

- `ANTHROPIC_API_KEY` (existing)
- `WP_API_URL`, `WP_USERNAME`, `WP_APP_PASSWORD` (from old autoblogger; re-add)
- `ALERT_WEBHOOK_URL` (same value ghl-sync uses)
- `BLOG_AUTOMATION_DISABLED` (kill switch; default off in prod once verified)
- Google Drive OAuth + Voyage / Media Library env (already present in auth)

## Risks & mitigations

- **Autonomous publish of bad content** → two-layer validation gate
  (programmatic + model rubric) with regen-then-skip; nothing malformed reaches
  the site.
- **Thin/repetitive content over time** → topic no-repeat per location +
  category rotation; weekly (not daily) cadence keeps each post distinct.
- **Schema not rendering** → confirm SEO plugin + embed JSON-LD in body as
  fallback.
- **Photo location mismatch** → verify the exact `media_assets.location` string
  format during planning so `filter_location` matches.
- **WP credentials drift** → `/blog-automation` status endpoint includes a WP
  connection check (like the old `/test`).

## Testing

- Unit: topic rotation/no-repeat, validation programmatic checks, WP payload
  building, photo-pick fallback behavior.
- Integration (manual, via "Generate now"): full pipeline against one location
  to a WordPress **draft** first (temporary flag) to eyeball output before
  flipping to autonomous publish.
- Verify SMS alert fires on a forced failure.
