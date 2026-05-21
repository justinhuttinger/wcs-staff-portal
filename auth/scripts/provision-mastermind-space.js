#!/usr/bin/env node
/**
 * WCS Marketing Mastermind — ClickUp Space Provisioning Script
 *
 * One-shot script that builds the entire "WCS Marketing" space in ClickUp:
 * 5 lanes (Inbox, Strategy, Campaigns, Channels, Performance), all child lists,
 * per-list statuses, and the custom fields the Mastermind processor expects.
 *
 * Usage:
 *   cd auth
 *   CLICKUP_API_KEY=pk_xxx CLICKUP_TEAM_ID=9011189579 \
 *     node scripts/provision-mastermind-space.js
 *
 * Optional env:
 *   SPACE_NAME (default "WCS Marketing")
 *   DRY_RUN=true  — print what would be created, make no API calls
 *
 * Output:
 *   - Progress logs to stdout as resources are created
 *   - On success, writes auth/scripts/mastermind-env-additions.txt with
 *     the env vars you should paste into Render
 */

const fs = require('fs')
const path = require('path')

const TOKEN = process.env.CLICKUP_API_KEY
const TEAM_ID = process.env.CLICKUP_TEAM_ID
const SPACE_NAME = process.env.SPACE_NAME || 'WCS Marketing'
const DRY_RUN = process.env.DRY_RUN === 'true'

if (!TOKEN) die('Missing CLICKUP_API_KEY env var')
if (!TEAM_ID) die('Missing CLICKUP_TEAM_ID env var')

// ----------------------------------------------------------------------------
// HTTP helpers
// ----------------------------------------------------------------------------

const API_BASE = 'https://api.clickup.com/api/v2'
const DOCS_API_BASE = 'https://api.clickup.com/api/v3'
const RATE_LIMIT_DELAY_MS = 250  // small gap to stay well under ClickUp rate limits

async function cu(path, opts = {}) {
  if (DRY_RUN) {
    log(`  [DRY] ${opts.method || 'GET'} ${path}`)
    return { id: `dry-${Math.random().toString(36).slice(2, 10)}` }
  }
  await sleep(RATE_LIMIT_DELAY_MS)
  const url = path.startsWith('http') ? path : `${API_BASE}${path}`
  const res = await fetch(url, {
    ...opts,
    headers: {
      'Authorization': TOKEN,
      'Content-Type': 'application/json',
      ...(opts.headers || {}),
    },
  })
  const text = await res.text()
  let json
  try { json = text ? JSON.parse(text) : {} } catch { json = { raw: text } }
  if (!res.ok) {
    throw new Error(`ClickUp ${res.status} ${opts.method || 'GET'} ${path}\n  ${text.slice(0, 400)}`)
  }
  return json
}

async function docs(path, opts = {}) {
  if (DRY_RUN) {
    log(`  [DRY] ${opts.method || 'GET'} (docs) ${path}`)
    return { id: `dry-doc-${Math.random().toString(36).slice(2, 10)}`, pages: [{ id: `dry-pg-${Math.random().toString(36).slice(2, 10)}` }] }
  }
  await sleep(RATE_LIMIT_DELAY_MS)
  const url = `${DOCS_API_BASE}${path}`
  const res = await fetch(url, {
    ...opts,
    headers: {
      'Authorization': TOKEN,
      'Content-Type': 'application/json',
      ...(opts.headers || {}),
    },
  })
  const text = await res.text()
  let json
  try { json = text ? JSON.parse(text) : {} } catch { json = { raw: text } }
  if (!res.ok) {
    throw new Error(`ClickUp Docs ${res.status} ${opts.method || 'GET'} ${path}\n  ${text.slice(0, 400)}`)
  }
  return json
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)) }
function log(msg) { console.log(msg) }
function die(msg) { console.error('FATAL:', msg); process.exit(1) }

// ----------------------------------------------------------------------------
// Domain config
// ----------------------------------------------------------------------------

// Default 5-stage statuses used by Channels lists
const CHANNEL_STATUSES = makeStatuses(['Idea', 'Drafting', 'Scheduled', 'Live', 'Done'])

// Universal custom fields applied to every list (Mastermind dropdown + pause flag).
// v2: two user-triggerable values plus a Thinking state the processor sets
// itself while working. Don't pick Thinking manually.
const UNIVERSAL_FIELDS = [
  {
    name: 'Mastermind',
    type: 'drop_down',
    type_config: {
      options: [
        { name: 'Strategize', color: '#9B59B6', orderindex: 0 },
        { name: 'Build', color: '#2ECC71', orderindex: 1 },
        { name: 'Thinking', color: '#F1C40F', orderindex: 2 },
      ],
    },
  },
  { name: 'Mastermind Paused', type: 'checkbox' },
]

// Locations dropdown (used on Channels + Campaign tasks)
const LOCATION_OPTIONS = [
  'Clackamas', 'Eugene', 'Keizer', 'Medford',
  'Milwaukie', 'Salem', 'Springfield',
  'All',
].map((name, i) => ({ name, orderindex: i }))

