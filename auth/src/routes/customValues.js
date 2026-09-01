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
const audit = require('../services/auditLog')

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

module.exports = router
