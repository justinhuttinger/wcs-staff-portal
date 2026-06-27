const { Router } = require('express')
const { supabaseAdmin } = require('../services/supabase')
const { clubNumberForLocationName } = require('../config/clubMap')
const { buildTourWebhookPayload } = require('../lib/tourWebhook')
const { getLocationBySlug } = require('../config/ghlLocations')
const { ghlFetch } = require('../services/ghlClient')

const router = Router()

// The tour-member list must match what staff see on the Day One booking page:
// the GHL "Day One Booking Team Member" dropdown options. Those are kept in sync
// from the LIVE ABC per-club roster by ghl-sync (employeeSync), so they include
// multi-club people (e.g. owners) that the deduped abc_employees table drops.
// We read the GHL field options directly and fall back to the table on failure.
const DAY_ONE_FIELD_KEY = 'contact.day_one_booking_team_member'
const employeeCache = {} // slug -> { names: string[], at: number }
const EMP_TTL = 30 * 60 * 1000

function optionLabel(o) {
  if (typeof o === 'string') return o
  return (o && (o.label || o.value || o.name || o.option)) || ''
}

// Read the location's GHL "Day One Booking Team Member" options. Returns an array
// of names, or null if this location has no GHL config (caller then falls back).
async function rosterFromGHL(locationName) {
  const slug = (locationName || '').trim().toLowerCase()
  const cached = employeeCache[slug]
  if (cached && (Date.now() - cached.at) < EMP_TTL) return cached.names
  const loc = getLocationBySlug(slug)
  if (!loc) return null
  const data = await ghlFetch(`/locations/${loc.id}/customFields`, loc.apiKey)
  const fields = data.customFields || []
  const field = fields.find(f =>
    f.fieldKey === DAY_ONE_FIELD_KEY ||
    (f.name || '').toLowerCase() === 'day one booking team member')
  const names = (field?.picklistOptions || field?.options || []).map(optionLabel).filter(Boolean)
  employeeCache[slug] = { names, at: Date.now() }
  return names
}

// Fallback: active ABC employees for the location's club from our synced table.
async function rosterFromTable(locationName) {
  const club = clubNumberForLocationName(locationName)
  if (!club) return []
  const { data } = await supabaseAdmin
    .from('abc_employees')
    .select('full_name, first_name, last_name')
    .eq('club_number', club)
    .ilike('status', 'active')
  return (data || [])
    .map(e => e.full_name || [e.first_name, e.last_name].filter(Boolean).join(' '))
    .filter(Boolean)
}

// NOTE: this router is intentionally NOT behind the authenticate middleware.
// Access is gated entirely by the unguessable per-location public_token.

const SELECT_COLS =
  'id, received_at, ghl_contact_id, contact_name, contact_email, contact_phone, ' +
  'photo_base64, location_id, status, outcome, notes, tour_member, completed_at'

const ALLOWED_OUTCOMES = ['Membership Sale', 'Started Trial', 'Started VIP Pass', 'Only Tour']

// Resolve a token -> active config row (+ location). Returns null if not found.
async function resolveToken(token) {
  if (!token) return null
  const { data: cfg } = await supabaseAdmin
    .from('tour_location_config')
    .select('location_id, day_one_base_url, webhook_url, active')
    .eq('public_token', token)
    .maybeSingle()
  if (!cfg || !cfg.active) return null
  const { data: loc } = await supabaseAdmin
    .from('locations')
    .select('id, name')
    .eq('id', cfg.location_id)
    .maybeSingle()
  if (!loc) return null
  return { cfg, location: loc }
}

// GET /public/tour/:token -> location name, day one link, ready + completed queues
router.get('/:token', async (req, res) => {
  try {
    const ctx = await resolveToken(req.params.token)
    if (!ctx) return res.status(404).json({ error: 'not found' })

    // Only the live queue. Completed tours are deleted on outcome-save (the
    // outbound webhook is the record on the way out), so there is no completed list.
    const { data: ready } = await supabaseAdmin
      .from('tour_intakes')
      .select(SELECT_COLS)
      .eq('location_id', ctx.location.id)
      .eq('status', 'ready')
      .order('received_at', { ascending: false })
      .limit(200)

    res.json({
      location_name: ctx.location.name,
      day_one_base_url: ctx.cfg.day_one_base_url || null,
      ready: ready || [],
    })
  } catch (err) {
    console.error('[public-tour] list failed:', err.message)
    res.status(500).json({ error: 'internal error' })
  }
})

// GET /public/tour/:token/employees -> the location's Day One booking team member
// list (matches the GHL field), A-Z. Falls back to the ABC employees table.
router.get('/:token/employees', async (req, res) => {
  try {
    const ctx = await resolveToken(req.params.token)
    if (!ctx) return res.status(404).json({ error: 'not found' })

    let names = null
    try {
      names = await rosterFromGHL(ctx.location.name)
    } catch (err) {
      console.error('[public-tour] GHL roster failed, falling back to table:', err.message)
    }
    if (!names || names.length === 0) {
      names = await rosterFromTable(ctx.location.name)
    }

    const employees = [...new Set(names)]
      .filter(Boolean)
      .sort((a, b) => a.localeCompare(b))
      .map((name, i) => ({ id: String(i), name }))
    res.json({ employees })
  } catch (err) {
    console.error('[public-tour] employees failed:', err.message)
    res.status(500).json({ error: 'internal error' })
  }
})

// PATCH /public/tour/:token/intake/:id -> save outcome, complete, fire webhook
router.patch('/:token/intake/:id', async (req, res) => {
  try {
    const ctx = await resolveToken(req.params.token)
    if (!ctx) return res.status(404).json({ error: 'not found' })

    const { tour_member, outcome, notes, status } = req.body || {}
    const cancelled = status === 'cancelled'
    if (!cancelled && !ALLOWED_OUTCOMES.includes(outcome)) {
      return res.status(400).json({ error: 'invalid outcome' })
    }

    // Confirm the intake belongs to this token's location before mutating.
    const { data: existing } = await supabaseAdmin
      .from('tour_intakes')
      .select(SELECT_COLS)
      .eq('id', req.params.id)
      .maybeSingle()
    if (!existing || existing.location_id !== ctx.location.id) {
      return res.status(404).json({ error: 'not found' })
    }

    // Fire the outbound per-location webhook with the final outcome (it carries
    // everything downstream needs), THEN delete the row. The iPad is a transient
    // queue: completed tours are not retained and there is no Completed tab.
    if (ctx.cfg.webhook_url && !cancelled) {
      const payload = buildTourWebhookPayload(ctx.location, {
        ...existing,
        tour_member: tour_member || null,
        outcome,
        notes: notes || null,
        completed_at: new Date().toISOString(),
      })
      fetch(ctx.cfg.webhook_url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      }).catch(e => console.error('[public-tour] webhook post failed:', e.message))
    }

    const { error } = await supabaseAdmin
      .from('tour_intakes')
      .delete()
      .eq('id', req.params.id)
    if (error) {
      console.error('[public-tour] delete failed:', error.message)
      return res.status(500).json({ error: 'failed to save' })
    }

    res.json({ success: true })
  } catch (err) {
    console.error('[public-tour] patch error:', err.message)
    res.status(500).json({ error: 'internal error' })
  }
})

module.exports = router
