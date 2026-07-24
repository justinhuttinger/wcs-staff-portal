// auth/src/services/meetingNotes/format.js
// Assemble the human-facing notes markdown for the Google Doc from a parsed
// ClickUp doc. Notes only, no transcript. Keeps Overview, Key Takeaways, and
// Next Steps; drops the long unstructured Key Topics section. Cleans the two
// known notetaker quirks: a doubled attendee, and Annette appearing as the
// shared club account.
'use strict'

const { splitSections, getSection } = require('./parse')

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December']
const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']

function longDate(ymd) {
  const [y, m, d] = ymd.split('-').map(Number)
  const wd = WEEKDAYS[new Date(Date.UTC(y, m - 1, d, 12)).getUTCDay()]
  return `${wd}, ${MONTHS[m - 1]} ${d}, ${y}`
}

// Known shared-account alias the notetaker mis-attributes. Applied to the
// attendee list (display only; the transcript is left untouched for the AI).
const ALIASES = { 'East Side Athletic Club': 'Annette (East Side Athletic Club)' }

function cleanAttendees(attendees) {
  return attendees.map((a) => ALIASES[a] || a)
}

// parsed = output of parse.parseDoc. opts.condensedTakeaways (optional) replaces
// the notetaker's verbatim Key Takeaways with an AI-condensed version.
// Title is a Heading 2 (H1 imports as an oversized Docs title); the date is a
// plain line beneath it. No em-dashes (they read oddly in the rendered Doc).
// Sections kept, in order: Overview, Key Takeaways, Next Steps. Key Topics is
// intentionally dropped (long and unstructured).
function buildNotesMarkdown(parsed, { condensedTakeaways = null } = {}) {
  const sections = splitSections(parsed.notes)
  const overview = getSection(sections, 'Overview')
  const takeaways = condensedTakeaways && condensedTakeaways.trim()
    ? condensedTakeaways.trim()
    : getSection(sections, 'Key Takeaways')
  const nextSteps = getSection(sections, 'Next Steps')

  const lines = []
  lines.push(`## ${parsed.meeting}`)
  lines.push('')
  lines.push(longDate(parsed.date))
  lines.push('')
  if (parsed.attendees.length) {
    lines.push(`**Attendees:** ${cleanAttendees(parsed.attendees).join(', ')}`)
    lines.push('')
  }
  if (parsed.recordingUrl) {
    lines.push(`**Recording:** ${parsed.recordingUrl}`)
    lines.push('')
  }

  const addSection = (title, content) => {
    if (!content || !content.trim()) return
    lines.push(`### ${title}`)
    lines.push('')
    lines.push(content.trim())
    lines.push('')
  }
  addSection('Overview', overview)
  addSection('Key Takeaways', takeaways)
  addSection('Next Steps', nextSteps)

  // Fallback: if the notetaker used unexpected headings and we matched nothing,
  // fall back to the raw body (minus the attendees line) rather than an empty doc.
  if (!overview && !takeaways && !nextSteps) {
    lines.push(parsed.notes.replace(/^\s*\*\*Attendees:\*\*.*$/im, '').replace(/\n{3,}/g, '\n\n').trim())
  }

  return lines.join('\n').replace(/\n{3,}/g, '\n\n').trim()
}

module.exports = { buildNotesMarkdown, longDate, cleanAttendees }
