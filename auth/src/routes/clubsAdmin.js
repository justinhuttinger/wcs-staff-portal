/**
 * /admin/clubs — add and edit clubs from the portal (Admin -> Clubs).
 *
 * public.clubs is the club list every service loads at boot. Creating a club
 * here also creates what a club needs around it, so nothing is set up by hand:
 *   - public.club_secrets: GHL token + Paychex company id, encrypted
 *   - locations row (staff, tiles, tours, forms and tickets hang off its id)
 *   - Action Links (Day One + VIP) with the standard per-club URLs
 *   - club_integrations row (Admin -> Club Integrations edits its webhooks)
 * then restarts the services that read the list at boot (services/renderRestart).
 *
 * GET  /             every club from the database, with which credentials are set
 * POST /             create a club
 * PUT  /:clubNumber  edit a club (name, slug and club number are fixed)
 * POST /:clubNumber/photo  upload the club's photo (portal background)
 */
const { Router } = require('express')
const multer = require('multer')
const { supabaseAdmin } = require('../services/supabase')
const authenticate = require('../middleware/auth')
const { requireRole } = require('../middleware/role')
const { encrypt } = require('../utils/crypto')
const { rowToClub } = require('../config/loadClubs')
const { ALL_CLUBS } = require('../config/clubs')
const { validateClubInput, defaultActionLinks } = require('../lib/clubInput')
const { restartClubServices, canRestart } = require('../services/renderRestart')

const router = Router()
router.use(authenticate)
router.use(requireRole('admin'))

const CLUB_COLUMNS = 'club_number, slug, name, sort_order, active, env_key, ghl_location_id, state, timezone, abc_url, background, trading_name, updated_at'

async function readClubs() {
  const { data, error } = await supabaseAdmin.from('clubs').select(CLUB_COLUMNS).order('sort_order')
  if (error) throw error
  return data || []
}

async function readSecretFlags() {
  const { data, error } = await supabaseAdmin.from('club_secrets').select('club_number, ghl_api_key_enc, paychex_company_id_enc')
  if (error) throw error
  return new Map((data || []).map(r => [r.club_number, { ghl: !!r.ghl_api_key_enc, paychex: !!r.paychex_company_id_enc }]))
}

// What the admin screen needs per club. Never returns a secret, only whether
// one is set and whether a Render env var overrides it.
function describe(row, flags) {
  const club = rowToClub(row)
  const f = flags.get(row.club_number) || {}
  return {
    ...club,
    sortOrder: row.sort_order,
    updatedAt: row.updated_at,
    credentials: {
      ghlToken: f.ghl ? 'saved' : process.env[`GHL_API_KEY_${club.envKey}`] ? 'env' : 'missing',
      paychexCompany: f.paychex ? 'saved' : process.env[`PAYCHEX_COMPANY_${club.envKey}`] ? 'env' : 'missing',
    },
    // False for a club saved since this service last booted: it is not in the
    // running list yet (the restart after a save fixes that).
    loaded: ALL_CLUBS.some(c => c.clubNumber === club.clubNumber),
  }
}

async function saveSecrets(clubNumber, secrets, staffId) {
  const patch = {}
  if (secrets.ghlApiKey) patch.ghl_api_key_enc = encrypt(secrets.ghlApiKey)
  if (secrets.paychexCompanyId) patch.paychex_company_id_enc = encrypt(secrets.paychexCompanyId)
  if (!Object.keys(patch).length) return
  const { error } = await supabaseAdmin.from('club_secrets').upsert(
    { club_number: clubNumber, ...patch, updated_at: new Date().toISOString(), updated_by: staffId || null },
    { onConflict: 'club_number' },
  )
  if (error) throw error
}

// The locations row the rest of the portal keys on. Matched by name (that is
// how every existing reader finds it). tours/webhooks read ghl_api_key from it.
async function upsertLocation(row, secrets) {
  const { data: found, error } = await supabaseAdmin.from('locations').select('id').ilike('name', row.name).maybeSingle()
  if (error) throw error
  const fields = { abc_url: row.abc_url || '', ghl_location_id: row.ghl_location_id }
  if (secrets.ghlApiKey) fields.ghl_api_key = secrets.ghlApiKey
  if (found) {
    const { error: e } = await supabaseAdmin.from('locations').update(fields).eq('id', found.id)
    if (e) throw e
  } else {
    const { error: e } = await supabaseAdmin.from('locations').insert({ name: row.name, ...fields })
    if (e) throw e
  }
}

// Only fills gaps: an Action Link someone already set is never overwritten.
async function ensureActionLinks(slug) {
  const links = defaultActionLinks(slug)
  const { data, error } = await supabaseAdmin.from('app_config').select('key').in('key', Object.keys(links))
  if (error) throw error
  const have = new Set((data || []).map(r => r.key))
  const missing = Object.entries(links).filter(([k]) => !have.has(k))
    .map(([key, value]) => ({ key, value, updated_at: new Date().toISOString() }))
  if (missing.length) {
    const { error: e } = await supabaseAdmin.from('app_config').insert(missing)
    if (e) throw e
  }
}

async function ensureClubIntegrations(row) {
  const { error } = await supabaseAdmin.from('club_integrations').upsert(
    { abc_club_number: row.club_number, location_slug: row.slug, display_name: row.name },
    { onConflict: 'abc_club_number', ignoreDuplicates: true },
  )
  if (error) throw error
}

