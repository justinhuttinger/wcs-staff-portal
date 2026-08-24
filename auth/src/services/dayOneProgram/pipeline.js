'use strict'

const { ghlFetch } = require('../ghlClient')
const { generateProgram } = require('./generate')
const { buildProgramPdf } = require('./pdf')
const deliver = require('./deliver')
const jobs = require('./jobs')

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

// Background pipeline. Updates the job row as it advances; both entry points
// (the GHL webhook and the public intake site) read progress from that row.
async function runPipeline(jobId, contactId, club, formData, abcMemberId, brandKey) {
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
    const pdfBuffer = await buildProgramPdf(contact, program, brandKey)

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
    try { await deliver.sendProgramEmail(contact, club, pdfBuffer, brandKey); await jobs.markFlags(jobId, { emailed: true }) }
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

module.exports = { runPipeline, fetchContact }
