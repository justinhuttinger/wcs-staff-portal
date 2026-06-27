const { Router } = require('express')
const { supabaseAdmin } = require('../services/supabase')
const { clubNumberForLocationName } = require('../config/clubMap')
const { buildTourWebhookPayload } = require('../lib/tourWebhook')

const router = Router()

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

    const base = supabaseAdmin
      .from('tour_intakes')
      .select(SELECT_COLS)
      .eq('location_id', ctx.location.id)
      .order('received_at', { ascending: false })
      .limit(200)

    const { data: ready } = await base.eq('status', 'ready')
    const { data: completed } = await supabaseAdmin
      .from('tour_intakes')
      .select(SELECT_COLS)
      .eq('location_id', ctx.location.id)
      .eq('status', 'completed')
      .order('received_at', { ascending: false })
      .limit(200)

    res.json({
      location_name: ctx.location.name,
      day_one_base_url: ctx.cfg.day_one_base_url || null,
      ready: ready || [],
      completed: completed || [],
    })
  } catch (err) {
    console.error('[public-tour] list failed:', err.message)
    res.status(500).json({ error: 'internal error' })
  }
})

// GET /public/tour/:token/employees -> active ABC employees for the club, A-Z
router.get('/:token/employees', async (req, res) => {
  try {
    const ctx = await resolveToken(req.params.token)
    if (!ctx) return res.status(404).json({ error: 'not found' })
    const club = clubNumberForLocationName(ctx.location.name)
    if (!club) return res.json({ employees: [] })

    const { data } = await supabaseAdmin
      .from('abc_employees')
      .select('employee_id, full_name, first_name, last_name')
      .eq('club_number', club)
      .ilike('status', 'active') // case-insensitive: ABC status is lowercase today but not guaranteed
    const employees = (data || [])
      .map(e => ({
        id: e.employee_id,
        name: e.full_name || [e.first_name, e.last_name].filter(Boolean).join(' '),
      }))
      .filter(e => e.name)
      .sort((a, b) => a.name.localeCompare(b.name))
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
    const newStatus = status === 'cancelled' ? 'cancelled' : 'completed'
    if (newStatus === 'completed' && !ALLOWED_OUTCOMES.includes(outcome)) {
      return res.status(400).json({ error: 'invalid outcome' })
    }

    // Confirm the intake belongs to this token's location before mutating.
    const { data: existing } = await supabaseAdmin
      .from('tour_intakes')
      .select('id, location_id')
      .eq('id', req.params.id)
      .maybeSingle()
    if (!existing || existing.location_id !== ctx.location.id) {
      return res.status(404).json({ error: 'not found' })
    }

    const updates = {
      status: newStatus,
      tour_member: tour_member || null,
      outcome: newStatus === 'completed' ? outcome : null,
      notes: notes || null,
      completed_at: new Date().toISOString(),
    }
    const { data: updated, error } = await supabaseAdmin
      .from('tour_intakes')
      .update(updates)
      .eq('id', req.params.id)
      .select(SELECT_COLS)
      .single()
    if (error) {
      console.error('[public-tour] update failed:', error.message)
      return res.status(500).json({ error: 'failed to save' })
    }

    // Fire the per-location webhook if configured (non-fatal, fire-and-forget).
    if (ctx.cfg.webhook_url && newStatus === 'completed') {
      const payload = buildTourWebhookPayload(ctx.location, updated)
      fetch(ctx.cfg.webhook_url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      }).catch(e => console.error('[public-tour] webhook post failed:', e.message))
    }

    res.json({ tour_intake: updated })
  } catch (err) {
    console.error('[public-tour] patch error:', err.message)
    res.status(500).json({ error: 'internal error' })
  }
})

module.exports = router
