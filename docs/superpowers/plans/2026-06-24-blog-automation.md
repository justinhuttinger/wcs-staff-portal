# Automated Blog Post System — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A weekly, fully-autonomous SEO/AEO/GEO blog generator inside the portal's auth service that publishes one location-specific post per gym to WordPress, with a local photo pulled from the existing Media Library embeddings.

**Architecture:** A new `auth/src/services/blogAutomation/` module + a `node-cron` weekly job (env-gated, started from `index.js`). Each run: rotate topic → generate (multi-step Claude) → validate (programmatic + model critique) → pick a location photo (reuse `embedQuery` + `match_media_embeddings`) → publish to WordPress (Yoast meta + FAQ block) → record a `blog_posts` row. Failures fire the existing GHL error-SMS webhook. A read-only portal page shows history + a manual "Generate now" trigger.

**Tech Stack:** Node/Express (CommonJS), `@anthropic-ai/sdk` (streaming), Supabase (`supabaseAdmin`, pgvector RPC), `node-cron`, WordPress REST API (Basic auth app password), `node:test`/`node:assert`, React (portal).

## Global Constraints

- **Locations (exactly 6, keys MUST match `media_assets.location` strings):** `Salem`, `Keizer`, `Eugene`, `Springfield`, `Clackamas`, `Medford`. **Milwaukie is excluded.**
- **No email anywhere.** Failures alert only via `sendAlert()` → GHL webhook.
- **Fully autonomous publish** — no human approval/draft step in the production path (a temporary `publish:false` flag exists only for manual test runs).
- **Models:** reuse `dayOneProgram/anthropic.js` → Sonnet `claude-sonnet-4-6` for prose, Haiku `claude-haiku-4-5-20251001` for mechanical work. Never hardcode model ids elsewhere; import them.
- **SEO plugin is Yoast** — write Yoast meta keys; emit FAQ via Yoast FAQ **block markup**; do NOT inject a competing Article/Org JSON-LD graph (Yoast already emits `@graph`).
- **No em-dashes in any user-facing/generated copy** (brand rule). Enforce in prompts + programmatic validation.
- **DB convention:** every new table has RLS enabled, no policy (service-role only).
- **Migration number:** next is `055`.
- **Tests:** `node:test` + `node:assert`, files are `*.test.js` beside source, run with `node --test <file>`.
- **Cron convention:** in-process `node-cron`, registered from `index.js` inside a try/catch, gated by env (`BLOG_AUTOMATION_DISABLED !== '1'` means ON... see note), timezone `America/Los_Angeles`.

> **Cron gate note:** match the spec's kill-switch semantics: the job is **OFF by default until explicitly enabled** during rollout, then flipped on. Use `BLOG_AUTOMATION_ENABLED === 'true'` to register the cron (opt-IN), unlike inventorySync's opt-out. The manual "Generate now" route works regardless of this flag.

---

## File Structure

```
auth/migrations/055_blog_posts.sql                 # Task 1
auth/src/services/blogAutomation/
  config.js            # Task 2  per-location SEO config + categories
  config.test.js
  topics.js            # Task 3  category/topic rotation + no-repeat (pure)
  topics.test.js
  jobs.js              # Task 4  blog_posts row lifecycle (supabaseAdmin)
  generate.js          # Task 5  multi-step generation + pure assembly helpers
  generate.test.js
  validate.js          # Task 6  programmatic checks + model critique
  validate.test.js
  photo.js             # Task 7  semantic photo pick + Drive download
  photo.test.js
  wordpress.js         # Task 8  publish + media upload + Yoast meta (ported)
  wordpress.test.js
  alerts.js            # Task 9  ported sendAlert()
  index.js             # Task 10 runForLocation/runWeekly/start (cron)
auth/src/routes/blogAutomation.js                  # Task 11 portal API
auth/src/index.js                                  # Task 10/11 register cron + mount route
portal/src/components/BlogAutomationView.jsx       # Task 12 monitoring UI
portal/src/lib/api.js                              # Task 12 add endpoints (modify)
```

---

## Task 1: Migration — `blog_posts` table

**Files:**
- Create: `auth/migrations/055_blog_posts.sql`

**Interfaces:**
- Produces: table `public.blog_posts` consumed by `jobs.js` (Task 4).

- [ ] **Step 1: Write the migration**

```sql
-- 055_blog_posts.sql
-- Autonomous blog generator job + history. One row per generated post.
-- Service-role only (auth API). RLS on, no policy, per portal convention.
create table if not exists public.blog_posts (
  id               uuid primary key default gen_random_uuid(),
  location         text not null,            -- matches media_assets.location (Salem/Keizer/...)
  category         text not null,
  topic            text not null,
  status           text not null default 'generating', -- generating|published|failed|skipped
  title            text,
  slug             text,
  meta_description text,
  focus_keyword    text,
  content_html     text,
  faq_json         jsonb,
  excerpt          text,
  image_asset_id   uuid,
  image_drive_id   text,
  wp_post_id       bigint,
  wp_media_id      bigint,
  wp_url           text,
  validation_report jsonb,
  error_message    text,
  created_at       timestamptz not null default now(),
  published_at     timestamptz
);

create index if not exists blog_posts_location_created_idx
  on public.blog_posts (location, created_at desc);

alter table public.blog_posts enable row level security;
```

- [ ] **Step 2: Apply via Supabase MCP**

Apply with the `apply_migration` tool (name `055_blog_posts`, the SQL above) against project `ybopxxydsuwlbwxiuzve`. Verify with `list_tables` that `blog_posts` exists.

- [ ] **Step 3: Commit**

```bash
git add auth/migrations/055_blog_posts.sql
git commit -m "feat(blog): migration 055 blog_posts table"
```

---

## Task 2: Per-location config + categories

**Files:**
- Create: `auth/src/services/blogAutomation/config.js`
- Test: `auth/src/services/blogAutomation/config.test.js`

**Interfaces:**
- Produces:
  - `LOCATIONS`: array of `{ key, name, city, wpCategory, keywords[], landmarks[], neighborhoods[], localContext, enabled }`. `key` is also the `media_assets.location` filter value.
  - `CATEGORIES`: array of `{ key, name, description, topics: string[] }`.
  - `getLocation(key)` → location object or `undefined`.
  - `enabledLocations()` → `LOCATIONS.filter(l => l.enabled)`.

> No `driveFolderId` field: photos come from the already-indexed Media Library, filtered by `location` key. No separate Drive config is needed.

- [ ] **Step 1: Write the failing test**

```js
const test = require('node:test')
const assert = require('node:assert')
const { LOCATIONS, CATEGORIES, getLocation, enabledLocations } = require('./config')

test('exactly the 6 target locations, Milwaukie excluded', () => {
  const keys = LOCATIONS.map(l => l.key).sort()
  assert.deepEqual(keys, ['Clackamas', 'Eugene', 'Keizer', 'Medford', 'Salem', 'Springfield'])
  assert.ok(!keys.includes('Milwaukie'))
})

test('every location has non-empty SEO context', () => {
  for (const l of LOCATIONS) {
    assert.ok(l.keywords.length >= 3, `${l.key} keywords`)
    assert.ok(l.localContext && l.localContext.length > 20, `${l.key} context`)
    assert.ok(l.wpCategory, `${l.key} wpCategory`)
  }
})

test('getLocation + enabledLocations', () => {
  assert.equal(getLocation('Salem').city, 'Salem')
  assert.equal(getLocation('nope'), undefined)
  assert.ok(enabledLocations().every(l => l.enabled))
})

test('categories have topics', () => {
  assert.ok(CATEGORIES.length >= 4)
  for (const c of CATEGORIES) assert.ok(c.topics.length >= 4, `${c.key} topics`)
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test auth/src/services/blogAutomation/config.test.js`
Expected: FAIL — cannot find module `./config`.

- [ ] **Step 3: Write `config.js`**

Port the SEO context from the old `autoblogger/src/config/locations.js` for the 5 it had (re-key `West Salem` → `Salem`), and author fresh context for **Medford**. Categories port the old 6 (drop `member-success` templating quirk — keep it as a normal category or omit; include at least: `fitness-tips`, `nutrition`, `local-fitness`, `gym-life`, `why-wcs`). Full content:

