/**
 * /admin/save - admin config + review for WCS Save, our member cancellation and
 * retention flow (Click2Save replacement).
 *
 * The member-facing side is the wcs-save Cloudflare Worker. It reads
 * save_settings / save_reasons / save_offers and writes save_requests with the
 * service key. This router only edits config and reviews requests; the portal
 * never calls the Worker. Tables come from migration 211.
 *
 * GET  /settings              the single settings row
 * PUT  /settings              update whitelisted settings columns
 * GET  /reasons               all reasons, sort_order
 * POST /reasons               add one
 * PUT  /reasons/:id           edit one (partial)
 * DELETE /reasons/:id         remove one (also drops it from offers' reason_ids)
 * GET  /offers                all offers, priority
 * POST /offers                add one
 * PUT  /offers/:id            edit one (merged with the stored row, then validated)
 * DELETE /offers/:id          remove one
 * GET  /rules                 cancel rules per plan kind (migration 213)
 * PUT  /rules/:planKind       edit notice_days / early_cancel_fee / send_to_staff
 * GET  /requests              ?outcome=&club=&limit=&needs_action=1 newest first
 * GET  /requests/:id          one request incl. abc_actions
 * PUT  /requests/:id/resolve  { note } mark a needs-action request handled
 *
 * "Needs action" = (outcome = needs_staff OR staff_reason is set) AND not
 * resolved. A perk is recorded as outcome = saved with staff_reason set.
 * GET  /stats?days=30         totals, save rate, by offer, by reason
 *
 * Validation lives in services/saveOffersSchema.js (unit tested).
 */

const { Router } = require('express')
const { supabaseAdmin } = require('../services/supabase')
const authenticate = require('../middleware/auth')
const { requireRole } = require('../middleware/role')
const {
  CLUB_NUMBERS,
  OUTCOMES,
  isUuid,
  validateSettings,
  validateReason,
  validateOffer,
  isPlanKind,
  validateCancelRule,
  sortCancelRules,
  parseLimit,
  parseDays,
  computeStats,
} = require('../services/saveOffersSchema')

const router = Router()
router.use(authenticate)
router.use(requireRole('admin'))

// The list view does not need the heavy jsonb columns; the detail view does.
const REQUEST_LIST_COLUMNS = [
  'id', 'club_number', 'member_id', 'member_name', 'email', 'reason_id', 'reason_label',
  'offer_id', 'offer_snapshot', 'outcome', 'staff_reason', 'cancel_date', 'dry_run',
  'completed_at', 'resolved_at', 'resolution_note', 'created_at',
].join(',')

// PostgREST filter for "staff has to do something": see needsAction() in
// saveOffersSchema.js. Combine with .is('resolved_at', null).
const NEEDS_ACTION_OR = 'outcome.eq.needs_staff,staff_reason.not.is.null'

function staffId(req) {
  return req.staff?.id || null
}

function badRequest(res, result) {
  return res.status(400).json({ error: result.error, fields: result.fields })
}

function serverError(res, label, err) {
  console.error(`[save-admin] ${label}:`, err?.message || err)
  // Most likely cause before merge-day: migration 211 not applied yet.
  const msg = err?.message || ''
  const missing = /relation .* does not exist|Could not find the table/i.test(msg)
  const migration = /save_cancel_rules/.test(msg) ? '213' : '211'
  return res.status(500).json({
    error: missing ? `Save tables not found. Apply migration ${migration}.` : `Failed to ${label}`,
  })
}

async function knownReasonIds() {
  const { data, error } = await supabaseAdmin.from('save_reasons').select('id')
  if (error) throw error
  return new Set((data || []).map(r => r.id))
}

// ---------------------------------------------------------------- settings

router.get('/settings', async (req, res) => {
  try {
    const { data, error } = await supabaseAdmin.from('save_settings').select('*').eq('id', 1).maybeSingle()
    if (error) throw error
    res.json({ settings: data || null })
  } catch (err) {
    serverError(res, 'load settings', err)
  }
})