// Lane / list structure
const LANES = [
  {
    name: 'Inbox & Ideas',
    lists: [
      {
        name: 'Inbox',
        statuses: makeStatuses(['New', 'Triaged', 'Routed', 'Archived']),
        extraFields: [
          {
            name: 'Source', type: 'drop_down',
            type_config: { options: ['Me', 'Paige', 'GM', 'Member feedback', 'Other'].map((n, i) => ({ name: n, orderindex: i })) },
          },
        ],
      },
    ],
  },
  {
    name: 'Strategy',
    lists: [
      {
        name: 'Strategy & Planning',
        statuses: makeStatuses(['Open', 'Drafting', 'Review', 'Locked']),
        extraFields: [],
      },
    ],
  },
  {
    name: 'Campaigns',
    lists: [
      {
        name: '🧪 Campaign Lab',
        statuses: makeStatuses(['Brainstorming', 'Ideas Posted', 'Concept Picked', 'Approved', 'Promoted', 'Archived']),
        extraFields: [
          {
            name: 'Campaign Type', type: 'drop_down',
            type_config: { options: ['Acquisition', 'Retention', 'Upsell', 'Operational'].map((n, i) => ({ name: n, orderindex: i })) },
          },
        ],
      },
    ],
  },
  {
    name: 'Social Media',
    lists: [
      {
        name: '🧪 Post Lab',
        statuses: makeStatuses(['Brainstorming', 'Ideas Posted', 'Picked', 'Promoted', 'Archived']),
        extraFields: [
          {
            name: 'Platform', type: 'drop_down',
            type_config: { options: ['Instagram', 'TikTok', 'Facebook'].map((n, i) => ({ name: n, orderindex: i })) },
          },
        ],
      },
      {
        name: '📅 Content Calendar',
        statuses: makeStatuses(['Drafting', 'Caption Ready', 'Asset Needed', 'Scheduled', 'Published']),
        extraFields: [
          {
            name: 'Platform', type: 'drop_down',
            type_config: { options: ['Instagram', 'TikTok', 'Facebook'].map((n, i) => ({ name: n, orderindex: i })) },
          },
          {
            name: 'Format', type: 'drop_down',
            type_config: { options: ['Feed', 'Reel', 'Story', 'Carousel'].map((n, i) => ({ name: n, orderindex: i })) },
          },
          locationField(),
          publishDateField('Publish Date'),
          {
            name: 'Asset Status', type: 'drop_down',
            type_config: { options: ['Needed', 'Captured', 'Edited', 'Ready'].map((n, i) => ({ name: n, orderindex: i })) },
          },
          { name: 'Caption', type: 'text' },
          { name: 'Hashtags', type: 'text' },
        ],
      },
      {
        name: '📦 Published Archive',
        statuses: makeStatuses(['Published']),
        extraFields: [
          locationField(),
          publishDateField('Published At'),
        ],
      },
    ],
  },
  {
    name: 'Channels',
    lists: [
      {
        name: '🧪 Content Lab',
        statuses: makeStatuses(['Brainstorming', 'Ideas Posted', 'Picked', 'Promoted', 'Archived']),
        extraFields: [
          {
            name: 'Channel Target', type: 'drop_down',
            type_config: { options: ['Email', 'SMS', 'App Blast', 'SEO', 'Blog', 'Flyer', 'Multi'].map((n, i) => ({ name: n, orderindex: i })) },
          },
        ],
      },
      {
        name: 'Meta Ads',
        statuses: CHANNEL_STATUSES,
        extraFields: [
          channelField(),
          locationField(),
          publishDateField('Start Date'),
          publishDateField('End Date'),
        ],
      },
      {
        name: 'SEO & Blogs',
        statuses: CHANNEL_STATUSES,
        extraFields: [
          locationField(),
          publishDateField('Publish Date'),
          { name: 'Target Keyword', type: 'text' },
          { name: 'URL Slug', type: 'text' },
        ],
      },
      {
        name: 'Email & SMS',
        statuses: CHANNEL_STATUSES,
        extraFields: [
          {
            name: 'Type', type: 'drop_down',
            type_config: { options: ['Email', 'SMS', 'Both'].map((n, i) => ({ name: n, orderindex: i })) },
          },
          locationField(),
          publishDateField('Send Date'),
          { name: 'Subject Line', type: 'text' },
        ],
      },
      {
        name: 'App Blasts',
        statuses: makeStatuses(['Idea', 'Drafting', 'Approved', 'Scheduled', 'Sent', 'Archived']),
        extraFields: [
          {
            name: 'Target Audience', type: 'drop_down',
            type_config: { options: ['All Members', 'PT Clients', 'Inactive 30d', 'By Location', 'Custom'].map((n, i) => ({ name: n, orderindex: i })) },
          },
          { name: 'Notification Title', type: 'text' },
          { name: 'Notification Body', type: 'text' },
          { name: 'CTA / Deep Link', type: 'url' },
          publishDateField('Send Date'),
        ],
      },
      {
        name: 'Flyers & Print',
        statuses: makeStatuses(['Idea', 'Design Brief', 'In Design', 'Proof Review', 'Approved', 'Printed', 'Distributed', 'Expired']),
        extraFields: [
          {
            name: 'Format', type: 'drop_down',
            type_config: {
              options: [
                'A-frame', 'Window Cling', '8.5×11 Handout', '11×17 Poster',
                'Trifold', 'Postcard', 'Door Hanger', 'Bag Stuffer',
              ].map((n, i) => ({ name: n, orderindex: i })),
            },
          },
          locationField(),
          { name: 'Quantity per location', type: 'number' },
          {
            name: 'Print Vendor', type: 'drop_down',
            type_config: { options: ['Vistaprint', 'Local Print Shop', 'In-House'].map((n, i) => ({ name: n, orderindex: i })) },
          },
          { name: 'Estimated Cost', type: 'currency', type_config: { default: 0, precision: 2, currency_type: 'USD' } },
          publishDateField('Distribute By'),
          publishDateField('Pull By'),
          { name: 'Design File', type: 'url' },
        ],
      },
      {
        name: 'Promotions & In-Gym',
        statuses: CHANNEL_STATUSES,
        extraFields: [
          locationField(),
          publishDateField('Start Date'),
          publishDateField('End Date'),
        ],
      },
    ],
  },
  {
    name: 'Performance',
    lists: [
      {
        name: 'Performance',
        statuses: makeStatuses(['Pending', 'Analyzing', 'Drafted', 'Reviewed', 'Sent']),
        extraFields: [
          publishDateField('Period Start'),
          publishDateField('Period End'),
        ],
      },
    ],
  },
]

