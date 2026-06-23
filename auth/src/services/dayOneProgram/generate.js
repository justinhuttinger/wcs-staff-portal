'use strict'

const { resolveDayFocuses } = require('./splits')
const { generateText: realGenerateText, MODEL_FAST } = require('./anthropic')
const { buildPreamble, buildDayPrompt, buildOverviewPrompt, buildTerminologyPrompt } = require('./prompts')

// Parse model output that may be wrapped in markdown fences.
function parseJson(text) {
  let s = String(text || '').trim()
  const jsonFence = s.match(/```json\s*\n?([\s\S]*?)\n?```/)
  const anyFence = s.match(/```\s*\n?([\s\S]*?)\n?```/)
  if (jsonFence) s = jsonFence[1]
  else if (anyFence) s = anyFence[1]
  return JSON.parse(s.trim())
}

// Generate a full program via parallel per-day calls + overview, then terminology.
async function generateProgram(contactData, formData, deps = {}) {
  const generateText = deps.generateText || realGenerateText
  const preamble = buildPreamble(contactData, formData)
  const dayFocuses = resolveDayFocuses(formData)

  // Fan out: N day-calls + 1 overview-call, all in parallel.
  // Exercise selection stays on Sonnet (default model) for quality. Concise
  // output keeps these fast (latency tracks output length) and one page per day.
  const dayPromises = dayFocuses.map(df =>
    generateText({ prompt: buildDayPrompt(preamble, df, formData), maxTokens: 1500 })
      .then(parseJson)
  )
  const overviewPromise = generateText({ prompt: buildOverviewPrompt(preamble, dayFocuses), maxTokens: 1200 })
    .then(parseJson)

  const [workoutsRaw, overview] = await Promise.all([Promise.all(dayPromises), overviewPromise])

  // Keep day order stable.
  const workouts = workoutsRaw.slice().sort((a, b) => (a.day || 0) - (b.day || 0))

  // Terminology AFTER days so it only defines terms actually used. This is pure
  // mechanical formatting (define words already present) with no selection
  // judgment, so it runs on the fast model to minimize the serial tail.
  const terminologyRaw = await generateText({
    prompt: buildTerminologyPrompt(workouts), maxTokens: 600, model: MODEL_FAST,
  })
  const { terminology } = parseJson(terminologyRaw)

  return {
    basicExplanation: overview.basicExplanation || '',
    progressionNotes: overview.progressionNotes || '',
    terminology: terminology || '',
    principles: overview.principles || '',
    importantNotes: overview.importantNotes || '',
    weekTemplate: { workouts },
  }
}

module.exports = { generateProgram, parseJson }
