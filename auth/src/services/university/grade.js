// WCS University — LLM grader.
//
// Grades a roleplay transcript against the WCS 7-stage sales pipeline (spec §8)
// and returns structured scores. JSON-only output, no prose, no markdown.
//
// Uses the Anthropic SDK directly (same key resolution as the mastermind
// module) rather than the mastermind `complete` helper, because grading wants
// its own model + a strict JSON contract independent of mastermind modes.

const Anthropic = require('@anthropic-ai/sdk').default || require('@anthropic-ai/sdk').Anthropic || require('@anthropic-ai/sdk')
const { getCallType } = require('./callTypes')

const apiKey = process.env.MASTERMIND_ANTHROPIC_API_KEY || process.env.ANTHROPIC_API_KEY
const client = apiKey ? new Anthropic({ apiKey }) : null

const MODEL = process.env.UNIVERSITY_GRADER_MODEL || 'claude-opus-4-8'

// Human-readable hint for each scored dimension, so the grader knows what each
// key means regardless of which call type it belongs to.
const DIMENSION_HINTS = {
  rapport: 'rapport built, tone, warmth',
  discovery: 'quality of needs discovery — did they uncover the real motivation?',
  objection_handling: 'did they surface AND address the lead\'s primary objection?',
  asked_for_commitment: 'did they actually ask for the booking/sale, and how decisively?',
  progression: 'how far down the pipeline did they move the lead?',
  surfaced_friction: 'did they draw out what is getting in the way of the member coming in?',
  value_reinforcement: 'did they reconnect the member to why this matters to them?',
  booked_next_session: 'did they lock in a specific next session/visit?',
  tone: 'supportive coach tone, not salesy or guilt-tripping',
  reconnection: 'warm re-open without making the lapsed member feel judged',
  acknowledged_lapse: 'named the drop-off honestly and without guilt-tripping',
  re_sold_value: 'rebuilt the case for why it is worth coming back',
  overcame_resistance: 'handled the "I fell off / not sure I\'ll stick" resistance',
  asked_for_return: 'asked for a concrete return — a booked session/visit',
  welcome_rapport: 'made the new member feel welcomed and set up for success',
  day_one_setup: 'set up Day One — InBody, coached workout, custom program',
  habit_building: 'helped establish a realistic cadence / habit',
  pt_positioning: 'positioned personal training where it genuinely fit',
  clear_next_step: 'left the member with one clear, scheduled next step',
}

// Build a call-type-specific grading system prompt. Each call type scores its
// own dimensions against the rep's goal for that situation.
function buildRubricSystem(callTypeKey) {
  const ct = getCallType(callTypeKey)
  const dims = ct.dimensions
  const dimLines = dims.map(d => `- ${d}: ${DIMENSION_HINTS[d] || d}`).join('\n')
  const stageKeys = dims.map(d => `    "${d}": <number 0-100>`).join(',\n')

  return `You grade a sales/retention-training roleplay call for West Coast Strength (WCS), a gym.
A trainee (a WCS rep/coach) called an AI lead. Grade ONLY the trainee's performance. Be a fair but
demanding evaluator — a "completed call" is not a "good call."

CALL TYPE: ${ct.label}
THE TRAINEE'S GOAL ON THIS CALL: ${ct.repGoal}

Score these dimensions 0-100 for THIS call type:
${dimLines}

overall_score is your holistic 0-100 judgment of how well the trainee achieved the goal above
(not a strict average of the dimensions).

Output STRICT JSON ONLY, no markdown, no code fences, no commentary, matching exactly:
{
  "overall_score": <number 0-100>,
  "stage_scores": {
${stageKeys}
  },
  "strengths": "<2-4 sentences on what the trainee did well>",
  "improvements": "<2-4 sentences of concrete, actionable coaching>"
}`
}

// Pull the first balanced JSON object out of a model response, tolerating the
// occasional stray code fence or lead-in text.
function extractJson(text) {
  if (!text) throw new Error('Empty model response')
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i)
  const candidate = fenced ? fenced[1] : text
  const start = candidate.indexOf('{')
  const end = candidate.lastIndexOf('}')
  if (start === -1 || end === -1 || end < start) {
    throw new Error('No JSON object found in model response')
  }
  return JSON.parse(candidate.slice(start, end + 1))
}

function clampScore(n) {
  const v = Number(n)
  if (Number.isNaN(v)) return null
  return Math.max(0, Math.min(100, v))
}

// Grade a transcript against the rubric for its call type. Returns:
//   { overall_score, stage_scores, strengths, improvements, raw, model }
// stage_scores keys are the call type's dimensions. Throws if the client is
// unconfigured, the transcript is empty, or the model refuses / returns
// unparseable output (caller marks the session failed).
async function gradeTranscript({ transcript, callType, scenario, difficulty, primaryObjection, leadSource }) {
  if (!client) {
    throw new Error('Anthropic client not initialized (MASTERMIND_ANTHROPIC_API_KEY or ANTHROPIC_API_KEY missing)')
  }
  const text = String(transcript || '').trim()
  if (text.length < 40) throw new Error('Transcript too short to grade')

  const ct = getCallType(callType)

  const userContent = [
    `CALL TYPE: ${callType || 'cold_lead'}`,
    `SCENARIO: ${scenario || 'unknown'}`,
    `DIFFICULTY: ${difficulty || 'unknown'}`,
    `LEAD SOURCE: ${leadSource || 'unspecified'}`,
    `LEAD'S PRIMARY OBJECTION: ${primaryObjection || 'unspecified'}`,
    '',
    'TRANSCRIPT:',
    text,
  ].join('\n')

  const resp = await client.messages.create({
    model: MODEL,
    max_tokens: 2000,
    thinking: { type: 'adaptive' },
    system: buildRubricSystem(callType),
    messages: [{ role: 'user', content: userContent }],
  })

  if (resp.stop_reason === 'refusal') {
    throw new Error('Grader refused to score this transcript')
  }

  const out = (resp.content || [])
    .filter(b => b.type === 'text')
    .map(b => b.text)
    .join('\n')

  const parsed = extractJson(out)
  const stage = parsed.stage_scores || {}

  // Clamp only the dimensions this call type defines.
  const stage_scores = {}
  for (const dim of ct.dimensions) stage_scores[dim] = clampScore(stage[dim])

  return {
    overall_score: clampScore(parsed.overall_score),
    stage_scores,
    strengths: typeof parsed.strengths === 'string' ? parsed.strengths : '',
    improvements: typeof parsed.improvements === 'string' ? parsed.improvements : '',
    raw: parsed,
    model: resp.model || MODEL,
  }
}

module.exports = { gradeTranscript, MODEL }