router.put('/settings', async (req, res) => {
  const result = validateSettings(req.body)
  if (!result.ok) return badRequest(res, result)
  try {
    const patch = { ...result.patch, updated_at: new Date().toISOString(), updated_by: staffId(req) }
    // Upsert so a missing seed row (it is inserted by the migration) never 404s.
    const { data, error } = await supabaseAdmin
      .from('save_settings')
      .upsert({ id: 1, ...patch }, { onConflict: 'id' })
      .select('*')
      .single()
    if (error) throw error
    res.json({ settings: data })
  } catch (err) {
    serverError(res, 'save settings', err)
  }
})

// ---------------------------------------------------------------- reasons

router.get('/reasons', async (req, res) => {
  try {
    const { data, error } = await supabaseAdmin
      .from('save_reasons')
      .select('*')
      .order('sort_order', { ascending: true })
      .order('created_at', { ascending: true })
    if (error) throw error
    res.json({ reasons: data || [] })
  } catch (err) {
    serverError(res, 'load reasons', err)
  }
})

router.post('/reasons', async (req, res) => {
  const result = validateReason(req.body)
  if (!result.ok) return badRequest(res, result)
  try {
    const row = { ...result.row }
    if (row.sort_order === undefined) {
      // Append to the end of the list.
      const { data: last } = await supabaseAdmin
        .from('save_reasons').select('sort_order').order('sort_order', { ascending: false }).limit(1)
      row.sort_order = ((last && last[0] && last[0].sort_order) || 0) + 10
    }
    const { data, error } = await supabaseAdmin.from('save_reasons').insert(row).select('*').single()
    if (error) throw error
    res.status(201).json({ reason: data })
  } catch (err) {
    serverError(res, 'add reason', err)
  }
})

router.put('/reasons/:id', async (req, res) => {
  if (!isUuid(req.params.id)) return res.status(404).json({ error: 'Reason not found' })
  const result = validateReason(req.body, { partial: true })
  if (!result.ok) return badRequest(res, result)
  if (!Object.keys(result.row).length) return res.status(400).json({ error: 'Nothing to update' })
  try {
    const { data, error } = await supabaseAdmin
      .from('save_reasons')
      .update({ ...result.row, updated_at: new Date().toISOString() })
      .eq('id', req.params.id)
      .select('*')
      .maybeSingle()
    if (error) throw error
    if (!data) return res.status(404).json({ error: 'Reason not found' })
    res.json({ reason: data })
  } catch (err) {
    serverError(res, 'update reason', err)
  }
})

router.delete('/reasons/:id', async (req, res) => {
  const id = req.params.id
  if (!isUuid(id)) return res.status(404).json({ error: 'Reason not found' })
  try {
    // Offers target reasons by id in a uuid[] with no FK. Drop the id from any
    // offer first, or an offer aimed only at this reason would silently turn
    // into "all reasons" (empty array) - or worse, keep a dead id.
    const { data: offers, error: offErr } = await supabaseAdmin
      .from('save_offers').select('id, reason_ids').contains('reason_ids', [id])
    if (offErr) throw offErr
    for (const o of offers || []) {
      const remaining = (o.reason_ids || []).filter(r => r !== id)
      const patch = { reason_ids: remaining, updated_at: new Date().toISOString(), updated_by: staffId(req) }
      // An offer that targeted only this reason would widen to every reason.
      // Turn it off instead so an admin decides.
      if (!remaining.length) patch.active = false
      const { error } = await supabaseAdmin.from('save_offers').update(patch).eq('id', o.id)
      if (error) throw error
    }

    const { data, error } = await supabaseAdmin.from('save_reasons').delete().eq('id', id).select('id')
    if (error) throw error
    if (!data || !data.length) return res.status(404).json({ error: 'Reason not found' })
    res.json({ ok: true, offers_updated: (offers || []).length })
  } catch (err) {
    serverError(res, 'delete reason', err)
  }
})

