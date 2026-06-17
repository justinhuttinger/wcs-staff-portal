// WCS University — voice roleplay training API.
//
// Two trust zones on one router:
//   • Machine endpoints (GHL custom-code action + Retell webhook) authenticate
//     with a shared secret, NOT the staff JWT — they're called by external
//     systems, not signed-in users.
//   • Read/admin endpoints use the normal staff JWT + role gate, for the
//     manager-facing completion dashboard (spec §9.9).
//
// Mounted at /university behind the UNIVERSITY_ENABLED flag (see index.js), so
// it ships dark until the Retell agent + GHL fields are configured.

const { Router } = require('express')
const { supabaseAdmin } = require('../services/supabase')
const authenticate = require('../middleware/auth')
const { requireRole } = require('../middleware/role')

const { createPhoneCall, verifyWebhookSecret } = require('../services/university/retell')
const { resolveAgentId, buildDynamicVariables } = require('../services/university/scenarios')
const { processCompletedCall } = require('../services/university')
const { recordCurriculumMilestone } = require('../services/university/milestones')
const { getMilestoneConfig, clearCache } = require('../services/university/config')

const router = Router()

// --- shared-secret guard for machine endpoints -----------------------------
// Accepts Authorization: Bearer <UNIVERSITY_API_KEY> or x-webhook-secret.
// If UNIVERSITY_API_KEY is unset, allow (matches the portal's webhook verifiers'
// backward-compat behavior) — set it in production.
function requireUniversitySecret(req, res, next) {
  const secret = process.env.UNIVERSITY_API_KEY
  if (!secret) return next()
  const header = req.headers.authorization || ''
  const bearer = header.startsWith('Bearer ') ? header.slice(7) : null
  const provided = bearer || req.headers['x-webhook-secret'] || req.query.secret
  if (provided !== secret) return res.status(401).json({ error: 'Invalid university secret' })
  next()
}

