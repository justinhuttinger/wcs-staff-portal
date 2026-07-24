// auth/src/services/kpiDigest/index.js
// Weekly Operandio KPI digest. Mirrors the blogAutomation service shape:
// a feature-flagged Monday cron plus a runnable function for the manual route.
'use strict'

const cron = require('node-cron')
const { priorWeek, pacificYmd } = require('./week')
const { fetchWeek } = require('./queries')
const { buildDigestDoc } = require('./tiptap')
const { publishDigest } = require('./publish')
const { CRON, TZ, ENABLED_ENV } = require('./config')
const { sendAlert } = require('../blogAutomation/alerts')

// Build and publish the digest for the completed prior week. Never throws;
// returns a status object. `now` is injectable for testing/backfill.
async function runWeekly({ now = new Date() } = {}) {
  const window = priorWeek(now)
  const generatedYmd = pacificYmd(now)
  try {
    const weekData = await fetchWeek(window)
    const doc = buildDigestDoc(weekData, generatedYmd)
    const { id, supersededIds } = await publishDigest(doc)
    console.log(`[KpiDigest] published ${window.start}..${window.end} as ${id}`
      + ` (superseded ${supersededIds.length})`)
    return { status: 'published', window, id, supersededIds }
  } catch (err) {
    console.error(`[KpiDigest] run failed for ${window.start}..${window.end}:`, err.message)
    await sendAlert(`Weekly KPI digest FAILED (${window.start}..${window.end}): ${err.message}`)
      .catch(() => {})
    return { status: 'failed', window, reason: err.message }
  }
}

function start() {
  if (process.env[ENABLED_ENV] !== 'true') {
    console.log(`[KpiDigest] disabled (set ${ENABLED_ENV}=true to enable weekly cron)`)
    return
  }
  cron.schedule(CRON, () => {
    runWeekly().catch((e) => console.error('[KpiDigest] weekly cron failed:', e.message))
  }, { timezone: TZ })
  console.log('[KpiDigest] weekly cron registered (Mon 8am PT)')
}

module.exports = { runWeekly, start }
