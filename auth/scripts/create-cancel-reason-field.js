#!/usr/bin/env node
/**
 * Creates a single-line "Cancel Reason" custom field in each GHL sub-account
 * configured in src/config/ghlLocations.js.
 *
 * Idempotent: GETs existing fields first and skips any location that already
 * has a field with the same name (case-insensitive). Prints the final
 * fieldKey for each location so you can confirm GHL generated the expected
 * key (typically `contact.cancel_reason`).
 *
 * Usage:
 *   node scripts/create-cancel-reason-field.js                # create in every configured location (env-based)
 *   node scripts/create-cancel-reason-field.js --location=salem
 *   node scripts/create-cancel-reason-field.js --name="Cancel Reason"
 *   node scripts/create-cancel-reason-field.js --dry-run      # show what would happen, no writes
 *
 * Credential sources (precedence):
 *   1. --clubs-config=<path>   read locations from a prospects---documents clubs-config.json
 *   2. process env             GHL_LOCATION_<NAME> + GHL_API_KEY_<NAME> via src/config/ghlLocations.js
 *
 * If neither is configured, falls back to the sibling repo
 * `..\..\prospects---documents\clubs-config.json` automatically.
 */

require('dotenv').config()
const fs = require('fs')
const path = require('path')
const { LOCATIONS: ENV_LOCATIONS } = require('../src/config/ghlLocations')

const BASE_URL = process.env.GHL_BASE_URL || 'https://services.leadconnectorhq.com'
const API_VERSION = '2021-07-28'

const args = parseArgs(process.argv.slice(2))
const FIELD_NAME = args.name || 'Cancel Reason'
const TARGET_SLUG = args.location ? String(args.location).toLowerCase() : null
const DRY_RUN = Boolean(args['dry-run'])
const CLUBS_CONFIG = args['clubs-config'] || null

function loadLocationsFromClubsConfig(filePath) {
  const raw = fs.readFileSync(filePath, 'utf8')
  const parsed = JSON.parse(raw)
  const clubs = Array.isArray(parsed.clubs) ? parsed.clubs : []
  return clubs
    .filter(c => c.enabled && c.ghlLocationId && c.ghlApiKey)
    .map(c => ({
      id: c.ghlLocationId,
      apiKey: c.ghlApiKey,
      name: c.clubName,
      slug: String(c.clubName || '').toLowerCase(),
      clubCode: String(c.clubNumber || ''),
    }))
}

function resolveLocations() {
  if (CLUBS_CONFIG) {
    const abs = path.resolve(CLUBS_CONFIG)
    console.log(`Using clubs-config from --clubs-config=${abs}`)
    return loadLocationsFromClubsConfig(abs)
  }
  if (ENV_LOCATIONS.length > 0) {
    console.log(`Using ${ENV_LOCATIONS.length} location(s) from env (GHL_LOCATION_* / GHL_API_KEY_*)`)
    return ENV_LOCATIONS
  }
  const fallback = path.resolve(__dirname, '..', '..', '..', 'prospects---documents', 'clubs-config.json')
  if (fs.existsSync(fallback)) {
    console.log(`No env GHL keys set; falling back to ${fallback}`)
    return loadLocationsFromClubsConfig(fallback)
  }
  return []
}

function parseArgs(argv) {
  const out = {}
  for (const a of argv) {
    const m = a.match(/^--([^=]+)(?:=(.*))?$/)
    if (m) out[m[1]] = m[2] === undefined ? true : m[2]
  }
  return out
}

async function ghl(path, apiKey, options = {}) {
  const { method = 'GET', body } = options
  const res = await fetch(BASE_URL + path, {
    method,
    headers: {
      Authorization: 'Bearer ' + apiKey,
      Version: API_VERSION,
      'Content-Type': 'application/json',
      Accept: 'application/json',
    },
    body: body ? JSON.stringify(body) : undefined,
  })
  const text = await res.text()
  let data = null
  try { data = text ? JSON.parse(text) : null } catch { /* leave as text */ }
  return { ok: res.ok, status: res.status, data, text }
}

async function processLocation(loc) {
  const tag = `[${loc.name}]`
  console.log(`${tag} location=${loc.id}`)

  const existing = await ghl('/locations/' + loc.id + '/customFields', loc.apiKey)
  if (!existing.ok) {
    console.log(`${tag}  ✗ failed to list existing fields: ${existing.status} ${existing.text}`)
    return { name: loc.name, status: 'list-failed' }
  }

  const fields = existing.data?.customFields || []
  const match = fields.find(f => (f.name || '').trim().toLowerCase() === FIELD_NAME.toLowerCase())
  if (match) {
    console.log(`${tag}  • already exists: id=${match.id} fieldKey=${match.fieldKey} dataType=${match.dataType}`)
    return { name: loc.name, status: 'exists', id: match.id, fieldKey: match.fieldKey }
  }

  if (DRY_RUN) {
    console.log(`${tag}  ~ dry-run: would POST /locations/${loc.id}/customFields name="${FIELD_NAME}" model=contact dataType=TEXT`)
    return { name: loc.name, status: 'dry-run' }
  }

  const created = await ghl('/locations/' + loc.id + '/customFields', loc.apiKey, {
    method: 'POST',
    body: {
      name: FIELD_NAME,
      dataType: 'TEXT',
      model: 'contact',
      placeholder: '',
    },
  })

  if (!created.ok) {
    console.log(`${tag}  ✗ create failed: ${created.status} ${created.text}`)
    return { name: loc.name, status: 'create-failed', error: created.text }
  }

  const field = created.data?.customField || created.data?.field || created.data
  const id = field?.id
  const fieldKey = field?.fieldKey
  console.log(`${tag}  ✓ created: id=${id} fieldKey=${fieldKey}`)
  return { name: loc.name, status: 'created', id, fieldKey }
}

async function main() {
  const locations = resolveLocations()
  if (locations.length === 0) {
    console.error('No GHL locations available. Provide --clubs-config=<path> or set GHL_LOCATION_*/GHL_API_KEY_* env vars.')
    process.exit(1)
  }

  const targets = TARGET_SLUG
    ? locations.filter(l => l.slug === TARGET_SLUG)
    : locations

  if (targets.length === 0) {
    console.error(`No location matched --location=${TARGET_SLUG}`)
    process.exit(1)
  }

  console.log(`Creating "${FIELD_NAME}" (TEXT, contact) in ${targets.length} location(s)${DRY_RUN ? ' [DRY RUN]' : ''}\n`)

  const results = []
  for (const loc of targets) {
    try {
      const r = await processLocation(loc)
      results.push(r)
    } catch (err) {
      console.log(`[${loc.name}]  ✗ exception: ${err.message}`)
      results.push({ name: loc.name, status: 'exception', error: err.message })
    }
    // Gentle pacing between sub-accounts
    if (targets.length > 1) await new Promise(r => setTimeout(r, 400))
  }

  console.log('\nSummary:')
  for (const r of results) {
    console.log(`  ${r.name.padEnd(12)} ${r.status.padEnd(14)} ${r.fieldKey || r.id || r.error || ''}`)
  }
}

main().catch(err => {
  console.error(err)
  process.exit(1)
})
