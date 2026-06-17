// WCS University — post-call orchestration.
//
// Given a session whose transcript has been captured, grade it, persist the
// grade, advance the milestone ledger, and mirror summaries to GHL. Designed
// to run detached from the webhook response (fire-and-forget): all failures
// land on the session row as status='failed' + error_detail rather than
// bubbling to the caller.

const { supabaseAdmin } = require('../supabase')
const { gradeTranscript } = require('./grade')
const { applyMilestoneProgress } = require('./milestones')
const { getScenario } = require('./scenarios')
const ghl = require('./ghlWriteback')

// Grade + score a completed session. Idempotent-ish: skips if already graded.
async function processCompletedCall(session) {
  try {
    if (session.status === 'graded') return { skipped: true, reason: 'already graded' }

    const scenario = getScenario(session.scenario)
    const grade = await gradeTranscript({
      transcript: session.transcript,
      scenario: session.scenario,
      difficulty: session.difficulty,
      primaryObjection: scenario.primary_objection,
    })

    // Persist the grade.
    const { data: gradeRow, error: gradeErr } = await supabaseAdmin
      .from('roleplay_grades')
      .insert({
        session_id: session.id,
        trainee_id: session.trainee_id,
        overall_score: grade.overall_score,
        stage_scores: grade.stage_scores,
        strengths: grade.strengths,
        improvements: grade.improvements,
        raw_model_output: grade.raw,
        model: grade.model,
      })
      .select()
      .single()
    if (gradeErr) throw new Error(`grade insert failed: ${gradeErr.message}`)

    // Mark the session graded.
    await supabaseAdmin
      .from('roleplay_sessions')
      .update({ status: 'graded' })
      .eq('id', session.id)

    // Mirror score + summary to the GHL contact.
    if (session.contact_id) {
      await ghl.mirrorCallSummary({
        contactId: session.contact_id,
        locationId: session.location_id,
        score: grade.overall_score,
        summary: grade.strengths || grade.improvements || '',
      })
    }

    // Advance the milestone ledger + graduation rollup.
    const progress = await applyMilestoneProgress(session, grade)

    return { ok: true, grade: gradeRow, progress }
  } catch (err) {
    console.error(`[university] grading failed for session ${session.id}:`, err.message)
    await supabaseAdmin
      .from('roleplay_sessions')
      .update({ status: 'failed', error_detail: err.message })
      .eq('id', session.id)
      .then(() => {}, () => {})
    return { ok: false, error: err.message }
  }
}

module.exports = { processCompletedCall }
