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

const express = require('express')
const { Router } = require('express')
const { supabaseAdmin } = require('../services/supabase')
const authenticate = require('../middleware/auth')
const { requireRole } = require('../middleware/role')

const { createPhoneCall, verifyWebhookSecret } = require('../services/university/retell')
const { resolveAgentId, resolveVoiceId, buildDynamicVariables } = require('../services/university/scenarios')
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

// GHL's Webhook action sends "Custom Data" in inconsistent shapes (often NOT
// application/json, sometimes form-encoded or on the query string), so the
// global express.json parser leaves req.body empty. This chain accepts the body
// however GHL transmits it — json (already parsed globally), form-encoded, or
// raw text — and merges query params as a fallback. Apply to GHL-facing POSTs.
const tolerantBody = [
  express.urlencoded({ extended: true }),
  express.text({ type: () => true }),
  (req, res, next) => {
    if (typeof req.body === 'string') {
      try { req.body = JSON.parse(req.body) } catch { req.body = {} }
    }
    if (!req.body || typeof req.body !== 'object') req.body = {}
    req.body = { ...req.query, ...req.body } // body wins; query is fallback
    // GHL nests the workflow's "Custom Data" under `customData` and puts the
    // contact's native fields at the top level. Lift customData up so handlers
    // see our fields, while keeping the native contact_id / location for free.
    if (req.body.customData && typeof req.body.customData === 'object') {
      req.body = { ...req.body, ...req.body.customData }
    }
    next()
  },
]

const sleep = ms => new Promise(r => setTimeout(r, ms))

// Claim the most recent unconsumed, unexpired pending assignment for a caller
// (written by /calls/prepare when the rep hit Dial in GHL). Buffered: if it
// isn't there yet, wait briefly and retry — the GHL "call started" workflow and
// Retell's inbound webhook race, and Retell gives us ~10s before it proceeds.
// Returns the claimed row (consumed) or null.
async function claimPendingAssignment(callerPhone, { waitMs = 1500, tries = 3 } = {}) {
  if (!callerPhone) return null
  const nowIso = () => new Date().toISOString()
  for (let i = 0; i < tries; i++) {
    const { data: rows } = await supabaseAdmin
      .from('roleplay_pending_assignments')
      .select('*')
      .eq('caller_phone', callerPhone)
      .is('consumed_at', null)
      .gt('expires_at', nowIso())
      .order('created_at', { ascending: false })
      .limit(1)
    const pending = rows && rows[0]
    if (pending) {
      // Consume it atomically (only if still unconsumed) so a retry/dup can't reuse it.
      const { data: claimed } = await supabaseAdmin
        .from('roleplay_pending_assignments')
        .update({ consumed_at: nowIso() })
        .eq('id', pending.id)
        .is('consumed_at', null)
        .select()
      if (claimed && claimed.length) return claimed[0]
    }
    if (i < tries - 1) await sleep(waitMs / (tries - 1))
  }
  return null
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
router.post('/calls/start', tolerantBody, requireUniversitySecret, async (req, res) => {
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

    // Persist whatever the event carried (NOT status — that's claimed atomically below).
    const update = { ended_at: new Date().toISOString() }
    if (transcript) update.transcript = transcript
    if (recordingUrl) update.recording_url = recordingUrl
    if (analysis) update.call_analysis = analysis
    await supabaseAdmin.from('roleplay_sessions').update(update).eq('id', session.id)

    // Grade once, even though Retell fires BOTH call_ended and call_analyzed
    // (each carrying a transcript) and may retry. Atomically claim the session
    // by flipping initiated/completed -> grading in a single conditional
    // UPDATE; only the event that wins the claim grades. This closes the
    // read-then-act race that previously let both events grade the same call.
    const haveTranscript = transcript || session.transcript
    if (haveTranscript) {
      const { data: claimed } = await supabaseAdmin
        .from('roleplay_sessions')
        .update({ status: 'grading' })
        .eq('id', session.id)
        .in('status', ['initiated', 'completed'])
        .select('id')
      if (claimed && claimed.length) {
        const merged = { ...session, ...update, status: 'grading', transcript: haveTranscript }
        // Detached — don't make Retell wait on the LLM + GHL round-trips.
        processCompletedCall(merged).catch(err =>
          console.error(`[university] background grading error (session ${session.id}):`, err.message))
      }
    }

    res.json({ ok: true, matched: true, session_id: session.id })
  } catch (err) {
    console.error('[university] retell webhook error:', err.message)
    res.status(500).json({ error: err.message })
  }
})

