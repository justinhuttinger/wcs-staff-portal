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
const authenticate = require('../middleware/auth')
const { requireMarketing } = require('../middleware/role')
const { LOCATIONS } = require('../config/ghlLocations')
const { ghlFetch } = require('../services/ghlClient')
const { supabaseAdmin } = require('../services/supabase')
const { resolveTokens, smsSegments, findHiddenCharacters, normalizePhone } = require('../lib/smsPreview')
const audit = require('../services/auditLog')

// app_config keys backing the test send.
const WEBHOOK_KEY = 'drip_test_webhook_url'
const DEFAULT_PHONE_KEY = 'drip_test_default_phone'

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
    .from('app_config').select('key, value').in('key', [WEBHOOK_KEY, DEFAULT_PHONE_KEY])
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
    const customValues = (data.customValues || data.customValue || []).map(shapeValue).sort(sortByName)

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
    const rendered = resolveTokens(req.body.text, {
      customValues,
      contact: req.body.contact || {},
      location: { name: loc.name },
    })
    res.json({
      text: rendered.text,
      unresolved: rendered.unresolved,
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
      contact: req.body.contact || {},
      location: { name: loc.name },
    })

    const payload = {
      phone,
      message: rendered.text,
      media_url: mediaUrl || '',
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

module.exports = router
