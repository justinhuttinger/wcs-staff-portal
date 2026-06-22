// ghl-sync/src/media/mediaIndex.js
const fs = require('fs')
const supabase = require('../db/supabase')
const { walkMediaTree, downloadBuffer, downloadToTemp, fetchThumbnailBuffer } = require('../google/driveClient')
const { embedMultimodal } = require('./voyageClient')
const { toEmbedInput } = require('./imagePrep')
const { sampleFrames } = require('./videoFrames')
const { diffDriveVsDb } = require('./diff')
const { deriveLocation, joinFolderPath } = require('./locationPath')

const FRAME_INTERVAL = Number(process.env.MEDIA_VIDEO_FRAME_INTERVAL_SEC || 5)
const PHOTO_BATCH = 50

let running = false

async function upsertAsset(file) {
  const row = {
    drive_file_id: file.id, kind: file.kind, title: file.name, mime_type: file.mimeType,
    location: deriveLocation(file.segments), folder_path: joinFolderPath(file.segments),
    file_size: file.size, drive_modified_time: file.modifiedTime, md5: file.md5,
    web_view_link: file.webViewLink, status: 'indexed', error: null, indexed_at: new Date().toISOString(),
  }
  const { data, error } = await supabase.from('media_assets').upsert(row, { onConflict: 'drive_file_id' }).select('id').single()
  if (error) throw error
  // Replace any prior embeddings for this asset (handles re-index of changed files).
  await supabase.from('media_embeddings').delete().eq('asset_id', data.id)
  return data.id
}

// Prepare one photo for embedding. Fast path: Drive's rendered JPEG thumbnail
// (~200KB, format-agnostic — handles HEIC/HEIF, TIFF, CR2 raw without sharp
// choking). Fall back to the full original only if no thumbnail is available.
async function preparePhoto(f) {
  try {
    return await toEmbedInput(await fetchThumbnailBuffer(f.id))
  } catch (thumbErr) {
    return await toEmbedInput(await downloadBuffer(f.id))
  }
}

async function indexPhotos(photos, stats) {
  let embedded = 0
  for (let i = 0; i < photos.length; i += PHOTO_BATCH) {
    const batch = photos.slice(i, i + PHOTO_BATCH)
    // Fetch + prep the whole batch concurrently; thumbnails are small so this is
    // far faster than the prior one-at-a-time download of full-res originals.
    const prepared = await Promise.all(batch.map(async (f) => {
      try { return { f, prepped: await preparePhoto(f) } }
      catch (e) { stats.errors++; await markError(f, e); return null }
    }))
    const ok = prepared.filter(Boolean)
    if (!ok.length) continue
    const vecs = await embedMultimodal(ok.map((o) => o.prepped), 'document')
    for (let j = 0; j < ok.length; j++) {
      const assetId = await upsertAsset(ok[j].f)
      await supabase.from('media_embeddings').insert({ asset_id: assetId, embedding: vecs[j], frame_time_seconds: null })
      embedded++
    }
  }
  return embedded
}

async function indexVideo(file) {
  const tmp = await downloadToTemp(file.id)
  try {
    const frames = await sampleFrames(tmp, FRAME_INTERVAL)
    if (!frames.length) return 0
    const assetId = await upsertAsset(file)
    // Embed frames in batches of PHOTO_BATCH.
    for (let i = 0; i < frames.length; i += PHOTO_BATCH) {
      const slice = frames.slice(i, i + PHOTO_BATCH)
      const inputs = []
      for (const fr of slice) inputs.push((await toEmbedInput(fr.buffer)))
      const vecs = await embedMultimodal(inputs, 'document')
      const rows = vecs.map((v, k) => ({ asset_id: assetId, embedding: v, frame_time_seconds: slice[k].timeSeconds }))
      await supabase.from('media_embeddings').insert(rows)
    }
    return 1
  } finally {
    fs.existsSync(tmp) && fs.unlinkSync(tmp)
  }
}

async function markError(file, e) {
  console.error('[MediaIndex] failed', file.id, e.message)
  await supabase.from('media_assets').upsert(
    { drive_file_id: file.id, kind: file.kind, title: file.name, status: 'error', error: String(e.message).slice(0, 500) },
    { onConflict: 'drive_file_id' }
  )
}

async function runMediaIndex() {
  if (running) return { skipped: true }
  running = true
  const stats = { embedded: 0, deleted: 0, errors: 0 }
  try {
    const root = process.env.MEDIA_ROOT_FOLDER_ID
    if (!root) throw new Error('MEDIA_ROOT_FOLDER_ID not set')
    const drive = await walkMediaTree(root)
    const { data: dbRows, error } = await supabase.from('media_assets').select('drive_file_id, md5, drive_modified_time, status')
    if (error) throw error
    const { toEmbed, toDelete } = diffDriveVsDb(drive, dbRows || [])

    const photos = toEmbed.filter((f) => f.kind === 'image')
    const videos = toEmbed.filter((f) => f.kind === 'video')
    console.log(`[MediaIndex] toEmbed=${toEmbed.length} (img=${photos.length} vid=${videos.length}) toDelete=${toDelete.length}`)

    stats.embedded += await indexPhotos(photos, stats)
    for (const v of videos) {
      try { stats.embedded += await indexVideo(v) } catch (e) { stats.errors++; await markError(v, e) }
    }
    if (toDelete.length) {
      const ids = toDelete.map((r) => r.drive_file_id)
      await supabase.from('media_assets').delete().in('drive_file_id', ids)
      stats.deleted = ids.length
    }
    console.log('[MediaIndex] done', stats)
    return stats
  } finally {
    running = false
  }
}

module.exports = { runMediaIndex }