// ---------------------------------------------------------------- offers

router.get('/offers', async (req, res) => {
  try {
    const { data, error } = await supabaseAdmin
      .from('save_offers')
      .select('*')
      .order('priority', { ascending: true })
      .order('created_at', { ascending: true })
    if (error) throw error
    res.json({ offers: data || [] })
  } catch (err) {
    serverError(res, 'load offers', err)
  }
})

router.post('/offers', async (req, res) => {
  try {
    const result = validateOffer(req.body, { knownReasonIds: await knownReasonIds() })
    if (!result.ok) return badRequest(res, result)
    const { data, error } = await supabaseAdmin
      .from('save_offers')
      .insert({ ...result.row, updated_by: staffId(req) })
      .select('*')
      .single()
    if (error) throw error
    res.status(201).json({ offer: data })
  } catch (err) {
    serverError(res, 'add offer', err)
  }
})

router.put('/offers/:id', async (req, res) => {
  const id = req.params.id
  if (!isUuid(id)) return res.status(404).json({ error: 'Offer not found' })
  try {
    const { data: existing, error: getErr } = await supabaseAdmin
      .from('save_offers').select('*').eq('id', id).maybeSingle()
    if (getErr) throw getErr
    if (!existing) return res.status(404).json({ error: 'Offer not found' })

    // Merge so the list's active toggle can send just { active }. Everything
    // is revalidated, so a stored row never gets worse by being edited.
    const body = req.body && typeof req.body === 'object' ? req.body : {}
    const merged = { ...existing, ...body }
    if (body.offer_type && body.offer_type !== existing.offer_type && !('config' in body)) merged.config = {}
    const result = validateOffer(merged, { knownReasonIds: await knownReasonIds() })
    if (!result.ok) return badRequest(res, result)

    const { data, error } = await supabaseAdmin
      .from('save_offers')
      .update({ ...result.row, updated_at: new Date().toISOString(), updated_by: staffId(req) })
      .eq('id', id)
      .select('*')
      .single()
    if (error) throw error
    res.json({ offer: data })
  } catch (err) {
    serverError(res, 'update offer', err)
  }
})

router.delete('/offers/:id', async (req, res) => {
  if (!isUuid(req.params.id)) return res.status(404).json({ error: 'Offer not found' })
  try {
    // save_requests.offer_id is ON DELETE SET NULL and each request keeps its
    // own offer_snapshot, so history survives the delete.
    const { data, error } = await supabaseAdmin.from('save_offers').delete().eq('id', req.params.id).select('id')
    if (error) throw error
    if (!data || !data.length) return res.status(404).json({ error: 'Offer not found' })
    res.json({ ok: true })
  } catch (err) {
    serverError(res, 'delete offer', err)
  }
})

// ---------------------------------------------------------------- cancel rules
// One row per plan kind, seeded by migration 213. The Worker uses them to work
// out what a member owes to cancel. Rows are never added or removed here.

router.get('/rules', async (req, res) => {
  try {
    const { data, error } = await supabaseAdmin.from('save_cancel_rules').select('*')
    if (error) throw error
    res.json({ rules: sortCancelRules(data) })
  } catch (err) {
    serverError(res, 'load cancel rules', err)
  }
})

router.put('/rules/:planKind', async (req, res) => {
  const planKind = req.params.planKind
  if (!isPlanKind(planKind)) return res.status(404).json({ error: 'Cancel rule not found' })
  const result = validateCancelRule(req.body)
  if (!result.ok) return badRequest(res, result)
  try {
    const { data, error } = await supabaseAdmin
      .from('save_cancel_rules')
      .update({ ...result.patch, updated_at: new Date().toISOString(), updated_by: staffId(req) })
      .eq('plan_kind', planKind)
      .select('*')
      .maybeSingle()
    if (error) throw error
    if (!data) return res.status(404).json({ error: 'Cancel rule not found. Apply migration 213.' })
    res.json({ rule: data })
  } catch (err) {
    serverError(res, 'save cancel rule', err)
  }
})

