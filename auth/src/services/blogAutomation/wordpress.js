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
  if (cr.ok) return (await cr.json()).id
  // The term may already exist even though our search did not surface it (WP search
  // is fuzzy/paginated). WP rejects the duplicate with term_exists and returns the
  // existing id - use it instead of failing the whole post.
  const errBody = await cr.json().catch(() => ({}))
  if (errBody.code === 'term_exists') {
    const existingId = errBody.data?.term_id ?? (Array.isArray(errBody.additional_data) ? errBody.additional_data[0] : null)
    if (existingId) return existingId
  }
  throw new Error(`WP ${kind} create ${cr.status}: ${JSON.stringify(errBody)}`)
}
const getOrCreateTag = (name, deps) => getOrCreateTerm('tags', name, deps)
const getOrCreateCategory = (name, deps) => getOrCreateTerm('categories', name, deps)

async function uploadMedia(buffer, meta, slug, altText, deps = {}) {
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
  const id = (await res.json()).id
  // Set alt text for accessibility + image SEO. The media library title is just a
  // camera filename, so the post title is the best available description. Non-fatal:
  // the image is already uploaded, so a failure here must not abort the post.
  if (altText) {
    try {
      const ar = await f(`${WP_API_BASE}/media/${id}`, {
        method: 'POST', headers: jsonHeaders(), body: JSON.stringify({ alt_text: altText }),
      })
      if (!ar.ok) console.warn(`[Blog] media alt_text update ${ar.status}`)
    } catch (e) { console.warn('[Blog] media alt_text update failed (continuing):', e.message) }
  }
  return id
}

async function publishPost({ post, location, image }, deps = {}) {
  const f = deps.fetch || fetch
  const tagId = await getOrCreateTag(post.categoryLabel || location.wpCategory, deps)
  const categoryId = await getOrCreateCategory(location.wpCategory, deps)
  let mediaId = null
  if (image && image.buffer) {
    try { mediaId = await uploadMedia(image.buffer, image, post.slug, post.title, deps) }
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
