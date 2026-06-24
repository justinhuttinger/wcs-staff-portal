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
