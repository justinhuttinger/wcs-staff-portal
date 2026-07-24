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
  return `You are preparing a busy operator for the next occurrence of a recurring meeting. Make the next meeting sharper by surfacing what actually needs follow-up, using ONLY what was said in the meeting you are given.

MEETING: ${meeting}
THIS MEETING'S DATE: ${longDate(date)}
NEXT MEETING'S DATE: ${longDate(nextDate)}
ATTENDEES: ${attendees.join(', ')}

You are given the meeting's structured NOTES and its full TRANSCRIPT. The transcript is the source of truth; the notes are a lossy summary. Read the transcript for what the summary flattened: commitments with owners and deadlines, disagreements talked over rather than resolved, and work assigned to no one.

LENGTH IS CRITICAL: the whole output must fit on ONE PAGE (about 350 words, and never more than 500). Be ruthless. Include only the highest-signal items a manager must act on. It is better to list 3 sharp items than 10 mediocre ones. Cut anything routine or obvious.

Write prep notes for the NEXT meeting as GitHub-flavored markdown, with exactly these two H2 sections:

## Carryover accountability
A markdown table of open commitments only: columns Owner | Commitment | Due. One row per real commitment made in the meeting. Skip anything vague or already done. If a blocking chain exists (X gates Y), add one short sentence under the table.

## To raise next meeting
3 to 5 bullets, most important first: unresolved disagreements (name who disagreed and on what), open decisions, work with no owner. One sentence each, specific, tied to what was said.

Rules:
- Trace everything to the transcript. Do NOT invent tasks, numbers, or agreements. If unsure something was committed, leave it out.
- Name people.
- No filler, no summary of the meeting, no motivational language, no preamble.
- Do NOT use em-dashes anywhere. Use commas, periods, or "to" for ranges.
- Do not wrap the output in code fences. Do not add a title or heading above the two sections.

NOTES:
${notes}

TRANSCRIPT:
${transcript}`
}

// Returns the prep-notes markdown string. maxTokens capped low to enforce the
// one-page target (the prompt also demands it).
async function generatePrepNotes({ meeting, date, nextDate, attendees, notes, transcript }, { model } = {}) {
  const prompt = buildPrompt({ meeting, date, nextDate, attendees, notes, transcript })
  const text = await generateText({ prompt, maxTokens: 1200, ...(model ? { model } : {}) })
  return text.trim()
}

module.exports = { generatePrepNotes, buildPrompt }
