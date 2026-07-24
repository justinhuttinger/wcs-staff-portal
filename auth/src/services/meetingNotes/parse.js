// auth/src/services/meetingNotes/parse.js
// Pure parsing of a ClickUp notetaker doc into structured parts. No I/O.
//
// The notetaker emits docs named "<Meeting Name> - MM/DD/YYYY" whose page
// content is markdown: an "**Attendees:**" line, a recording link, then
// "### Overview / ### Key Takeaways / ### Next Steps / ### Key Topics", then a
// "*   Transcript" bullet followed by "**Speaker:** ..." turns.
'use strict'

// "Corporate Operations - 07/20/2026" -> { meeting, date: 'YYYY-MM-DD' }.
// Returns null if the name doesn't match the notetaker convention.
function parseDocName(name) {
  const m = /^(.*?)\s*-\s*(\d{2})\/(\d{2})\/(\d{4})\s*$/.exec(String(name || ''))
  if (!m) return null
  const [, meeting, mm, dd, yyyy] = m
  return { meeting: meeting.trim(), date: `${yyyy}-${mm}-${dd}` }
}

// Split the page content into notes (everything before the transcript) and the
// transcript. The transcript starts at the first line that is just a
// "Transcript" bullet/heading. If there's no such marker, it's all notes.
function splitNotesTranscript(content) {
  const text = String(content || '')
  const marker = /^[ \t]*(?:\*[ \t]+)?#*[ \t]*Transcript[ \t]*$/im.exec(text)
  if (!marker) return { notes: text.trim(), transcript: '' }
  const idx = marker.index
  return {
    notes: text.slice(0, idx).trim(),
    transcript: text.slice(idx).trim(),
  }
}

// Attendee names from the "**Attendees:** a, b, c" line. Deduped, order kept.
function extractAttendees(notes) {
  const m = /\*\*Attendees:\*\*\s*(.+)/i.exec(String(notes || ''))
  if (!m) return []
  const seen = new Set()
  const out = []
  for (const raw of m[1].split(',')) {
    const name = raw.trim()
    if (name && !seen.has(name.toLowerCase())) { seen.add(name.toLowerCase()); out.push(name) }
  }
  return out
}

// Strip the standalone recording-attachment markdown link (an mp4 URL) from the
// notes so it doesn't leak into the Google Doc. Returns { notes, recordingUrl }.
function extractRecording(notes) {
  const text = String(notes || '')
  const m = /\[https?:\/\/[^\]]*\.mp4[^\]]*\]\((https?:\/\/[^)]*\.mp4[^)]*)\)/i.exec(text)
  if (!m) return { notes: text, recordingUrl: null }
  const cleaned = text.replace(m[0], '').replace(/\n{3,}/g, '\n\n').trim()
  return { notes: cleaned, recordingUrl: m[1] }
}

// Full parse of one ClickUp doc page.
// Returns { meeting, date, attendees[], recordingUrl, notes, transcript } or
// null if the doc name isn't a dated meeting doc.
function parseDoc({ name, content }) {
  const named = parseDocName(name)
  if (!named) return null
  const { notes: body, transcript } = splitNotesTranscript(content)
  const { notes, recordingUrl } = extractRecording(body)
  return {
    meeting: named.meeting,
    date: named.date,
    attendees: extractAttendees(notes),
    recordingUrl,
    notes,
    transcript,
  }
}

// Split notetaker notes markdown into its ## / ### sections. Returns an ordered
// array of { title, content }. Content before the first heading (the attendees
// line) is dropped — callers pull named sections via getSection.
function splitSections(md) {
  const lines = String(md || '').split(/\r?\n/)
  const sections = []
  let cur = null
  for (const line of lines) {
    const h = /^#{2,6}\s+(.+?)\s*$/.exec(line)
    if (h) { cur = { title: h[1].trim(), lines: [] }; sections.push(cur) }
    else if (cur) cur.lines.push(line)
  }
  return sections.map((s) => ({ title: s.title, content: s.lines.join('\n').trim() }))
}

const normTitle = (t) => String(t || '').toLowerCase().replace(/[^a-z0-9 ]/g, '').trim()

// Content of the first section whose title matches `name` (case/punct-insensitive).
function getSection(sections, name) {
  const want = normTitle(name)
  const hit = sections.find((s) => normTitle(s.title) === want)
  return hit ? hit.content : null
}

module.exports = {
  parseDocName, splitNotesTranscript, extractAttendees, extractRecording, parseDoc,
  splitSections, getSection,
}
