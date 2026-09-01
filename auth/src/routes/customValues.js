// Drip Campaigns — GHL Custom Values.
//
// Custom values are the sub-account-level variables that the drip SMS/email
// workflows reference as {{custom_values.some_key}}. GHL only exposes them in
// its own settings UI, one sub-account at a time, so this route gives the
// portal a single place to read and update them per club.
//
// Gated on marketing access (the same gate as the Marketing tile) rather than
// admin: anyone who can open the tile can edit the drip copy.
//
// GHL API (version 2021-07-28):
//   GET  /locations/:locationId/customValues
//   PUT  /locations/:locationId/customValues/:id   { name, value }
const { Router } = require('express')
const multer = require('multer')
const authenticate = require('../middleware/auth')
const { requireMarketing } = require('../middleware/role')
const { LOCATIONS } = require('../config/ghlLocations')
const { ghlFetch } = require('../services/ghlClient')
const { supabaseAdmin } = require('../services/supabase')
const {
  resolveTokens, smsSegments, findHiddenCharacters, normalizePhone,
  extractMergeFields, labelForField,
} = require('../lib/smsPreview')
const {
  mediaKeyFor, mediaNameFor, isMediaKey, validateMedia, formatBytes,
  mediaStoragePath, MAX_MEDIA_BYTES,
} = require('../lib/dripMedia')
const audit = require('../services/auditLog')

// app_config keys backing the test send.
const WEBHOOK_KEY = 'drip_test_webhook_url'
const DEFAULT_PHONE_KEY = 'drip_test_default_phone'
const SAMPLE_KEY = 'drip_test_sample_values'

// Planted merge-field values for a test send. A test number is not attached to
// a real contact, so without these every token would render empty and the
// preview would show a message no member will ever receive. Saved values from
// app_config layer on top; anything still missing falls back to these.
const DEFAULT_SAMPLE_VALUES = {
  'contact.first_name': 'Alex',
  'contact.last_name': 'Morgan',
  'contact.name': 'Alex Morgan',
  'contact.full_name': 'Alex Morgan',
  'contact.email': 'alex.morgan@example.com',
  'contact.phone': '(503) 555-0142',
  'contact.company_name': 'West Coast Strength',
  'contact.referred_by_full_name': 'Jamie Smith',
  'contact.referral_friend_name': 'Jamie Smith',
  'contact.vip_team_member': 'Taylor Reed',
  'contact.day_one_trainer': 'Taylor Reed',
  'contact.sale_team_member': 'Taylor Reed',
  'contact.tour_team_member': 'Taylor Reed',
}

function parseSaved(raw) {
  if (!raw) return {}
  if (typeof raw === 'object') return raw
  try {
    const v = JSON.parse(raw)
    return v && typeof v === 'object' ? v : {}
  } catch {
    return {}
  }
}

// A test send costs money and texts a real handset, so it is rate limited per
// staff member. In-memory is enough: the cap exists to stop a stuck finger or a
// loop, not a determined attacker (the route is already behind marketing auth).
const SEND_WINDOW_MS = 60_000
const SEND_MAX_PER_WINDOW = 10
const recentSends = new Map()

function tooManySends(staffId) {
  const now = Date.now()
  const key = String(staffId || 'anonymous')
  const hits = (recentSends.get(key) || []).filter(t => now - t < SEND_WINDOW_MS)
  if (hits.length >= SEND_MAX_PER_WINDOW) return true
  hits.push(now)
  recentSends.set(key, hits)
  // Keep the map from growing without bound across a long-lived process.
  if (recentSends.size > 500) {
    for (const [k, v] of recentSends) {
      if (!v.some(t => now - t < SEND_WINDOW_MS)) recentSends.delete(k)
    }
  }
  return false
}

async function readSettings() {
  const { data, error } = await supabaseAdmin
    .from('app_config').select('key, value').in('key', [WEBHOOK_KEY, DEFAULT_PHONE_KEY, SAMPLE_KEY])
  if (error) throw error
  const out = {}
  for (const row of (data || [])) out[row.key] = row.value
  return out
}

const router = Router()
router.use(authenticate)
router.use(requireMarketing)

function findLocation(slug) {
  const norm = String(slug || '').trim().toLowerCase()
  if (!norm) return null
  return LOCATIONS.find(l => l.slug === norm) || null
}

