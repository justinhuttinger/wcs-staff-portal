'use strict'

const { Router } = require('express')
const { getLocationById } = require('../config/ghlLocations')
const { mapWebhookToFormData } = require('../services/dayOneProgram/intake')
const jobs = require('../services/dayOneProgram/jobs')
const deliver = require('../services/dayOneProgram/deliver')
const { runPipeline } = require('../services/dayOneProgram/pipeline')
const { renderSuccessPage } = require('../services/dayOneProgram/successPage')
const { resolveBrandKey, DEFAULT_BRAND, brandFieldNames } = require('../services/dayOneProgram/brands')
const { supabaseAdmin } = require('../services/supabase')

const router = Router()

// POST /day-one-program/webhook — GHL trigger.
router.post('/webhook', async (req, res) => {
  try {
    const contactId = req.body.contact_id
    const locationId = req.body.location?.id
    if (!contactId) return res.status(400).json({ error: 'Missing contact_id' })
    if (!locationId) return res.status(400).json({ error: 'Missing location.id' })

    const club = getLocationById(locationId)
    if (!club) {
      await deliver.sendErrorNotification(new Error(`Unknown location ${locationId}`), contactId, { name: locationId })
      return res.status(400).json({ error: `Unknown location ${locationId}` })
    }

    const formData = mapWebhookToFormData(req.body)
    const abcMemberId = req.body['ABC Member ID'] || null
    // A GHL custom field on the intake selects the brand (ESAC = black-and-white
    // Eastside branding); everything else stays WCS.
    const brandKey = resolveBrandKey(req.body)
    // Field LABELS only (values can hold client PII). Without this, a run that
    // silently comes out WCS gives no way to see what the payload carried.
    console.log(`[DayOne] brand=${brandKey} branding-fields=[${brandFieldNames(req.body).join(', ')}]`)

    const job = await jobs.createJob({
      contactId,
      locationId,
      clubCode: club.clubCode,
      trainerName: formData.trainerName,
      abcMemberId,
      brand: brandKey,
    })

    // Respond immediately; run generation in the background.
    res.status(200).json({ message: 'Program generation started', jobId: job.id, success: true })
    runPipeline(job.id, contactId, club, formData, abcMemberId, brandKey)
  } catch (err) {
    console.error('[DayOne] Webhook error:', err)
    if (!res.headersSent) res.status(500).json({ error: err.message })
  }
})

// GET /day-one-program/status/stream?contactId=... — SSE progress for the latest job.
router.get('/status/stream', async (req, res) => {
  const contactId = req.query.contactId
  res.set({ 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive' })
  res.flushHeaders?.()

  let closed = false
  req.on('close', () => { closed = true })

  const startedAt = Date.now()
  const MAX_MS = 2 * 60 * 1000

  // When the trainer re-runs the SAME client, the latest row we first see may be
  // their PREVIOUS completed run (already has a pdf_path). If we acted on it the
  // page would instantly open the old program. So: if the first job we observe is
  // already finished, treat it as a stale baseline and wait for the NEW job (a
  // different id) created by this submission to finish instead.
  let baselineChecked = false
  let staleId = null

  const send = (event, data) => res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`)

  async function tick() {
    if (closed) return
    try {
      const row = contactId ? await jobs.getLatestForContact(contactId) : null
      if (row) {
        if (!baselineChecked) {
          baselineChecked = true
          // Already-finished latest row at stream open = a prior run for this contact.
          if (row.pdf_path || row.status === 'complete' || row.status === 'error') {
            staleId = row.id
          }
        }
        const isStale = staleId && row.id === staleId
        if (!isStale) {
          send('progress', { status: row.status, progress: row.progress })
          // PDF is ready the moment it's stored — don't make the user wait for
          // email/ABC delivery to finish.
          if (row.pdf_path || row.status === 'complete') { send('done', { jobId: row.id }); return res.end() }
          if (row.status === 'error') { send('failed', { error: row.error_message }); return res.end() }
        }
      }
    } catch (e) {
      // transient read error; keep polling
    }
    if (Date.now() - startedAt > MAX_MS) { send('failed', { error: 'timeout' }); return res.end() }
    setTimeout(tick, 1500)
  }
  tick()
})

// GET /day-one-program/pdf/:jobId — stream the finished PDF.
router.get('/pdf/:jobId', async (req, res) => {
  try {
    const { data, error } = await supabaseAdmin
      .from('pt_programs').select('pdf_path, contact_name').eq('id', req.params.jobId).maybeSingle()
    if (error || !data?.pdf_path) return res.status(404).send('Program PDF not found')
    const buf = await jobs.downloadPdfFromStorage(data.pdf_path)
    const safeName = data.contact_name
      ? data.contact_name.replace(/[^A-Za-z0-9_-]/g, '_')
      : null
    const filename = safeName ? `Training_Program_${safeName}.pdf` : 'Training_Program.pdf'
    res.set({ 'Content-Type': 'application/pdf', 'Content-Disposition': `inline; filename="${filename}"` })
    res.send(buf)
  } catch (e) {
    res.status(500).send('Error loading PDF')
  }
})

// GET /day-one-program/success?contactId=... — the SSE success page.
// Brand comes from ?brand= when the redirect carries it, otherwise from the job
// row this contact just created (a stale row still brands correctly - a contact
// does not change clubs mid-session).
router.get('/success', async (req, res) => {
  let brandKey = req.query.brand || null
  if (!brandKey && req.query.contactId) {
    try { brandKey = (await jobs.getLatestForContact(req.query.contactId))?.brand || null }
    catch (e) { console.warn('[DayOne] Brand lookup failed:', e.message) }
  }
  res.set('Content-Type', 'text/html')
  res.send(renderSuccessPage(req.query.contactId, brandKey || DEFAULT_BRAND))
})

module.exports = router
