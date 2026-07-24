// auth/src/services/meetingNotes/prep.js
// Generate prep notes for NEXT week's meeting from this week's notes +
// transcript, via the Claude API. The prompt is the product here: it must
// reproduce the careful transcript read that surfaces open commitments,
// unresolved disagreements the summary flattened, and unowned work — not a
// restatement of the summary. Everything must trace to something actually said.
'use strict'

const { generateText } = require('../dayOneProgram/anthropic')
const { longDate } = require('./format')

function buildPrompt({ meeting, date, nextDate, attendees, notes, transcript }) {
  return `You are preparing a busy operator for the next occurrence of a recurring meeting. Your job is to make the next meeting sharper by surfacing what actually needs follow-up, using ONLY what was said in the meeting you are given.

MEETING: ${meeting}
THIS MEETING'S DATE: ${longDate(date)}
NEXT MEETING'S DATE: ${longDate(nextDate)}
ATTENDEES: ${attendees.join(', ')}

You are given the meeting's structured NOTES and its full TRANSCRIPT. The transcript is the source of truth; the notes are a lossy summary. Read the transcript for things the summary flattened: commitments with owners and deadlines, disagreements that were talked over rather than resolved, work that was assigned to no one, and items that were raised and then dropped or laughed off.

Write prep notes for the NEXT meeting as GitHub-flavored markdown. Use exactly these two H2 sections, in order:

## Carryover accountability
Open action items and commitments from this meeting, each with its owner and, where stated, its deadline. Prefer a markdown table with columns: Owner | Commitment | Due | Status to confirm. Include a short line calling out any blocking chain (X gates Y gates Z) if one exists in the transcript. Only include commitments that were actually made.

## Suggested agenda
The handful of things worth raising next meeting: unresolved disagreements (name who disagreed and on what), decisions left open, work with no owner, and metrics someone said they'd revisit. Lead with the single most important unresolved item. Be specific and cite what was said. If something was raised and dodged, say so plainly.

If there are genuinely loose threads that fit neither section (raised once, no follow-up, no owner), add a short "## Loose threads" section. Otherwise omit it.

Rules:
- Trace everything to the transcript. Do NOT invent tasks, numbers, or agreements. If you're unsure something was committed, leave it out.
- Name people. Attribute disagreements and commitments to who said them.
- Be concise. No filler, no restating the summary, no motivational language.
- Do not include the transcript or a summary of the meeting. Only forward-looking prep.
- Do not wrap the output in code fences.

NOTES:
${notes}

TRANSCRIPT:
${transcript}`
}

// Returns the prep-notes markdown string. `now` unused; nextDate is passed in.
async function generatePrepNotes({ meeting, date, nextDate, attendees, notes, transcript }, { model } = {}) {
  const prompt = buildPrompt({ meeting, date, nextDate, attendees, notes, transcript })
  const text = await generateText({ prompt, maxTokens: 4000, ...(model ? { model } : {}) })
  return text.trim()
}

module.exports = { generatePrepNotes, buildPrompt }
