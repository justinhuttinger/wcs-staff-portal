'use strict'

const { Router } = require('express')
const { getLocationById } = require('../config/ghlLocations')
const { ghlFetch } = require('../services/ghlClient')
const { mapWebhookToFormData } = require('../services/dayOneProgram/intake')
const { generateProgram } = require('../services/dayOneProgram/generate')
const { buildProgramPdf } = require('../services/dayOneProgram/pdf')
const deliver = require('../services/dayOneProgram/deliver')
const jobs = require('../services/dayOneProgram/jobs')
const { renderSuccessPage } = require('../services/dayOneProgram/successPage')
const { supabaseAdmin } = require('../services/supabase')

const router = Router()

// Resolve a GHL contact to the fields we need.
async function fetchContact(contactId, club) {
  const data = await ghlFetch(`/contacts/${contactId}`, club.apiKey)
  const c = data.contact || {}
  return {
    id: c.id,
    name: c.name || 'Client',
    firstName: c.firstName || '',
    lastName: c.lastName || '',
    email: c.email,
    phone: c.phone,
  }
}

// Background pipeline. Updates the job row as it advances (SSE reads the row).
async function runPipeline(jobId, contactId, club, formData, abcMemberId) {
  try {
    await jobs.setProgress(jobId, 'generating', 'Fetching client details')
    const contact = await fetchContact(contactId, club)
    await jobs.attachContact(jobId, contact.name, contact.email)
    await jobs.setProgress(jobId, 'generating', 'Designing your workouts')

    const program = await generateProgram(contact, formData)
    program.trainerName = formData.trainerName || ''
    program.medicalScreening = {
      heartCondition: formData.heartCondition || 'No',
      chestPain: formData.chestPain || 'No',
      boneJointProblem: formData.boneJointProblem || 'No',
      bloodPressureMedication: formData.bloodPressureMedication || 'No',
      medicalSupervisionNeeded: formData.medicalSupervisionNeeded || 'No',
    }
    await jobs.attachProgram(jobId, program)

    await jobs.setProgress(jobId, 'rendering', 'Building your PDF')
    const pdfBuffer = await buildProgramPdf(contact, program)

    // Persist PDF (non-fatal). Once stored, the success page can show it
    // immediately (SSE emits 'done' on pdf_path) while email/ABC finish below.
    try {
      const pdfPath = await jobs.uploadPdfToStorage(jobId, pdfBuffer)
      await jobs.attachPdf(jobId, pdfPath)
      await jobs.setProgress(jobId, 'ready', 'Your program is ready')
    } catch (e) {
      console.warn('[DayOne] PDF storage save failed (continuing):', e.message)
    }

    await jobs.setProgress(jobId, 'delivering', 'Sending to the client')
    // Email + ABC are independent: one failing must not block the other.
    try { await deliver.sendProgramEmail(contact, club, pdfBuffer); await jobs.markFlags(jobId, { emailed: true }) }
    catch (e) { console.warn('[DayOne] Email failed:', e.message) }

    if (abcMemberId && club.clubCode) {
      try { await deliver.uploadToABC(abcMemberId, club.clubCode, pdfBuffer, contact); await jobs.markFlags(jobId, { uploadedAbc: true }) }
      catch (e) { console.warn('[DayOne] ABC upload failed:', e.message) }
    }

    await jobs.markComplete(jobId)
  } catch (err) {
    console.error('[DayOne] Pipeline error:', err)
    await jobs.markError(jobId, err.message).catch(() => {})
    await deliver.sendErrorNotification(err, contactId, club).catch(() => {})
  }
}

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

    const job = await jobs.createJob({
      contactId,
      locationId,
      clubCode: club.clubCode,
      trainerName: formData.trainerName,
      abcMemberId,
    })

    // Respond immediately; run generation in the background.
    res.status(200).json({ message: 'Program generation started', jobId: job.id, success: true })
    runPipeline(job.id, contactId, club, formData, abcMemberId)
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

  const send = (event, data) => res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`)

  async function tick() {
    if (closed) return
    try {
      const row = contactId ? await jobs.getLatestForContact(contactId) : null
      if (row) {
        send('progress', { status: row.status, progress: row.progress })
        // PDF is ready the moment it's stored — don't make the user wait for
        // email/ABC delivery to finish.
        if (row.pdf_path || row.status === 'complete') { send('done', { jobId: row.id }); return res.end() }
        if (row.status === 'error') { send('failed', { error: row.error_message }); return res.end() }
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
router.get('/success', (req, res) => {
  res.set('Content-Type', 'text/html')
  res.send(renderSuccessPage(req.query.contactId))
})

module.exports = router