```js
// auth/src/services/blogAutomation/config.js
// Static per-location SEO context + content categories for the blog generator.
// `key` MUST equal the media_assets.location string so photo search filters match.

const LOCATIONS = [
  {
    key: 'Salem', name: 'West Coast Strength Salem', city: 'Salem', wpCategory: 'Salem',
    keywords: ['gym in Salem Oregon', 'Salem fitness center', 'personal training Salem OR',
      'Salem gym membership', 'weight training Salem'],
    landmarks: ['Wallace Marine Park', 'Riverfront Park', 'Minto-Brown Island Park'],
    neighborhoods: ['West Salem', 'South Salem', 'Downtown Salem'],
    localContext: 'Salem is Oregon\'s capital, a family-oriented city in the Willamette Valley with strong parks and an active, community-minded population.',
    enabled: true,
  },
  {
    key: 'Keizer', name: 'West Coast Strength Keizer', city: 'Keizer', wpCategory: 'Keizer',
    keywords: ['gym in Keizer Oregon', 'Keizer fitness center', 'personal training Keizer OR',
      'Keizer gym membership', 'weight training Keizer'],
    landmarks: ['Keizer Station', 'Volcanoes Stadium', 'Keizer Rapids Park'],
    neighborhoods: ['Keizer', 'Clear Lake', 'Gubser'],
    localContext: 'Keizer is a tight-knit community just north of Salem, home to the Salem-Keizer Volcanoes, with strong community pride and an active outdoor culture.',
    enabled: true,
  },
  {
    key: 'Eugene', name: 'West Coast Strength Eugene', city: 'Eugene', wpCategory: 'Eugene',
    keywords: ['gym in Eugene Oregon', 'Eugene fitness center', 'personal training Eugene OR',
      'Eugene gym membership', 'weight training Eugene'],
    landmarks: ['University of Oregon', 'Pre\'s Trail', 'Alton Baker Park'],
    neighborhoods: ['South Eugene', 'Whiteaker', 'Cal Young'],
    localContext: 'Eugene is Track Town USA, home to the University of Oregon and a deep running culture, with a health-conscious population that values fitness and the outdoors.',
    enabled: true,
  },
  {
    key: 'Springfield', name: 'West Coast Strength Springfield', city: 'Springfield', wpCategory: 'Springfield',
    keywords: ['gym in Springfield Oregon', 'Springfield fitness center', 'personal training Springfield OR',
      'Springfield gym membership', 'weight training Springfield'],
    landmarks: ['McKenzie River', 'Dorris Ranch', 'Island Park'],
    neighborhoods: ['Thurston', 'Gateway', 'Downtown Springfield'],
    localContext: 'Springfield is Eugene\'s sister city, known for working-class roots and community spirit, with the McKenzie River nearby for world-class outdoor recreation.',
    enabled: true,
  },
  {
    key: 'Clackamas', name: 'West Coast Strength Clackamas', city: 'Clackamas', wpCategory: 'Clackamas',
    keywords: ['gym in Clackamas Oregon', 'Clackamas fitness center', 'personal training Clackamas OR',
      'Clackamas gym membership', 'weight training Clackamas'],
    landmarks: ['Clackamas Town Center', 'North Clackamas Park', 'Mt. Scott'],
    neighborhoods: ['Happy Valley', 'Sunnyside', 'Milwaukie'],
    localContext: 'Clackamas is part of the Portland metro area, offering suburban convenience with easy access to outdoor recreation along the Clackamas River and toward Mt. Hood.',
    enabled: true,
  },
  {
    key: 'Medford', name: 'West Coast Strength Medford', city: 'Medford', wpCategory: 'Medford',
    keywords: ['gym in Medford Oregon', 'Medford fitness center', 'personal training Medford OR',
      'Medford gym membership', 'weight training Medford'],
    landmarks: ['Bear Creek Greenway', 'Prescott Park', 'Roxy Ann Peak'],
    neighborhoods: ['East Medford', 'West Medford', 'Downtown Medford'],
    localContext: 'Medford is the hub of Southern Oregon\'s Rogue Valley, surrounded by wine country and outdoor recreation, with a warm climate and an active, growing population.',
    enabled: true,
  },
]

const CATEGORIES = [
  { key: 'fitness-tips', name: 'Fitness Tips', description: 'Workout guides, exercise tutorials, training advice',
    topics: ['Best compound exercises for building strength', 'How to properly warm up before lifting',
      'Progressive overload explained', 'Recovery tips for faster muscle repair',
      'How to break through a training plateau', 'A beginner\'s guide to strength training',
      'Why proper form matters more than weight', 'How to build a balanced weekly routine'] },
  { key: 'nutrition', name: 'Nutrition', description: 'Diet tips, meal planning, nutrition guidance',
    topics: ['What to eat before a workout', 'Post-workout meals for recovery',
      'How much protein you really need', 'Meal prep for busy schedules',
      'Understanding macros for your goals', 'Hydration and performance',
      'Healthy snacks that fuel training', 'Eating for fat loss without losing muscle'] },
  { key: 'local-fitness', name: 'Local Fitness', description: 'Local fitness culture, outdoor activities, seasonal content',
    topics: ['Best outdoor workout spots near [Location]', 'Staying fit through Oregon\'s rainy season',
      'Summer fitness challenges for [Location] residents', 'Keeping your routine through the holidays',
      'Spring into fitness: seasonal tips', 'Pairing gym training with [Location] outdoor activities'] },
  { key: 'gym-life', name: 'Gym Life', description: 'Equipment, gym culture, member tips',
    topics: ['Gym etiquette for a better experience', 'Making the most of your membership',
      'Group classes vs training solo', 'How to stay motivated at the gym',
      'Building a gym habit that sticks', 'How to use the most underrated equipment'] },
  { key: 'why-wcs', name: 'Why West Coast Strength', description: 'Location-specific benefits and community focus',
    topics: ['Why [Location] residents choose West Coast Strength', 'What makes our [Location] gym different',
      'The community at West Coast Strength [Location]', 'What to expect at WCS [Location]',
      'Personal training options at WCS [Location]'] },
]

const getLocation = (key) => LOCATIONS.find(l => l.key === key)
const enabledLocations = () => LOCATIONS.filter(l => l.enabled)

module.exports = { LOCATIONS, CATEGORIES, getLocation, enabledLocations }
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test auth/src/services/blogAutomation/config.test.js`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add auth/src/services/blogAutomation/config.js auth/src/services/blogAutomation/config.test.js
git commit -m "feat(blog): per-location SEO config + content categories"
```

---

## Task 3: Topic rotation (pure, no-repeat)

**Files:**
- Create: `auth/src/services/blogAutomation/topics.js`
- Test: `auth/src/services/blogAutomation/topics.test.js`

**Interfaces:**
- Consumes: `CATEGORIES` from `./config`.
- Produces:
  - `pickCategory(recentCategoryKeys: string[]) -> string` — least-recently-used category key.
  - `pickTopic(categoryKey, recentTopics: string[], locationName) -> string` — first topic in the category not in `recentTopics`, with `[Location]` replaced by `locationName`; falls back to the least-recently-used if all used.
  - `resolveTopicText(topic, locationName) -> string` — `[Location]` substitution helper.

- [ ] **Step 1: Write the failing test**

```js
const test = require('node:test')
const assert = require('node:assert')
const { pickCategory, pickTopic, resolveTopicText } = require('./topics')

test('pickCategory returns a not-recently-used category', () => {
  const c = pickCategory(['fitness-tips', 'nutrition'])
  assert.ok(!['fitness-tips', 'nutrition'].includes(c))
})

test('pickCategory with empty history returns the first category', () => {
  assert.equal(pickCategory([]), 'fitness-tips')
})

test('resolveTopicText substitutes [Location]', () => {
  assert.equal(resolveTopicText('Best spots near [Location]', 'Salem'), 'Best spots near Salem')
})

test('pickTopic avoids recently used topics', () => {
  const used = ['Best compound exercises for building strength']
  const t = pickTopic('fitness-tips', used, 'Salem')
  assert.ok(!used.includes(t))
  assert.ok(t.length > 0)
})