// ---------------------------------------------------------------------------
// POST /university/calls/prepare  (machine — GHL "call started" workflow)
// Pre-registers which persona the inbound call that's connecting should get,
// keyed by the caller's number (the from_number Retell will see). Lets a rep
// hit Dial on a specific GHL contact and reach THAT persona, with one shared
// Retell number, and threads contact_id/location_id for write-back.
// Body: { trainee_phone, persona_scenario, persona_difficulty, call_type,
//         lead_source?, contact_id?, location_id?, trainee_id?, trainee_name?, ttl_seconds? }
// ---------------------------------------------------------------------------
router.post('/calls/prepare', tolerantBody, requireUniversitySecret, async (req, res) => {
  try {
    const b = req.body || {}
    const caller = normalizePhone(b.trainee_phone || b.caller_phone || b.from_number)
    const scenario = b.persona_scenario || b.scenario
    const difficulty = b.persona_difficulty || b.difficulty
    if (!caller || !scenario || !difficulty) {
      // Echo what we received so a misconfigured GHL webhook is diagnosable
      // straight from the webhook's response panel.
      return res.status(400).json({
        error: 'Missing required fields: trainee_phone, persona_scenario, persona_difficulty',
        received: { content_type: req.headers['content-type'] || null, keys: Object.keys(b), body: b },
      })
    }

    const ttl = Math.min(Math.max(Number(b.ttl_seconds) || 120, 30), 600)
    const expiresAt = new Date(Date.now() + ttl * 1000).toISOString()

    // Supersede any earlier unconsumed pending for this caller so the freshest
    // Dial wins (handles a rep starting a call, hanging up, and re-dialing).
    await supabaseAdmin
      .from('roleplay_pending_assignments')
      .update({ consumed_at: new Date().toISOString() })
      .eq('caller_phone', caller)
      .is('consumed_at', null)

    const { data, error } = await supabaseAdmin
      .from('roleplay_pending_assignments')
      .insert({
        caller_phone: caller,
        trainee_id: b.trainee_id || caller,
        // GHL's native envelope gives us full_name + contact_id + location.id
        // for free — use them as fallbacks so write-back works without extra
        // Custom Data mapping.
        trainee_name: b.trainee_name || b.full_name || null,
        contact_id: b.contact_id || null,
        location_id: b.location_id || b.location?.id || null,
        scenario,
        difficulty,
        call_type: b.call_type || b.persona_call_type || 'cold_lead',
        lead_source: b.lead_source || null,
        expires_at: expiresAt,
      })
      .select('id')
      .single()
    if (error) return res.status(500).json({ error: error.message })

    res.json({ ok: true, pending_id: data.id, expires_at: expiresAt })
  } catch (err) {
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
    const caller = normalizePhone(fromNumber)

    // Persona source, in priority order:
    //   1. a pending assignment from /calls/prepare (rep hit Dial on a specific
    //      GHL contact) — carries contact_id/location_id for write-back.
    //   2. UNIVERSITY_NUMBER_MAP (this number is pinned to a persona).
    //   3. random.
    const pending = await claimPendingAssignment(caller)
    // `a` is either the pending row or a number-map / random assignment. Both
    // shapes carry scenario/difficulty/call_type/lead_source; the pending row
    // and number-map entries additionally carry contact_id/location_id (and
    // trainee_name) for write-back.
    const a = pending || (await pickAssignment({ toNumber }))

    const traineeId = a.trainee_id || caller || `inbound:${toNumber || 'unknown'}`

    // Mint the session up front so the transcript can be matched + graded.
    const { data: session, error: insErr } = await supabaseAdmin
      .from('roleplay_sessions')
      .insert({
        trainee_id: traineeId,
        trainee_name: a.trainee_name || null,
        trainee_phone: caller,
        contact_id: a.contact_id || null,
        location_id: a.location_id || null,
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
      traineeName: a.trainee_name || null,
      sessionId: session?.id || null,
    })

    // Optional per-scenario agent override (RETELL_AGENT_* / RETELL_DEFAULT_AGENT_ID).
    const overrideAgentId = resolveAgentId(a.scenario, null)
    // Per-persona voice so the lead doesn't always sound like the agent's one
    // hardcoded voice. A number-map voice_id wins; else gender-based resolution.
    const voiceId = a.voice_id || resolveVoiceId(a.scenario)

    const payload = { call_inbound: { dynamic_variables, metadata: { session_id: session?.id || null } } }
    if (overrideAgentId) payload.call_inbound.override_agent_id = overrideAgentId
    if (voiceId) payload.call_inbound.agent_override = { voice_id: voiceId }

    res.json(payload)
  } catch (err) {
    console.error('[university] inbound webhook error:', err.message)
    // Still let the call connect (no personalization) rather than dropping it.
    res.json({ call_inbound: {} })
  }
})

