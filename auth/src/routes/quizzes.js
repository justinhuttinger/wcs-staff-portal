const rateLimit = require('express-rate-limit')
const { supabaseAdmin } = require('../services/supabase')
const { buildFormsRouter, loadFormAccess } = require('./formsHandlers')
const { requireQuizBuilder } = require('../services/formsPermissions')
const {
  CLUB_SLUGS, clubRowsView, planClubUpserts, buildWebhookPayload, sampleSubmission,
} = require('../services/quizSchema')
const { postJson, deliverWebhook } = require('../services/quizWebhook')
const formsAudit = require('../services/formsAudit')
const { getAllClubTracking } = require('../services/clubTracking')

// Quiz Funnels management API: the shared forms handlers (kind='quiz') plus
// the per-club webhook/tracking endpoints.
const router = buildFormsRouter({ kind: 'quiz', gate: requireQuizBuilder })
const load = (req, id) => loadFormAccess(req, id, 'quiz')

const testLimiter = rateLimit({
  windowMs: 60 * 1000, limit: 10, standardHeaders: true, legacyHeaders: false,
  message: { error: 'Too many test sends. Try again in a minute.' },
})

// The 7 clubs, as locations rows (other locations rows are not clubs).
async function clubLocations() {
  const { data, error } = await supabaseAdmin.from('locations').select('id, name').order('name')
  if (error) throw error
  return (data || []).filter(l => CLUB_SLUGS.includes(String(l.name).toLowerCase()))
}

async function clubsResponse(form) {
  const [locs, { data: rows }, defaults] = await Promise.all([
    clubLocations(),
    supabaseAdmin.from('quiz_clubs').select('*').eq('form_id', form.id),
    getAllClubTracking(),
  ])
  return clubRowsView(locs, rows || [], form, defaults)
}

router.get('/:id/clubs', async (req, res) => {
  try {
    const { form, access } = await load(req, req.params.id)
    if (!form || !access.view) return res.status(form ? 403 : 404).json({ error: form ? 'No access' : 'Not found' })
    res.json({ clubs: await clubsResponse(form) })
  } catch (err) {
    console.error('[quizzes] clubs load failed:', err.message)
    res.status(500).json({ error: 'Failed to load clubs' })
  }
})

router.put('/:id/clubs', async (req, res) => {
  try {
    const { form, access } = await load(req, req.params.id)
    if (!form || !access.edit) return res.status(form ? 403 : 404).json({ error: form ? 'No access' : 'Not found' })
    const input = Array.isArray(req.body?.clubs) ? req.body.clubs : null
    if (!input) return res.status(400).json({ error: 'clubs must be an array' })
    const [locs, { data: existing }] = await Promise.all([
      clubLocations(),
      supabaseAdmin.from('quiz_clubs').select('*').eq('form_id', form.id),
    ])
    const plan = planClubUpserts(form.id, input, existing || [], locs)
    if (!plan.ok) return res.status(400).json({ error: plan.error })
    if (plan.rows.length) {
      const { error } = await supabaseAdmin.from('quiz_clubs').upsert(plan.rows, { onConflict: 'form_id,location_id' })
      if (error) throw error
    }
    formsAudit.record(form.id, req.staff.id, 'clubs_updated', {
      active: plan.rows.filter(r => r.active).map(r => r.location_id),
    })
    res.json({ clubs: await clubsResponse(form) })
  } catch (err) {
    console.error('[quizzes] clubs save failed:', err.message)
    res.status(500).json({ error: 'Failed to save clubs' })
  }
})

router.post('/:id/clubs/:locationId/test-webhook', testLimiter, async (req, res) => {
  try {
    const { form, access } = await load(req, req.params.id)
    if (!form || !access.edit) return res.status(form ? 403 : 404).json({ error: form ? 'No access' : 'Not found' })
    const [{ data: club }, { data: loc }] = await Promise.all([
      supabaseAdmin.from('quiz_clubs').select('*').eq('form_id', form.id).eq('location_id', req.params.locationId).maybeSingle(),
      supabaseAdmin.from('locations').select('name').eq('id', req.params.locationId).maybeSingle(),
    ])
    if (!club?.ghl_webhook_url) return res.status(400).json({ error: 'Save a webhook URL for this club first' })
    const payload = buildWebhookPayload({ form, clubName: loc?.name || '', submission: sampleSubmission(form), test: true })
    const result = await postJson(club.ghl_webhook_url, payload)
    formsAudit.record(form.id, req.staff.id, 'webhook_test', { location_id: req.params.locationId, status: result.status })
    res.json({ ok: result.ok, status: result.status, response: result.text })
  } catch (err) {
    console.error('[quizzes] test webhook failed:', err.message)
    res.status(500).json({ error: 'Test send failed' })
  }
})

router.post('/:id/submissions/:subId/retry-webhook', async (req, res) => {
  try {
    const { form, access } = await load(req, req.params.id)
    if (!form || !access.edit) return res.status(form ? 403 : 404).json({ error: form ? 'No access' : 'Not found' })
    const { data: sub } = await supabaseAdmin.from('form_submissions')
      .select('id, form_id').eq('id', req.params.subId).maybeSingle()
    if (!sub || sub.form_id !== form.id) return res.status(404).json({ error: 'Not found' })
    const result = await deliverWebhook(sub.id)
    formsAudit.record(form.id, req.staff.id, 'webhook_retry', { submission_id: sub.id, status: result.webhook_status || 'skipped' })
    res.json(result)
  } catch (err) {
    console.error('[quizzes] retry webhook failed:', err.message)
    res.status(500).json({ error: 'Retry failed' })
  }
})

module.exports = router