test('pickTopic falls back when all topics used', () => {
  const { CATEGORIES } = require('./config')
  const all = CATEGORIES.find(c => c.key === 'gym-life').topics
  const t = pickTopic('gym-life', all, 'Eugene')
  assert.ok(typeof t === 'string' && t.length > 0)
})
```

- [ ] **Step 2: Run to verify it fails**

Run: `node --test auth/src/services/blogAutomation/topics.test.js`
Expected: FAIL — cannot find module `./topics`.

- [ ] **Step 3: Write `topics.js`**

```js
// auth/src/services/blogAutomation/topics.js
const { CATEGORIES } = require('./config')

function resolveTopicText(topic, locationName) {
  return String(topic).replace(/\[Location\]/g, locationName)
}

// Least-recently-used: pick the first category not in recent; if all recent,
// pick the one used longest ago (front of the category list wins on ties).
function pickCategory(recentCategoryKeys = []) {
  const keys = CATEGORIES.map(c => c.key)
  const fresh = keys.find(k => !recentCategoryKeys.includes(k))
  if (fresh) return fresh
  // all used recently: choose the one whose last use is oldest
  let best = keys[0], bestIdx = -1
  for (const k of keys) {
    const idx = recentCategoryKeys.lastIndexOf(k) // larger = more recent
    if (idx > bestIdx) continue
    best = k; bestIdx = idx
  }
  return best
}

function pickTopic(categoryKey, recentTopics = [], locationName = '') {
  const cat = CATEGORIES.find(c => c.key === categoryKey) || CATEGORIES[0]
  const resolved = cat.topics.map(t => resolveTopicText(t, locationName))
  const fresh = resolved.find(t => !recentTopics.includes(t))
  return fresh || resolved[0]
}

module.exports = { pickCategory, pickTopic, resolveTopicText }
```

- [ ] **Step 4: Run to verify it passes**

Run: `node --test auth/src/services/blogAutomation/topics.test.js`
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add auth/src/services/blogAutomation/topics.js auth/src/services/blogAutomation/topics.test.js
git commit -m "feat(blog): category/topic rotation with no-repeat"
```

---

## Task 4: `blog_posts` job lifecycle

**Files:**
- Create: `auth/src/services/blogAutomation/jobs.js`

**Interfaces:**
- Consumes: `supabaseAdmin` from `../supabase`.
- Produces:
  - `createJob({ location, category, topic }) -> { id }`
  - `setStatus(id, status, patch = {})` (merges patch, e.g. `{ title, slug, ... }`)
  - `attachContent(id, { title, slug, metaDescription, focusKeyword, contentHtml, faqJson, excerpt })`
  - `attachValidation(id, report)`
  - `attachImage(id, { assetId, driveId })`
  - `markPublished(id, { wpPostId, wpUrl, wpMediaId })`
  - `markFailed(id, message)`
  - `markSkipped(id, message)`
  - `recentTopics(location, limit = 12) -> string[]`
  - `recentCategories(location, limit = 6) -> string[]`
  - `listRecent({ location, limit = 50 }) -> rows[]`
  - `getById(id) -> row`

> No test for this task: it is thin Supabase I/O with no branching logic. It is exercised end-to-end by the Task 10 manual integration run. (Follows the `pt_programs/jobs.js` precedent, which is likewise untested.)

- [ ] **Step 1: Write `jobs.js`**

```js
// auth/src/services/blogAutomation/jobs.js
const { supabaseAdmin } = require('../supabase')

const T = 'blog_posts'

async function createJob({ location, category, topic }) {
  const { data, error } = await supabaseAdmin.from(T)
    .insert({ location, category, topic, status: 'generating' })
    .select('id').single()
  if (error) throw new Error(`createJob failed: ${error.message}`)
  return data
}

async function update(id, patch) {
  const { error } = await supabaseAdmin.from(T).update(patch).eq('id', id)
  if (error) throw new Error(`blog_posts update failed: ${error.message}`)
}

const setStatus = (id, status, patch = {}) => update(id, { status, ...patch })

const attachContent = (id, c) => update(id, {
  title: c.title, slug: c.slug, meta_description: c.metaDescription,
  focus_keyword: c.focusKeyword, content_html: c.contentHtml,
  faq_json: c.faqJson, excerpt: c.excerpt,
})

const attachValidation = (id, report) => update(id, { validation_report: report })
const attachImage = (id, { assetId, driveId }) =>
  update(id, { image_asset_id: assetId || null, image_drive_id: driveId || null })

const markPublished = (id, { wpPostId, wpUrl, wpMediaId }) => update(id, {
  status: 'published', wp_post_id: wpPostId || null, wp_url: wpUrl || null,
  wp_media_id: wpMediaId || null, published_at: new Date().toISOString(),
})

const markFailed = (id, message) =>
  update(id, { status: 'failed', error_message: String(message || '').slice(0, 2000) })
const markSkipped = (id, message) =>
  update(id, { status: 'skipped', error_message: String(message || '').slice(0, 2000) })

async function recentRows(location, limit) {
  const { data, error } = await supabaseAdmin.from(T)
    .select('category, topic, created_at')
    .eq('location', location).order('created_at', { ascending: false }).limit(limit)
  if (error) throw new Error(`recentRows failed: ${error.message}`)
  return data || []
}
const recentTopics = async (location, limit = 12) => (await recentRows(location, limit)).map(r => r.topic)
const recentCategories = async (location, limit = 6) => (await recentRows(location, limit)).map(r => r.category)

async function listRecent({ location, limit = 50 } = {}) {
  let q = supabaseAdmin.from(T).select('*').order('created_at', { ascending: false }).limit(limit)
  if (location) q = q.eq('location', location)
  const { data, error } = await q
  if (error) throw new Error(`listRecent failed: ${error.message}`)
  return data || []
}

async function getById(id) {
  const { data, error } = await supabaseAdmin.from(T).select('*').eq('id', id).maybeSingle()
  if (error) throw new Error(`getById failed: ${error.message}`)
  return data
}

module.exports = {
  createJob, setStatus, attachContent, attachValidation, attachImage,
  markPublished, markFailed, markSkipped, recentTopics, recentCategories, listRecent, getById,
}
```

- [ ] **Step 2: Smoke-check it loads**

Run: `node -e "require('./auth/src/services/blogAutomation/jobs.js'); console.log('ok')"`
Expected: prints `ok` (no throw). (Requires `../supabase` to load; if it needs env, run from a shell where `SUPABASE_URL`/`SUPABASE_SERVICE_KEY` are set, or accept the require resolves without connecting.)

- [ ] **Step 3: Commit**

```bash
git add auth/src/services/blogAutomation/jobs.js
git commit -m "feat(blog): blog_posts job lifecycle helpers"
```

---

## Task 5: Content generation (multi-step) + pure assembly helpers

**Files:**
- Create: `auth/src/services/blogAutomation/generate.js`
- Test: `auth/src/services/blogAutomation/generate.test.js`

