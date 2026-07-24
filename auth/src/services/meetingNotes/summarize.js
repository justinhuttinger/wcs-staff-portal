// auth/src/services/meetingNotes/summarize.js
// Condense the notetaker's granular Key Takeaways into a few high-level bullets
// for the notes Doc. Grounded in the notetaker's own takeaways (+ overview for
// context), NOT re-derived from the transcript, so it stays a faithful record.
'use strict'

function buildPrompt({ meeting, overview, takeaways }) {
  return `Condense the key takeaways from a "${meeting}" meeting into 5 to 7 short, high-level bullets a manager can scan in about 15 seconds.

Rules:
- One line per bullet, high-level. Merge related or granular points; drop trivia and process detail.
- Keep specifics that carry weight (names, numbers, dates, decisions) but cut incidental detail.
- Plain markdown bullets starting with "- ". No sub-bullets, no headings, no preamble, no closing line.
- Do NOT use em-dashes. Use commas, periods, or "to" for ranges.
- Do not invent anything. Only condense what is given below.

OVERVIEW (context only, do not restate):
${overview || '(none)'}

KEY TAKEAWAYS (condense these):
${takeaways}`
}

// Returns condensed markdown bullets, or '' if there's nothing to condense.
async function condenseTakeaways({ meeting, overview, takeaways }, { model } = {}) {
  if (!takeaways || !takeaways.trim()) return ''
  const { generateText } = require('../dayOneProgram/anthropic') // lazy: keeps buildPrompt SDK-free
  const text = await generateText({
    prompt: buildPrompt({ meeting, overview, takeaways }),
    maxTokens: 700,
    ...(model ? { model } : {}),
  })
  return text.trim()
}

module.exports = { condenseTakeaways, buildPrompt }
