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
const { pickAssignment } = require('../services/university/assign')

// Normalize a phone to E.164-ish for use as a stable trainee_id in the inbound
// model (trainee identified by the number they dial from).
function normalizePhone(p) {
  const d = String(p || '').replace(/\D+/g, '')
  if (!d) return null
  if (d.length === 10) return `+1${d}`
  if (d.length === 11 && d[0] === '1') return `+${d}`
  return `+${d}`
}

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
    const call_type = b.persona_call_type || b.call_type || 'cold_lead'
    const lead_source = b.lead_source || b.persona_lead_source || null

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
        call_type,
        lead_source,
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
          callType: call_type,
          leadSource: lead_source,
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
    // session_id rides in dynamic vars (outbound) and/or metadata (inbound).
    const sessionId = dynVars.session_id || call.metadata?.session_id || null
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
// POST /university/retell/inbound  (machine — Retell inbound-call webhook)
// Fires when a trainee DIALS the Retell number (e.g. hits "Dial" on a GHL
// contact whose phone is that number). Retell calls us before connecting; we
// pick a persona, mint a session, and return dynamic variables so the agent
// opens in character. The session_id rides in dynamic_variables + metadata, so
// the post-call webhook grades it like any other call.
//
// Request:  { event: "call_inbound", call_inbound: { from_number, to_number, agent_id } }
// Response: { call_inbound: { dynamic_variables, metadata, override_agent_id? } }
// ---------------------------------------------------------------------------
router.post('/retell/inbound', async (req, res) => {
  if (!verifyWebhookSecret(req)) return res.status(401).json({ error: 'Invalid retell secret' })

  try {
    const inbound = req.body?.call_inbound || req.body || {}
    const fromNumber = inbound.from_number || null
    const toNumber = inbound.to_number || null

    // Trainee identified by the number they dial from (mapped to staff later).
    const traineeId = normalizePhone(fromNumber) || `inbound:${toNumber || 'unknown'}`

    // Pick the persona: a number mapped in UNIVERSITY_NUMBER_MAP wins, else random.
    const a = await pickAssignment({ toNumber })

    // Mint the session up front so the transcript can be matched + graded.
    const { data: session, error: insErr } = await supabaseAdmin
      .from('roleplay_sessions')
      .insert({
        trainee_id: traineeId,
        trainee_phone: normalizePhone(fromNumber),
        scenario: a.scenario,
        difficulty: a.difficulty,
        call_type: a.call_type,
        lead_source: a.lead_source,
        retell_agent_id: inbound.agent_id || null,
        status: 'initiated',
      })
      .select()
      .single()
    if (insErr) {
      // Don't block the call on our DB — let it connect with vars but no session.
      console.error('[university] inbound session insert failed:', insErr.message)
    }

    const dynamic_variables = buildDynamicVariables({
      scenario: a.scenario,
      difficulty: a.difficulty,
      callType: a.call_type,
      leadSource: a.lead_source,
      traineeName: null,
      sessionId: session?.id || null,
    })

    // Optional per-scenario agent override (RETELL_AGENT_* / RETELL_DEFAULT_AGENT_ID).
    const overrideAgentId = resolveAgentId(a.scenario, null)

    const payload = { call_inbound: { dynamic_variables, metadata: { session_id: session?.id || null } } }
    if (overrideAgentId) payload.call_inbound.override_agent_id = overrideAgentId

    res.json(payload)
  } catch (err) {
    console.error('[university] inbound webhook error:', err.message)
    // Still let the call connect (no personalization) rather than dropping it.
    res.json({ call_inbound: {} })
  }
})

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
