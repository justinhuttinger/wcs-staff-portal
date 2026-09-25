const { Router } = require('express')
const rateLimit = require('express-rate-limit')
const { supabaseAdmin } = require('../services/supabase')
const { validateSubmission, sanitizeUtm } = require('../services/formsSchema')
const { CLUB_SLUGS, publicQuizView, validateContact, quizSettingsWithDefaults } = require('../services/quizSchema')
const formsSheets = require('../services/formsSheets')
const formsAudit = require('../services/formsAudit')
const { deliverWebhook } = require('../services/quizWebhook')

// Public quiz renderer endpoints (no auth). A quiz is reachable only when it
// is published AND the club in the URL is active for it.
const router = Router()

const submitLimiter = rateLimit({
  windowMs: 60 * 1000, limit: 20, standardHeaders: true, legacyHeaders: false,
  message: { error: 'Too many submissions. Try again in a minute.' },
})

async function loadQuiz(clubSlug, slug) {
  const club = String(clubSlug || '').toLowerCase()
  if (!CLUB_SLUGS.includes(club)) return null
  const { data: form } = await supabaseAdmin.from('forms').select('*')
    .eq('slug', slug).eq('kind', 'quiz').eq('status', 'published').maybeSingle()
  if (!form) return null
  // CLUB_SLUGS are plain letters, so ilike here is a case-insensitive equals.
  const { data: location } = await supabaseAdmin.from('locations').select('id, name').ilike('name', club).maybeSingle()
  if (!location) return null
  const { data: clubRow } = await supabaseAdmin.from('quiz_clubs').select('*')
    .eq('form_id', form.id).eq('location_id', location.id).eq('active', true).maybeSingle()
  if (!clubRow) return null
  return { form, location, club: clubRow }
}

router.get('/:club/:slug', async (req, res) => {
  try {
    const ctx = await loadQuiz(req.params.club, req.params.slug)
    if (!ctx) return res.status(404).json({ error: 'This quiz is not available' })
    res.json({ quiz: publicQuizView(ctx.form, ctx.location, ctx.club) })
  } catch (err) {
    console.error('[publicQuizzes] fetch failed:', err.message)
    res.status(500).json({ error: 'Something went wrong. Try again.' })
  }
})

router.post('/:club/:slug/submit', submitLimiter, async (req, res) => {
  try {
    const ctx = await loadQuiz(req.params.club, req.params.slug)
    if (!ctx) return res.status(404).json({ error: 'This quiz is not available' })
    const body = req.body || {}
    const settings = quizSettingsWithDefaults(ctx.form.settings)
    const answers = validateSubmission(ctx.form.schema, body.answers)
    const contact = validateContact(body.contact, settings.contact_step)
    if (!answers.ok || !contact.ok) {
      return res.status(400).json({ errors: { ...answers.errors, ...contact.errors } })
    }
    const hasWebhook = !!ctx.club.ghl_webhook_url
    // Supabase backup first; Sheets + webhook run after the response.
    const { data: submission, error } = await supabaseAdmin.from('form_submissions').insert({
      form_id: ctx.form.id,
      location_id: ctx.location.id,
      data: { ...answers.cleaned, club: ctx.location.name, ...contact.cleaned },
      utm: sanitizeUtm(body.utm),
      webhook_status: hasWebhook ? 'pending' : 'none',
    }).select('*').single()
    if (error) throw error
    formsAudit.record(ctx.form.id, null, 'submission_received', { submission_id: submission.id, location_id: ctx.location.id })
    res.json({ ok: true, redirect_url: settings.thank_you.redirect_url || '' })

    // After the response: neither failure affects the lead. Failures are
    // recorded on the row and retried by the 10-minute sweeps.
    if (ctx.form.sheet_id) {
      formsSheets.appendSubmission(ctx.form, submission)
        .catch(err => console.error('[publicQuizzes] sheet append failed (backed up):', err.message))
    }
    if (hasWebhook) {
      deliverWebhook(submission.id)
        .catch(err => console.error('[publicQuizzes] webhook send threw:', err.message))
    }
  } catch (err) {
    console.error('[publicQuizzes] submit failed:', err.message)
    if (!res.headersSent) res.status(500).json({ error: 'Something went wrong. Try again.' })
  }
})

module.exports = router
