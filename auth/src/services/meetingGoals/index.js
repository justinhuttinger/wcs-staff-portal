// auth/src/services/meetingGoals/index.js
// Weekly meeting goals: collect submitted MC/PT Weekly Meeting action plans and
// republish each club's knowledge article. Feature-flagged cron plus a runnable
// function for the admin route, mirroring the kpiDigest service shape.
'use strict'

const cron = require('node-cron')
const { collect, knownArticles } = require('./collect')
const { publishAll } = require('./publish')
const { CRON, TZ, ENABLED_ENV } = require('./config')
const { sendAlert } = require('../blogAutomation/alerts')

let running = false

// Collect then publish. Never throws; returns a status object.
//
// `kind`/`club` force one article to republish even when unchanged is not
// implied — used by the admin route to repair an article edited by hand.
async function runGoals({ kind = null, club = null, all = false } = {}) {
  if (running) return { status: 'skipped', reason: 'already running' }
  running = true
  try {
    const collected = await collect()

    let targets
    if (kind && club) {
      targets = [{ kind, location_slug: club }]
    } else if (all) {
      targets = await knownArticles()
    } else {
      targets = collected.touched.map((key) => {
        const [k, slug] = key.split(':')
        return { kind: k, location_slug: slug }
      })
    }

    if (targets.length === 0) {
      return { status: 'ok', entries: collected.entries, results: [] }
    }

    const results = await publishAll(targets)
    const failed = results.filter((r) => r.status === 'failed')
    const published = results.filter((r) => r.status === 'published')
    console.log(`[MeetingGoals] ${collected.entries} entries,`
      + ` ${published.length} published, ${failed.length} failed`)
    if (failed.length) {
      await sendAlert(`Meeting goals: ${failed.length} article(s) failed — `
        + failed.map((f) => `${f.kind}/${f.slug}: ${f.reason}`).join('; ')).catch(() => {})
    }
    return { status: failed.length ? 'partial' : 'ok', entries: collected.entries, results }
  } catch (err) {
    console.error('[MeetingGoals] run failed:', err.message)
    await sendAlert(`Meeting goals run FAILED: ${err.message}`).catch(() => {})
    return { status: 'failed', reason: err.message }
  } finally {
    running = false
  }
}

function start() {
  if (process.env[ENABLED_ENV] !== 'true') {
    console.log(`[MeetingGoals] disabled (set ${ENABLED_ENV}=true to enable)`)
    return
  }
  cron.schedule(CRON, () => {
    runGoals().catch((e) => console.error('[MeetingGoals] cron failed:', e.message))
  }, { timezone: TZ })
  console.log('[MeetingGoals] cron registered (5/20/35/50 past the hour)')
}

module.exports = { runGoals, start }
