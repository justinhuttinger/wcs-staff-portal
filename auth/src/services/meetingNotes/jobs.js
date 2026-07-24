// auth/src/services/meetingNotes/jobs.js
// Idempotency + audit for the meeting-notes job (table meeting_notes_runs).
'use strict'

const { supabaseAdmin } = require('../supabase')

const T = 'meeting_notes_runs'

// Doc ids already processed successfully (status done). Used to skip re-work.
async function doneDocIds() {
  const { data, error } = await supabaseAdmin.from(T).select('clickup_doc_id').eq('status', 'done')
  if (error) throw new Error(`meeting_notes_runs read failed: ${error.message}`)
  return new Set((data || []).map((r) => r.clickup_doc_id))
}

async function upsertRun(row) {
  const { error } = await supabaseAdmin.from(T)
    .upsert({ ...row, updated_at: new Date().toISOString() }, { onConflict: 'clickup_doc_id' })
  if (error) throw new Error(`meeting_notes_runs upsert failed: ${error.message}`)
}

const markDone = (clickup_doc_id, patch) =>
  upsertRun({ clickup_doc_id, status: 'done', error: null, ...patch })
const markFailed = (clickup_doc_id, meeting, meeting_date, message) =>
  upsertRun({ clickup_doc_id, meeting, meeting_date, status: 'failed', error: String(message || '').slice(0, 2000) })

module.exports = { doneDocIds, upsertRun, markDone, markFailed }
