#!/usr/bin/env node
/**
 * Cross-location contact cleanup script.
 *
 * For each lead-side GHL contact that has a confirmed member at a sister club
 * (per v_cross_location_deletion_candidates):
 *   1. Snapshot the full contact row into deleted_contacts_archive
 *   2. DELETE /contacts/{id} via GHL API using the lead-side location's key
 *   3. Log the API status + response into contact_deletion_log
 *
 * The view excludes contacts already deleted (2xx in contact_deletion_log),
 * so the script is safe to re-run.
 *
 * Usage:
 *   node scripts/cross-loc-contact-cleanup.js --dry-run
 *   node scripts/cross-loc-contact-cleanup.js --dry-run --location=salem
 *   node scripts/cross-loc-contact-cleanup.js --limit=10
 *   node scripts/cross-loc-contact-cleanup.js
 */

require('dotenv').config()
const { supabaseAdmin } = require('../src/services/supabase')
const { getLocationBySlug } = require('../src/config/ghlLocations')

const BASE_URL = process.env.GHL_BASE_URL || 'https://services.leadconnectorhq.com'
const API_VERSION = '2021-07-28'
const RATE_LIMIT_MS = 200  // 5 req/sec, well under GHL limits

function parseArgs(argv) {
  const out = {}
  for (const a of argv) {
    const m = a.match(/^--([^=]+)(?:=(.*))?$/)
    if (m) out[m[1]] = m[2] === undefined ? true : m[2]
  }
  return out
}

const args = parseArgs(process.argv.slice(2))
const DRY_RUN = Boolean(args['dry-run'])
const LIMIT = args.limit ? parseInt(args.limit, 10) : null
const LOCATION_FILTER = args.location ? String(args.location).toLowerCase() : null
const TRIGGERED_BY = args['triggered-by'] || 'backlog_cleanup_script'

const sleep = ms => new Promise(r => setTimeout(r, ms))

async function fetchCandidates() {
  let q = supabaseAdmin.from('v_cross_location_deletion_candidates').select('*')
  if (LOCATION_FILTER) q = q.eq('lead_location_slug', LOCATION_FILTER)
  if (LIMIT) q = q.limit(LIMIT)
  const { data, error } = await q
  if (error) throw new Error(`Failed to load candidates: ${error.message}`)
  return data || []
}

// Pulls the live row from ghl_contacts_v2 so the archive captures everything
// (not just the columns the view exposes). Returns null if the contact has
// already disappeared from our mirror, in which case we skip.
async function fetchContactSnapshot(ghlContactId) {
  const { data, error } = await supabaseAdmin
    .from('ghl_contacts_v2')
    .select('*')
    .eq('id', ghlContactId)
    .maybeSingle()
  if (error) throw new Error(`Failed to snapshot ${ghlContactId}: ${error.message}`)
  return data
}

async function archiveContact(snapshot, leadLocation) {
  // We don't populate location_id (FK to public.locations) — ghl_contacts_v2
  // stores GHL's location id (a string) and resolving our UUID would cost
  // another roundtrip. location_slug is sufficient for recovery.
  const row = {
    ghl_contact_id: snapshot.id,
    location_slug: leadLocation.slug,
    email: snapshot.email,
    phone: snapshot.phone,
    first_name: snapshot.first_name,
    last_name: snapshot.last_name,
    tags: snapshot.tags,
    custom_fields: snapshot.custom_fields,
    contact_snapshot: snapshot,
    archived_by: TRIGGERED_BY,
  }
  const { data, error } = await supabaseAdmin
    .from('deleted_contacts_archive')
    .insert(row)
    .select('id')
    .single()
  if (error) throw new Error(`Archive insert failed for ${snapshot.id}: ${error.message}`)
  return data.id
}

async function deleteContactInGhl(contactId, apiKey) {
  const url = `${BASE_URL}/contacts/${contactId}`
  const res = await fetch(url, {
    method: 'DELETE',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      Version: API_VERSION,
      Accept: 'application/json',
    },
  })
  const text = await res.text().catch(() => '')
  let body = null
  if (text) {
    try { body = JSON.parse(text) } catch { body = { raw: text } }
  }
  return { status: res.status, ok: res.ok, body }
}

