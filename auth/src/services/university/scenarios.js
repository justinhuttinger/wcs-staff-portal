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
    primary_objection: 'cost',
    lead_source: 'a Snapchat ad',
    agentEnv: 'RETELL_AGENT_PRICE_SENSITIVE',
  },
  tire_kicker: {
    label: 'Just shopping around',
    lead_name: 'Dylan',
    primary_objection: 'not sure it is worth it',
    lead_source: 'a Facebook ad',
    agentEnv: 'RETELL_AGENT_TIRE_KICKER',
  },
  ready_to_buy: {
    label: 'Ready to buy',
    lead_name: 'Sarah',
    primary_objection: 'scheduling',
    lead_source: 'an Instagram ad',
    agentEnv: 'RETELL_AGENT_READY_TO_BUY',
  },
  hostile: {
    label: 'Hostile / skeptical',
    lead_name: 'Greg',
    primary_objection: 'bad past gym experience',
    lead_source: 'a Google search',
    agentEnv: 'RETELL_AGENT_HOSTILE',
  },
  confused: {
    label: 'Confused about offerings',
    lead_name: 'Priya',
    primary_objection: 'does not understand what is included',
    lead_source: 'an Instagram ad',
    agentEnv: 'RETELL_AGENT_CONFUSED',
  },
}

// Fallback so an unknown scenario still produces a coherent lead rather than
// a broken call.
const DEFAULT_SCENARIO = {
  label: 'Generic prospect',
  lead_name: 'Alex',
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

// Resolve the Retell agent id to dial for this scenario, honoring the payload
// override first, then the scenario's env var, then a global default.
function resolveAgentId(scenarioKey, payloadAgentId) {
  if (payloadAgentId) return payloadAgentId
  const sc = getScenario(scenarioKey)
  if (sc.agentEnv && process.env[sc.agentEnv]) return process.env[sc.agentEnv]
  return process.env.RETELL_DEFAULT_AGENT_ID || null
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
  buildDynamicVariables,
}
