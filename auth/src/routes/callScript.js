/*
 * GET /ghl/call-script?locationId=...&workflowId=...
 *
 * Returns the call script for a Manual Actions workflow as
 * { workflow, title, script }, or { script: null } when there is none. The GHL
 * custom JS shows it across the top of the app while staff are on that call.
 *
 * Scripts are the location's own Custom Values, matched to the workflow by
 * name, so they are edited in GHL with no deploy:
 *
 *   workflow "F. Abandoned Cart Call 2"
 *     1. custom value "Abandoned Cart Call 2 Script"   (this exact call)
 *     2. custom value "Abandoned Cart Call Script"     (shared by every call in the flow)
 *
 * Matching ignores case, spaces and punctuation, so "A. New Lead-Call 1" finds
 * "New Lead Call 1 Script".
 *
 * The script comes back with its merge fields ({{contact.first_name}}) intact;
 * the browser fills them in from the staff member's own GHL session, so no
 * contact data passes through here.
 *
 * Tokens come from config/ghlLocations (GHL_API_KEY_<CLUB>) and need
 * workflows.readonly and locations/customValues.readonly.
 *
 * Mounted in app.js BEFORE the global cors() so this route's own CORS answers
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
const CACHE_MS = 5 * 60 * 1000
const ID_PATTERN = /^[A-Za-z0-9-]{8,64}$/
const WORKFLOW_PATTERN = /^[A-Z]{1,3}\.\s*(.+)$/ // "B. Trial-Ending Call" -> "Trial-Ending Call"

const cache = new Map()

function normalize(s) {
  return String(s || '').toLowerCase().replace(/[^a-z0-9]/g, '')
}

// Custom value names to try for a workflow, most specific first.
function scriptKeys(workflowName) {
  const match = String(workflowName || '').trim().match(WORKFLOW_PATTERN)
  if (!match) return []
  const exact = normalize(match[1])
  const shared = normalize(match[1].replace(/\s*\d+\s*$/, ''))
  return [...new Set([exact, shared])].filter(Boolean).map((k) => `${k}script`)
}

function findScript(workflowName, customValues) {
  const byName = new Map()
  for (const v of customValues || []) {
    if (String(v.value || '').trim()) byName.set(normalize(v.name), v)
  }
  for (const key of scriptKeys(workflowName)) {
    const hit = byName.get(key)
    if (hit) return { title: hit.name, script: String(hit.value).trim() }
  }
  return null
}

async function ghlGet(token, path) {
  const res = await fetch(GHL_API + path, {
    headers: { Authorization: `Bearer ${token}`, Version: GHL_VERSION, Accept: 'application/json' },
  })
  if (!res.ok) throw new Error(`GHL ${path} responded ${res.status}`)
  return res.json()
}

// Workflows and custom values for a location, refreshed together every few minutes.
async function loadLocation(location) {
  const cached = cache.get(location.id)
  if (cached && Date.now() - cached.at < CACHE_MS) return cached
  try {
    const [wf, cv] = await Promise.all([
      ghlGet(location.apiKey, `/workflows/?locationId=${encodeURIComponent(location.id)}`),
      ghlGet(location.apiKey, `/locations/${encodeURIComponent(location.id)}/customValues`),
    ])
    const fresh = { at: Date.now(), workflows: wf.workflows || [], customValues: cv.customValues || [] }
    cache.set(location.id, fresh)
    return fresh
  } catch (err) {
    // Serve stale scripts rather than none if GHL has a hiccup.
    if (cached) return cached
    throw err
  }
}

// CORS for the two GHL domains only. No cookies or credentials are involved.
router.use('/ghl/call-script', (req, res, next) => {
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

router.get('/ghl/call-script', async (req, res) => {
  const location = getLocationById(String(req.query.locationId || ''))
  if (!location) return res.status(404).json({ error: 'Unknown location' })
  const workflowId = String(req.query.workflowId || '')
  if (!ID_PATTERN.test(workflowId)) return res.status(400).json({ error: 'Invalid workflow' })

  try {
    const data = await loadLocation(location)
    const workflow = data.workflows.find((w) => w.id === workflowId)
    const found = workflow && findScript(workflow.name, data.customValues)
    res.json({ workflow: workflow ? workflow.name : null, title: found ? found.title : null, script: found ? found.script : null })
  } catch (err) {
    console.error(`[call-script] ${location.name}:`, err.message)
    res.status(502).json({ error: 'Could not load the call script' })
  }
})

module.exports = router
module.exports.scriptKeys = scriptKeys
module.exports.findScript = findScript