// Normalize one GHL custom value into the shape the portal renders. GHL returns
// the reference key as `fieldKey` (e.g. "custom_values.offer_headline"); older
// payloads have shipped it as `key`, so fall back before deriving from the name.
function shapeValue(cv) {
  const fieldKey = cv.fieldKey || cv.key || null
  return {
    id: cv.id,
    name: cv.name || '',
    value: cv.value == null ? '' : String(cv.value),
    fieldKey,
    // The token you paste into a template. GHL renders custom values as
    // {{custom_values.<key>}} — fieldKey already carries the prefix.
    token: fieldKey ? `{{ ${fieldKey} }}` : null,
    dateAdded: cv.dateAdded || null,
    dateUpdated: cv.dateUpdated || null,
  }
}

function sortByName(a, b) {
  return (a.name || '').localeCompare(b.name || '', undefined, { sensitivity: 'base' })
}

// GHL's customValues LIST endpoint lags writes by many minutes - a value read
// back straight after a successful write still shows the old contents, while a
// direct GET by id is correct. The portal renders from the list, so media would
// vanish from the screen while sitting correctly in GHL.
//
// So the portal keeps its own record of what each message carries, written at
// the same moment as the GHL write. GHL stays canonical for SENDING; this is
// canonical for DISPLAY. It lives in app_config rather than a new table so no
// migration is needed, one row per club per message.
//
// Consequence worth knowing: editing a media value directly in GHL will not be
// reflected here until the next upload or clear through the portal.
const MEDIA_RECORD_PREFIX = 'drip_media.'

function mediaRecordKey(clubSlug, mediaKey) {
  return `${MEDIA_RECORD_PREFIX}${clubSlug}.${normalizeKeyLocal(mediaKey)}`
}

async function rememberMedia(clubSlug, mediaKey, url) {
  const { error } = await supabaseAdmin.from('app_config').upsert(
    { key: mediaRecordKey(clubSlug, mediaKey), value: url || '', updated_at: new Date().toISOString() },
    { onConflict: 'key' }
  )
  if (error) console.error('[custom-values] could not record media url:', error.message)
}

// mediaKey -> url for one club. Absent means "no record", which is different
// from a recorded empty string (media deliberately turned off).
async function readMediaRecords(clubSlug) {
  const { data, error } = await supabaseAdmin
    .from('app_config').select('key, value')
    .like('key', `${MEDIA_RECORD_PREFIX}${clubSlug}.%`)
  if (error) {
    console.error('[custom-values] could not read media records:', error.message)
    return {}
  }
  const out = {}
  const prefix = `${MEDIA_RECORD_PREFIX}${clubSlug}.`
  for (const row of (data || [])) out[String(row.key).slice(prefix.length)] = row.value || ''
  return out
}

// Media lives in a PUBLIC bucket on purpose: carriers fetch an MMS attachment
// with no credentials, so a signed URL would 403 on the way to the handset.
// Everything in here is marketing artwork already being texted to the public.
const MEDIA_BUCKET = 'drip-media'

let bucketReady = false
async function ensureMediaBucket() {
  if (bucketReady) return
  const { error } = await supabaseAdmin.storage.createBucket(MEDIA_BUCKET, {
    public: true,
    fileSizeLimit: '1MB',
    allowedMimeTypes: ['image/jpeg', 'image/png', 'image/gif'],
  })
  if (error && !/exist/i.test(error.message || '')) throw error
  bucketReady = true
}

const upload = multer({ limits: { fileSize: 2 * 1024 * 1024, files: 1 } })

function uploadSingle(req, res, next) {
  upload.single('file')(req, res, err => {
    if (err) {
      const tooBig = err.code === 'LIMIT_FILE_SIZE'
      return res.status(tooBig ? 413 : 400).json({
        error: tooBig ? `That image is over 2 MB. Carriers cap MMS near 0.6 MB, so it needs to be under ${formatBytes(MAX_MEDIA_BYTES)}.` : 'Upload failed',
      })
    }
    next()
  })
}