async function logDeletion({ ghlContactId, leadSlug, memberSlug, email, archiveId, status, body, error }) {
  const row = {
    ghl_contact_id: ghlContactId,
    lead_location_slug: leadSlug,
    member_location_slug: memberSlug,
    email,
    triggered_by: TRIGGERED_BY,
    archive_id: archiveId,
    ghl_api_status: status,
    ghl_api_response: body,
    error_message: error || null,
  }
  const { error: insertErr } = await supabaseAdmin.from('contact_deletion_log').insert(row)
  if (insertErr) {
    console.error(`[log] Failed to write deletion log for ${ghlContactId}: ${insertErr.message}`)
  }
}

async function main() {
  if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
    throw new Error('SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY required')
  }

  const candidates = await fetchCandidates()
  console.log(`[cleanup] ${candidates.length} candidate(s) loaded${LOCATION_FILTER ? ` for ${LOCATION_FILTER}` : ''}${LIMIT ? ` (limit ${LIMIT})` : ''}`)
  console.log(`[cleanup] mode: ${DRY_RUN ? 'DRY RUN — no writes' : 'LIVE — contacts will be deleted'}`)

  if (candidates.length === 0) {
    console.log('[cleanup] nothing to do, exiting')
    return
  }

  let deleted = 0
  let skipped = 0
  let failed = 0

  for (const c of candidates) {
    const leadLoc = getLocationBySlug(c.lead_location_slug)
    if (!leadLoc) {
      console.warn(`[skip] ${c.lead_ghl_contact_id}: no API key configured for ${c.lead_location_slug}`)
      skipped++
      continue
    }

    if (DRY_RUN) {
      console.log(`[dry-run] would delete ${c.lead_ghl_contact_id} (${c.first_name} ${c.last_name}, ${c.email}) from ${c.lead_location_slug} → member at ${c.member_location_slug}`)
      continue
    }

    let snapshot
    try {
      snapshot = await fetchContactSnapshot(c.lead_ghl_contact_id)
    } catch (e) {
      console.error(`[error] snapshot fetch ${c.lead_ghl_contact_id}: ${e.message}`)
      failed++
      continue
    }
    if (!snapshot) {
      console.warn(`[skip] ${c.lead_ghl_contact_id}: no longer in ghl_contacts_v2 (likely already synced out)`)
      skipped++
      continue
    }

    let archiveId
    try {
      archiveId = await archiveContact(snapshot, leadLoc)
    } catch (e) {
      console.error(`[error] archive ${c.lead_ghl_contact_id}: ${e.message}`)
      failed++
      continue
    }

    let apiResult, apiErr
    try {
      apiResult = await deleteContactInGhl(c.lead_ghl_contact_id, leadLoc.apiKey)
    } catch (e) {
      apiErr = e.message
    }

    await logDeletion({
      ghlContactId: c.lead_ghl_contact_id,
      leadSlug: c.lead_location_slug,
      memberSlug: c.member_location_slug,
      email: c.email,
      archiveId,
      status: apiResult ? apiResult.status : null,
      body: apiResult ? apiResult.body : null,
      error: apiErr,
    })

    if (apiResult && apiResult.ok) {
      deleted++
      console.log(`[ok] ${c.lead_ghl_contact_id} (${c.email}) deleted from ${c.lead_location_slug}`)
    } else {
      failed++
      const where = apiResult ? `HTTP ${apiResult.status}` : apiErr
      console.error(`[fail] ${c.lead_ghl_contact_id} (${c.email}): ${where}`)
    }

    await sleep(RATE_LIMIT_MS)
  }

  console.log(`[cleanup] done — ${deleted} deleted, ${skipped} skipped, ${failed} failed`)
}

main().catch(err => {
  console.error('[fatal]', err)
  process.exit(1)
})