**Interfaces:**
- Consumes: `generateText`, `MODEL_FAST` from `../dayOneProgram/anthropic`; `getLocation` from `./config`.
- Produces:
  - `slugify(title) -> string`
  - `buildFaqBlock(faq: {q,a}[]) -> string` — Yoast FAQ block markup.
  - `assembleContentHtml({ intro, sections: {heading,html}[], takeaways: string[], faq, ctaHtml }) -> string`
  - `parseJsonLoose(text) -> object` — tolerant JSON parse (handles ``` fences).
  - `buildOutlinePrompt(location, category, topic) -> string`
  - `buildSectionPrompt(location, topic, headingList) -> string`
  - `generatePost({ location /* object */, category, topic }, deps?) -> { title, slug, metaDescription, focusKeyword, excerpt, contentHtml, faq }`

- [ ] **Step 1: Write the failing test**

```js
const test = require('node:test')
const assert = require('node:assert')
const g = require('./generate')

test('slugify lowercases, strips punctuation, hyphenates', () => {
  assert.equal(g.slugify('Best Compound Exercises (2026)!'), 'best-compound-exercises-2026')
})

test('buildFaqBlock emits Yoast FAQ block markup with each Q and A', () => {
  const html = g.buildFaqBlock([{ q: 'How often?', a: 'Three times a week.' }])
  assert.match(html, /wp:yoast\/faq-block/)
  assert.match(html, /How often\?/)
  assert.match(html, /Three times a week\./)
})

test('parseJsonLoose handles fenced JSON', () => {
  assert.deepEqual(g.parseJsonLoose('```json\n{"a":1}\n```'), { a: 1 })
})

test('assembleContentHtml includes sections, takeaways, faq, cta in order', () => {
  const html = g.assembleContentHtml({
    intro: '<p>Intro</p>',
    sections: [{ heading: 'Warm Up', html: '<p>warm</p>' }],
    takeaways: ['Rest enough'],
    faq: [{ q: 'Q1', a: 'A1' }],
    ctaHtml: '<p>Come in</p>',
  })
  assert.match(html, /<h2>Warm Up<\/h2>/)
  assert.match(html, /Rest enough/)
  assert.match(html, /wp:yoast\/faq-block/)
  assert.ok(html.indexOf('Warm Up') < html.indexOf('Rest enough'))
})

test('generatePost assembles a post from injected fake model output', async () => {
  const fakeText = async ({ prompt }) => {
    if (/outline/i.test(prompt)) return JSON.stringify({
      title: 'Strength Basics in Salem', metaDescription: 'A practical guide to building strength in Salem for beginners and beyond today.',
      focusKeyword: 'strength training Salem', excerpt: 'Build strength in Salem.',
      headings: ['Start With Compounds', 'Progress Slowly'],
      faq: [{ q: 'How often should I lift?', a: 'About three times a week works for most beginners.' }],
      takeaways: ['Lift compound movements', 'Add weight gradually'],
    })
    return JSON.stringify({ sections: [
      { heading: 'Start With Compounds', html: '<p>Squat, hinge, push, pull.</p>' },
      { heading: 'Progress Slowly', html: '<p>Add a little each week.</p>' },
    ], intro: '<p>Strength is built over time.</p>', ctaHtml: '<p>Visit West Coast Strength Salem.</p>' })
  }
  const loc = require('./config').getLocation('Salem')
  const post = await g.generatePost({ location: loc, category: 'fitness-tips', topic: 'Strength basics' },
    { generateText: fakeText })
  assert.equal(post.title, 'Strength Basics in Salem')
  assert.equal(post.slug, 'strength-basics-in-salem')
  assert.match(post.contentHtml, /<h2>Start With Compounds<\/h2>/)
  assert.match(post.contentHtml, /wp:yoast\/faq-block/)
  assert.equal(post.faq.length, 1)
})
```

- [ ] **Step 2: Run to verify it fails**

Run: `node --test auth/src/services/blogAutomation/generate.test.js`
Expected: FAIL — cannot find module `./generate`.

- [ ] **Step 3: Write `generate.js`**

```js
// auth/src/services/blogAutomation/generate.js
'use strict'
const { generateText: realGenerateText, MODEL_FAST } = require('../dayOneProgram/anthropic')

const BRAND = `Brand voice: friendly, encouraging, knowledgeable, community-focused, practical. Avoid hype and salesy language. Never use em-dashes (use commas or short sentences). Write for humans first.`

function slugify(title) {
  return String(title).toLowerCase().replace(/['']/g, '')
    .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '')
}

function parseJsonLoose(text) {
  let s = String(text || '').trim()
  const fence = s.match(/```json\s*\n?([\s\S]*?)\n?```/) || s.match(/```\s*\n?([\s\S]*?)\n?```/)
  if (fence) s = fence[1]
  return JSON.parse(s.trim())
}

// Yoast FAQ Gutenberg block — Yoast emits FAQPage schema from this markup.
function buildFaqBlock(faq) {
  const items = (faq || []).map((f, i) => {
    const id = `faq-${i + 1}`
    return `<div class="schema-faq-section" id="${id}">` +
      `<strong class="schema-faq-question">${f.q}</strong> ` +
      `<p class="schema-faq-answer">${f.a}</p></div>`
  }).join('\n')
  return `<!-- wp:yoast/faq-block -->\n<div class="schema-faq wp-block-yoast-faq-block">\n${items}\n</div>\n<!-- /wp:yoast/faq-block -->`
}

function assembleContentHtml({ intro, sections, takeaways, faq, ctaHtml }) {
  const body = (sections || []).map(s => `<h2>${s.heading}</h2>\n${s.html}`).join('\n')
  const takeawaysHtml = (takeaways && takeaways.length)
    ? `<h2>Key Takeaways</h2>\n<ul>\n${takeaways.map(t => `<li>${t}</li>`).join('\n')}\n</ul>`
    : ''
  const faqHtml = (faq && faq.length) ? `<h2>Frequently Asked Questions</h2>\n${buildFaqBlock(faq)}` : ''
  return [intro || '', body, takeawaysHtml, faqHtml, ctaHtml || '']
    .filter(Boolean).join('\n\n')
}

function buildOutlinePrompt(location, category, topic) {
  return `${BRAND}\n\nYou are an expert local SEO content strategist for ${location.name} (a gym in ${location.city}, Oregon).\n` +
    `Plan a blog post on: "${topic}" (category: ${category}).\n` +
    `Local SEO context: keywords ${location.keywords.slice(0,5).join('; ')}. Landmarks: ${location.landmarks.join(', ')}. Neighborhoods: ${location.neighborhoods.join(', ')}. ${location.localContext}\n\n` +
    `Optimize for SEO, AEO (answer engines / featured snippets) and GEO (AI answer engines): use a question-style angle, factual quotable statements, and clear structure.\n\n` +
    `Return ONLY JSON: {"title": string (50-60 chars, includes the city), "metaDescription": string (150-160 chars), "focusKeyword": string, "excerpt": string (2 sentences), "headings": string[4-6] (each a clear H2, several phrased as questions), "faq": [{"q","a"}] (3-5, concise direct answers), "takeaways": string[3-5]}`
}

function buildSectionPrompt(location, topic, headings) {
  return `${BRAND}\n\nWrite the body for a blog post titled around "${topic}" for ${location.name} in ${location.city}, Oregon.\n` +
    `For EACH heading, write 1-2 short scannable paragraphs of genuinely helpful, specific, factual content. Where a heading is a question, answer it directly in the first sentence (AEO). Weave in local references naturally. No em-dashes.\n` +
    `Headings: ${JSON.stringify(headings)}\n\n` +
    `Return ONLY JSON: {"intro": string (HTML, one <p>, opens with a direct value statement), "sections": [{"heading": string (must match an input heading), "html": string (HTML paragraphs)}], "ctaHtml": string (one <p> CTA inviting readers to West Coast Strength ${location.city})}`
}

async function generatePost({ location, category, topic }, deps = {}) {
  const generateText = deps.generateText || realGenerateText
  const outline = parseJsonLoose(await generateText({
    prompt: buildOutlinePrompt(location, category, topic), maxTokens: 1500,
  }))
  const bodyRaw = parseJsonLoose(await generateText({
    prompt: buildSectionPrompt(location, topic, outline.headings || []), maxTokens: 3000,
  }))
  const contentHtml = assembleContentHtml({
    intro: bodyRaw.intro, sections: bodyRaw.sections || [],
    takeaways: outline.takeaways || [], faq: outline.faq || [], ctaHtml: bodyRaw.ctaHtml,
  })
  return {
    title: outline.title, slug: slugify(outline.title || topic),
    metaDescription: outline.metaDescription, focusKeyword: outline.focusKeyword,
    excerpt: outline.excerpt, contentHtml, faq: outline.faq || [],
  }
}

