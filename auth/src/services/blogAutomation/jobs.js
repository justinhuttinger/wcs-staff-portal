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

// Heal jobs orphaned in `generating` by a mid-run process restart (a single small
// instance can OOM under concurrent manual runs). Only touches rows with a NULL
// error_message: a successful dry run is parked in `generating` WITH the
// 'test run, not published' message, so it must be left alone.
async function sweepStale(maxAgeMinutes = 15, deps = {}) {
  const db = deps.supabase || supabaseAdmin
  const cutoff = new Date(Date.now() - maxAgeMinutes * 60 * 1000).toISOString()
  const { data, error } = await db.from(T)
    .update({ status: 'failed', error_message: 'stuck in generating (likely a mid-run restart); auto-swept' })
    .eq('status', 'generating').is('error_message', null).lt('created_at', cutoff)
    .select('id')
  if (error) throw new Error(`sweepStale failed: ${error.message}`)
  return data || []
}

module.exports = {
  createJob, setStatus, attachContent, attachValidation, attachImage,
  markPublished, markFailed, markSkipped, recentTopics, recentCategories, listRecent, getById, sweepStale,
}
