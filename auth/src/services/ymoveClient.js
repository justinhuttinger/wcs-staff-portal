// auth/src/services/ymoveClient.js
// Thin client for the YMove Exercise API (https://exercise-api.ymove.app).
// The key stays server-side; nothing here is reachable from a browser except
// through /exercises routes. Everything is a no-op until YMOVE_API_KEY is set.
//
// Video URLs YMove returns are pre-signed and expire after 48h, so they are
// fetched at play time (getExerciseVideo) and never written to the database.

const BASE = 'https://exercise-api.ymove.app/api/v2'
const PAGE_SIZE = 50 // YMove's maximum

const isConfigured = () => !!process.env.YMOVE_API_KEY

async function call(path, params, fetchImpl) {
  const url = new URL(BASE + path)
  for (const [k, v] of Object.entries(params || {})) url.searchParams.set(k, String(v))
  const res = await fetchImpl(url.toString(), { headers: { 'X-API-Key': process.env.YMOVE_API_KEY, Accept: 'application/json' } })
  const body = await res.json().catch(() => ({}))
  if (!res.ok) {
    const retry = body.retryAfterMs ? ` (retry after ${body.retryAfterMs}ms)` : ''
    throw new Error(`YMove ${res.status}: ${body.error || 'request failed'}${retry}`)
  }
  return body
}

// The list wrapper key is not pinned down in the public docs; accept the
// likely shapes so first contact with the real API does not need a deploy.
const itemsOf = (body) => body.data || body.exercises || body.items || []

/**
 * Every exercise's metadata, all pages. excludeVideos=1 keeps this off the
 * video-minute meter. Throws on the first failed page, so a caller never acts
 * on a partial list.
 */
async function listAllExercises({ fetchImpl = fetch } = {}) {
  const all = []
  // Hard stop well past the ~1,400-exercise catalogue, in case a response
  // never signals its last page.
  for (let page = 1; page <= 200; page++) {
    const body = await call('/exercises', { excludeVideos: 1, pageSize: PAGE_SIZE, page }, fetchImpl)
    const items = itemsOf(body)
    // An empty first page means we misread the response, not an empty
    // catalogue; failing loudly beats a sync that "succeeds" with nothing.
    if (page === 1 && !items.length) throw new Error('YMove returned no exercises (unexpected response shape?)')
    all.push(...items)
    const totalPages = body.pagination?.totalPages
    if (totalPages != null ? page >= totalPages : items.length < PAGE_SIZE) break
  }
  return all
}

/** A fresh signed video for one exercise (counts against video minutes). */
async function getExerciseVideo(sourceId, { fetchImpl = fetch } = {}) {
  const body = await call(`/exercises/${encodeURIComponent(sourceId)}`, {}, fetchImpl)
  const ex = body.data || body.exercise || body
  const primary = (ex.videos || []).find(v => v.isPrimary) || (ex.videos || [])[0] || {}
  return {
    videoUrl: primary.videoUrl || ex.videoUrl || null,
    hlsUrl: primary.videoHlsUrl || ex.videoHlsUrl || null,
    thumbnailUrl: primary.thumbnailUrl || ex.thumbnailUrl || null,
    durationSecs: ex.videoDurationSecs ?? null,
  }
}

module.exports = { isConfigured, listAllExercises, getExerciseVideo }
