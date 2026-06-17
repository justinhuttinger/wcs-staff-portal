// WCS University — milestone ledger + graduation (spec §9.5–§9.8).
//
// trainee_milestones is the per-trainee/per-milestone ledger. Competency
// milestones flip only when a graded score clears the configured bar (a
// completed call is not a passed call, §9.2). trainee_graduation is the
// computed rollup, recomputed after any milestone change and mirrored to GHL.

const { supabaseAdmin } = require('../supabase')
const { getMilestoneConfig, resolveThreshold } = require('./config')
const ghl = require('./ghlWriteback')

// Upsert one ledger row. Returns { row, justFlippedToPassed }.
//   - increments attempts
//   - tracks best_score (competency only)
//   - flips passed=true the first time passedNow is true (records session + ts)
async function upsertTraineeMilestone({ traineeId, milestoneKey, milestoneType, score, sessionId, passedNow }) {
  const nowIso = new Date().toISOString()

  const { data: existing } = await supabaseAdmin
    .from('trainee_milestones')
    .select('*')
    .eq('trainee_id', traineeId)
    .eq('milestone_key', milestoneKey)
    .maybeSingle()

  const wasPassed = !!existing?.passed
  const willPass = wasPassed || !!passedNow
  const justFlippedToPassed = !wasPassed && !!passedNow

  const prevBest = typeof existing?.best_score === 'number' ? existing.best_score : null
  const bestScore = score != null
    ? (prevBest != null ? Math.max(prevBest, score) : score)
    : prevBest

  const row = {
    trainee_id: traineeId,
    milestone_key: milestoneKey,
    milestone_type: milestoneType,
    passed: willPass,
    best_score: bestScore,
    attempts: (existing?.attempts || 0) + 1,
    first_attempt_at: existing?.first_attempt_at || nowIso,
    passed_session_id: existing?.passed_session_id || (justFlippedToPassed ? (sessionId || null) : null),
    passed_at: existing?.passed_at || (justFlippedToPassed ? nowIso : null),
  }

  const { data, error } = await supabaseAdmin
    .from('trainee_milestones')
    .upsert(row, { onConflict: 'trainee_id,milestone_key' })
    .select()
    .single()
  if (error) throw new Error(`milestone upsert failed: ${error.message}`)

  return { row: data, justFlippedToPassed }
}

// Apply competency progress from a graded call (spec §9.7). Flips the
// difficulty milestone (roleplay_<difficulty>) and, when present, the
// objection_handling milestone from stage_scores. Mirrors fresh passes to GHL,
// then recomputes graduation.
async function applyMilestoneProgress(session, grade) {
  const cfg = await getMilestoneConfig()
  const results = []

  // 1. roleplay_<difficulty>
  const difficultyKey = `roleplay_${session.difficulty}`
  if ((cfg.milestones || []).some(m => m.key === difficultyKey)) {
    const threshold = resolveThreshold(cfg, difficultyKey)
    const passedNow = grade.overall_score != null && grade.overall_score >= threshold
    const { justFlippedToPassed } = await upsertTraineeMilestone({
      traineeId: session.trainee_id,
      milestoneKey: difficultyKey,
      milestoneType: 'competency',
      score: grade.overall_score,
      sessionId: session.id,
      passedNow,
    })
    results.push({ key: difficultyKey, passedNow, justFlippedToPassed })
    if (justFlippedToPassed && session.contact_id) {
      await ghl.mirrorMilestonePass({ contactId: session.contact_id, locationId: session.location_id, milestoneKey: difficultyKey })
    }
  }

  // 2. objection_handling (from the per-dimension score)
  const objKey = 'objection_handling'
  const objScore = grade.stage_scores?.objection_handling
  if ((cfg.milestones || []).some(m => m.key === objKey) && objScore != null) {
    const threshold = resolveThreshold(cfg, objKey)
    const passedNow = objScore >= threshold
    const { justFlippedToPassed } = await upsertTraineeMilestone({
      traineeId: session.trainee_id,
      milestoneKey: objKey,
      milestoneType: 'competency',
      score: objScore,
      sessionId: session.id,
      passedNow,
    })
    results.push({ key: objKey, passedNow, justFlippedToPassed })
    if (justFlippedToPassed && session.contact_id) {
      await ghl.mirrorMilestonePass({ contactId: session.contact_id, locationId: session.location_id, milestoneKey: objKey })
    }
  }

  const graduation = await recomputeGraduation(session.trainee_id, session.contact_id, session.location_id)
  return { milestones: results, graduation }
}

// Record a curriculum milestone (event-driven, spec §9.7). Idempotent: passed
// stays true. Mirrors the boolean to GHL and recomputes graduation.
async function recordCurriculumMilestone({ traineeId, milestoneKey, contactId, locationId }) {
  const { justFlippedToPassed } = await upsertTraineeMilestone({
    traineeId,
    milestoneKey,
    milestoneType: 'curriculum',
    score: null,
    sessionId: null,
    passedNow: true,
  })
  if (justFlippedToPassed && contactId) {
    await ghl.mirrorCurriculum({ contactId, locationId, milestoneKey })
  }
  const graduation = await recomputeGraduation(traineeId, contactId, locationId)
  return { justFlippedToPassed, graduation }
}

// Recompute eligibility from the ledger against config (spec §9.8). Writes
// trainee_graduation and mirrors the rollup to GHL.
async function recomputeGraduation(traineeId, contactId, locationId) {
  const cfg = await getMilestoneConfig()
  const required = (cfg.milestones || []).filter(m => m.required).map(m => m.key)

  const { data: ledger } = await supabaseAdmin
    .from('trainee_milestones')
    .select('milestone_key, passed')
    .eq('trainee_id', traineeId)

  const passedKeys = new Set((ledger || []).filter(r => r.passed).map(r => r.milestone_key))
  const completed = required.filter(k => passedKeys.has(k))
  const pct = required.length ? Math.round((completed.length / required.length) * 100) : 0
  const eligible = required.length > 0 && completed.length === required.length

  const { data, error } = await supabaseAdmin
    .from('trainee_graduation')
    .upsert({
      trainee_id: traineeId,
      progress_pct: pct,
      eligible,
      required_milestones: required,
      completed_milestones: completed,
      evaluated_at: new Date().toISOString(),
    }, { onConflict: 'trainee_id' })
    .select()
    .single()
  if (error) throw new Error(`graduation upsert failed: ${error.message}`)

  if (contactId) {
    await ghl.mirrorGraduation({ contactId, locationId, progressPct: pct, eligible })
  }

  return data
}

module.exports = {
  upsertTraineeMilestone,
  applyMilestoneProgress,
  recordCurriculumMilestone,
  recomputeGraduation,
}