module.exports = {
  slugify, parseJsonLoose, buildFaqBlock, assembleContentHtml,
  buildOutlinePrompt, buildSectionPrompt, generatePost, MODEL_FAST,
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `node --test auth/src/services/blogAutomation/generate.test.js`
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add auth/src/services/blogAutomation/generate.js auth/src/services/blogAutomation/generate.test.js
git commit -m "feat(blog): multi-step SEO/AEO/GEO content generation"
```

---

## Task 6: Validation gate (programmatic + model critique)

**Files:**
- Create: `auth/src/services/blogAutomation/validate.js`
- Test: `auth/src/services/blogAutomation/validate.test.js`

**Interfaces:**
- Consumes: `generateText`, `MODEL_FAST` from `../dayOneProgram/anthropic`; `parseJsonLoose` from `./generate`.
- Produces:
  - `validateProgrammatic(post, location) -> { ok: boolean, failures: string[] }`
  - `critique(post, location, deps?) -> { ok: boolean, score: number, issues: string[] }`
  - `validatePost(post, location, deps?) -> { ok, report }` where `report = { programmatic, critique }`

- [ ] **Step 1: Write the failing test**

```js
const test = require('node:test')
const assert = require('node:assert')
const v = require('./validate')
const loc = require('./config').getLocation('Salem')

const goodPost = {
  title: 'Strength Training Basics in Salem',
  metaDescription: 'A practical guide to building strength in Salem, Oregon, with simple steps for beginners and a plan you can start this week now.',
  focusKeyword: 'strength training Salem',
  contentHtml: '<p>Intro about Salem.</p>'.repeat(2) + '<h2>Section</h2>' + '<p>word </p>'.repeat(450) + '<!-- wp:yoast/faq-block --><div class="schema-faq">Salem</div>',
  faq: [{ q: 'How often?', a: 'About three times a week.' }],
}

test('a well-formed post passes programmatic checks', () => {
  const r = v.validateProgrammatic(goodPost, loc)
  assert.equal(r.ok, true, JSON.stringify(r.failures))
})

test('missing FAQ fails', () => {
  const r = v.validateProgrammatic({ ...goodPost, contentHtml: '<p>no faq here, '.repeat(450) + '</p>', faq: [] }, loc)
  assert.equal(r.ok, false)
  assert.ok(r.failures.some(f => /faq/i.test(f)))
})

test('em-dash in content fails (brand rule)', () => {
  const r = v.validateProgrammatic({ ...goodPost, contentHtml: goodPost.contentHtml + '<p>strength — power</p>' }, loc)
  assert.ok(r.failures.some(f => /em-dash/i.test(f)))
})

test('meta description outside 150-160 fails', () => {
  const r = v.validateProgrammatic({ ...goodPost, metaDescription: 'too short' }, loc)
  assert.ok(r.failures.some(f => /meta/i.test(f)))
})

test('location not named fails', () => {
  const r = v.validateProgrammatic({ ...goodPost, contentHtml: '<p>generic '.repeat(450) + '</p><!-- wp:yoast/faq-block -->' }, loc)
  assert.ok(r.failures.some(f => /location|Salem/i.test(f)))
})

test('validatePost combines programmatic + injected critique', async () => {
  const fakeCritique = async () => JSON.stringify({ score: 9, issues: [] })
  const r = await v.validatePost(goodPost, loc, { generateText: fakeCritique })
  assert.equal(r.ok, true)
  assert.equal(r.report.critique.score, 9)
})

test('validatePost fails when critique scores low', async () => {
  const fakeCritique = async () => JSON.stringify({ score: 4, issues: ['off-brand', 'thin'] })
  const r = await v.validatePost(goodPost, loc, { generateText: fakeCritique })
  assert.equal(r.ok, false)
})
```

- [ ] **Step 2: Run to verify it fails**

Run: `node --test auth/src/services/blogAutomation/validate.test.js`
Expected: FAIL — cannot find module `./validate`.

- [ ] **Step 3: Write `validate.js`**

```js
// auth/src/services/blogAutomation/validate.js
'use strict'
const { generateText: realGenerateText, MODEL_FAST } = require('../dayOneProgram/anthropic')
const { parseJsonLoose } = require('./generate')

const MIN_WORDS = 400
const CRITIQUE_PASS = 7

function wordCount(html) {
  return String(html).replace(/<[^>]+>/g, ' ').trim().split(/\s+/).filter(Boolean).length
}

function validateProgrammatic(post, location) {
  const failures = []
  const html = post.contentHtml || ''
  if (!post.title || post.title.length < 20) failures.push('title missing or too short')
  const md = post.metaDescription || ''
  if (md.length < 150 || md.length > 160) failures.push(`meta description length ${md.length} not in 150-160`)
  if (!post.focusKeyword) failures.push('focus keyword missing')
  if (wordCount(html) < MIN_WORDS) failures.push(`word count ${wordCount(html)} below ${MIN_WORDS}`)
  if (!/wp:yoast\/faq-block/.test(html) || !(post.faq && post.faq.length)) failures.push('faq block missing')
  if (!new RegExp(location.city, 'i').test(html) && !new RegExp(location.key, 'i').test(html)) {
    failures.push(`location ${location.key} not named in content`)
  }
  if (/—/.test(html) || /—/.test(md) || /—/.test(post.title || '')) failures.push('em-dash present (brand rule)')
  if (!/<h2>/i.test(html)) failures.push('no H2 headings')
  return { ok: failures.length === 0, failures }
}

async function critique(post, location, deps = {}) {
  const generateText = deps.generateText || realGenerateText
  const prompt = `You are a strict editor for ${location.name}. Score this blog post 0-10 for: on-brand voice (friendly, not salesy), factual safety (no invented specific claims about this gym, no medical overreach), correct location (${location.city}, Oregon), readability, and genuine helpfulness.\n` +
    `Return ONLY JSON: {"score": number 0-10, "issues": string[]}.\n\nTITLE: ${post.title}\nMETA: ${post.metaDescription}\n\nCONTENT:\n${String(post.contentHtml).slice(0, 8000)}`
  const out = parseJsonLoose(await generateText({ prompt, maxTokens: 600, model: MODEL_FAST }))
  const score = Number(out.score) || 0
  return { ok: score >= CRITIQUE_PASS, score, issues: out.issues || [] }
}

async function validatePost(post, location, deps = {}) {
  const programmatic = validateProgrammatic(post, location)
  if (!programmatic.ok) return { ok: false, report: { programmatic, critique: null } }
  const crit = await critique(post, location, deps)
  return { ok: crit.ok, report: { programmatic, critique: crit } }
}

module.exports = { validateProgrammatic, critique, validatePost, MIN_WORDS, CRITIQUE_PASS }
```

- [ ] **Step 4: Run to verify it passes**

Run: `node --test auth/src/services/blogAutomation/validate.test.js`
Expected: PASS (7 tests).

- [ ] **Step 5: Commit**

```bash
git add auth/src/services/blogAutomation/validate.js auth/src/services/blogAutomation/validate.test.js
git commit -m "feat(blog): two-layer validation gate (programmatic + model critique)"
```

---

## Task 7: Semantic photo pick + Drive download

**Files:**
- Create: `auth/src/services/blogAutomation/photo.js`
- Test: `auth/src/services/blogAutomation/photo.test.js`

**Interfaces:**
- Consumes: `embedQuery` from `../voyageQuery`; `supabaseAdmin` from `../supabase`; `getAccessToken` from `../../routes/googleBusiness`.
- Produces:
  - `pickPhoto({ location, queryText }, deps?) -> { assetId, driveFileId, similarity } | null`
  - `downloadPhoto(driveFileId, deps?) -> { buffer: Buffer, mimeType, filename }`

- [ ] **Step 1: Write the failing test**

```js
const test = require('node:test')
const assert = require('node:assert')
const photo = require('./photo')

test('pickPhoto returns the top image match for the location', async () => {
  const fakeEmbed = async () => [0.1, 0.2]
  const fakeRpc = async (fn, args) => {
    assert.equal(fn, 'match_media_embeddings')
    assert.equal(args.filter_location, 'Salem')
    assert.equal(args.filter_kind, 'image')
    return { data: [
      { asset_id: 'a1', drive_file_id: 'd1', similarity: 0.8 },
      { asset_id: 'a2', drive_file_id: 'd2', similarity: 0.6 },
    ], error: null }
  }
  const r = await photo.pickPhoto({ location: 'Salem', queryText: 'squat rack' },
    { embedQuery: fakeEmbed, rpc: fakeRpc })
  assert.deepEqual(r, { assetId: 'a1', driveFileId: 'd1', similarity: 0.8 })
})

test('pickPhoto returns null when no matches', async () => {
  const r = await photo.pickPhoto({ location: 'Medford', queryText: 'x' },
    { embedQuery: async () => [0], rpc: async () => ({ data: [], error: null }) })
  assert.equal(r, null)
})

test('pickPhoto returns null and does not throw on embed error', async () => {
  const r = await photo.pickPhoto({ location: 'Salem', queryText: 'x' },
    { embedQuery: async () => { throw new Error('voyage down') }, rpc: async () => ({ data: [], error: null }) })
  assert.equal(r, null)
})
```

- [ ] **Step 2: Run to verify it fails**

Run: `node --test auth/src/services/blogAutomation/photo.test.js`
Expected: FAIL — cannot find module `./photo`.

- [ ] **Step 3: Write `photo.js`**

```js
// auth/src/services/blogAutomation/photo.js
'use strict'
const { embedQuery: realEmbed } = require('../voyageQuery')
const { supabaseAdmin } = require('../supabase')
const { getAccessToken } = require('../../routes/googleBusiness')

const DRIVE_FILES = 'https://www.googleapis.com/drive/v3/files'

// Pick the best-matching indexed image for a location. Returns null on any
// failure (no photo is non-fatal — the post still publishes without one).
async function pickPhoto({ location, queryText }, deps = {}) {
  const embedQuery = deps.embedQuery || realEmbed
  const rpc = deps.rpc || ((fn, args) => supabaseAdmin.rpc(fn, args))
  try {
    const embedding = await embedQuery(queryText)
    const { data, error } = await rpc('match_media_embeddings', {
      query_embedding: JSON.stringify(embedding),
      match_count: 5, filter_location: location, filter_kind: 'image',
    })
    if (error) throw error
    if (!data || !data.length) return null
    const top = data[0]
    return { assetId: top.asset_id, driveFileId: top.drive_file_id, similarity: top.similarity }
  } catch (e) {
    console.warn('[Blog] photo pick failed:', e.message)
    return null
  }
}

async function downloadPhoto(driveFileId, deps = {}) {
  const token = deps.token || await getAccessToken()
  const fetchFn = deps.fetch || fetch
  const meta = await fetchFn(`${DRIVE_FILES}/${driveFileId}?fields=name,mimeType&supportsAllDrives=true`,
    { headers: { Authorization: 'Bearer ' + token } }).then(r => r.json())
  const res = await fetchFn(`${DRIVE_FILES}/${driveFileId}?alt=media&supportsAllDrives=true`,
    { headers: { Authorization: 'Bearer ' + token } })
  if (!res.ok) throw new Error(`Drive download failed: ${res.status}`)
  const buffer = Buffer.from(await res.arrayBuffer())
  return { buffer, mimeType: meta.mimeType || res.headers.get('content-type') || 'image/jpeg', filename: meta.name || `${driveFileId}.jpg` }
}

module.exports = { pickPhoto, downloadPhoto }
```

- [ ] **Step 4: Run to verify it passes**

Run: `node --test auth/src/services/blogAutomation/photo.test.js`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add auth/src/services/blogAutomation/photo.js auth/src/services/blogAutomation/photo.test.js
git commit -m "feat(blog): semantic photo pick from Media Library + Drive download"
```

---

## Task 8: WordPress publish (ported, Yoast meta)

**Files:**
- Create: `auth/src/services/blogAutomation/wordpress.js`
- Test: `auth/src/services/blogAutomation/wordpress.test.js`

**Interfaces:**
- Produces:
  - `buildPostPayload(post, { tagId, categoryId, mediaId }) -> object` (pure)
  - `uploadMedia(imageBuffer, imageMeta, slug, deps?) -> mediaId`
  - `getOrCreateTag(name, deps?) -> id`, `getOrCreateCategory(name, deps?) -> id`
  - `publishPost({ post, location, image }, deps?) -> { id, url, mediaId }` where `image = { buffer, mimeType, filename } | null`
  - `testConnection() -> { success, user? , error? }`

Port the HTTP helpers from `autoblogger/src/wordpress.js` (kept verbatim except: drop Unsplash + draft variants; category from `location.wpCategory`; tag from `category`; Yoast meta from `post.meta_description`/`post.focus_keyword`/title). Env: `WP_API_URL`, `WP_USERNAME`, `WP_APP_PASSWORD`.

- [ ] **Step 1: Write the failing test** (pure payload builder only — HTTP paths are covered by the Task 10 manual integration run)

```js
const test = require('node:test')
const assert = require('node:assert')
const wp = require('./wordpress')

test('buildPostPayload sets publish status, category, tag, media, Yoast meta', () => {
  const post = { title: 'T', contentHtml: '<p>body</p>', excerpt: 'E',
    metaDescription: 'M', focusKeyword: 'K', slug: 't-slug' }
  const payload = wp.buildPostPayload(post, { tagId: 11, categoryId: 22, mediaId: 33 })
  assert.equal(payload.status, 'publish')
  assert.equal(payload.content, '<p>body</p>')
  assert.equal(payload.slug, 't-slug')
  assert.deepEqual(payload.tags, [11])
  assert.deepEqual(payload.categories, [22])
  assert.equal(payload.featured_media, 33)
  assert.equal(payload.meta._yoast_wpseo_metadesc, 'M')
  assert.equal(payload.meta._yoast_wpseo_focuskw, 'K')
})

test('buildPostPayload omits featured_media when no image', () => {
  const payload = wp.buildPostPayload({ title: 'T', contentHtml: '<p>b</p>' }, { tagId: 1, categoryId: 2, mediaId: null })
  assert.ok(!('featured_media' in payload))
})
```

- [ ] **Step 2: Run to verify it fails**

Run: `node --test auth/src/services/blogAutomation/wordpress.test.js`
Expected: FAIL — cannot find module `./wordpress`.

- [ ] **Step 3: Write `wordpress.js`**

```js
// auth/src/services/blogAutomation/wordpress.js
'use strict'
const WP_API_BASE = process.env.WP_API_URL || 'https://www.westcoaststrength.com/wp-json/wp/v2'

function authHeader() {
  const creds = Buffer.from(`${process.env.WP_USERNAME}:${process.env.WP_APP_PASSWORD}`).toString('base64')
  return 'Basic ' + creds
}
function jsonHeaders() { return { 'Content-Type': 'application/json', Authorization: authHeader() } }

function buildPostPayload(post, { tagId, categoryId, mediaId }) {
  const payload = {
    title: post.title, content: post.contentHtml, excerpt: post.excerpt || '',
    slug: post.slug || undefined, status: 'publish',
    tags: [tagId], categories: [categoryId],
    meta: { _yoast_wpseo_metadesc: post.metaDescription || '', _yoast_wpseo_focuskw: post.focusKeyword || '' },
  }
  if (mediaId) payload.featured_media = mediaId
  return payload
}

async function getOrCreateTerm(kind, name, deps = {}) {
  const f = deps.fetch || fetch
  const base = `${WP_API_BASE}/${kind}`
  const sr = await f(`${base}?search=${encodeURIComponent(name)}`, { headers: jsonHeaders() })
  if (!sr.ok) throw new Error(`WP ${kind} search ${sr.status}`)
  const existing = await sr.json()
  const match = existing.find(t => t.name.toLowerCase() === name.toLowerCase())
  if (match) return match.id
  const cr = await f(base, { method: 'POST', headers: jsonHeaders(), body: JSON.stringify({ name }) })
  if (!cr.ok) throw new Error(`WP ${kind} create ${cr.status}: ${await cr.text()}`)
  return (await cr.json()).id
}
const getOrCreateTag = (name, deps) => getOrCreateTerm('tags', name, deps)
const getOrCreateCategory = (name, deps) => getOrCreateTerm('categories', name, deps)

async function uploadMedia(buffer, meta, slug, deps = {}) {
  const f = deps.fetch || fetch
  const ext = (meta.mimeType || '').includes('png') ? 'png' : 'jpg'
  const filename = `${(slug || 'blog').replace(/[^a-z0-9-]/gi, '-')}.${ext}`
  const res = await f(`${WP_API_BASE}/media`, {
    method: 'POST',
    headers: { Authorization: authHeader(), 'Content-Type': meta.mimeType || 'image/jpeg',
      'Content-Disposition': `attachment; filename="${filename}"` },
    body: buffer,
  })
  if (!res.ok) throw new Error(`WP media upload ${res.status}: ${await res.text()}`)
  return (await res.json()).id
}

async function publishPost({ post, location, image }, deps = {}) {
  const f = deps.fetch || fetch
  const tagId = await getOrCreateTag(post.categoryLabel || location.wpCategory, deps)
  const categoryId = await getOrCreateCategory(location.wpCategory, deps)
  let mediaId = null
  if (image && image.buffer) {
    try { mediaId = await uploadMedia(image.buffer, image, post.slug, deps) }
    catch (e) { console.warn('[Blog] WP media upload failed (continuing):', e.message) }
  }
  const res = await f(`${WP_API_BASE}/posts`, {
    method: 'POST', headers: jsonHeaders(), body: JSON.stringify(buildPostPayload(post, { tagId, categoryId, mediaId })),
  })
  if (!res.ok) throw new Error(`WP publish ${res.status}: ${await res.text()}`)
  const published = await res.json()
  return { id: published.id, url: published.link, mediaId }
}

async function testConnection() {
  try {
    const r = await fetch(`${WP_API_BASE}/users/me`, { headers: jsonHeaders() })
    if (!r.ok) return { success: false, error: `auth ${r.status}` }
    const u = await r.json()
    return { success: true, user: u.name }
  } catch (e) { return { success: false, error: e.message } }
}

module.exports = { buildPostPayload, getOrCreateTag, getOrCreateCategory, uploadMedia, publishPost, testConnection }
```

- [ ] **Step 4: Run to verify it passes**

Run: `node --test auth/src/services/blogAutomation/wordpress.test.js`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add auth/src/services/blogAutomation/wordpress.js auth/src/services/blogAutomation/wordpress.test.js
git commit -m "feat(blog): WordPress publish with Yoast meta + media upload"
```

---

## Task 9: Error-SMS alert (ported)

**Files:**
- Create: `auth/src/services/blogAutomation/alerts.js`

**Interfaces:**
- Produces: `sendAlert(message)` — POSTs `{ message }` to `ALERT_WEBHOOK_URL` with the same dedupe/cooldown as `ghl-sync/src/alerts.js`. `blogAlert(message)` prefixes `Blog generator: `.

> No unit test (network side-effect with a timer-based cooldown). Verified by the forced-failure check in Task 10's manual run.

- [ ] **Step 1: Write `alerts.js`** (ported from `ghl-sync/src/alerts.js`, trimmed to the generic sender)

```js
// auth/src/services/blogAutomation/alerts.js
// Ported from ghl-sync/src/alerts.js — POST {message} to a GHL webhook that
// triggers an SMS workflow. Identical messages within the cooldown are dropped.
const ALERT_WEBHOOK_URL = process.env.ALERT_WEBHOOK_URL
  || 'https://services.leadconnectorhq.com/hooks/uflpfHNpByAnaBLkQzu3/webhook-trigger/3692f5a8-2bc2-48ab-afd3-dfb5a93f85ba'
const ALERT_COOLDOWN_MS = (parseInt(process.env.ALERT_COOLDOWN_MINUTES, 10) || 360) * 60 * 1000
const lastSentAt = new Map()

async function sendAlert(message) {
  const now = Date.now()
  const prev = lastSentAt.get(message)
  if (prev && now - prev < ALERT_COOLDOWN_MS) { console.log('[BlogAlert] suppressed (dupe):', message); return }
  try {
    await fetch(ALERT_WEBHOOK_URL, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message }), signal: AbortSignal.timeout(10000),
    })
    lastSentAt.set(message, now)
    console.log('[BlogAlert] webhook sent')
  } catch (err) { console.error('[BlogAlert] failed:', err.message) }
}

