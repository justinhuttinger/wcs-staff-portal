// WCS University — inbound assignment picker.
//
// When a trainee just dials the Retell number (inbound model), the server has
// to choose what they practice. This picks a random call_type + persona +
// difficulty per call, which is ideal for cold practice / variety.
//
// Mode is env-controlled so we can grow into curriculum-driven selection later
// (drill the call type the trainee hasn't passed) without changing callers:
//   UNIVERSITY_INBOUND_MODE = random (default)
// `pickAssignment` is async to leave room for a curriculum mode that reads the
// trainee's ledger; the random path ignores traineeId.

const { CALL_TYPES } = require('./callTypes')
const { SCENARIOS } = require('./scenarios')

const DIFFICULTIES = ['easy', 'medium', 'hard']

function sample(arr) {
  return arr[Math.floor(Math.random() * arr.length)]
}

function randomAssignment() {
  return {
    call_type: sample(Object.keys(CALL_TYPES)),
    scenario: sample(Object.keys(SCENARIOS)),
    difficulty: sample(DIFFICULTIES),
    lead_source: null, // falls back to the scenario's own lead_source
  }
}

// Optional per-number mapping (for the "number per persona" model). Set
// UNIVERSITY_NUMBER_MAP to a JSON object keyed by the Retell number (E.164):
//   {"+15035551234": {"call_type":"cold_lead","scenario":"price_sensitive_snapchat","difficulty":"hard","lead_source":"instagram"}}
// When a dialed number is mapped, that fixed persona answers (contact == lead).
// Unmapped numbers fall back to a random assignment.
function loadNumberMap() {
  const raw = process.env.UNIVERSITY_NUMBER_MAP
  if (!raw) return {}
  try { return JSON.parse(raw) } catch (e) {
    console.warn('[university/assign] UNIVERSITY_NUMBER_MAP is not valid JSON:', e.message)
    return {}
  }
}

function assignmentForNumber(toNumber) {
  if (!toNumber) return null
  const map = loadNumberMap()
  const m = map[toNumber] || map[String(toNumber).replace(/\s+/g, '')]
  if (!m) return null
  // A number can also carry the GHL contact_id/location_id of its persona's
  // practice contact, so grading writes back to that contact without a prepare
  // step. voice_id optionally overrides the gender-based voice.
  return {
    call_type: m.call_type || 'cold_lead',
    scenario: m.scenario || 'price_sensitive_snapchat',
    difficulty: m.difficulty || 'medium',
    lead_source: m.lead_source || null,
    contact_id: m.contact_id || null,
    location_id: m.location_id || null,
    trainee_name: m.trainee_name || null,
    voice_id: m.voice_id || null,
  }
}

// Returns { call_type, scenario, difficulty, lead_source }.
// If the dialed number is mapped to a fixed persona, use it; else assign.
async function pickAssignment({ toNumber } = {}) {
  const mapped = assignmentForNumber(toNumber)
  if (mapped) return mapped

  const mode = process.env.UNIVERSITY_INBOUND_MODE || 'random'
  // Only 'random' is implemented today; unknown modes fall back to random.
  switch (mode) {
    case 'random':
    default:
      return randomAssignment()
  }
}

module.exports = { pickAssignment, randomAssignment, assignmentForNumber, DIFFICULTIES }
