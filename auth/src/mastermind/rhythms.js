const cron = require('node-cron')
const cu = require('./clickup')

// Each rhythm: cron expression (PT), list ID env var, task title fn, mode dropdown label.
const RHYTHMS = [
  {
    name: 'weekly_meta_review',
    cron: '0 7 * * 1',             // Mon 7am PT
    listIdEnv: 'CLICKUP_LIST_PERFORMANCE',
    title: () => `Weekly Meta ROAS Review: week of ${dateStamp()}`,
    description: 'Auto-created by Mastermind. Reviews last 7 days of Meta ad performance.',
    modeLabel: 'Analyze',
  },
  {
    name: 'weekly_digest',
    cron: '0 16 * * 5',            // Fri 4pm PT
    listIdEnv: 'CLICKUP_LIST_PERFORMANCE',
    title: () => `Weekly Marketing Digest: week of ${dateStamp()}`,
    description: 'Auto-created by Mastermind. Cross-channel roll-up for the week.',
    modeLabel: 'Analyze',
  },
  {
    name: 'monthly_report',
    cron: '0 7 1 * *',             // 1st of month 7am PT
    listIdEnv: 'CLICKUP_LIST_PERFORMANCE',
    title: () => `Monthly Marketing Report: ${monthName()}`,
    description: 'Auto-created by Mastermind. Full GBP + GA4 + FB ROAS + trends report.',
    modeLabel: 'Analyze',
  },
  {
    name: 'quarterly_strategy',
    cron: '0 7 1 1,4,7,10 *',      // 1st of each quarter 7am PT
    listIdEnv: 'CLICKUP_LIST_PERFORMANCE',
    title: () => `Quarterly Strategy Review: ${quarterLabel()}`,
    description: 'Auto-created by Mastermind. Strategic memo on the quarter.',
    modeLabel: 'Strategize',
  },
  {
    name: 'flyer_audit',
    cron: '0 8 1 * *',             // 1st of month 8am PT
    listIdEnv: 'CLICKUP_LIST_FLYERS',
    title: () => `Flyer Audit: what's expired (${monthName()})`,
    description: 'Auto-created by Mastermind. Lists flyers past Pull By date that still need removal.',
    modeLabel: 'Analyze',
  },
  {
    name: 'email_queue_check',
    cron: '0 8 * * 2',             // Tue 8am PT
    listIdEnv: 'CLICKUP_LIST_EMAIL',
    title: () => 'Email & SMS: what\'s queued this week',
    description: 'Auto-created by Mastermind. Surfaces scheduled email/SMS for the week + gaps.',
    modeLabel: 'Analyze',
  },
  {
    name: 'annual_brand_review',
    cron: '0 7 1 1 *',             // Jan 1 7am PT
    listIdEnv: 'CLICKUP_LIST_STRATEGY',
    title: () => `Annual Brand Review: ${new Date().getFullYear()}`,
    description: 'Auto-created by Mastermind. Reviews all locked Strategy Docs, proposes refreshes.',
    modeLabel: 'Strategize',
  },
]

function start() {
  if (process.env.MASTERMIND_ENABLED !== 'true') return

  let scheduled = 0
  let skipped = 0
  for (const r of RHYTHMS) {
    const listId = process.env[r.listIdEnv]
    if (!listId) {
      console.warn(`[mastermind] rhythm '${r.name}' has no list id (${r.listIdEnv} unset): skipped`)
      skipped++
      continue
    }
    cron.schedule(r.cron, () => runRhythm(r, listId).catch(e => console.error(`[mastermind] rhythm '${r.name}' failed`, e.message)), {
      timezone: 'America/Los_Angeles',
    })
    scheduled++
    console.log(`[mastermind] rhythm '${r.name}' scheduled: ${r.cron}`)
  }
  console.log(`[mastermind] ${scheduled} rhythm(s) scheduled, ${skipped} skipped (missing list IDs)`)
}

async function runRhythm(r, listId) {
  const taskRes = await cu.createTask(listId, {
    name: r.title(),
    description: r.description,
  })
  const taskId = taskRes?.id
  if (!taskId) {
    console.error(`[mastermind] rhythm '${r.name}' created no task`)
    return
  }

  // Resolve the Mastermind field ID. Prefer the field instance on this list
  // (more reliable than env var since each list has its own field instance).
  let fieldId = null
  try {
    const fullTask = await cu.getTask(taskId)
    const fields = fullTask?.custom_fields || []
    fieldId = fields.find(f => f?.name === 'Mastermind')?.id || null
  } catch (e) {
    console.warn(`[mastermind] rhythm '${r.name}' could not fetch task for field lookup: ${e.message}`)
  }
  if (!fieldId) fieldId = process.env.CLICKUP_MASTERMIND_FIELD_ID

  if (fieldId) {
    try {
      await cu.setCustomField(taskId, fieldId, r.modeLabel)
    } catch (e) {
      console.error(`[mastermind] rhythm '${r.name}' field set failed:`, e.message)
    }
  } else {
    console.warn(`[mastermind] rhythm '${r.name}' created task ${taskId} but no Mastermind field found on the list and CLICKUP_MASTERMIND_FIELD_ID is unset: field not auto-set`)
  }
  console.log(`[mastermind] rhythm '${r.name}' created task ${taskId}`)
}

function dateStamp() {
  return new Date().toISOString().slice(0, 10)
}
function monthName() {
  return new Date().toLocaleString('en-US', { month: 'long', year: 'numeric' })
}
function quarterLabel() {
  const d = new Date()
  const q = Math.floor(d.getMonth() / 3) + 1
  return `Q${q} ${d.getFullYear()}`
}

module.exports = { start, RHYTHMS }
