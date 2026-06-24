'use strict'
const { embedQuery: realEmbed } = require('../voyageQuery')
const { supabaseAdmin } = require('../supabase')
const { getAccessToken } = require('../../routes/googleBusiness')

const DRIVE_FILES = 'https://www.googleapis.com/drive/v3/files'

// Pick the best-matching indexed image for a location. Returns null on any
// failure (no photo is non-fatal - the post still publishes without one).
async function pickPhoto({ location, queryText }, deps = {}) {
  const embedQuery = deps.embedQuery || realEmbed
  const rpc = deps.rpc || ((fn, args) => supabaseAdmin.rpc(fn, args))
  try {
    const embedding = await embedQuery(queryText)
    const { data, error } = await rpc('match_media_embeddings', {
      query_embedding: JSON.stringify(embedding),
      match_count: 5, filter_location: location, filter_kind: 'image',
    })
    if (error) throw error
    if (!data || !data.length) return null
    const top = data[0]
    return { assetId: top.asset_id, driveFileId: top.drive_file_id, similarity: top.similarity }
  } catch (e) {
    console.warn('[Blog] photo pick failed:', e.message)
    return null
  }
}

async function downloadPhoto(driveFileId, deps = {}) {
  const token = deps.token || await getAccessToken()
  const fetchFn = deps.fetch || fetch
  const meta = await fetchFn(`${DRIVE_FILES}/${driveFileId}?fields=name,mimeType&supportsAllDrives=true`,
    { headers: { Authorization: 'Bearer ' + token } }).then(r => r.json())
  const res = await fetchFn(`${DRIVE_FILES}/${driveFileId}?alt=media&supportsAllDrives=true`,
    { headers: { Authorization: 'Bearer ' + token } })
  if (!res.ok) throw new Error(`Drive download failed: ${res.status}`)
  const buffer = Buffer.from(await res.arrayBuffer())
  return { buffer, mimeType: meta.mimeType || res.headers.get('content-type') || 'image/jpeg', filename: meta.name || `${driveFileId}.jpg` }
}

module.exports = { pickPhoto, downloadPhoto }
