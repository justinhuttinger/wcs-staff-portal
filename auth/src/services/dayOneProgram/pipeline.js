'use strict'

const { ghlFetch } = require('../ghlClient')
const { generateProgram } = require('./generate')
const { buildProgramPdf } = require('./pdf')
const deliver = require('./deliver')
const jobs = require('./jobs')
const { shapeContact } = require('./contact')

// Only the webhook path needs this: it is handed a contact id and nothing else.
async function fetchContact(contactId, club) {
  const data = await ghlFetch(`/contacts/${contactId}`, club.apiKey)
  return shapeContact(data.contact)
}

// Background pipeline shared by both entry points.
//
// `contact` is the client, already known. The intake site collects it on the
// form, so it passes it straight in and no CRM is involved. The GHL webhook
// receives only a `contactId`, so it asks GHL who that is.
async function runPipeline(jobId, { club, formData, brandKey, contact = null, contactId = null, abcMemberId = null }) {
  try {
    let client = contact
    if (!client) {
      await jobs.setProgress(jobId, 'generating', 'Fetching client details')
      client = await fetchContact(contactId, club)
      await jobs.attachContact(jobId, client.name, client.email)
    }
    await jobs.setProgress(jobId, 'generating', 'Designing your workouts')

    const program = await generateProgram(client, formData)
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
    const pdfBuffer = await buildProgramPdf(client, program, brandKey)

    // Persist PDF (non-fatal). Once stored the caller can show it immediately
    // while email/ABC finish below.
    try {
      const pdfPath = await jobs.uploadPdfToStorage(jobId, pdfBuffer)
      await jobs.attachPdf(jobId, pdfPath)
      await jobs.setProgress(jobId, 'ready', 'Your program is ready')
    } catch (e) {
      console.warn('[DayOne] PDF storage save failed (continuing):', e.message)
    }

    await jobs.setProgress(jobId, 'delivering', 'Sending to the client')
    // Email + ABC are independent: one failing must not block the other.
    try { await deliver.sendProgramEmail(client, club, pdfBuffer, brandKey); await jobs.markFlags(jobId, { emailed: true }) }
    catch (e) { console.warn('[DayOne] Email failed:', e.message) }

    if (abcMemberId && club.clubCode) {
      try { await deliver.uploadToABC(abcMemberId, club.clubCode, pdfBuffer, client); await jobs.markFlags(jobId, { uploadedAbc: true }) }
      catch (e) { console.warn('[DayOne] ABC upload failed:', e.message) }
    }

    await jobs.markComplete(jobId)
  } catch (err) {
    console.error('[DayOne] Pipeline error:', err)
    await jobs.markError(jobId, err.message).catch(() => {})
    await deliver.sendErrorNotification(err, contactId || jobId, club).catch(() => {})
  }
}

module.exports = { runPipeline, fetchContact }
