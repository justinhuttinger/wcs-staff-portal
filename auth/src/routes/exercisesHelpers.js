// Pure helpers for routes/exercises.js, split out so they test without
// Supabase (same pattern as backgroundsHelpers).
const { MUSCLES, nameKey } = require('../lib/exerciseLibrary')

// YMove signs video URLs for 48h; holding one for 24h saves video minutes and
// leaves a full day of margin before it would expire mid-workout.
const VIDEO_CACHE_MS = 24 * 60 * 60 * 1000

const clean = (v, max = 200) => (v == null ? '' : String(v).trim().slice(0, max))
const cleanList = (list, max = 500) => (Array.isArray(list) ? list.map(v => clean(v, max)).filter(Boolean).slice(0, 30) : [])

/** ilike pattern for a library search; LIKE wildcards in the input are literal. */
function searchPattern(q) {
  const words = clean(q, 100).split(/\s+/).filter(Boolean)
  if (!words.length) return null
  const esc = words.map(w => w.replace(/[\\%_]/g, c => `\\${c}`))
  return `%${esc.join('%')}%`
}

/** Validate a trainer-made exercise. Returns { row } or { error }. */
function validateCustom(body = {}) {
  const name = clean(body.name, 120)
  if (!name) return { error: 'Give the exercise a name.' }
  const primary = clean(body.primary_muscle).toLowerCase()
  if (!MUSCLES.includes(primary)) return { error: 'Pick the main muscle it works.' }
  const secondary = cleanList(body.secondary_muscles).map(m => m.toLowerCase())
    .filter(m => MUSCLES.includes(m) && m !== primary)
  return {
    row: {
      name,
      name_key: nameKey(name),
      primary_muscle: primary,
      secondary_muscles: [...new Set(secondary)],
      equipment: clean(body.equipment, 60).toLowerCase() || null,
      instructions: cleanList(body.instructions),
      cues: cleanList(body.cues),
    },
  }
}

/**
 * Library rows from a vendor are read-only. A custom exercise can be edited by
 * whoever made it, or by a manager+ (it may sit in other trainers' programs).
 */
const canEdit = (row, { actor, isManager }) =>
  row?.source === 'custom' && (isManager || (!!actor && row.created_by === actor))

/**
 * Resolves a playable video for a library row, or null when there is none
 * (free rows, ymove rows before the key exists, custom rows without a clip).
 */
function createVideoResolver({ client, now = Date.now }) {
  const cache = new Map()
  return async function resolve(row) {
    if (row.source === 'custom') {
      return row.video_url ? { videoUrl: row.video_url, hlsUrl: null, thumbnailUrl: row.thumbnail_url || null, durationSecs: null } : null
    }
    if (row.source !== 'ymove' || !client.isConfigured()) return null
    const hit = cache.get(row.id)
    if (hit && now() - hit.at < VIDEO_CACHE_MS) return hit.video
    const video = await client.getExerciseVideo(row.source_id)
    if (!video?.videoUrl && !video?.hlsUrl) return null
    cache.set(row.id, { at: now(), video })
    return video
  }
}

module.exports = { VIDEO_CACHE_MS, searchPattern, validateCustom, canEdit, createVideoResolver }
