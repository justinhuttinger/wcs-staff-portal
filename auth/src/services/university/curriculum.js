// WCS University — guided course engine.
//
// The curriculum is an ordered list of typed steps (university_curriculum, a
// single-row JSONB config). Per-trainee state lives in trainee_progress, keyed
// by email. Completion by step type:
//   explore / info     -> trainee clicks Next (advanceManual)
//   action_webhook     -> GHL automation hits /progress/event (completeEvent),
//                         or trainee clicks Next as a fallback
//   graded_call        -> reconciled on load from passing graded sessions (>= 80)
//   graduation         -> auto when all prior steps complete
//
// reconcileProgress() is the read-path source of truth: every time the trainee
// opens the app it consumes their passing calls into the graded steps (so the
// attribution/grading race doesn't matter — by the time they "come back to the
// University," the calls are graded under their email and get applied).

const { supabaseAdmin } = require('../supabase')

const TTL_MS = 60 * 1000
let _cache = null
let _cachedAt = 0

const FALLBACK = { pass_threshold: 80, steps: [] }

async function getCurriculum() {
  if (_cache && Date.now() - _cachedAt < TTL_MS) return _cache
  const { data, error } = await supabaseAdmin
    .from('university_curriculum').select('config').eq('id', true).maybeSingle()
  if (error) { console.warn('[university/curriculum] load failed:', error.message); return FALLBACK }
  _cache = data?.config || FALLBACK
  _cachedAt = Date.now()
  return _cache
}
function clearCache() { _cache = null; _cachedAt = 0 }

function thresholdFor(step, cfg) {
  return typeof step.pass_threshold === 'number' ? step.pass_threshold
    : (typeof cfg.pass_threshold === 'number' ? cfg.pass_threshold : 80)
}

async function getProgressRow(email) {
  const { data } = await supabaseAdmin
    .from('trainee_progress').select('*').eq('trainee_id', email).maybeSingle()
  return data || { trainee_id: email, completed_steps: [], points: 0, graduated: false, _new: true }
}

// All graded practice calls for this trainee, oldest first, with their score.
async function passingSessions(email) {
  const { data: sess } = await supabaseAdmin
    .from('roleplay_sessions').select('id, created_at, scenario')
    .eq('trainee_id', email).eq('status', 'graded')
    .order('created_at', { ascending: true })
  const ids = (sess || []).map(s => s.id)
  if (!ids.length) return []
  const { data: grades } = await supabaseAdmin
    .from('roleplay_grades').select('session_id, overall_score').in('session_id', ids)
  const scoreBy = {}
  for (const g of grades || []) {
    const v = g.overall_score == null ? null : Number(g.overall_score)
    if (v != null && (scoreBy[g.session_id] == null || v > scoreBy[g.session_id])) scoreBy[g.session_id] = v
  }
  return (sess || []).map(s => ({ id: s.id, created_at: s.created_at, scenario: s.scenario, score: scoreBy[s.id] ?? null }))
}

