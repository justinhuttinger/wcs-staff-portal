const { Router } = require('express')
const rateLimit = require('express-rate-limit')
const { supabaseAdmin } = require('../services/supabase')
const { validateSubmission } = require('../services/formsSchema')
const formsSheets = require('../services/formsSheets')
const formsAudit = require('../services/formsAudit')

// Public form renderer endpoints. Intentionally NOT behind authenticate:
// anyone with the URL can view and submit a published form (spec section 7).
// Drafts and archived forms 404. The builder/management API stays in
// routes/forms.js behind auth.
const router = Router()

const submitLimiter = rateLimit({
  windowMs: 60 * 1000,
  limit: 20, // express-rate-limit v8: 'limit', not the deprecated 'max'
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many submissions. Try again in a minute.' },
})

async function loadPublished(slug) {
  const { data } = await supabaseAdmin.from('forms')
    .select('*').eq('slug', slug).eq('status', 'published').maybeSingle()
  return data || null
}

// GET /public/forms/:slug — published schema for rendering.
router.get('/:slug', async (req, res) => {
  try {
    const form = await loadPublished(req.params.slug)
    if (!form) return res.status(404).json({ error: 'This form is not available' })
    const { data: loc } = await supabaseAdmin.from('locations').select('name').eq('id', form.location_id).maybeSingle()
    res.json({
      form: {
        slug: form.slug, title: form.title, description: form.description,
        schema: form.schema, location_name: loc?.name || '',
      },
    })
  } catch (err) {
    console.error('[publicForms] fetch failed:', err.message)
    res.status(500).json({ error: 'Something went wrong. Try again.' })
  }
})

// POST /public/forms/:slug/submit — validate, back up in Supabase, then Sheets.
router.post('/:slug/submit', submitLimiter, async (req, res) => {
  try {
    const form = await loadPublished(req.params.slug)
    if (!form) return res.status(404).json({ error: 'This form is not available' })
    const result = validateSubmission(form.schema, (req.body || {}).data)
    if (!result.ok) return res.status(400).json({ errors: result.errors })

    // 1. Supabase backup first. A Sheets outage never loses a submission.
    const { data: submission, error } = await supabaseAdmin.from('form_submissions')
      .insert({ form_id: form.id, data: result.cleaned }).select('*').single()
    if (error) throw error
    formsAudit.record(form.id, null, 'submission_received', { submission_id: submission.id })

    // 2. Sheets append. Failure is recorded on the row and retried later; the
    // submitter still gets a success.
    if (form.sheet_id) {
      try { await formsSheets.appendSubmission(form, submission) } catch (err) {
        console.error('[publicForms] sheet append failed (backed up):', err.message)
      }
    }
    res.json({ ok: true })
  } catch (err) {
    console.error('[publicForms] submit failed:', err.message)
    res.status(500).json({ error: 'Something went wrong. Try again.' })
  }
})

module.exports = router
