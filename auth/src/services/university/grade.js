// WCS University — LLM grader.
//
// Grades a roleplay transcript against the WCS 7-stage sales pipeline (spec §8)
// and returns structured scores. JSON-only output, no prose, no markdown.
//
// Uses the Anthropic SDK directly (same key resolution as the mastermind
// module) rather than the mastermind `complete` helper, because grading wants
// its own model + a strict JSON contract independent of mastermind modes.

const Anthropic = require('@anthropic-ai/sdk').default || require('@anthropic-ai/sdk').Anthropic || require('@anthropic-ai/sdk')

const apiKey = process.env.MASTERMIND_ANTHROPIC_API_KEY || process.env.ANTHROPIC_API_KEY
const client = apiKey ? new Anthropic({ apiKey }) : null

const MODEL = process.env.UNIVERSITY_GRADER_MODEL || 'claude-opus-4-8'

const RUBRIC_SYSTEM = `You grade a sales-training roleplay call for West Coast Strength (WCS), a gym.
A trainee (sales rep) called an AI lead playing a prospective member. Grade ONLY the trainee's
performance against the WCS sales process. Be a fair but demanding evaluator — a "completed call"
is not a "good call."

The WCS 7-stage pipeline (not every stage fires on every call — score what the call called for):
1. Lead — opened well, built rapport, identified the prospect and their need.
2. Tour Scheduled — drove toward booking a tour / Day One.
3. The Tour — framed the in-person experience (where applicable).
4. Trial — positioned the trial / next step.
5. Sale — asked for the commitment and handled the objection.
6. Day One — set up Day One onboarding (InBody, coached workout, custom program).
7. PT Client — teed up personal training where appropriate.

Score these dimensions 0-100:
- rapport: rapport built and tone/warmth.
- discovery: quality of needs discovery (did they uncover the real motivation?).
- objection_handling: did they surface AND address the lead's primary objection?
- asked_for_commitment: did they actually ask for the booking/sale, and how decisively?
- progression: how far down the pipeline did they move the lead?

overall_score is your holistic 0-100 judgment of the call (not a strict average).

Output STRICT JSON ONLY, no markdown, no code fences, no commentary, matching exactly:
{
  "overall_score": <number 0-100>,
  "stage_scores": {
    "rapport": <number 0-100>,
    "discovery": <number 0-100>,
    "objection_handling": <number 0-100>,
    "asked_for_commitment": <number 0-100>,
    "progression": <number 0-100>
  },
  "strengths": "<2-4 sentences on what the trainee did well>",
  "improvements": "<2-4 sentences of concrete, actionable coaching>"
}`

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

// Grade a transcript. Returns:
//   { overall_score, stage_scores, strengths, improvements, raw, model }
// Throws if the client is unconfigured, the transcript is empty, or the model
// refuses / returns unparseable output (caller marks the session failed).
async function gradeTranscript({ transcript, scenario, difficulty, primaryObjection }) {
  if (!client) {
    throw new Error('Anthropic client not initialized (MASTERMIND_ANTHROPIC_API_KEY or ANTHROPIC_API_KEY missing)')
  }
  const text = String(transcript || '').trim()
  if (text.length < 40) throw new Error('Transcript too short to grade')

  const userContent = [
    `SCENARIO: ${scenario || 'unknown'}`,
    `DIFFICULTY: ${difficulty || 'unknown'}`,
    `LEAD'S PRIMARY OBJECTION: ${primaryObjection || 'unspecified'}`,
    '',
    'TRANSCRIPT:',
    text,
  ].join('\n')

  const resp = await client.messages.create({
    model: MODEL,
    max_tokens: 2000,
    thinking: { type: 'adaptive' },
    system: RUBRIC_SYSTEM,
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

  return {
    overall_score: clampScore(parsed.overall_score),
    stage_scores: {
      rapport: clampScore(stage.rapport),
      discovery: clampScore(stage.discovery),
      objection_handling: clampScore(stage.objection_handling),
      asked_for_commitment: clampScore(stage.asked_for_commitment),
      progression: clampScore(stage.progression),
    },
    strengths: typeof parsed.strengths === 'string' ? parsed.strengths : '',
    improvements: typeof parsed.improvements === 'string' ? parsed.improvements : '',
    raw: parsed,
    model: resp.model || MODEL,
  }
}

module.exports = { gradeTranscript, MODEL }