// ----------------------------------------------------------------------------
// Builders
// ----------------------------------------------------------------------------

function makeStatuses(names) {
  const colors = ['#87909e', '#f9d900', '#4286f4', '#02bcd4', '#6bc950', '#bf55ec', '#e50000', '#000000']
  return names.map((status, i) => ({
    status,
    color: colors[i % colors.length],
    orderindex: i,
    type: i === 0 ? 'open' : i === names.length - 1 ? 'closed' : 'custom',
  }))
}

function locationField() {
  return { name: 'Location', type: 'drop_down', type_config: { options: LOCATION_OPTIONS } }
}
function publishDateField(name) {
  return { name, type: 'date', type_config: { include_time: false } }
}
function channelField() {
  return {
    name: 'Channel',
    type: 'drop_down',
    type_config: {
      options: ['Meta', 'Social', 'Email', 'SEO', 'Promo', 'Multi'].map((n, i) => ({ name: n, orderindex: i })),
    },
  }
}

// ----------------------------------------------------------------------------
// Main
// ----------------------------------------------------------------------------

async function main() {
  log('\n=== WCS Marketing Mastermind — ClickUp Space Provisioning ===\n')
  log(`Workspace (team) ID: ${TEAM_ID}`)
  log(`Space name:          ${SPACE_NAME}`)
  log(`Dry run:             ${DRY_RUN}\n`)

  // 1. Pre-flight: list existing spaces so we don't accidentally double-create
  log('Checking existing spaces...')
  const existing = await cu(`/team/${TEAM_ID}/space?archived=false`)
  const collision = (existing.spaces || []).find(s => s.name === SPACE_NAME)
  if (collision) {
    die(`A space named "${SPACE_NAME}" already exists (id ${collision.id}). Archive or rename it first, or set SPACE_NAME to a different value.`)
  }
  log('  no collision — safe to create\n')

  // 2. Create the space
  log(`Creating space "${SPACE_NAME}"...`)
  const space = await cu(`/team/${TEAM_ID}/space`, {
    method: 'POST',
    body: JSON.stringify({
      name: SPACE_NAME,
      multiple_assignees: true,
      features: {
        due_dates:     { enabled: true, start_date: true, remap_due_dates: true, remap_closed_due_date: false },
        time_tracking: { enabled: false },
        tags:          { enabled: true },
        time_estimates:{ enabled: false },
        checklists:    { enabled: true },
        custom_fields: { enabled: true },
        remap_dependencies: { enabled: true },
        dependency_warning: { enabled: true },
        portfolios:    { enabled: false },
      },
    }),
  })
  log(`  ✓ space id: ${space.id}\n`)

  // 3. Build each lane (folder) and its lists
  const allLists = []
  const idByEnvKey = {}

  for (const lane of LANES) {
    log(`Creating lane: ${lane.name}`)
    const folder = await cu(`/space/${space.id}/folder`, {
      method: 'POST',
      body: JSON.stringify({ name: lane.name }),
    })
    log(`  ✓ folder id: ${folder.id}`)

    // Track Campaigns folder for the promotion logic
    if (lane.name === 'Campaigns') {
      idByEnvKey.CLICKUP_FOLDER_CAMPAIGNS = folder.id
    }

    for (const list of lane.lists) {
      const listRes = await cu(`/folder/${folder.id}/list`, {
        method: 'POST',
        body: JSON.stringify({
          name: list.name,
          content: '',
        }),
      })
      log(`    ✓ list "${list.name}" id: ${listRes.id}`)
      allLists.push({ list: listRes, def: list, lane: lane.name })

      // Track special-purpose list IDs for env vars used by the processor.
      // These are used both for recurring rhythms AND for the campaign
      // promotion's multi-list deliverable feature.
      if (lane.name === 'Performance' && list.name === 'Performance') {
        idByEnvKey.CLICKUP_LIST_PERFORMANCE = listRes.id
      }
      if (lane.name === 'Strategy' && list.name === 'Strategy & Planning') {
        idByEnvKey.CLICKUP_LIST_STRATEGY = listRes.id
      }
      if (list.name === 'Meta Ads') idByEnvKey.CLICKUP_LIST_META_ADS = listRes.id
      if (list.name === 'SEO & Blogs') idByEnvKey.CLICKUP_LIST_SEO = listRes.id
      if (list.name === 'Email & SMS') idByEnvKey.CLICKUP_LIST_EMAIL = listRes.id
      if (list.name === 'App Blasts') idByEnvKey.CLICKUP_LIST_APPBLASTS = listRes.id
      if (list.name === 'Flyers & Print') idByEnvKey.CLICKUP_LIST_FLYERS = listRes.id
      if (list.name === 'Promotions & In-Gym') idByEnvKey.CLICKUP_LIST_PROMOTIONS = listRes.id
      if (list.name === '📅 Content Calendar') idByEnvKey.CLICKUP_LIST_CONTENT_CALENDAR = listRes.id
      if (list.name === '🧪 Content Lab') idByEnvKey.CLICKUP_LIST_CONTENT_LAB = listRes.id

      // Per-list custom statuses require Custom Statuses ClickApp enabled on
      // the space. Best-effort; falls back to space defaults if not supported.
      try {
        await cu(`/list/${listRes.id}`, {
          method: 'PUT',
          body: JSON.stringify({ name: list.name, statuses: list.statuses }),
        })
        log(`      ✓ ${list.statuses.length} statuses set`)
      } catch (e) {
        log(`      ⚠ using space default statuses: ${e.message.slice(0, 120)}`)
      }
    }
    log('')
  }

  // 4. Create custom fields per list (Mastermind + Mastermind Paused on every list,
  //    plus list-specific extras). After fields are created, query back to
  //    capture the Mastermind field ID — POST response shape varies, so a fresh
  //    GET is the only reliable way.
  log('Creating custom fields on every list...')
  let firstMastermindFieldId = null
  for (const { list, def, lane } of allLists) {
    log(`  ${lane} / ${def.name}`)
    const allFields = [...UNIVERSAL_FIELDS, ...(def.extraFields || [])]
    for (const f of allFields) {
      try {
        await cu(`/list/${list.id}/field`, {
          method: 'POST',
          body: JSON.stringify(f),
        })
        log(`    ✓ ${f.name} (${f.type})`)
      } catch (e) {
        log(`    ⚠ ${f.name}: ${e.message.slice(0, 120)}`)
      }
    }

    // Look up Mastermind field ID once we have one list fully built
    if (!firstMastermindFieldId) {
      try {
        const lf = await cu(`/list/${list.id}/field`)
        const mm = (lf.fields || []).find(x => x?.name === 'Mastermind')
        if (mm?.id) {
          firstMastermindFieldId = mm.id
          log(`      → captured Mastermind field id: ${mm.id}`)
        }
      } catch { /* ignore */ }
    }
  }

  if (firstMastermindFieldId) {
    idByEnvKey.CLICKUP_MASTERMIND_FIELD_ID = firstMastermindFieldId
  }
  idByEnvKey.CLICKUP_WORKSPACE_ID = TEAM_ID
  idByEnvKey.CLICKUP_SPACE_MARKETING = space.id

  // 4b. Create in-ClickUp user-guide doc explaining the system
  log('\nCreating user-guide doc...')
  try {
    const docUrl = await createUserGuideDoc(space.id)
    log(`  ✓ user guide doc: ${docUrl || '(created, no URL returned)'}`)
  } catch (e) {
    log(`  ⚠ could not create user guide doc: ${e.message.slice(0, 200)}`)
  }

  // 5. Emit env-additions.txt
  const outPath = path.join(__dirname, 'mastermind-env-additions.txt')
  const envText = formatEnvText(idByEnvKey, space.id)
  if (!DRY_RUN) fs.writeFileSync(outPath, envText)
  log('\n=========================================================')
  log('  ✅  Provisioning complete')
  log('=========================================================\n')
  log('Add these to your Render auth-service env vars:\n')
  log(envText)
  if (!DRY_RUN) {
    log(`\nAlso saved to: ${outPath}`)
  }
  log('\nNext: set MASTERMIND_ENABLED=true on Render and redeploy.\n')
}