const blogAlert = (message) => sendAlert(`Blog generator: ${message}`)

module.exports = { sendAlert, blogAlert }
```

- [ ] **Step 2: Smoke-check it loads**

Run: `node -e "require('./auth/src/services/blogAutomation/alerts.js').blogAlert && console.log('ok')"`
Expected: prints `ok`.

- [ ] **Step 3: Commit**

```bash
git add auth/src/services/blogAutomation/alerts.js
git commit -m "feat(blog): ported error-SMS alert helper"
```

---

## Task 10: Orchestrator + weekly cron

**Files:**
- Create: `auth/src/services/blogAutomation/index.js`
- Modify: `auth/src/index.js` (register cron near the inventorySync block, ~line 155-162)

**Interfaces:**
- Consumes: all sibling modules + `node-cron`.
- Produces:
  - `runForLocation(locationKey, { publish = true }) -> { status, jobId, wpUrl?, reason? }`
  - `runWeekly() -> results[]`
  - `start()` — registers the weekly cron when `BLOG_AUTOMATION_ENABLED === 'true'`.

- [ ] **Step 1: Write `index.js` (orchestrator)**

```js
// auth/src/services/blogAutomation/index.js
'use strict'
const cron = require('node-cron')
const { getLocation, enabledLocations } = require('./config')
const topics = require('./topics')
const jobs = require('./jobs')
const { generatePost } = require('./generate')
const { validatePost } = require('./validate')
const { pickPhoto, downloadPhoto } = require('./photo')
const wordpress = require('./wordpress')
const { blogAlert } = require('./alerts')

