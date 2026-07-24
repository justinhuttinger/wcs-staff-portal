// auth/src/services/meetingNotes/format.js
// Assemble the human-facing notes markdown for the Google Doc from a parsed
// ClickUp doc. Notes only, no transcript. Cleans the two known notetaker
// quirks: a doubled attendee, and Annette appearing as the shared club account.
'use strict'

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

// parsed = output of parse.parseDoc. Returns a markdown string for the Doc.
// Title is a Heading 2 (H1 imports as an oversized Docs title); the date is a
// plain line beneath it. No em-dashes (they read oddly in the rendered Doc).
function buildNotesMarkdown(parsed) {
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
  // The notetaker's own notes body already carries the section headings; keep it
  // as-is below the header. Strip any leftover "**Attendees:**" line so it isn't
  // duplicated.
  const body = parsed.notes
    .replace(/^\s*\*\*Attendees:\*\*.*$/im, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
  lines.push(body)
  return lines.join('\n')
}

module.exports = { buildNotesMarkdown, longDate, cleanAttendees }