// ----------------------------------------------------------------------------
// User-guide Doc creation
// ----------------------------------------------------------------------------

async function createUserGuideDoc(spaceId) {
  // Create the parent doc at the Space level. parent.type 4 = Space.
  const doc = await docs(`/workspaces/${TEAM_ID}/docs`, {
    method: 'POST',
    body: JSON.stringify({
      name: '📘 Mastermind — User Guide',
      parent: { id: spaceId, type: 4 },
      visibility: 'PUBLIC',
      create_page: true,
    }),
  })
  if (!doc?.id) return null

  // Update the first page (Overview) with content
  const firstPageId = doc.pages?.[0]?.id
  if (firstPageId) {
    try {
      await docs(`/workspaces/${TEAM_ID}/docs/${doc.id}/pages/${firstPageId}`, {
        method: 'PUT',
        body: JSON.stringify({
          name: 'Overview',
          content: GUIDE_PAGES.overview,
          content_format: 'text/md',
        }),
      })
    } catch (e) {
      log(`    ⚠ overview page write failed: ${e.message.slice(0, 120)}`)
    }
  }

  // Add the rest of the pages
  const extraPages = [
    { name: 'The Lanes', content: GUIDE_PAGES.lanes },
    { name: 'The Mastermind Dropdown', content: GUIDE_PAGES.dropdown },
    { name: 'The Labs (idea generation)', content: GUIDE_PAGES.labs },
    { name: 'Building a Campaign', content: GUIDE_PAGES.campaigns },
    { name: 'Talking to Mastermind in Comments', content: GUIDE_PAGES.comments },
    { name: 'Common Workflows', content: GUIDE_PAGES.workflows },
    { name: 'Troubleshooting', content: GUIDE_PAGES.troubleshooting },
  ]
  for (const page of extraPages) {
    try {
      await docs(`/workspaces/${TEAM_ID}/docs/${doc.id}/pages`, {
        method: 'POST',
        body: JSON.stringify({
          name: page.name,
          content: page.content,
          content_format: 'text/md',
        }),
      })
      log(`    ✓ page: ${page.name}`)
    } catch (e) {
      log(`    ⚠ page '${page.name}': ${e.message.slice(0, 120)}`)
    }
  }

  return doc.url || `https://app.clickup.com/${TEAM_ID}/docs/${doc.id}`
}