// Generate + (optionally) publish one post for a location. Never throws; returns
// a status object. Validation failure => one regen, then skip (no publish).
async function runForLocation(locationKey, { publish = true } = {}) {
  const location = getLocation(locationKey)
  if (!location) return { status: 'error', reason: `unknown location ${locationKey}` }

  const recentCats = await jobs.recentCategories(locationKey)
  const recentTops = await jobs.recentTopics(locationKey)
  const category = topics.pickCategory(recentCats)
  const topic = topics.pickTopic(category, recentTops, location.city)

  const { id: jobId } = await jobs.createJob({ location: locationKey, category, topic })
  try {
    let post, report
    for (let attempt = 1; attempt <= 2; attempt++) {
      post = await generatePost({ location, category, topic })
      const v = await validatePost(post, location)
      report = v.report
      if (v.ok) break
      if (attempt === 2) {
        await jobs.attachContent(jobId, post)
        await jobs.attachValidation(jobId, report)
        await jobs.markSkipped(jobId, 'validation failed after retry')
        await blogAlert(`${locationKey} post skipped (validation failed): ${JSON.stringify(report.programmatic.failures || report.critique?.issues)}`)
        return { status: 'skipped', jobId, reason: 'validation' }
      }
    }
    await jobs.attachContent(jobId, post)
    await jobs.attachValidation(jobId, report)

    // Photo (non-fatal)
    let image = null
    const match = await pickPhoto({ location: locationKey, queryText: `${post.title}. ${topic}` })
    if (match) {
      await jobs.attachImage(jobId, { assetId: match.assetId, driveId: match.driveFileId })
      try { image = await downloadPhoto(match.driveFileId) } catch (e) { console.warn('[Blog] photo download failed:', e.message) }
    }

    if (!publish) { await jobs.setStatus(jobId, 'generating', { error_message: 'test run, not published' }); return { status: 'generated', jobId } }

    const result = await wordpress.publishPost({ post: { ...post, categoryLabel: location.wpCategory }, location, image })
    await jobs.markPublished(jobId, { wpPostId: result.id, wpUrl: result.url, wpMediaId: result.mediaId })
    return { status: 'published', jobId, wpUrl: result.url }
  } catch (err) {
    console.error(`[Blog] ${locationKey} failed:`, err)
    await jobs.markFailed(jobId, err.message).catch(() => {})
    await blogAlert(`${locationKey} post FAILED: ${err.message}`)
    return { status: 'failed', jobId, reason: err.message }
  }
}

async function runWeekly() {
  const results = []
  for (const loc of enabledLocations()) {
    results.push({ location: loc.key, ...(await runForLocation(loc.key, { publish: true })) })
    await new Promise(r => setTimeout(r, 5000)) // gentle pacing
  }
  console.log('[Blog] weekly run complete', results.map(r => `${r.location}:${r.status}`).join(' '))
  return results
}

function start() {
  if (process.env.BLOG_AUTOMATION_ENABLED !== 'true') {
    console.log('[Blog] automation disabled (set BLOG_AUTOMATION_ENABLED=true to enable weekly cron)')
    return
  }
  // Mondays 08:00 America/Los_Angeles
  cron.schedule('0 8 * * 1', () => {
    runWeekly().catch(e => console.error('[Blog] weekly cron failed:', e.message))
  }, { timezone: 'America/Los_Angeles' })
  console.log('[Blog] weekly cron registered (Mon 8am PT)')
}