// ---------------------------------------------------------------- requests

router.get('/requests', async (req, res) => {
  const outcome = String(req.query.outcome || '').trim()
  const club = String(req.query.club || '').trim()
  if (outcome && !OUTCOMES.includes(outcome)) return res.status(400).json({ error: `Unknown outcome ${outcome}` })
  if (club && !CLUB_NUMBERS.includes(club)) return res.status(400).json({ error: `Unknown club ${club}` })
  const limit = parseLimit(req.query.limit)
  const needsActionOnly = ['1', 'true'].includes(String(req.query.needs_action || '').toLowerCase())
  try {
    let q = supabaseAdmin
      .from('save_requests')
      .select(REQUEST_LIST_COLUMNS)
      .order('created_at', { ascending: false })
      .limit(limit)
    if (outcome) q = q.eq('outcome', outcome)
    if (club) q = q.eq('club_number', club)
    if (needsActionOnly) q = q.or(NEEDS_ACTION_OR).is('resolved_at', null)
    const { data, error } = await q
    if (error) throw error
    res.json({ requests: data || [], limit })
  } catch (err) {
    serverError(res, 'load requests', err)
  }
})

router.get('/requests/:id', async (req, res) => {
  if (!isUuid(req.params.id)) return res.status(404).json({ error: 'Request not found' })
  try {
    const { data, error } = await supabaseAdmin
      .from('save_requests').select('*').eq('id', req.params.id).maybeSingle()
    if (error) throw error
    if (!data) return res.status(404).json({ error: 'Request not found' })
    res.json({ request: data })
  } catch (err) {
    serverError(res, 'load request', err)
  }
})

router.put('/requests/:id/resolve', async (req, res) => {
  if (!isUuid(req.params.id)) return res.status(404).json({ error: 'Request not found' })
  const note = String(req.body?.note ?? '').trim()
  if (note.length > 2000) return res.status(400).json({ error: 'Keep the note under 2000 characters' })
  try {
    const { data, error } = await supabaseAdmin
      .from('save_requests')
      .update({
        resolved_at: new Date().toISOString(),
        resolved_by: staffId(req),
        resolution_note: note || null,
        updated_at: new Date().toISOString(),
      })
      .eq('id', req.params.id)
      .select('*')
      .maybeSingle()
    if (error) throw error
    if (!data) return res.status(404).json({ error: 'Request not found' })
    res.json({ request: data })
  } catch (err) {
    serverError(res, 'resolve request', err)
  }
})

// ---------------------------------------------------------------- stats

router.get('/stats', async (req, res) => {
  const days = parseDays(req.query.days)
  const since = new Date(Date.now() - days * 86400000).toISOString()
  try {
    // Page through the window. Volume is small (a cancel flow), but never
    // trust PostgREST's default 1000-row cap to be "enough".
    const rows = []
    const PAGE = 1000
    for (let from = 0; ; from += PAGE) {
      const { data, error } = await supabaseAdmin
        .from('save_requests')
        .select('outcome, offer_id, offer_snapshot, reason_label, staff_reason, resolved_at')
        .gte('created_at', since)
        .order('created_at', { ascending: false })
        .range(from, from + PAGE - 1)
      if (error) throw error
      rows.push(...(data || []))
      if (!data || data.length < PAGE) break
    }
    const stats = computeStats(rows)

    // The open needs-action queue is not limited to the window: an old one
    // that nobody finished is exactly what this number is for.
    const { count, error: cntErr } = await supabaseAdmin
      .from('save_requests')
      .select('id', { count: 'exact', head: true })
      .or(NEEDS_ACTION_OR)
      .is('resolved_at', null)
    if (cntErr) throw cntErr

    res.json({ days, since, ...stats, needs_action_open_all_time: count || 0 })
  } catch (err) {
    serverError(res, 'load stats', err)
  }
})

module.exports = router
