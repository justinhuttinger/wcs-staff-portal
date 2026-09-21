/*
 * GET /ghl/manual-action-workflows?locationId=...
 *
 * Returns the location's workflows as [{ id, name }], sorted by name, for the
 * Manual Actions chip bar in the GHL custom JS. The browser only ever sees ids and
 * names; the GHL token stays on the server.
 *
 * Tokens come from config/ghlLocations (GHL_API_KEY_<CLUB>). Each token needs the
 * workflows.readonly scope.
 *
 * Mounted in index.js BEFORE the global cors() so this route's own CORS answers
 * the GHL origins (the global whitelist would otherwise swallow the preflight).
 */
const express = require('express')
const { getLocationById } = require('../config/ghlLocations')

const router = express.Router()

const ALLOWED_ORIGINS = [
  'https://app.gohighlevel.com',
  'https://app.westcoaststrength.com',
]

const GHL_API = 'https://services.leadconnectorhq.com'
const GHL_VERSION = '2021-07-28'
const CACHE_MS = 10 * 60 * 1000

const cache = new Map()

// CORS for the two GHL domains only. No cookies or credentials are involved.
router.use('/ghl/manual-action-workflows', (req, res, next) => {
  const origin = req.headers.origin
  if (ALLOWED_ORIGINS.includes(origin)) {
    res.set('Access-Control-Allow-Origin', origin)
    res.set('Vary', 'Origin')
  }
  if (req.method === 'OPTIONS') {
    res.set('Access-Control-Allow-Methods', 'GET')
    return res.sendStatus(204)
  }
  next()
})

router.get('/ghl/manual-action-workflows', async (req, res) => {
  const locationId = String(req.query.locationId || '')

  // Only our configured club locations are served, so this can't be used
  // to query arbitrary sub-accounts.
  const location = getLocationById(locationId)
  if (!location) return res.status(404).json({ error: 'Unknown location' })

  const cached = cache.get(locationId)
  if (cached && Date.now() - cached.at < CACHE_MS) return res.json(cached.list)

  try {
    const ghl = await fetch(`${GHL_API}/workflows/?locationId=${encodeURIComponent(locationId)}`, {
      headers: {
        Authorization: `Bearer ${location.apiKey}`,
        Version: GHL_VERSION,
        Accept: 'application/json',
      },
    })
    if (!ghl.ok) throw new Error(`GHL responded ${ghl.status}`)

    const body = await ghl.json()
    const list = (body.workflows || [])
      .map((w) => ({ id: w.id, name: w.name }))
      .sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }))

    cache.set(locationId, { at: Date.now(), list })
    res.json(list)
  } catch (err) {
    console.error(`[manual-action-workflows] ${location.name}:`, err.message)
    // Serve a stale list rather than nothing if GHL has a hiccup.
    if (cached) return res.json(cached.list)
    res.status(502).json({ error: 'Could not load workflows' })
  }
})

module.exports = router
