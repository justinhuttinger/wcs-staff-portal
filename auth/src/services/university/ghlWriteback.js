// WCS University — GHL write-back (the visible mirror, spec §9.1).
//
// Supabase is the ledger; GHL custom fields are what trainees/managers see on
// the contact. We mirror: last_call_score / last_call_summary after each grade,
// the grade-gated competency booleans on a fresh pass, and the graduation
// rollup. Field ids are resolved by fieldKey via the shared ghlCustomFields
// cache. Missing fields are logged and skipped — never fatal (matches the
// click2save / referral patterns: GHL write-back is a downstream side effect).
//
// The GHL custom fields must be created by hand in each location (the GHL API
// can't create custom fields — see reference_clickup_custom_fields). The keys
// this module writes are listed in services/university/README.md.

const { getLocationById } = require('../../config/ghlLocations')
const { getFieldId } = require('../ghlCustomFields')
const { ghlFetch } = require('../ghlClient')

// fieldKey namespace for contact custom fields in GHL.
const KEY = k => `contact.${k}`

// Resolve { id, apiKey } for a GHL location id, or null if unconfigured.
function resolveLocation(locationId) {
  return getLocationById(locationId)
}

// Write a map of { fieldKey: value } onto an existing GHL contact. Resolves
// each field id (skipping unknown keys with a warn), then issues one PUT.
// Returns { ok, written, skipped } — never throws.
async function pushContactFields(contactId, locationId, fieldMap) {
  const loc = resolveLocation(locationId)
  if (!contactId || !loc) {
    console.warn(`[university/ghl] skip write: missing contact_id or no GHL config for location ${locationId}`)
    return { ok: false, written: [], skipped: Object.keys(fieldMap || {}) }
  }

  const written = []
  const skipped = []
  const customFields = []

  for (const [key, value] of Object.entries(fieldMap || {})) {
    if (value === undefined || value === null) { skipped.push(key); continue }
    const fieldId = await getFieldId(loc.id, loc.apiKey, KEY(key)).catch(() => null)
    if (!fieldId) {
      console.warn(`[university/ghl] field ${KEY(key)} not found in ${loc.name} — create it in GHL`)
      skipped.push(key)
      continue
    }
    customFields.push({ id: fieldId, field_value: typeof value === 'boolean' ? String(value) : value })
    written.push(key)
  }

  if (customFields.length === 0) return { ok: false, written, skipped }

  try {
    await ghlFetch(`/contacts/${contactId}`, loc.apiKey, { method: 'PUT', body: { customFields } })
    return { ok: true, written, skipped }
  } catch (err) {
    console.warn(`[university/ghl] contact ${contactId} update failed:`, err.message)
    return { ok: false, written: [], skipped: written.concat(skipped) }
  }
}

// After a grade: mirror last_call_score + last_call_summary.
async function mirrorCallSummary({ contactId, locationId, score, summary }) {
  return pushContactFields(contactId, locationId, {
    last_call_score: score != null ? String(Math.round(score)) : null,
    last_call_summary: summary || null,
  })
}

// On a fresh competency pass: flip the corresponding boolean (e.g.
// roleplay_hard_passed, objection_handling_passed).
async function mirrorMilestonePass({ contactId, locationId, milestoneKey }) {
  return pushContactFields(contactId, locationId, { [`${milestoneKey}_passed`]: true })
}

// On a curriculum milestone: flip the corresponding boolean (e.g.
// mod1_complete, first_call_made).
async function mirrorCurriculum({ contactId, locationId, milestoneKey }) {
  // Curriculum field naming: <key>_complete for module-style keys, but the
  // spec also uses first_call_made verbatim. Honor an explicit field name when
  // the key already reads like a boolean flag; otherwise append _complete.
  const field = /_(made|complete|passed|done)$/.test(milestoneKey)
    ? milestoneKey
    : `${milestoneKey}_complete`
  return pushContactFields(contactId, locationId, { [field]: true })
}

// On graduation recompute: mirror the rollup.
async function mirrorGraduation({ contactId, locationId, progressPct, eligible }) {
  return pushContactFields(contactId, locationId, {
    graduation_progress_pct: progressPct != null ? String(Math.round(progressPct)) : null,
    graduation_eligible: !!eligible,
  })
}

module.exports = {
  pushContactFields,
  mirrorCallSummary,
  mirrorMilestonePass,
  mirrorCurriculum,
  mirrorGraduation,
}
