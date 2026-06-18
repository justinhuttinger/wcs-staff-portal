// WCS University — scenario / persona library.
//
// Each scenario maps to a Retell agent persona. The Retell agent prompt is
// templated with dynamic variables (spec §5): lead_name, primary_objection,
// scenario, difficulty, trainee_name, session_id. This file is the source of
// truth for the *non-trainee* variables (who the lead is, what they push back
// on) so the same base Retell agent can play every scenario.
//
// retell_agent_id resolution order (most specific wins):
//   1. value on the GHL practice contact / /calls/start payload
//   2. scenario.agentEnv  -> process.env[scenario.agentEnv]
//   3. process.env.RETELL_DEFAULT_AGENT_ID
//
// Add scenarios here as the persona library grows (spec §10.2 recommends one
// base agent + variables before building distinct agents).

const { getCallType, DEFAULT_CALL_TYPE } = require('./callTypes')

const SCENARIOS = {
  price_sensitive_snapchat: {
    label: 'Price-sensitive (Snapchat ad)',
    lead_name: 'Marcus',
    gender: 'male',
    primary_objection: 'cost',
    lead_source: 'a Snapchat ad',
    agentEnv: 'RETELL_AGENT_PRICE_SENSITIVE',
  },
  tire_kicker: {
    label: 'Just shopping around',
    lead_name: 'Dylan',
    gender: 'male',
    primary_objection: 'not sure it is worth it',
    lead_source: 'a Facebook ad',
    agentEnv: 'RETELL_AGENT_TIRE_KICKER',
  },
  ready_to_buy: {
    label: 'Ready to buy',
    lead_name: 'Sarah',
    gender: 'female',
    primary_objection: 'scheduling',
    lead_source: 'an Instagram ad',
    agentEnv: 'RETELL_AGENT_READY_TO_BUY',
  },
  hostile: {
    label: 'Hostile / skeptical',
    lead_name: 'Greg',
    gender: 'male',
    primary_objection: 'bad past gym experience',
    lead_source: 'a Google search',
    agentEnv: 'RETELL_AGENT_HOSTILE',
  },
  confused: {
    label: 'Confused about offerings',
    lead_name: 'Priya',
    gender: 'female',
    primary_objection: 'does not understand what is included',
    lead_source: 'an Instagram ad',
    agentEnv: 'RETELL_AGENT_CONFUSED',
  },

  // --- Course personas (one per dedicated Retell number) -------------------
  easy_lead: {
    label: 'Easy lead (warm)',
    lead_name: 'Sarah',
    gender: 'female',
    primary_objection: 'the cost, but only mildly',
    lead_source: 'an Instagram ad',
    agentEnv: null,
  },
  hard_lead: {
    label: 'Hard lead (skeptical)',
    lead_name: 'Marcus',
    gender: 'male',
    primary_objection: 'cost, and whether it will actually work for him',
    lead_source: 'a Snapchat ad',
    agentEnv: null,
  },
  trial_ending: {
    label: 'Trial ending (mid-trial)',
    lead_name: 'Megan',
    gender: 'female',
    primary_objection: 'being too busy to come in',
    lead_source: 'a trial sign-up',
    agentEnv: null,
  },
  trial_expired: {
    label: 'Trial expired (winback)',
    lead_name: 'Brandon',
    gender: 'male',
    primary_objection: 'that he fell off and doubts he will stick with it',
    lead_source: 'an expired trial',
    agentEnv: null,
  },
  new_member: {
    label: 'New member (onboarding)',
    lead_name: 'Tyler',
    gender: 'male',
    primary_objection: 'not knowing what to do first',
    lead_source: 'a new membership',
    agentEnv: null,
  },
}

// Fallback so an unknown scenario still produces a coherent lead rather than
// a broken call.
const DEFAULT_SCENARIO = {
  label: 'Generic prospect',
  lead_name: 'Alex',
  gender: 'unknown',
  primary_objection: 'cost',
  lead_source: 'an ad',
  agentEnv: null,
}

function getScenario(key) {
  return SCENARIOS[key] || DEFAULT_SCENARIO
}

function pickLeadName(scenarioKey) {
  return getScenario(scenarioKey).lead_name
}

function pickObjection(scenarioKey) {
  return getScenario(scenarioKey).primary_objection
}