// ---------------------------------------------------------------------------
// POST /university/calls/start  (machine — GHL custom-code action)
// Body: { trainee_id, trainee_name, trainee_phone, contact_id, location_id,
//         persona_scenario, persona_difficulty, retell_agent_id? }
// ---------------------------------------------------------------------------
router.post('/calls/start', requireUniversitySecret, async (req, res) => {
  try {
    const b = req.body || {}
    const trainee_id = b.trainee_id
    const trainee_phone = b.trainee_phone
    const scenario = b.persona_scenario || b.scenario
    const difficulty = b.persona_difficulty || b.difficulty

    if (!trainee_id || !trainee_phone || !scenario || !difficulty) {
      return res.status(400).json({ error: 'Missing required fields: trainee_id, trainee_phone, persona_scenario, persona_difficulty' })
    }

    const agentId = resolveAgentId(scenario, b.retell_agent_id)

    // 1. Record the session up front (status=initiated) so we have an id to
    //    thread through Retell's dynamic variables and match on at webhook time.
    const { data: session, error: insErr } = await supabaseAdmin
      .from('roleplay_sessions')
      .insert({
        trainee_id,
        trainee_name: b.trainee_name || null,
        trainee_phone,
        contact_id: b.contact_id || null,
        location_id: b.location_id || null,
        scenario,
        difficulty,
        retell_agent_id: agentId,
        status: 'initiated',
      })
      .select()
      .single()
    if (insErr) return res.status(500).json({ error: `session insert failed: ${insErr.message}` })

    // 2. Ask Retell to dial the trainee with the persona variables baked in.
    let call
    try {
      call = await createPhoneCall({
        fromNumber: process.env.RETELL_FROM_NUMBER,
        toNumber: trainee_phone,
        agentId,
        dynamicVariables: buildDynamicVariables({
          scenario,
          difficulty,
          traineeName: b.trainee_name,
          sessionId: session.id,
        }),
      })
    } catch (err) {
      await supabaseAdmin
        .from('roleplay_sessions')
        .update({ status: 'failed', error_detail: err.message })
        .eq('id', session.id)
      return res.status(502).json({ error: `Retell call failed: ${err.message}`, session_id: session.id })
    }

    // 3. Stamp the Retell call id for webhook matching.
    await supabaseAdmin
      .from('roleplay_sessions')
      .update({ retell_call_id: call.call_id })
      .eq('id', session.id)

    res.json({ session_id: session.id, retell_call_id: call.call_id, status: 'initiated' })
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

// ---------------------------------------------------------------------------
// POST /university/retell/webhook  (machine — Retell post-call event)
// Captures the transcript/recording, then grades asynchronously so the webhook
// returns fast. Matches the session by dynamic-var session_id, else call_id.
// ---------------------------------------------------------------------------
router.post('/retell/webhook', async (req, res) => {
  if (!verifyWebhookSecret(req)) return res.status(401).json({ error: 'Invalid retell secret' })

  try {
    const body = req.body || {}
    // Retell nests the call under `call` on most events; tolerate flat too.
    const call = body.call || body.data || body
    const eventType = body.event || body.event_type || ''
    const callId = call.call_id || call.callId || body.call_id || null
    const dynVars = call.retell_llm_dynamic_variables || call.dynamic_variables || {}
    const sessionId = dynVars.session_id || null
    const transcript = call.transcript || call.transcript_text || body.transcript || null
    const recordingUrl = call.recording_url || call.recordingUrl || body.recording_url || null
    const analysis = call.call_analysis || call.analysis || null

    // Find the session.
    let query = supabaseAdmin.from('roleplay_sessions').select('*')
    query = sessionId ? query.eq('id', sessionId) : query.eq('retell_call_id', callId)
    const { data: session } = await query.maybeSingle()

    if (!session) {
      // Unknown call — ack so Retell doesn't retry forever, but flag it.
      console.warn(`[university] retell webhook for unknown session (event=${eventType}, call_id=${callId}, session_id=${sessionId})`)
      return res.json({ ok: true, matched: false })
    }

    // Persist whatever the event carried.
    const update = { ended_at: new Date().toISOString() }
    if (transcript) update.transcript = transcript
    if (recordingUrl) update.recording_url = recordingUrl
    if (analysis) update.call_analysis = analysis
    if (session.status === 'initiated') update.status = 'completed'

    await supabaseAdmin.from('roleplay_sessions').update(update).eq('id', session.id)

    // Grade only once we actually have a transcript and haven't graded yet.
    const haveTranscript = transcript || session.transcript
    if (haveTranscript && session.status !== 'graded') {
      const merged = { ...session, ...update, transcript: haveTranscript }
      // Detached — don't make Retell wait on the LLM + GHL round-trips.
      processCompletedCall(merged).catch(err =>
        console.error(`[university] background grading error (session ${session.id}):`, err.message))
    }

    res.json({ ok: true, matched: true, session_id: session.id })
  } catch (err) {
    console.error('[university] retell webhook error:', err.message)
    res.status(500).json({ error: err.message })
  }
})

// ---------------------------------------------------------------------------
// POST /university/curriculum  (machine — GHL workflow for module/event done)
// Body: { trainee_id, milestone_key, contact_id?, location_id? }
// Records an event-driven curriculum milestone (spec §9.7).
// ---------------------------------------------------------------------------
router.post('/curriculum', requireUniversitySecret, async (req, res) => {
  try {
    const { trainee_id, milestone_key, contact_id, location_id } = req.body || {}
    if (!trainee_id || !milestone_key) {
      return res.status(400).json({ error: 'Missing required fields: trainee_id, milestone_key' })
    }
    const result = await recordCurriculumMilestone({
      traineeId: trainee_id,
      milestoneKey: milestone_key,
      contactId: contact_id || null,
      locationId: location_id || null,
    })
    res.json({ ok: true, ...result })
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

// ===========================================================================
// Read / admin endpoints (staff JWT) — for the manager completion dashboard.
// ===========================================================================
router.use(authenticate)

// GET /university/sessions?trainee_id=&status=&limit=
router.get('/sessions', requireRole('manager'), async (req, res) => {
  try {
    let q = supabaseAdmin
      .from('roleplay_sessions')
      .select('*')
      .order('started_at', { ascending: false })
      .limit(Math.min(Number(req.query.limit) || 200, 500))
    if (req.query.trainee_id) q = q.eq('trainee_id', req.query.trainee_id)
    if (req.query.status) q = q.eq('status', req.query.status)
    const { data, error } = await q
    if (error) return res.status(500).json({ error: error.message })
    res.json({ sessions: data || [] })
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

// GET /university/trainees/:traineeId — ledger + rollup + recent graded calls.
router.get('/trainees/:traineeId', requireRole('manager'), async (req, res) => {
  try {
    const traineeId = req.params.traineeId
    const [milestones, graduation, sessions, grades] = await Promise.all([
      supabaseAdmin.from('trainee_milestones').select('*').eq('trainee_id', traineeId),
      supabaseAdmin.from('trainee_graduation').select('*').eq('trainee_id', traineeId).maybeSingle(),
      supabaseAdmin.from('roleplay_sessions').select('*').eq('trainee_id', traineeId).order('started_at', { ascending: false }).limit(50),
      supabaseAdmin.from('roleplay_grades').select('*').eq('trainee_id', traineeId).order('graded_at', { ascending: false }).limit(50),
    ])
    res.json({
      trainee_id: traineeId,
      milestones: milestones.data || [],
      graduation: graduation.data || null,
      sessions: sessions.data || [],
      grades: grades.data || [],
    })
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

// GET /university/config — current milestone config.
router.get('/config', requireRole('manager'), async (req, res) => {
  try {
    res.json({ config: await getMilestoneConfig() })
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

// PUT /university/config — replace milestone config (admin only). Body: { config }.
router.put('/config', requireRole('admin'), async (req, res) => {
  try {
    const config = req.body?.config
    if (!config || !Array.isArray(config.milestones)) {
      return res.status(400).json({ error: 'Body must be { config: { pass_threshold_default, milestones: [...] } }' })
    }
    const { error } = await supabaseAdmin
      .from('milestone_config')
      .upsert({ id: true, config, updated_by: req.staff?.email || req.staff?.id || 'unknown', updated_at: new Date().toISOString() }, { onConflict: 'id' })
    if (error) return res.status(500).json({ error: error.message })
    clearCache()
    res.json({ ok: true, config })
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

module.exports = router
