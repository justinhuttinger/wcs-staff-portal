const { Router } = require('express')
const { supabaseAdmin } = require('../services/supabase')
const authenticate = require('../middleware/auth')
const { requireRole } = require('../middleware/role')

const router = Router()
router.use(authenticate)
router.use(requireRole('admin'))

const LOCATIONS = require('../config/clubs').CLUBS.map(c => ({
  name: c.name,
  locationId: c.ghlLocationId,
  apiKeyEnv: `GHL_API_KEY_${c.envKey}`,
}))

const GHL_BASE = 'https://services.leadconnectorhq.com'

async function ghlFetch(path, apiKey) {
  const res = await fetch(GHL_BASE + path, {
    headers: { Authorization: 'Bearer ' + apiKey, Version: '2021-07-28', Accept: 'application/json' },
  })
  if (!res.ok) throw new Error('HTTP ' + res.status)
  return res.json()
}

// GET /custom-fields — pull definitions + sample values for all locations
router.get('/', async (req, res) => {
  try {
    const locationSlug = req.query.location
    let targets = LOCATIONS

    if (locationSlug && locationSlug !== 'all') {
      const match = LOCATIONS.find(l => l.name.toLowerCase() === locationSlug.toLowerCase())
      if (match) targets = [match]
    }

    const results = []

    for (const loc of targets) {
      const apiKey = process.env[loc.apiKeyEnv]
      if (!apiKey) {
        results.push({ name: loc.name, locationId: loc.locationId, error: `${loc.apiKeyEnv} not set` })
        continue
      }

      const entry = { name: loc.name, locationId: loc.locationId, definitions: [], contactFields: [] }

      // Fetch custom field definitions
      try {
        const defData = await ghlFetch('/locations/' + loc.locationId + '/customFields', apiKey)
        entry.definitions = (defData.customFields || []).map(d => ({
          id: d.id,
          name: d.name,
          fieldKey: d.fieldKey,
          dataType: d.dataType,
        }))
      } catch (e) {
        entry.defError = e.message
      }

      // Fetch sample contact to see field values
      try {
        const cData = await ghlFetch('/contacts/?locationId=' + loc.locationId + '&limit=3', apiKey)
        const contacts = cData.contacts || []
        const fieldMap = {}
        for (const contact of contacts) {
          for (const f of (contact.customFields || [])) {
            if (!fieldMap[f.id]) fieldMap[f.id] = f.value
          }
        }
        entry.contactFields = Object.entries(fieldMap).map(([id, value]) => ({ id, sampleValue: value }))
      } catch (e) {
        entry.contactError = e.message
      }

      results.push(entry)

      // Small delay between locations
      if (targets.length > 1) await new Promise(r => setTimeout(r, 500))
    }

    res.json({ locations: results })
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

module.exports = router