// defer: the portal is about to upload a photo for this club, and that request
// does the restart, so the two do not race.
function afterSave(res, payload, { defer = false } = {}) {
  if (defer) return res.json({ ...payload, restart: { status: 'deferred', message: 'Saved.' } })
  const restart = canRestart()
    ? { status: 'restarting', message: 'The portal services are restarting to pick this up (about 2 minutes).' }
    : { status: 'manual', message: 'Saved. Restart wcs-auth-api and ghl-sync in Render to apply it (auto-restart is not configured).' }
  res.json({ ...payload, restart })
  if (canRestart()) {
    // After the response: this service is one of the ones restarting.
    setTimeout(() => {
      restartClubServices().catch(err => console.error('[clubs] restart failed:', err.message))
    }, 500).unref()
  }
}

router.get('/', async (req, res) => {
  try {
    const [rows, flags] = await Promise.all([readClubs(), readSecretFlags()])
    res.json({ clubs: rows.map(r => describe(r, flags)), autoRestart: canRestart() })
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

router.post('/', async (req, res) => {
  try {
    const rows = await readClubs()
    const existing = rows.map(rowToClub)
    const { errors, row, secrets } = validateClubInput(req.body, existing)
    if (errors.length) return res.status(400).json({ error: errors.join(' '), errors })

    const sortOrder = rows.reduce((m, r) => Math.max(m, r.sort_order || 0), 0) + 1
    const { error } = await supabaseAdmin.from('clubs').insert({ ...row, sort_order: sortOrder, updated_at: new Date().toISOString() })
    if (error) throw error

    await saveSecrets(row.club_number, secrets, req.staff?.id)
    await upsertLocation(row, secrets)
    await ensureActionLinks(row.slug)
    await ensureClubIntegrations(row)

    console.log(`[clubs] created ${row.name} (${row.club_number}) by ${req.staff?.email || 'admin'}`)
    afterSave(res, { club: rowToClub({ ...row, sort_order: sortOrder }) }, { defer: req.body.deferRestart === true })
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

router.put('/:clubNumber', async (req, res) => {
  try {
    const rows = await readClubs()
    const currentRow = rows.find(r => r.club_number === String(req.params.clubNumber).replace(/^0+/, ''))
    if (!currentRow) return res.status(404).json({ error: 'Unknown club' })
    const current = rowToClub(currentRow)
    const { errors, row, secrets } = validateClubInput(req.body, rows.map(rowToClub), { current })
    if (errors.length) return res.status(400).json({ error: errors.join(' '), errors })

    const { club_number, slug, name, ...editable } = row
    const { error } = await supabaseAdmin.from('clubs')
      .update({ ...editable, updated_at: new Date().toISOString() })
      .eq('club_number', club_number)
    if (error) throw error

    await saveSecrets(club_number, secrets, req.staff?.id)
    await upsertLocation(row, secrets)
    await ensureActionLinks(slug)
    await ensureClubIntegrations(row)

    console.log(`[clubs] updated ${name} (${club_number}) by ${req.staff?.email || 'admin'}`)
    afterSave(res, { club: rowToClub({ ...currentRow, ...editable }) }, { defer: req.body.deferRestart === true })
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

// Club photo (the portal background for the club). Public bucket: the photo is
// shown on the sign-in screen before anyone is signed in.
const PHOTO_BUCKET = 'club-photos'
const PHOTO_TYPES = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp' }
const PHOTO_MAX = 5 * 1024 * 1024
const photoUpload = multer({ limits: { fileSize: PHOTO_MAX, files: 1 } })

let photoBucketReady = false
async function ensurePhotoBucket() {
  if (photoBucketReady) return
  const { error } = await supabaseAdmin.storage.createBucket(PHOTO_BUCKET, {
    public: true,
    fileSizeLimit: '5MB',
    allowedMimeTypes: Object.keys(PHOTO_TYPES),
  })
  if (error && !/exist/i.test(error.message || '')) throw error
  photoBucketReady = true
}

// POST /admin/clubs/:clubNumber/photo  (multipart: file)
router.post('/:clubNumber/photo', (req, res, next) => {
  photoUpload.single('file')(req, res, err => {
    if (err) return res.status(400).json({ error: err.code === 'LIMIT_FILE_SIZE' ? 'Photo must be under 5 MB.' : err.message })
    next()
  })
}, async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'No photo was uploaded.' })
    const ext = PHOTO_TYPES[req.file.mimetype]
    if (!ext) return res.status(400).json({ error: 'Photo must be a JPG, PNG or WebP.' })

    const rows = await readClubs()
    const row = rows.find(r => r.club_number === String(req.params.clubNumber).replace(/^0+/, ''))
    if (!row) return res.status(404).json({ error: 'Unknown club' })

    await ensurePhotoBucket()
    const path = `${row.slug}-${Date.now()}.${ext}`
    const { error: upErr } = await supabaseAdmin.storage.from(PHOTO_BUCKET)
      .upload(path, req.file.buffer, { contentType: req.file.mimetype, upsert: false })
    if (upErr) throw upErr
    const url = supabaseAdmin.storage.from(PHOTO_BUCKET).getPublicUrl(path)?.data?.publicUrl
    if (!url) throw new Error('Storage did not return a public URL')

    const { error } = await supabaseAdmin.from('clubs')
      .update({ background: url, updated_at: new Date().toISOString() })
      .eq('club_number', row.club_number)
    if (error) throw error

    afterSave(res, { club: rowToClub({ ...row, background: url }) })
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

module.exports = router
module.exports._test = { describe }