// Find a club's custom value by fieldKey, or create it. GHL derives fieldKey
// from the name at CREATE time and never changes it on rename, so the name has
// to be right the first time or the workflow token points at nothing.
async function findOrCreateValue(loc, { key, name, value, id }) {
  // The list endpoint lags writes by minutes, so a lookup can miss a value that
  // exists and we would create a duplicate. When the caller already knows the
  // id (the portal does - it was paired into the row), write straight to it.
  if (id) {
    const updated = await ghlFetch(`/locations/${loc.id}/customValues/${id}`, loc.apiKey, {
      method: 'PUT',
      body: { name, value },
    })
    return shapeValue(updated.customValue || { id, name, value })
  }
  const data = await ghlFetch(`/locations/${loc.id}/customValues`, loc.apiKey)
  const existing = (data.customValues || []).find(cv => normalizeKeyLocal(cv.fieldKey || cv.key) === key)
  if (existing) {
    const updated = await ghlFetch(`/locations/${loc.id}/customValues/${existing.id}`, loc.apiKey, {
      method: 'PUT',
      body: { name: existing.name || name, value },
    })
    return shapeValue(updated.customValue || { ...existing, value })
  }
  const created = await ghlFetch(`/locations/${loc.id}/customValues`, loc.apiKey, {
    method: 'POST',
    body: { name, value },
  })
  const made = shapeValue(created.customValue || created.customValues || { name, value })
  if (made.fieldKey && normalizeKeyLocal(made.fieldKey) !== key) {
    // Surfaced rather than swallowed: a mismatch means the token an admin
    // pastes into the workflow will never resolve.
    made.keyWarning = `GHL created this as ${made.fieldKey}, not ${key}.`
  }
  return made
}

function normalizeKeyLocal(k) {
  return String(k || '').replace(/[{}\s]/g, '')
}

// GET /custom-values/locations — clubs this tool can target.
router.get('/locations', (req, res) => {
  res.json({ locations: LOCATIONS.map(l => ({ slug: l.slug, name: l.name, locationId: l.id })) })
})

// GET /custom-values?location=<slug>
// Returns the club's custom values plus its contact custom fields, so the
// editor's merge-field picker can offer the account-specific tokens alongside
// the standard GHL ones.
router.get('/', async (req, res) => {
  const loc = findLocation(req.query.location)
  if (!loc) return res.status(400).json({ error: 'Unknown or missing location' })

  try {
    const data = await ghlFetch(`/locations/${loc.id}/customValues`, loc.apiKey)
    const all = (data.customValues || data.customValue || []).map(shapeValue)

    // A media companion is not a message. Pair each one onto the message it
    // belongs to and keep it out of the list, so adding media does not double
    // the number of rows staff scroll through.
    const mediaByKey = {}
    for (const cv of all) {
      if (cv.fieldKey && isMediaKey(cv.fieldKey)) mediaByKey[normalizeKeyLocal(cv.fieldKey)] = cv
    }
    // Our own record wins over the list, which can be minutes behind.
    const recorded = await readMediaRecords(loc.slug)
    const customValues = all
      .filter(cv => !(cv.fieldKey && isMediaKey(cv.fieldKey)))
      .map(cv => {
        const key = cv.fieldKey ? mediaKeyFor(cv.fieldKey) : null
        const companion = key ? mediaByKey[key] : null
        // Prefer what we recorded at write time; fall back to the list for
        // anything the portal has never touched.
        const url = key && Object.prototype.hasOwnProperty.call(recorded, key)
          ? recorded[key]
          : (companion ? companion.value : '')
        return {
          ...cv,
          media: {
            key,
            // "on" is simply whether the companion holds a URL. Clearing the
            // value is what turns media off, so there is no separate flag to
            // drift out of step with what actually sends.
            on: !!url,
            url,
            id: companion ? companion.id : null,
            exists: !!companion,
          },
        }
      })
      .sort(sortByName)

    // Contact custom fields are a best-effort extra for the picker — a failure
    // here must not block editing the custom values themselves.
    let customFields = []
    let customFieldsError = null
    try {
      const fieldData = await ghlFetch(`/locations/${loc.id}/customFields`, loc.apiKey)
      customFields = (fieldData.customFields || [])
        .filter(f => f.fieldKey)
        .map(f => ({
          id: f.id,
          name: f.name || f.fieldKey,
          fieldKey: f.fieldKey,
          dataType: f.dataType || null,
          token: `{{ ${f.fieldKey} }}`,
        }))
        .sort(sortByName)
    } catch (err) {
      customFieldsError = err.message
    }

    res.json({
      location: { slug: loc.slug, name: loc.name, locationId: loc.id },
      customValues,
      customFields,
      customFieldsError,
    })
  } catch (err) {
    console.error('[custom-values] list failed:', err.message)
    res.status(502).json({ error: 'GHL request failed: ' + err.message })
  }
})

