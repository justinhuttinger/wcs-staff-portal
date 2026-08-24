'use strict'

const { supabaseAdmin } = require('../supabase')

const BUCKET = 'pt-programs'

async function createJob(fields) {
  const { data, error } = await supabaseAdmin.from('pt_programs').insert({
    contact_id: fields.contactId,
    contact_name: fields.contactName || null,
    contact_email: fields.contactEmail || null,
    location_id: fields.locationId || null,
    club_code: fields.clubCode || null,
    trainer_name: fields.trainerName || null,
    brand: fields.brand || 'wcs',
    abc_member_id: fields.abcMemberId || null,
    status: 'pending',
    progress: 'Queued',
  }).select('id').single()
  if (error) throw new Error(`createJob failed: ${error.message}`)
  return data
}

async function update(id, patch) {
  const { error } = await supabaseAdmin.from('pt_programs')
    .update({ ...patch, updated_at: new Date().toISOString() }).eq('id', id)
  if (error) throw new Error(`pt_programs update failed: ${error.message}`)
}

const setProgress = (id, status, progress) => update(id, { status, progress })
const attachContact = (id, contactName, contactEmail) => update(id, { contact_name: contactName || null, contact_email: contactEmail || null })
const attachProgram = (id, programJson) => update(id, { program_json: programJson })
const attachPdf = (id, pdfPath) => update(id, { pdf_path: pdfPath })
const markFlags = (id, { emailed, uploadedAbc }) =>
  update(id, { ...(emailed != null ? { emailed } : {}), ...(uploadedAbc != null ? { uploaded_abc: uploadedAbc } : {}) })
const markComplete = (id) => update(id, { status: 'complete', progress: 'Done', completed_at: new Date().toISOString() })
const markError = (id, message) => update(id, { status: 'error', error_message: String(message || '').slice(0, 2000) })

async function getById(id) {
  const { data, error } = await supabaseAdmin.from('pt_programs')
    .select('*').eq('id', id).maybeSingle()
  if (error) throw new Error(`getById failed: ${error.message}`)
  return data
}

async function getLatestForContact(contactId) {
  const { data, error } = await supabaseAdmin.from('pt_programs')
    .select('*').eq('contact_id', contactId)
    .order('created_at', { ascending: false }).limit(1).maybeSingle()
  if (error) throw new Error(`getLatestForContact failed: ${error.message}`)
  return data
}

async function uploadPdfToStorage(id, pdfBuffer) {
  const pdfPath = `${id}.pdf`
  const { error } = await supabaseAdmin.storage.from(BUCKET)
    .upload(pdfPath, pdfBuffer, { contentType: 'application/pdf', upsert: true })
  if (error) throw new Error(`PDF storage upload failed: ${error.message}`)
  return pdfPath
}

async function downloadPdfFromStorage(pdfPath) {
  const { data, error } = await supabaseAdmin.storage.from(BUCKET).download(pdfPath)
  if (error) throw new Error(`PDF storage download failed: ${error.message}`)
  return Buffer.from(await data.arrayBuffer())
}

module.exports = {
  BUCKET, createJob, setProgress, attachContact, attachProgram, attachPdf, markFlags,
  markComplete, markError, getById, getLatestForContact, uploadPdfToStorage, downloadPdfFromStorage,
}
