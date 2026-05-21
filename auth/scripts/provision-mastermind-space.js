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

function sleep(ms) { return new Promise(r => setTimeout(r, ms)) }
function log(msg) { console.log(msg) }
function die(msg) { console.error('FATAL:', msg); process.exit(1) }

// ----------------------------------------------------------------------------
// Domain config
// ----------------------------------------------------------------------------

// Default 5-stage statuses used by Channels lists
const CHANNEL_STATUSES = makeStatuses(['Idea', 'Drafting', 'Scheduled', 'Live', 'Done'])

// Universal custom fields applied to every list (Mastermind dropdown + pause flag)
const UNIVERSAL_FIELDS = [
  {
    name: 'Mastermind',
    type: 'drop_down',
    type_config: {
      options: [
        { name: 'Brief Me', color: '#3397DD', orderindex: 0 },
        { name: 'Strategize', color: '#9B59B6', orderindex: 1 },
        { name: 'Analyze', color: '#2ECC71', orderindex: 2 },
        { name: 'Draft', color: '#F1C40F', orderindex: 3 },
        { name: 'Review', color: '#E67E22', orderindex: 4 },
        { name: 'Wrap Up', color: '#95A5A6', orderindex: 5 },
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
    name: 'Channels',
    lists: [
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
          { name: 'Caption', type: 'textarea' },
          { name: 'Hashtags', type: 'textarea' },
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
        name: '🧪 Broadcast Lab',
        statuses: makeStatuses(['Brainstorming', 'Ideas Posted', 'Approved', 'Promoted', 'Archived']),
        extraFields: [],
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
          { name: 'Notification Body', type: 'textarea' },
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
          status: 'active',
        }),
      })
      log(`    ✓ list "${list.name}" id: ${listRes.id}`)
      allLists.push({ list: listRes, def: list, lane: lane.name })

      // Track special-purpose list IDs for rhythms env vars
      if (lane.name === 'Performance' && list.name === 'Performance') {
        idByEnvKey.CLICKUP_LIST_PERFORMANCE = listRes.id
      }
      if (list.name === 'Flyers & Print') {
        idByEnvKey.CLICKUP_LIST_FLYERS = listRes.id
      }
      if (list.name === 'Email & SMS') {
        idByEnvKey.CLICKUP_LIST_EMAIL = listRes.id
      }
      if (lane.name === 'Strategy' && list.name === 'Strategy & Planning') {
        idByEnvKey.CLICKUP_LIST_STRATEGY = listRes.id
      }

      // Set custom statuses on the list (some space defaults may interfere; safer to PUT)
      try {
        await cu(`/list/${listRes.id}`, {
          method: 'PUT',
          body: JSON.stringify({ name: list.name, status: 'active', statuses: list.statuses }),
        })
        log(`      ✓ ${list.statuses.length} statuses set`)
      } catch (e) {
        log(`      ⚠ could not override statuses (using space defaults): ${e.message.slice(0, 120)}`)
      }
    }
    log('')
  }

  // 4. Create custom fields per list (Mastermind + Mastermind Paused on every list,
  //    plus list-specific extras)
  log('Creating custom fields on every list...')
  let firstMastermindFieldId = null
  for (const { list, def, lane } of allLists) {
    log(`  ${lane} / ${def.name}`)
    const allFields = [...UNIVERSAL_FIELDS, ...(def.extraFields || [])]
    for (const f of allFields) {
      try {
        const fieldRes = await cu(`/list/${list.id}/field`, {
          method: 'POST',
          body: JSON.stringify(f),
        })
        if (f.name === 'Mastermind' && !firstMastermindFieldId) {
          firstMastermindFieldId = fieldRes.id
        }
        log(`    ✓ ${f.name} (${f.type})`)
      } catch (e) {
        log(`    ⚠ ${f.name}: ${e.message.slice(0, 120)}`)
      }
    }
  }

  if (firstMastermindFieldId) {
    idByEnvKey.CLICKUP_MASTERMIND_FIELD_ID = firstMastermindFieldId
  }
  idByEnvKey.CLICKUP_WORKSPACE_ID = TEAM_ID
  idByEnvKey.CLICKUP_SPACE_MARKETING = space.id

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

function formatEnvText(idByEnvKey, spaceId) {
  const ordered = [
    'CLICKUP_WORKSPACE_ID',
    'CLICKUP_SPACE_MARKETING',
    'CLICKUP_FOLDER_CAMPAIGNS',
    'CLICKUP_MASTERMIND_FIELD_ID',
    'CLICKUP_LIST_PERFORMANCE',
    'CLICKUP_LIST_FLYERS',
    'CLICKUP_LIST_EMAIL',
    'CLICKUP_LIST_STRATEGY',
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