// PUT /custom-values/:id?location=<slug>  { name, value }
// GHL's update endpoint replaces both fields, so both are always sent — the UI
// passes the current name back when only the value changed.
router.put('/:id', async (req, res) => {
  const loc = findLocation(req.query.location || req.body.location)
  if (!loc) return res.status(400).json({ error: 'Unknown or missing location' })

  const id = String(req.params.id || '').trim()
  if (!id) return res.status(400).json({ error: 'Missing custom value id' })

  const name = typeof req.body.name === 'string' ? req.body.name.trim() : ''
  if (!name) return res.status(400).json({ error: 'Name is required' })
  if (typeof req.body.value !== 'string') return res.status(400).json({ error: 'Value must be a string' })

  try {
    const data = await ghlFetch(`/locations/${loc.id}/customValues/${id}`, loc.apiKey, {
      method: 'PUT',
      body: { name, value: req.body.value },
    })
    const updated = shapeValue(data.customValue || data.customValues || { id, name, value: req.body.value })

    audit.record(req.staff?.id, 'ghl.custom_value.update', {
      target: `${loc.slug}:${id}`,
      metadata: { location: loc.slug, name, fieldKey: updated.fieldKey },
      ip: req.ip,
    }).catch(() => {})

    res.json({ customValue: updated })
  } catch (err) {
    console.error('[custom-values] update failed:', err.message)
    res.status(502).json({ error: 'GHL update failed: ' + err.message })
  }
})

// GET /custom-values/test-config
// What the Drip Campaigns test panel needs to render. The webhook URL itself is
// only returned to admins - everyone else gets whether one is configured.
router.get('/test-config', async (req, res) => {
  try {
    const settings = await readSettings()
    const url = settings[WEBHOOK_KEY] || ''
    const isAdmin = String(req.staff?.role || '') === 'admin'
    res.json({
      configured: !!url,
      webhookUrl: isAdmin ? url : undefined,
      defaultPhone: settings[DEFAULT_PHONE_KEY] || '',
      sampleValues: { ...DEFAULT_SAMPLE_VALUES, ...parseSaved(settings[SAMPLE_KEY]) },
      builtInSampleValues: DEFAULT_SAMPLE_VALUES,
      canEdit: isAdmin,
    })
  } catch (err) {
    console.error('[custom-values] test-config failed:', err.message)
    res.status(500).json({ error: err.message })
  }
})

// POST /custom-values/preview  { location, text, contact }
// Renders a message without sending anything, so the panel can show exactly
// what will go out (and what failed to resolve) before a real SMS is spent.
router.post('/preview', async (req, res) => {
  const loc = findLocation(req.body.location)
  if (!loc) return res.status(400).json({ error: 'Unknown or missing location' })
  if (typeof req.body.text !== 'string') return res.status(400).json({ error: 'text is required' })

  try {
    const data = await ghlFetch(`/locations/${loc.id}/customValues`, loc.apiKey)
    const customValues = {}
    for (const cv of (data.customValues || [])) {
      if (cv.fieldKey || cv.key) customValues[cv.fieldKey || cv.key] = cv.value
    }
    const settings = await readSettings()
    const planted = {
      ...DEFAULT_SAMPLE_VALUES,
      ...parseSaved(settings[SAMPLE_KEY]),
      'location.name': loc.name,
      ...(req.body.values || {}),
    }
    const rendered = resolveTokens(req.body.text, {
      customValues,
      values: planted,
      contact: req.body.contact || {},
      location: { name: loc.name },
    })
    // Every merge field this copy uses, so the panel can offer an input per
    // field rather than a hardcoded three.
    const fields = extractMergeFields(req.body.text, customValues).map(path => ({
      path,
      label: labelForField(path),
      value: planted[path] == null ? '' : String(planted[path]),
    }))
    res.json({
      text: rendered.text,
      unresolved: rendered.unresolved,
      fields,
      ...smsSegments(rendered.text),
      hidden: findHiddenCharacters(rendered.text),
    })
  } catch (err) {
    console.error('[custom-values] preview failed:', err.message)
    res.status(502).json({ error: 'GHL request failed: ' + err.message })
  }
})

