// auth/src/services/meetingNotes/parse.test.js
const test = require('node:test')
const assert = require('node:assert')
const { parseDocName, splitNotesTranscript, extractAttendees, extractRecording, parseDoc } = require('./parse')

// Mirrors the real Corp Ops 7/20 doc shape.
const SAMPLE = `**Attendees:** Steve Vedder, Matthew Turnquist, Matthew Turnquist, Jon Horn, Justin Huttinger
[https://x.clickup-attachments.com/a/b.mp4?view=open&filename=Corp.mp4](https://x.clickup-attachments.com/a/b.mp4?view=open&filename=Corp.mp4)
### Overview

Team leads met.

### Key Takeaways

*   Block Party at every location.

*   Transcript

    **Justin Huttinger:** Doing the things.

    **Jon Horn:** Hello.`

test('parseDocName extracts meeting and ISO date', () => {
  assert.deepStrictEqual(parseDocName('Corporate Operations - 07/20/2026'),
    { meeting: 'Corporate Operations', date: '2026-07-20' })
  assert.deepStrictEqual(parseDocName('Marketing  - 01/05/2026'),
    { meeting: 'Marketing', date: '2026-01-05' })
})

test('parseDocName returns null for non-meeting docs', () => {
  assert.strictEqual(parseDocName('Project Notes'), null)
  assert.strictEqual(parseDocName('New Hire Paperwork 2026.docx'), null)
})

test('splitNotesTranscript splits on the Transcript marker', () => {
  const { notes, transcript } = splitNotesTranscript(SAMPLE)
  assert.ok(notes.includes('### Overview'))
  assert.ok(!notes.includes('Doing the things'))
  assert.ok(transcript.startsWith('*   Transcript') || transcript.startsWith('Transcript'))
  assert.ok(transcript.includes('Doing the things'))
})

test('splitNotesTranscript with no marker is all notes', () => {
  const { notes, transcript } = splitNotesTranscript('### Overview\nNo transcript here.')
  assert.ok(notes.includes('Overview'))
  assert.strictEqual(transcript, '')
})

test('extractAttendees dedupes and preserves order', () => {
  assert.deepStrictEqual(extractAttendees(SAMPLE),
    ['Steve Vedder', 'Matthew Turnquist', 'Jon Horn', 'Justin Huttinger'])
})

test('extractRecording pulls the mp4 link out of the notes', () => {
  const { notes, recordingUrl } = extractRecording(SAMPLE)
  assert.match(recordingUrl, /b\.mp4/)
  assert.ok(!notes.includes('.mp4'))
})

test('parseDoc assembles the full structured object', () => {
  const doc = parseDoc({ name: 'Corporate Operations - 07/20/2026', content: SAMPLE })
  assert.strictEqual(doc.meeting, 'Corporate Operations')
  assert.strictEqual(doc.date, '2026-07-20')
  assert.deepStrictEqual(doc.attendees.slice(0, 2), ['Steve Vedder', 'Matthew Turnquist'])
  assert.match(doc.recordingUrl, /\.mp4/)
  assert.ok(doc.notes.includes('### Overview'))
  assert.ok(doc.transcript.includes('Doing the things'))
})

test('parseDoc returns null for a non-meeting doc name', () => {
  assert.strictEqual(parseDoc({ name: 'Marketing Materials', content: 'x' }), null)
})