// ---------------------------------------------------------------------------
// POST /university/calls/identify  (machine — GHL "call started" workflow)
// When every trainee dials the SAME shared number, the inbound call carries no
// trainee identity. This attributes the just-started call to the logged-in
// trainee: the GHL call-started workflow fires (a few seconds late is fine —
// attribution happens post-call, not at connect) with the user's email, and we
// stamp it onto the most recent not-yet-attributed session. Email is the
// trainee key (it's available in both this workflow AND the menu-link app).
// Persona still comes from the number-map at connect; this is identity only.
// Body: { email, name?, contact_id?, location_id? }
// ---------------------------------------------------------------------------
router.post('/calls/identify', tolerantBody, requireUniversitySecret, async (req, res) => {
  try {
    const b = req.body || {}
    const email = String(b.email || b.trainee_email || '').trim().toLowerCase() || null
    const name = b.name || b.trainee_name || b.full_name || null
    const contactId = b.contact_id || null
    const locationId = b.location_id || b.location?.id || null
    if (!email) {
      return res.status(400).json({ error: 'Missing required field: email', received: { keys: Object.keys(b) } })
    }

    // The call this trainee just started: the most recent session from the last
    // ~120s whose trainee_id isn't yet an email (still the placeholder phone).
    const cutoff = new Date(Date.now() - 120000).toISOString()
    const { data: rows } = await supabaseAdmin
      .from('roleplay_sessions')
      .select('id, contact_id, location_id')
      .gte('created_at', cutoff)
      .not('trainee_id', 'ilike', '%@%')
      .order('created_at', { ascending: false })
      .limit(1)
    const session = rows && rows[0]
    if (!session) return res.json({ ok: true, attributed: false, reason: 'no recent unattributed session' })

    const update = { trainee_id: email }
    if (name) update.trainee_name = name
    if (!session.contact_id && contactId) update.contact_id = contactId
    if (!session.location_id && locationId) update.location_id = locationId
    await supabaseAdmin.from('roleplay_sessions').update(update).eq('id', session.id)

    res.json({ ok: true, attributed: true, session_id: session.id, trainee_id: email })
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

// POST /university/curriculum  (machine — GHL workflow for module/event done)
// Body: { trainee_id, milestone_key, contact_id?, location_id? }
// Records an event-driven curriculum milestone (spec §9.7).
// ---------------------------------------------------------------------------
router.post('/curriculum', tolerantBody, requireUniversitySecret, async (req, res) => {
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
