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
// Embed at most this many images per Voyage call. Kept modest so a batch's
// base64 payloads don't spike memory on the shared instance.
const PHOTO_BATCH = Number(process.env.MEDIA_PHOTO_BATCH || 25)
// How many photos to fetch/prep at once. Bounded so the backfill stays a good
// citizen alongside the other ghl-sync jobs and keeps peak memory low.
const PREP_CONCURRENCY = Number(process.env.MEDIA_PREP_CONCURRENCY || 4)
// Cap how many files a single run embeds. A large backlog (e.g. a fresh folder
// or a big drop) otherwise keeps the run grinding for ~an hour, holding an
// elevated resident-memory plateau the whole time. On the 512MB starter
// instance that plateau erases the headroom the :00/:30 delta + ABC sync bursts
// need, and the combination OOM-kills the service. Bounding the run keeps each
// pass short and low-memory; the remainder is picked up by the next daily run
// (toEmbed is recomputed from the Drive-vs-DB diff, so embedded files don't
// recur). Set to 0 to disable the cap.
const MAX_PER_RUN = Number(process.env.MEDIA_MAX_PER_RUN || 800)

let running = false

// Map fn over items with at most `limit` concurrent workers, preserving order.
async function mapLimit(items, limit, fn) {
  const results = new Array(items.length)
  let next = 0
  const worker = async () => {
    while (next < items.length) {
      const i = next++
      results[i] = await fn(items[i], i)
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker))
  return results
}

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
    const prepared = await mapLimit(batch, PREP_CONCURRENCY, async (f) => {
      try { return { f, prepped: await preparePhoto(f) } }
      catch (e) { stats.errors++; await markError(f, e); return null }
    })
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
  let frameDir
  try {
    const { dir, frames } = await sampleFrames(tmp, FRAME_INTERVAL)
    frameDir = dir
    if (!frames.length) return 0
    const assetId = await upsertAsset(file)
    // Embed frames in batches; read each frame from disk just-in-time so we
    // never hold every frame buffer of a long video in memory at once.
    for (let i = 0; i < frames.length; i += PHOTO_BATCH) {
      const slice = frames.slice(i, i + PHOTO_BATCH)
      const inputs = []
      for (const fr of slice) inputs.push(await toEmbedInput(fs.readFileSync(fr.path)))
      const vecs = await embedMultimodal(inputs, 'document')
      const rows = vecs.map((v, k) => ({ asset_id: assetId, embedding: v, frame_time_seconds: slice[k].timeSeconds }))
      await supabase.from('media_embeddings').insert(rows)
    }
    return 1
  } finally {
    if (frameDir) fs.rmSync(frameDir, { recursive: true, force: true })
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

// Walk Drive + diff against the DB to decide what needs (re)embedding and what
// to prune. Kept in its own scope so the full Drive tree and the entire
// media_assets row set become garbage-collectable before the long embedding
// loop runs — they're only needed to compute the diff, not to embed.
async function planMediaIndex() {
  const root = process.env.MEDIA_ROOT_FOLDER_ID
  if (!root) throw new Error('MEDIA_ROOT_FOLDER_ID not set')
  const drive = await walkMediaTree(root)
  const { data: dbRows, error } = await supabase.from('media_assets').select('drive_file_id, md5, drive_modified_time, status')
  if (error) throw error
  return diffDriveVsDb(drive, dbRows || [])
}

async function runMediaIndex() {
  if (running) return { skipped: true }
  running = true
  const stats = { embedded: 0, deleted: 0, errors: 0 }
  try {
    const { toEmbed, toDelete } = await planMediaIndex()

    // Process deletes first (cheap — just IDs) and always in full, so prunes
    // never get starved by the embed cap.
    if (toDelete.length) {
      const ids = toDelete.map((r) => r.drive_file_id)
      await supabase.from('media_assets').delete().in('drive_file_id', ids)
      stats.deleted = ids.length
    }

    const capped = MAX_PER_RUN > 0 && toEmbed.length > MAX_PER_RUN
    const batch = capped ? toEmbed.slice(0, MAX_PER_RUN) : toEmbed
    const photos = batch.filter((f) => f.kind === 'image')
    const videos = batch.filter((f) => f.kind === 'video')
    const deferred = toEmbed.length - batch.length
    console.log(`[MediaIndex] toEmbed=${toEmbed.length} (img=${photos.length} vid=${videos.length}) toDelete=${toDelete.length}${deferred ? ` deferred=${deferred} (cap ${MAX_PER_RUN}/run)` : ''}`)

    stats.embedded += await indexPhotos(photos, stats)
    for (const v of videos) {
      try { stats.embedded += await indexVideo(v) } catch (e) { stats.errors++; await markError(v, e) }
    }
    console.log('[MediaIndex] done', { ...stats, deferred })
    return stats
  } finally {
    running = false
  }
}

module.exports = { runMediaIndex }