const GUIDE_PAGES = {
  overview: `# WCS Marketing Mastermind — User Guide

The **Mastermind** is your AI marketing collaborator that lives inside this ClickUp space. You drop briefs and ideas as ClickUp tasks, set a dropdown to tell it what kind of help you want, and it works in the background — posting results back as comments, Docs, and subtasks.

It can be a **strategist** (big-picture, positioning), a **performance analyst** (reads your data, writes reviews), a **campaign executor** (drafts your ad copy, emails, captions, flyer briefs), or an **operations coordinator** (breaks campaigns into deliverables, keeps the calendar honest).

## How it works in 30 seconds

1. You make a task somewhere in this space
2. You set the **Mastermind** custom field on the task to one of: \`Brief Me\`, \`Strategize\`, \`Analyze\`, \`Draft\`, \`Review\`, \`Wrap Up\`
3. Within ~90 seconds, Mastermind posts back: a comment, sometimes an attached Doc, sometimes auto-generated subtasks
4. You react. If you want changes, comment \`@mastermind\` in the task with your feedback — it'll respond.

## The big idea

ClickUp is the **inbox + record**. Mastermind reads from it and writes back to it. You don't have to leave ClickUp to get marketing work done.

See the other pages of this guide for details on each lane, what each Mastermind dropdown value does, and common workflows.`,

  lanes: `# The Lanes

This space is organized into top-level folders, each with a specific purpose.

## 📥 Inbox & Ideas
**Inbox** — Raw drop zone. Anything you can't immediately categorize lands here. Mastermind sweeps it daily and posts triage suggestions on stale tasks.

When to use: a stray thought, a member-feedback snippet, a "we should do X" hunch. Don't overthink the lane — just dump.

## 🧠 Strategy
**Strategy & Planning** — Long-form planning work. Brand positioning, ICP definitions, quarterly plans. Use ClickUp Docs here for evergreen reference material; use tasks when there's an actual deliverable to produce.

When to use: "Refresh our Q3 plan", "Document the new-member journey", "Annual brand review".

## 🚀 Campaigns
- **🧪 Campaign Lab** — Idea generation for campaigns. Drop a brief, set Mastermind = Strategize, get 3 concept subtasks.
- **🟢 [Active] <name>** — Each running campaign gets its own list (auto-created by Mastermind when you promote a concept).
- **📦 [Archive] <name>** — Past campaigns.

When to use: anything that's a unit of marketing spend with a defined start, end, and goal.

## 📱 Social Media
- **🧪 Post Lab** — Brainstorm Instagram/TikTok/Facebook post ideas.
- **📅 Content Calendar** — Approved posts with publish dates. Calendar view shows your editorial schedule.
- **📦 Published Archive** — Posted content, for reference and post-mortem analysis.

When to use: every IG/TikTok/FB post belongs here. NOT here: paid Meta ads (those are in Channels → Meta Ads).

## 📣 Channels
- **🧪 Content Lab** — Idea generation for non-social content (email broadcasts, app blasts, SEO posts, blog topics, flyer concepts).
- **Meta Ads** — Paid Facebook + Instagram ads.
- **SEO & Blogs** — Blog posts, location pages, SEO content.
- **Email & SMS** — Broadcast emails, SMS campaigns, nurture sequences (Paige's home).
- **App Blasts** — In-app push notifications to members.
- **Flyers & Print** — Physical print collateral (A-frames, window clings, handouts).
- **Promotions & In-Gym** — Time-bound member promos and in-gym offers.

When to use: ongoing work in a channel that's not tied to a named campaign. Or campaign deliverables that get mirrored here automatically (see "Building a Campaign" page).

## 📊 Performance
Recurring analyst tasks Mastermind creates automatically. Weekly Meta ROAS review, Friday digest, monthly report, quarterly strategy.

When to use: you usually don't create tasks here. Mastermind drops reports on schedule; you read and react.`,

  dropdown: `# The Mastermind Dropdown

Every task in this space has a custom field called **Mastermind**. When you set it to a non-blank value, the AI picks up the task within ~90 seconds and does the work.

After completing, Mastermind clears the field back to blank — so you can re-trigger it later if needed.

## The 6 values

### \`Brief Me\`
**What it does:** Reads your raw task and produces a tight structured brief — Scope, Audience, Channels, Hook, Key messages, CTA, Success metric, Open questions, Deliverables checklist.

**When to use:** You have a rough idea and want it organized into a real brief before drafting. Use this for individual tasks.

**Special behavior in Campaign Lab:** When you set \`Brief Me\` on an **Approved** concept in Campaign Lab, Mastermind promotes it to a full Active Campaign — creates a new list, parent task with the full plan, deliverable subtasks per channel, and a ClickUp Doc with the plan attached.

### \`Strategize\`
**What it does:** Strategic memo on whether the work should happen, what alternatives to consider, what risks to watch.

**When to use:** Big-picture decisions. "Should we even do this? What else could we try?"

**Special behavior in any Lab list (Campaign Lab / Post Lab / Content Lab):** Generates exactly 3 concept subtasks for the brief you wrote. You pick the one you want and approve it.

### \`Analyze\`
**What it does:** Pulls performance data (FB ROAS, GA4, GBP) and writes a concise analysis.

**When to use:** Performance lane mostly. You can also use it on a campaign post-close, or on any task where you've pasted data and want a read.

**Current limitation:** Only Meta ROAS adapter is fully wired right now. For other reports, paste the data into the task and Mastermind will write the analysis from what you provide.

### \`Draft\`
**What it does:** Produces the actual deliverable — caption, email, push notification, blog draft, flyer copy, ad copy. Tailored to the channel based on the task's lane.

**When to use:** On any deliverable task. You'll get a code-fenced draft ready to copy/paste into the publishing tool (or, for long-form, an attached ClickUp Doc).

### \`Review\`
**What it does:** Critiques the draft on the task. Calls out strengths, issues, suggested rewrites, and risk flags.

**When to use:** After you or Paige has written a draft. Mastermind plays senior creative director.

### \`Wrap Up\`
**What it does:** Writes a post-mortem (what worked, what didn't, what to keep/kill/try next) AND auto-creates follow-up subtasks for the action items it identifies.

**When to use:** When a campaign or piece of work is done. Closes the loop.

## Universal mute switch

Every task also has a \`Mastermind Paused\` boolean field. If you set that to **true**, Mastermind will ignore the task regardless of what's in the Mastermind dropdown. Use this when you want a task in the system but you don't want AI touching it.`,

  labs: `# The Labs — Idea Generation Pattern

There are three "Labs" in this space, and they all work the same way. Their purpose is to take a brief and turn it into 3 distinct concepts you can pick from.

## The three Labs

| Lab | Located in | Generates concepts for |
|---|---|---|
| 🧪 Campaign Lab | Campaigns folder | Full marketing campaigns (multi-channel, multi-week) |
| 🧪 Post Lab | Social Media folder | Instagram / TikTok / Facebook posts |
| 🧪 Content Lab | Channels folder | Single-channel content: emails, SMS, app blasts, SEO posts, flyers |

## The flow (same for all three Labs)

### 1. Create a parent task in the Lab with your brief

Just a regular ClickUp task. Title = what you want concepts for. Description = the brief.

Example titles:
- "May new-member push — need ideas" (Campaign Lab)
- "10 IG post ideas for June" (Post Lab)
- "Re-engagement email series — need 3 angles" (Content Lab)

### 2. Set \`Mastermind = Strategize\`

Within ~90 seconds, Mastermind:
- Posts a comment with its read of the brief + market context
- Creates **3 concept subtasks** under your parent — each with a hook, audience, channels, expected outcome, and a 1–5 confidence score

### 3. Review the concepts

Open each subtask, read the hook + reasoning. You can:
- Comment \`@mastermind variations on #2 — make it more relatable\` to get alternates
- Comment \`@mastermind combine 1 and 3\` to synthesize
- Mark the one you want as **Approved** when you're ready

### 4. Pick one and run with it

This step depends on which Lab you're in:

**Campaign Lab:** Set \`Mastermind = Brief Me\` on the Approved concept. Mastermind creates a whole new Active Campaign folder with the full plan, deliverable subtasks across all needed channels, and a ClickUp Doc with the full plan.

**Post Lab / Content Lab:** Set \`Mastermind = Draft\` on the Approved concept. Mastermind produces the actual deliverable (caption, email, push body, etc.).

## Why 3 concepts?

Tight enough to actually compare. Most decisions are made between 3 options anyway. If you want more, ask for variations in a comment.

## Where do non-chosen concepts go?

If you used Campaign Lab and promoted a concept to an Active Campaign, the non-chosen concepts auto-archive to keep the Lab tidy. In Post Lab / Content Lab they stay as Ideas — you can revisit them anytime, or archive them yourself if they're stale.`,

  campaigns: `# Building a Campaign

This is the most powerful workflow in the system — going from a rough campaign idea to a fully-built-out campaign with deliverables, in about 3 minutes of human work + 2 minutes of AI work.

## Step 1: Drop the idea in Campaign Lab

Create a task in **Campaigns → 🧪 Campaign Lab**. Write what you want:

> **Title:** Spring Member Drive — Centralia + Olympia, $5K budget
>
> **Description:** 6-week new-member push starting April 1. Budget $5K total (Meta ~$3K, Paige owns email nurture, in-gym promo signage at both locations). Goal: 50 net new members. Hook idea I'm noodling: "First 100 days free unlimited classes" — but open to anything. Tone should feel premium, not discount-y.

Set \`Mastermind = Strategize\`.

## Step 2: Pick a concept

In ~90 seconds, 3 subtasks appear with different campaign concepts. Each has a hook, audience, channel mix, expected outcome, and confidence score.

Read them, optionally ask for variations via \`@mastermind\` comments, then mark your favorite as **Approved**.

## Step 3: Build it out

On the Approved concept, set \`Mastermind = Brief Me\`.

Mastermind goes to work and creates:

1. **A new list** under Campaigns called \`🟢 <Campaign Name>\` with its own 5-stage status flow (Briefing → Building → Live → Review → Closed)
2. **The parent campaign task** in that new list, with the full plan in the description
3. **Deliverable subtasks** — one per channel the concept needs (e.g., "Cold Meta ad set", "5-email nurture sequence", "Landing page copy", "A-frame signage")
4. **A ClickUp Doc** attached to the parent with the full strategic plan
5. **Mirrors each deliverable** into its matching Channels list — so the Meta ad subtask shows up both in your campaign list AND in Channels → Meta Ads (single task, two homes)

## Step 4: Produce the assets

For each deliverable subtask, set \`Mastermind = Draft\`. You'll get:
- Email: subject line, preheader, body, CTA
- Meta ad copy: hook lines, body, CTA
- Social caption: hook, body, hashtags
- Flyer brief: headline, subhead, body, CTA + asset spec
- Blog draft: H1, lede, sections
- Push notification: title (≤40 chars), body (≤140 chars)

You review, iterate via \`@mastermind\` comments if needed, then ship.

## Step 5: Close it out

When the campaign is done, set \`Mastermind = Wrap Up\` on the parent campaign task. You'll get a post-mortem and Mastermind auto-creates follow-up subtasks for any action items it found.

## Why this matters

The unit of marketing work is the campaign. Everything else flows from it. This pipeline eliminates the friction between "I have an idea" and "the work is in flight."`,

  comments: `# Talking to Mastermind in Comments

After Mastermind posts a result, you can keep the conversation going right in the task comments. No need to re-trigger the dropdown.

## The trigger: \`@mastermind\`

Add \`@mastermind\` anywhere in a comment and the AI will pick it up within ~90 seconds and respond as a new comment.

## What you can ask

**Revisions:**
- "@mastermind rewrite the second paragraph in a more direct tone"
- "@mastermind the CTA is too pushy — try something softer"
- "@mastermind remove the discount mention, we don't want to lead with price"

**Variations:**
- "@mastermind give me 3 alternate hook lines"
- "@mastermind same brief but for the Salem location specifically"

**Quick questions:**
- "@mastermind what hashtags would you use for this?"
- "@mastermind should we test a video version of this ad?"

**Continuations:**
- "@mastermind now write a follow-up email for 7 days later"
- "@mastermind expand this into a blog post"

## What it remembers

When Mastermind responds to your @mention, it reads:
- The task title + description
- The full comment history on this task
- The lane the task is in (gives it context about whether this is social, paid, email, etc.)

So you can have a multi-turn conversation. It picks up where you left off.

## Without the @mention

Plain comments (no \`@mastermind\` mention) don't trigger anything. You and Paige can talk to each other in the task comments without spamming the AI.

## If you change your mind mid-conversation

Just say so: "@mastermind scrap all the above, let's restart with [new direction]". It'll catch the reset.`,

  workflows: `# Common Workflows

Cheat sheet for the patterns you'll use most. Pin this in your bookmarks.

## "Write me an email broadcast" (~3 min)

1. Create task in **Channels → Email & SMS**
2. Title + brief: who it's for, what it's about, the CTA
3. Set \`Mastermind = Draft\`
4. Get a comment back with subject line + preheader + body + CTA
5. If you want changes, comment \`@mastermind <feedback>\`
6. When ready, copy into your email tool, set Publish Date in the task, status → \`Scheduled\` → \`Live\` → \`Done\`

## "Brainstorm a campaign" (~5 min)

1. Create task in **Campaigns → 🧪 Campaign Lab**
2. Brief: budget, dates, goal, what's working/not working
3. Set \`Mastermind = Strategize\` → get 3 concept subtasks
4. Pick one, mark **Approved**
5. Set \`Mastermind = Brief Me\` on the approved concept
6. Mastermind builds the whole campaign — see "Building a Campaign" page

## "Need a flyer for the front door" (~2 min)

1. Create task in **Channels → Flyers & Print**
2. Brief: occasion, location, format (A-frame? handout?), what it's promoting
3. Set \`Mastermind = Brief Me\` → get headline + subhead + body + CTA + design notes
4. Hand the brief to whoever designs (you, Paige, or a contractor) — paste into Canva
5. Once printed and distributed, update \`Distribute By\` and \`Pull By\` dates. Mastermind audits monthly.

## "Need IG post ideas for this week" (~3 min)

1. Create task in **Social Media → 🧪 Post Lab**
2. Brief: themes, location focus, format mix (Reels vs Feed)
3. Set \`Mastermind = Strategize\` → 3 concept subtasks
4. Mark the ones you want as Approved
5. On each, set \`Mastermind = Draft\` → get caption + hashtags + asset note
6. Move to Content Calendar, set Publish Date, post manually when ready

## "What's our Meta ROAS this week?"

Don't even need to ask — the \`Weekly Meta ROAS Review\` task auto-creates every Monday 7am in Performance. Just open and read.

If you want an off-cycle one: create a task in **Performance**, set \`Mastermind = Analyze\`.

## "Critique this draft I wrote"

1. Open the task with your draft (or paste it in a comment)
2. Set \`Mastermind = Review\`
3. Get strengths / issues / suggested rewrites / risk flags

## "Close out this campaign and tell me what to do differently"

1. Open the parent campaign task
2. Set \`Mastermind = Wrap Up\`
3. Get post-mortem + auto-generated follow-up subtasks for the action items`,

  troubleshooting: `# Troubleshooting

## "I set Mastermind on a task and nothing happened"

Wait 90 seconds. The processor polls every minute and ClickUp's webhook can take a few seconds to fire.

Still nothing after 2 minutes? Open the portal at **/admin → Experimental → Marketing Mastermind**. Check:
- **Queue tab:** is there a row for your task?
- **Errors tab:** any webhook signature errors?

If queue shows the row but status is stuck on \`pending\`, the processor isn't running. Tell Justin.

## "Mastermind generated something terrible"

Comment \`@mastermind redo with [direction]\` in the task. It'll iterate. Be specific about what was wrong.

If you want it to start fresh, say so: \`@mastermind ignore the previous draft, start over with [new angle]\`.

## "I want to lock a task off-limits"

Set the \`Mastermind Paused\` field to **true**. Mastermind will ignore the task entirely.

Unset it (set to false / unchecked) when you want it active again.

## "I keep getting cost-cap warnings"

Default caps: $25/day total, $2/task. If you're hitting them often, tell Justin to bump the env vars (\`MASTERMIND_DAILY_CAP_USD\`, \`MASTERMIND_TASK_CAP_USD\`).

A \`$2/task\` warning means the request needed unusually large context (e.g., a task with 50+ comments and big attached docs). The work still completes; you just get a heads-up.

## "The post-mortem made up numbers I don't recognize"

Mastermind doesn't have access to your raw data unless you paste it in. For post-mortems, attach the relevant data (e.g., Meta export, GA4 screenshot) to the task or paste in a comment before triggering \`Wrap Up\`.

## "I want to disable a recurring rhythm"

Tell Justin — the schedules live in code. Easy to comment one out or change the cron.

## "How do I add a new location dropdown option?"

Open any list where \`Location\` exists → click the field header → Edit field → add the new option. ClickUp will sync it across lists that share the field definition.

## "I'm worried about cost"

Open \`/admin → Marketing Mastermind\` in the portal. You see today's spend vs. cap, total invocations, and breakdowns by mode/lane/task. Top 10 most expensive tasks are linked back to ClickUp so you can investigate what cost the most.

Anthropic Console (claude.ai/console) is the source-of-truth for total spend.`,
}