// POST /custom-values/test-sms  { location, text, phone, contact, mediaUrl }
// Renders the message, then POSTs it to the configured GHL inbound webhook.
// GHL does the sending, from one workflow, to the phone in the payload.
router.post('/test-sms', async (req, res) => {
  const loc = findLocation(req.body.location)
  if (!loc) return res.status(400).json({ error: 'Unknown or missing location' })
  if (typeof req.body.text !== 'string' || !req.body.text.trim()) {
    return res.status(400).json({ error: 'text is required' })
  }
  if (req.body.text.length > 4000) return res.status(400).json({ error: 'Message is too long to send' })

  const phone = normalizePhone(req.body.phone)
  if (!phone) return res.status(400).json({ error: 'Enter a valid phone number to send the test to' })

  const mediaUrl = String(req.body.mediaUrl || '').trim()
  if (mediaUrl && !/^https:\/\//i.test(mediaUrl)) {
    return res.status(400).json({ error: 'Media URL must start with https://' })
  }

  if (tooManySends(req.staff?.id)) {
    return res.status(429).json({ error: 'Too many test sends. Wait a minute and try again.' })
  }

  try {
    const settings = await readSettings()
    const webhookUrl = settings[WEBHOOK_KEY] || ''
    if (!webhookUrl) {
      return res.status(400).json({ error: 'No test webhook is configured. An admin can set one in the Drip Campaigns test panel.' })
    }
    if (!/^https:\/\//i.test(webhookUrl)) {
      return res.status(400).json({ error: 'The configured test webhook URL is not https.' })
    }

    // Resolve here rather than letting GHL do it: the workflow acts on the
    // tester's own contact, so GHL would substitute the STAFF member's name and
    // an empty referrer - a preview that hides the very gap worth catching.
    const data = await ghlFetch(`/locations/${loc.id}/customValues`, loc.apiKey)
    const customValues = {}
    for (const cv of (data.customValues || [])) {
      if (cv.fieldKey || cv.key) customValues[cv.fieldKey || cv.key] = cv.value
    }
    const rendered = resolveTokens(req.body.text, {
      customValues,
      values: {
        ...DEFAULT_SAMPLE_VALUES,
        ...parseSaved(settings[SAMPLE_KEY]),
        'location.name': loc.name,
        ...(req.body.values || {}),
      },
      contact: req.body.contact || {},
      location: { name: loc.name },
    })

    // GHL's Send SMS action rejects an empty attachment ("Not a valid URL
    // parameter"), so a message without media cannot go through an action that
    // references one. The workflow branches instead, which means:
    //
    //  - media_url is ALWAYS present, even when empty. GHL builds a webhook's
    //    field list from a received sample, so omitting the key means the
    //    workflow builder never offers it as something to branch on.
    //  - has_media is sent alongside it because an If/Else comparing "yes"/"no"
    //    is far more dependable than asking GHL whether a URL string is empty.
    const payload = {
      phone,
      message: rendered.text,
      media_url: mediaUrl || '',
      has_media: mediaUrl ? 'yes' : 'no',
      club: loc.name,
      club_slug: loc.slug,
      label: String(req.body.label || '').slice(0, 120),
      source: 'wcs-portal-drip-test',
      sent_by: req.staff?.email || '',
    }

    const hookRes = await fetch(webhookUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    })
    const hookText = await hookRes.text().catch(() => '')
    if (!hookRes.ok) {
      return res.status(502).json({ error: `Webhook rejected the test (${hookRes.status}): ${hookText.slice(0, 200)}` })
    }

    audit.record(req.staff?.id, 'ghl.drip_test_sms', {
      target: `${loc.slug}:${payload.label || 'ad-hoc'}`,
      metadata: { location: loc.slug, phone, hasMedia: !!mediaUrl, unresolved: rendered.unresolved },
      ip: req.ip,
    }).catch(() => {})

    res.json({
      ok: true,
      phone,
      text: rendered.text,
      unresolved: rendered.unresolved,
      ...smsSegments(rendered.text),
    })
  } catch (err) {
    console.error('[custom-values] test-sms failed:', err.message)
    res.status(502).json({ error: 'Test send failed: ' + err.message })
  }
})

