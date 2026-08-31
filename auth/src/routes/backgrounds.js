// auth/src/routes/backgrounds.js
// Home-screen background images: each user's own uploads plus an admin-managed
// shared gallery.
//
// Storage layout in the private `portal-backgrounds` bucket:
//   {staff_id}/{uuid}.{ext}   a personal upload
//   shared/{uuid}.{ext}       the admin gallery
//
// staff_id ALWAYS comes from the token, never from the body, so one person can
// neither write nor delete another's image. That is the same rule
// uiPreferences.js states for the prefs row.
//
// The bucket is private and images are served by 1-hour signed URL. They are
// staff-uploaded photos of the inside of a gym; they should not be reachable
// by URL alone.
const { Router } = require('express')
const crypto = require('crypto')
const multer = require('multer')
const { supabaseAdmin } = require('../services/supabase')
const authenticate = require('../middleware/auth')
const { requireRole } = require('../middleware/role')
const {
  MAX_UPLOAD_BYTES, MAX_PER_USER, ID_RE, isAllowedMime, extForMime, toPrune,
} = require('./backgroundsHelpers')

const router = Router()
router.use(authenticate)

const BUCKET = 'portal-backgrounds'
const SHARED = 'shared'
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: MAX_UPLOAD_BYTES } })

let bucketReady = false
async function ensureBucket() {
  if (bucketReady) return
  const { error } = await supabaseAdmin.storage.createBucket(BUCKET, { public: false, fileSizeLimit: '5MB' })
  if (error && !/exist/i.test(error.message || '')) throw error
  bucketReady = true
}

function uploadSingle(req, res, next) {
  upload.single('file')(req, res, (err) => {
    if (err) {
      const tooBig = err.code === 'LIMIT_FILE_SIZE'
      return res.status(tooBig ? 413 : 400).json({ error: tooBig ? 'Image exceeds the 5 MB limit' : 'Upload failed' })
    }
    next()
  })
}

async function listFolder(prefix) {
  const { data, error } = await supabaseAdmin.storage.from(BUCKET).list(prefix, { limit: 100 })
  if (error) throw error
  return (data || []).filter(f => f.name && !f.name.startsWith('.'))
}

async function signed(prefix, name) {
  const { data } = await supabaseAdmin.storage.from(BUCKET)
    .createSignedUrl(`${prefix}/${name}`, 60 * 60)
  return data?.signedUrl || null
}

async function withUrls(prefix, files) {
  const withMaybeUrls = await Promise.all(
    files.map(async f => ({ id: f.name, url: await signed(prefix, f.name) })),
  )
  // A signing failure should just drop the image from the list, not hand the
  // client a null url it would put straight into a CSS url(...).
  return withMaybeUrls.filter(f => f.url)
}

// GET /backgrounds — this user's uploads plus the shared gallery.
router.get('/', async (req, res) => {
  try {
    await ensureBucket()
    const [mine, shared] = await Promise.all([listFolder(req.staff.id), listFolder(SHARED)])
    res.json({
      mine: await withUrls(req.staff.id, mine),
      shared: await withUrls(SHARED, shared),
      maxPerUser: MAX_PER_USER,
    })
  } catch (err) {
    console.error('[backgrounds] list failed:', err.message)
    res.status(500).json({ error: 'Could not load backgrounds' })
  }
})

async function store(prefix, req, res) {
  if (!req.file) return res.status(400).json({ error: 'No file uploaded' })
  // Trust the sniffed mime, not the filename: the extension is derived from it
  // and the filename is never used to build the path.
  if (!isAllowedMime(req.file.mimetype)) {
    return res.status(400).json({ error: 'Only JPEG, PNG and WebP images are accepted' })
  }
  await ensureBucket()

  // Prune AFTER a successful upload, not before: pruning first and then
  // having the upload throw would cost the user an image for nothing.
  const existing = prefix !== SHARED ? await listFolder(prefix) : []

  const name = `${crypto.randomUUID()}.${extForMime(req.file.mimetype)}`
  const { error } = await supabaseAdmin.storage.from(BUCKET)
    .upload(`${prefix}/${name}`, req.file.buffer, { contentType: req.file.mimetype, upsert: false })
  if (error) throw error

  if (prefix !== SHARED) {
    for (const oldName of toPrune(existing, MAX_PER_USER)) {
      await supabaseAdmin.storage.from(BUCKET).remove([`${prefix}/${oldName}`])
    }
  }

  res.status(201).json({ image: { id: name, url: await signed(prefix, name) } })
}

// POST /backgrounds — a personal upload.
router.post('/', uploadSingle, async (req, res) => {
  try {
    await store(req.staff.id, req, res)
  } catch (err) {
    console.error('[backgrounds] upload failed:', err.message)
    res.status(500).json({ error: 'Upload failed' })
  }
})

// POST /backgrounds/shared — admin only, into the gallery.
router.post('/shared', requireRole('admin'), uploadSingle, async (req, res) => {
  try {
    await store(SHARED, req, res)
  } catch (err) {
    console.error('[backgrounds] shared upload failed:', err.message)
    res.status(500).json({ error: 'Upload failed' })
  }
})

async function destroy(prefix, req, res) {
  if (!ID_RE.test(req.params.id || '')) return res.status(400).json({ error: 'Bad image id' })
  const { error } = await supabaseAdmin.storage.from(BUCKET).remove([`${prefix}/${req.params.id}`])
  if (error) throw error
  res.json({ ok: true })
}

// DELETE /backgrounds/shared/:id — admin only. Declared BEFORE /:id so that
// "shared" is never matched as an image id.
router.delete('/shared/:id', requireRole('admin'), async (req, res) => {
  try {
    await destroy(SHARED, req, res)
  } catch (err) {
    console.error('[backgrounds] shared delete failed:', err.message)
    res.status(500).json({ error: 'Delete failed' })
  }
})

// DELETE /backgrounds/:id — own folder only; the prefix comes from the token.
router.delete('/:id', async (req, res) => {
  try {
    await destroy(req.staff.id, req, res)
  } catch (err) {
    console.error('[backgrounds] delete failed:', err.message)
    res.status(500).json({ error: 'Delete failed' })
  }
})

module.exports = router