// Reconcile + return the view model the app renders.
async function reconcileProgress(email, name) {
  const cfg = await getCurriculum()
  const steps = cfg.steps || []
  const row = await getProgressRow(email)

  const completed = Array.isArray(row.completed_steps) ? [...row.completed_steps] : []
  const completedKeys = new Set(completed.map(c => c.key))
  const usedSessions = new Set(completed.filter(c => c.session_id).map(c => c.session_id))
  let points = row.points || 0
  let graduated = !!row.graduated
  let changed = !!row._new

  // Unused passing calls, oldest first — consumed into graded steps in order.
  const sessions = await passingSessions(email)
  const queue = sessions.filter(s => s.score != null && !usedSessions.has(s.id))

  const nowIso = new Date().toISOString()
  let currentKey = null
  let currentStep = null

  for (const step of steps) {
    if (completedKeys.has(step.key)) continue
    if (step.type === 'graded_call') {
      const thr = thresholdFor(step, cfg)
      // A graded step is satisfied only by a passing call to ITS lead — when
      // step.scenario is set, the call's scenario must match (so call 1 must be
      // to the easy lead's number, call 2 to the hard lead's, etc.).
      const idx = queue.findIndex(s => s.score >= thr && (!step.scenario || s.scenario === step.scenario))
      if (idx >= 0) {
        const s = queue.splice(idx, 1)[0]
        completed.push({ key: step.key, at: nowIso, points: step.points || 0, session_id: s.id })
        completedKeys.add(step.key); points += step.points || 0; changed = true
        continue
      }
      currentKey = step.key; currentStep = step; break   // need a passing call to this lead
    } else if (step.type === 'graduation') {
      completed.push({ key: step.key, at: nowIso, points: 0 }); completedKeys.add(step.key)
      if (!graduated) { graduated = true; changed = true }
      currentKey = step.key; currentStep = step; break
    } else {
      currentKey = step.key; currentStep = step; break    // explore/info/webhook — await action
    }
  }

  if (changed) {
    await supabaseAdmin.from('trainee_progress').upsert({
      trainee_id: email, trainee_name: name || row.trainee_name || null,
      completed_steps: completed, points, graduated,
      graduated_at: graduated ? (row.graduated_at || nowIso) : null,
    }, { onConflict: 'trainee_id' })
  }

  // Best score on an unused call to the CURRENT graded step's lead (drives the
  // "best score X / need 80, call again" nudge). Scoped to the step's scenario.
  const gradedScenario = currentStep && currentStep.type === 'graded_call' ? currentStep.scenario : null
  const relevant = queue.filter(s => !gradedScenario || s.scenario === gradedScenario)
  const bestRecent = relevant.reduce((m, s) => (s.score != null && s.score > m ? s.score : m), null)
  const attempts = relevant.length

  return {
    steps: steps.map(s => ({
      key: s.key, type: s.type, title: s.title, body: s.body,
      points: s.points || 0, next_hint: s.next_hint || '', event_key: s.event_key || null,
      status: completedKeys.has(s.key) ? 'done' : (s.key === currentKey ? 'current' : 'locked'),
    })),
    currentKey, points, graduated,
    graded: { threshold: cfg.pass_threshold || 80, bestRecent, attempts },
  }
}

// Mark a step complete + award its points (shared by manual + event paths).
async function completeStep(email, name, step) {
  const row = await getProgressRow(email)
  const completed = Array.isArray(row.completed_steps) ? [...row.completed_steps] : []
  if (completed.some(c => c.key === step.key)) return reconcileProgress(email, name)
  completed.push({ key: step.key, at: new Date().toISOString(), points: step.points || 0 })
  await supabaseAdmin.from('trainee_progress').upsert({
    trainee_id: email, trainee_name: name || row.trainee_name || null,
    completed_steps: completed, points: (row.points || 0) + (step.points || 0),
    graduated: !!row.graduated,
  }, { onConflict: 'trainee_id' })
  return reconcileProgress(email, name)
}

// Trainee clicked Next. Only explore/info steps can be advanced this way.
// action_webhook steps are gated to the webhook event (no manual bypass), and
// graded_call / graduation advance automatically.
async function advanceManual(email, name, stepKey) {
  const cfg = await getCurriculum()
  const steps = cfg.steps || []
  const model = await reconcileProgress(email, name)
  const step = steps.find(s => s.key === model.currentKey)
  if (!step || step.key !== stepKey) return model
  if (!['explore', 'info'].includes(step.type)) return model    // webhook/graded/graduation: not manual
  return completeStep(email, name, step)
}

// GHL automation event (e.g. appointment booked) → complete the matching
// action_webhook step if the trainee is currently on it. This is the ONLY way
// an action_webhook step completes — there is no manual bypass.
async function completeEvent(email, name, eventKey) {
  const cfg = await getCurriculum()
  const steps = cfg.steps || []
  const model = await reconcileProgress(email, name)
  const step = steps.find(s => s.key === model.currentKey)
  if (!step || step.type !== 'action_webhook' || step.event_key !== eventKey) {
    return { ok: true, applied: false }
  }
  await completeStep(email, name, step)
  return { ok: true, applied: true, step: step.key }
}

module.exports = { getCurriculum, clearCache, reconcileProgress, advanceManual, completeEvent }