module.exports = { runForLocation, runWeekly, start }
```

- [ ] **Step 2: Register the cron in `auth/src/index.js`**

After the inventorySync block (around line 162, before the closing `})` of the `app.listen` callback), add:

```js
  // Blog automation weekly cron — opt-in via BLOG_AUTOMATION_ENABLED=true.
  try {
    require('./services/blogAutomation').start()
  } catch (err) {
    console.error('[blog] failed to start:', err.message)
  }
```

- [ ] **Step 3: Manual integration run (test, no publish)**

Set env (`ANTHROPIC_API_KEY`, `VOYAGE_API_KEY`, Supabase, Google) in the auth shell, then:

Run: `node -e "require('./auth/src/services/blogAutomation').runForLocation('Salem', { publish: false }).then(r => console.log(r))"`
Expected: `{ status: 'generated', jobId: '...' }`, and a `blog_posts` row exists with content + an `image_drive_id`. Inspect the row's `content_html` to eyeball SEO/AEO quality and confirm a Yoast FAQ block + the city name appear.

- [ ] **Step 4: Forced-failure alert check**

Temporarily set `WP_APP_PASSWORD` to a bad value and run with `publish: true` for one location; confirm the row goes `failed` and a webhook SMS arrives. Restore the password.

- [ ] **Step 5: Commit**

```bash
git add auth/src/services/blogAutomation/index.js auth/src/index.js
git commit -m "feat(blog): orchestrator + opt-in weekly cron"
```

---

## Task 11: Portal API route

**Files:**
- Create: `auth/src/routes/blogAutomation.js`
- Modify: `auth/src/index.js` (mount route near other `app.use(...)` lines, ~line 80)

**Interfaces:**
- Consumes: `runForLocation` (Task 10), `jobs.listRecent` (Task 4), `wordpress.testConnection` (Task 8), `enabledLocations` (Task 2).
- Produces HTTP:
  - `GET /blog-automation/posts?location=&limit=` → `{ posts }`
  - `GET /blog-automation/status` → `{ wp, locations, enabled, nextRun }`
  - `POST /blog-automation/run` body `{ location, publish }` → `{ result }` (admin only)

- [ ] **Step 1: Write `blogAutomation.js`**

```js
// auth/src/routes/blogAutomation.js
const { Router } = require('express')
const authenticate = require('../middleware/auth')
const { requireRole } = require('../middleware/role')
const jobs = require('../services/blogAutomation/jobs')
const wp = require('../services/blogAutomation/wordpress')
const { enabledLocations } = require('../services/blogAutomation/config')
const { runForLocation } = require('../services/blogAutomation')

const router = Router()
router.use(authenticate)
router.use(requireRole('corporate')) // corporate/marketing/admin

router.get('/posts', async (req, res) => {
  try {
    const posts = await jobs.listRecent({ location: req.query.location || null, limit: Math.min(Number(req.query.limit) || 50, 200) })
    res.json({ posts })
  } catch (e) { res.status(500).json({ error: e.message }) }
})

router.get('/status', async (req, res) => {
  try {
    const wpConn = await wp.testConnection()
    res.json({ wp: wpConn, locations: enabledLocations().map(l => l.key),
      enabled: process.env.BLOG_AUTOMATION_ENABLED === 'true', nextRun: 'Mondays 8:00am PT' })
  } catch (e) { res.status(500).json({ error: e.message }) }
})

router.post('/run', requireRole('admin'), async (req, res) => {
  try {
    const location = String(req.body.location || '')
    const publish = req.body.publish === true
    const result = await runForLocation(location, { publish })
    res.json({ result })
  } catch (e) { res.status(500).json({ error: e.message }) }
})

module.exports = router
```

- [ ] **Step 2: Mount it in `auth/src/index.js`**

Near the other `app.use('/...', require('./routes/...'))` lines (~line 80):

```js
app.use('/blog-automation', require('./routes/blogAutomation'))
```

- [ ] **Step 3: Verify route mounts**

Run: `node -e "const a=require('./auth/src/routes/blogAutomation'); console.log(typeof a)"`
Expected: prints `function` (the router). Then hit `GET /blog-automation/status` with a valid token in a running auth instance and confirm a JSON body with `wp.success`.

- [ ] **Step 4: Commit**

```bash
git add auth/src/routes/blogAutomation.js auth/src/index.js
git commit -m "feat(blog): portal API (history, status, manual run)"
```

---

## Task 12: Portal monitoring UI

**Files:**
- Create: `portal/src/components/BlogAutomationView.jsx`
- Modify: `portal/src/lib/api.js` (add `blogAutomation` API calls)
- Modify: wherever Admin/Marketing tiles + routing are registered (follow the existing pattern used by e.g. `MediaLibraryView` — locate with `grep -rn "MediaLibraryView" portal/src`)

**Interfaces:**
- Consumes: the Task 11 endpoints.
- Produces: a corporate/marketing/admin-gated page listing recent posts per location with status pills + live links, a WP-connection indicator, next-run text, and per-location "Generate now" (admin) buttons with a publish/test toggle.

- [ ] **Step 1: Add API helpers to `portal/src/lib/api.js`**

Follow the existing exported-object pattern in that file. Add:

```js
export const blogAutomation = {
  posts: (location) => apiGet(`/blog-automation/posts${location ? `?location=${encodeURIComponent(location)}` : ''}`),
  status: () => apiGet('/blog-automation/status'),
  run: (location, publish) => apiPost('/blog-automation/run', { location, publish }),
}
```

(Use the same `apiGet`/`apiPost` helpers and auth-header handling the rest of the file uses; match their exact names.)

- [ ] **Step 2: Write `BlogAutomationView.jsx`**

Build a page that, on mount, calls `blogAutomation.status()` and `blogAutomation.posts()`, renders:
- a header with WP connection status (green/red) + "Next run: Mondays 8:00am PT" + enabled/disabled badge,
- a table of recent posts: location, status pill (published=green, failed=red, skipped=amber, generating=grey), title (linked to `wp_url` when present), created date, error text on failure,
- a per-location control row (admin only) with a "Test" (publish:false) and "Publish now" (publish:true) button calling `blogAutomation.run(location, publish)`, then refreshing the list.

Match the styling/conventions of `MediaLibraryView.jsx` (Tailwind classes, loading + error states, role checks from the app's auth context). Keep it one focused component.

- [ ] **Step 3: Register navigation/route**

Mirror how `MediaLibraryView` is registered (tile + route/hash). Gate visibility to corporate/marketing/admin.

- [ ] **Step 4: Manual verification**

Run the portal dev server, open the page, confirm: status loads, table renders the rows created in Task 10, and an admin "Test" run creates a new `generating` row.

- [ ] **Step 5: Commit**

```bash
git add portal/src/components/BlogAutomationView.jsx portal/src/lib/api.js
git commit -m "feat(blog): portal monitoring page + manual trigger"
```

---

## Self-Review (completed during planning)

**Spec coverage:** auth-service module (T2-T11) ✓; fully-automatic weekly cron (T10) ✓; 6 locations sans Milwaukie (T2) ✓; no email (only `sendAlert`, T9) ✓; semantic photo reuse (T7) ✓; SEO/AEO/GEO via prompts + FAQ block + Yoast meta (T5, T8) ✓; two-layer validation gate (T6) ✓; `blog_posts` data model (T1) ✓; error-SMS on failure (T9/T10) ✓; portal monitoring + manual trigger (T11, T12) ✓.

**Deferred-to-execution detail (flagged, not a gap):** confirm Yoast exposes `_yoast_wpseo_*` via the REST `meta` field on the live site during Task 8/10 — if blocked, fall back to a single self-authored `FAQPage` JSON-LD block (FAQPage only). The WP credentials (`WP_USERNAME`, `WP_APP_PASSWORD`, `WP_API_URL`) must be set on the auth Render service before Task 10's publish step.

**Type consistency:** `generatePost` returns `{title, slug, metaDescription, focusKeyword, excerpt, contentHtml, faq}` — consumed identically by `validate`, `jobs.attachContent`, and `wordpress.buildPostPayload`. `pickPhoto` → `{assetId, driveFileId, similarity}` consumed by `jobs.attachImage` + `downloadPhoto`. `publishPost` → `{id, url, mediaId}` consumed by `jobs.markPublished`. Consistent.