// Resolve the Retell agent id for this scenario. Priority:
//   1. explicit payload override
//   2. scenario's own agent env (RETELL_AGENT_<SCENARIO>)
//   3. gendered agent (RETELL_AGENT_MALE / RETELL_AGENT_FEMALE) — each agent
//      carries its own voice, so routing by gender gives per-persona voices
//      reliably (the inbound agent_override.voice_id is not honored alongside
//      override_agent_id on Retell, so we switch the whole agent instead).
//   4. global default agent.
function resolveAgentId(scenarioKey, payloadAgentId) {
  if (payloadAgentId) return payloadAgentId
  const sc = getScenario(scenarioKey)
  if (sc.agentEnv && process.env[sc.agentEnv]) return process.env[sc.agentEnv]
  if (sc.gender === 'male' && process.env.RETELL_AGENT_MALE) return process.env.RETELL_AGENT_MALE
  if (sc.gender === 'female' && process.env.RETELL_AGENT_FEMALE) return process.env.RETELL_AGENT_FEMALE
  return process.env.RETELL_DEFAULT_AGENT_ID || null
}

// For INBOUND calls: which agent to override to, WITHOUT the default fallback.
// Returns the scenario/gendered agent if configured, else null. Null means
// "don't override" — the call then uses whatever agent the dialed number is
// bound to in Retell. So you can route voices either by env (set RETELL_AGENT_*)
// OR simply by binding each number to the right-voice agent in Retell (no env).
function resolveOverrideAgent(scenarioKey) {
  const sc = getScenario(scenarioKey)
  if (sc.agentEnv && process.env[sc.agentEnv]) return process.env[sc.agentEnv]
  if (sc.gender === 'male' && process.env.RETELL_AGENT_MALE) return process.env.RETELL_AGENT_MALE
  if (sc.gender === 'female' && process.env.RETELL_AGENT_FEMALE) return process.env.RETELL_AGENT_FEMALE
  return null
}

// Resolve the Retell voice_id for a scenario so the lead's voice matches the
// persona (instead of the agent's single hardcoded voice). Priority:
//   1. UNIVERSITY_VOICE_MAP JSON — { "<scenario>": "<voice_id>" }
//   2. RETELL_VOICE_MALE / RETELL_VOICE_FEMALE by the persona's gender
//   3. RETELL_VOICE_DEFAULT, else null (keep the agent's configured voice)
// Returned via agent_override.voice_id on the inbound webhook response.
function resolveVoiceId(scenarioKey) {
  const raw = process.env.UNIVERSITY_VOICE_MAP
  if (raw) {
    try {
      const map = JSON.parse(raw)
      if (map && map[scenarioKey]) return map[scenarioKey]
    } catch (e) {
      console.warn('[university] UNIVERSITY_VOICE_MAP is not valid JSON:', e.message)
    }
  }
  const g = getScenario(scenarioKey).gender
  if (g === 'male' && process.env.RETELL_VOICE_MALE) return process.env.RETELL_VOICE_MALE
  if (g === 'female' && process.env.RETELL_VOICE_FEMALE) return process.env.RETELL_VOICE_FEMALE
  return process.env.RETELL_VOICE_DEFAULT || null
}

// Dynamic variables injected into the Retell agent prompt at call start.
// The call_type drives `situation` + `your_goal` (computed in callTypes.js) so
// one base agent can play a cold lead, a mid-trial check-in, a winback, etc.
function buildDynamicVariables({ scenario, difficulty, traineeName, sessionId, callType, leadSource }) {
  const sc = getScenario(scenario)
  const ct = getCallType(callType)
  const firstName = String(traineeName || '').trim().split(/\s+/)[0] || 'there'
  return {
    trainee_name: firstName,
    scenario,
    difficulty,
    call_type: callType || DEFAULT_CALL_TYPE,
    lead_source: leadSource || sc.lead_source || 'an ad',
    lead_name: sc.lead_name,
    primary_objection: sc.primary_objection,
    // The lead's situation + mindset for this call type (NOT the rep's goal —
    // that's grader-only, so the lead never sees it and can't "play along").
    situation: ct.situation(difficulty),
    session_id: sessionId,
  }
}

module.exports = {
  SCENARIOS,
  getScenario,
  pickLeadName,
  pickObjection,
  resolveAgentId,
  resolveOverrideAgent,
  resolveVoiceId,
  buildDynamicVariables,
}