// POST /custom-values/media  (multipart: file, location, messageKey, messageName)
// Stores the image and writes its URL into the message's companion media value.
router.post('/media', uploadSingle, async (req, res) => {
  const loc = findLocation(req.body.location)
  if (!loc) return res.status(400).json({ error: 'Unknown or missing location' })
  if (!req.file) return res.status(400).json({ error: 'No file was uploaded' })

  const mediaKey = mediaKeyFor(req.body.messageKey)
  const mediaName = mediaNameFor(req.body.messageName)
  if (!mediaKey || !mediaName) return res.status(400).json({ error: 'messageKey and messageName are required' })

  const check = validateMedia({ mimetype: req.file.mimetype, size: req.file.size })
  if (!check.ok) return res.status(400).json({ error: check.error })

  try {
    await ensureMediaBucket()
    const path = mediaStoragePath({ clubSlug: loc.slug, mediaKey, ext: check.ext })
    const { error: upErr } = await supabaseAdmin.storage
      .from(MEDIA_BUCKET)
      .upload(path, req.file.buffer, { contentType: req.file.mimetype, upsert: false })
    if (upErr) throw upErr

    const { data: urlData } = supabaseAdmin.storage.from(MEDIA_BUCKET).getPublicUrl(path)
    const publicUrl = urlData?.publicUrl
    if (!publicUrl) throw new Error('Storage did not return a public URL')

    const mediaValue = await findOrCreateValue(loc, {
      key: mediaKey, name: mediaName, value: publicUrl,
      id: String(req.body.mediaValueId || '').trim() || undefined,
    })

    await rememberMedia(loc.slug, mediaKey, publicUrl)

    audit.record(req.staff?.id, 'ghl.drip_media.upload', {
      target: `${loc.slug}:${mediaKey}`,
      metadata: { location: loc.slug, path, bytes: req.file.size, type: req.file.mimetype },
      ip: req.ip,
    }).catch(() => {})

    res.json({ url: publicUrl, path, bytes: req.file.size, mediaValue })
  } catch (err) {
    console.error('[custom-values] media upload failed:', err.message)
    res.status(502).json({ error: 'Upload failed: ' + err.message })
  }
})

// POST /custom-values/media/clear  { location, messageKey }
// Turning media off empties the companion value, so the workflow's attachment
// field resolves to nothing and the message sends as a plain SMS. The workflow
// itself is never touched. The stored file is left in place - cheap to keep,
// and it means toggling back on does not need a re-upload.
router.post('/media/clear', async (req, res) => {
  const loc = findLocation(req.body.location)
  if (!loc) return res.status(400).json({ error: 'Unknown or missing location' })

  const mediaKey = mediaKeyFor(req.body.messageKey)
  const mediaName = mediaNameFor(req.body.messageName)
  if (!mediaKey) return res.status(400).json({ error: 'messageKey is required' })

  try {
    // Prefer the id the portal already holds: the list lags writes, so looking
    // the companion up again can miss it and silently do nothing.
    let id = String(req.body.mediaValueId || '').trim()
    let name = String(req.body.mediaValueName || '').trim()
    if (!id) {
      const data = await ghlFetch(`/locations/${loc.id}/customValues`, loc.apiKey)
      const existing = (data.customValues || []).find(cv => normalizeKeyLocal(cv.fieldKey || cv.key) === mediaKey)
      if (!existing) return res.json({ cleared: true, mediaValue: null })
      id = existing.id
      name = existing.name
    }
    if (!name) name = mediaName ? mediaName : 'Media'

    await ghlFetch(`/locations/${loc.id}/customValues/${id}`, loc.apiKey, {
      method: 'PUT',
      body: { name, value: '' },
    })

    await rememberMedia(loc.slug, mediaKey, '')

    audit.record(req.staff?.id, 'ghl.drip_media.clear', {
      target: `${loc.slug}:${mediaKey}`,
      metadata: { location: loc.slug },
      ip: req.ip,
    }).catch(() => {})

    res.json({ cleared: true, mediaValue: shapeValue({ id, name, value: '', fieldKey: mediaKey }) })
  } catch (err) {
    console.error('[custom-values] media clear failed:', err.message)
    res.status(502).json({ error: 'Could not turn media off: ' + err.message })
  }
})

module.exports = router
