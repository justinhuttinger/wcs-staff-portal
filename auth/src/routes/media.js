// auth/src/routes/media.js
// Media Library: semantic search over the indexed Drive media folder.
// Gated to corporate/marketing/admin (requireRole('corporate') covers all three
// in the role hierarchy). Thumbnails are proxied because the Drive folder is
// private and <img> can't send a Bearer token directly.
const { Router } = require('express')
const { Readable } = require('stream')
const { supabaseAdmin } = require('../services/supabase')
const authenticate = require('../middleware/auth')
const { requireRole } = require('../middleware/role')
const { getAccessToken } = require('./googleBusiness')
const { embedQuery } = require('../services/voyageQuery')

const router = Router()
router.use(authenticate)
router.use(requireRole('corporate'))

const DRIVE_FILES = 'https://www.googleapis.com/drive/v3/files'

// POST /media/search { query, location?, kind?, limit? }
router.post('/search', async (req, res) => {
  try {
    const query = String(req.body.query || '').trim()
    if (!query) return res.status(400).json({ error: 'query required' })
    const limit = Math.min(Number(req.body.limit) || 40, 100)
    const filterLocation = req.body.location ? String(req.body.location) : null
    const filterKind = req.body.kind === 'image' || req.body.kind === 'video' ? req.body.kind : null

    const embedding = await embedQuery(query)
    const { data, error } = await supabaseAdmin.rpc('match_media_embeddings', {
      query_embedding: JSON.stringify(embedding), // pgvector accepts '[...]' text
      match_count: limit,
      filter_location: filterLocation,
      filter_kind: filterKind,
    })
    if (error) throw error
    res.json({ results: data || [] })
  } catch (err) {
    console.error('[Media] search error:', err.message)
    res.status(500).json({ error: err.message })
  }
})

// GET /media/thumbnail/:driveFileId -- authenticated proxy for a Drive thumbnail.
router.get('/thumbnail/:driveFileId', async (req, res) => {
  try {
    const id = req.params.driveFileId
    const token = await getAccessToken()
    const meta = await fetch(`${DRIVE_FILES}/${id}?fields=thumbnailLink&supportsAllDrives=true`, {
      headers: { Authorization: 'Bearer ' + token },
    }).then((r) => r.json())
    let upstream
    if (meta.thumbnailLink) {
      upstream = await fetch(meta.thumbnailLink.replace(/=s\d+$/, '=s640'), { headers: { Authorization: 'Bearer ' + token } })
    }
    if (!upstream || !upstream.ok) {
      upstream = await fetch(`${DRIVE_FILES}/${id}?alt=media&supportsAllDrives=true`, { headers: { Authorization: 'Bearer ' + token } })
    }
    if (!upstream.ok) return res.status(404).end()
    res.set('Content-Type', upstream.headers.get('content-type') || 'image/jpeg')
    res.set('Cache-Control', 'private, max-age=86400')
    const buf = Buffer.from(await upstream.arrayBuffer())
    res.send(buf)
  } catch (err) {
    console.error('[Media] thumbnail error:', err.message)
    res.status(500).end()
  }
})

// GET /media/download/:driveFileId -- stream the original file as an attachment.
router.get('/download/:driveFileId', async (req, res) => {
  try {
    const id = req.params.driveFileId
    const token = await getAccessToken()
    const meta = await fetch(`${DRIVE_FILES}/${id}?fields=name,mimeType&supportsAllDrives=true`, {
      headers: { Authorization: 'Bearer ' + token },
    }).then((r) => r.json())
    const upstream = await fetch(`${DRIVE_FILES}/${id}?alt=media&supportsAllDrives=true`, {
      headers: { Authorization: 'Bearer ' + token },
    })
    if (!upstream.ok || !upstream.body) return res.status(upstream.status || 404).end()
    const name = (meta.name || 'media').replace(/[\r\n"]/g, '')
    res.set('Content-Type', meta.mimeType || upstream.headers.get('content-type') || 'application/octet-stream')
    res.set('Content-Disposition', `attachment; filename="${name}"`)
    // Stream so large videos don't buffer in memory.
    Readable.fromWeb(upstream.body).pipe(res)
  } catch (err) {
    console.error('[Media] download error:', err.message)
    if (!res.headersSent) res.status(500).end()
  }
})

// POST /media/reindex -- admin only; proxies to the ghl-sync worker.
router.post('/reindex', requireRole('admin'), async (req, res) => {
  try {
    const base = process.env.GHL_SYNC_URL
    if (!base) return res.status(503).json({ error: 'GHL_SYNC_URL not configured' })
    const r = await fetch(base.replace(/\/$/, '') + '/api/media/reindex', {
      method: 'POST', headers: { 'x-sync-secret': process.env.SYNC_SECRET || '' },
    })
    const data = await r.json().catch(() => ({}))
    res.status(r.status).json(data)
  } catch (err) {
    console.error('[Media] reindex proxy error:', err.message)
    res.status(500).json({ error: err.message })
  }
})

module.exports = router