function formatEnvText(idByEnvKey, spaceId) {
  const ordered = [
    'CLICKUP_WORKSPACE_ID',
    'CLICKUP_SPACE_MARKETING',
    'CLICKUP_FOLDER_CAMPAIGNS',
    'CLICKUP_MASTERMIND_FIELD_ID',
    // Rhythm targets
    'CLICKUP_LIST_PERFORMANCE',
    'CLICKUP_LIST_STRATEGY',
    // Channel lists (for multi-list campaign deliverables)
    'CLICKUP_LIST_META_ADS',
    'CLICKUP_LIST_SEO',
    'CLICKUP_LIST_EMAIL',
    'CLICKUP_LIST_APPBLASTS',
    'CLICKUP_LIST_FLYERS',
    'CLICKUP_LIST_PROMOTIONS',
    'CLICKUP_LIST_CONTENT_CALENDAR',
    'CLICKUP_LIST_CONTENT_LAB',
  ]
  const lines = ordered.map(k => {
    const v = idByEnvKey[k]
    return v ? `${k}=${v}` : `# ${k}=(not captured — check script output above)`
  })
  return lines.join('\n')
}

main().catch(e => {
  console.error('\n=========================================================')
  console.error('  ❌  Provisioning failed')
  console.error('=========================================================')
  console.error(e.message || e)
  if (e.stack) console.error('\n' + e.stack.split('\n').slice(0, 5).join('\n'))
  console.error('\nTo retry cleanly: archive the partial "' + SPACE_NAME + '" space in ClickUp first, then re-run.')
  process.exit(1)
})
