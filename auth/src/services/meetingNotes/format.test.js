// auth/src/services/meetingNotes/format.test.js
const test = require('node:test')
const assert = require('node:assert')
const { buildNotesMarkdown, longDate, cleanAttendees } = require('./format')

test('longDate renders a full weekday date', () => {
  assert.strictEqual(longDate('2026-07-20'), 'Monday, July 20, 2026')
})

test('cleanAttendees relabels the shared club account', () => {
  assert.deepStrictEqual(
    cleanAttendees(['Jon Horn', 'East Side Athletic Club']),
    ['Jon Horn', 'Annette (East Side Athletic Club)'],
  )
})

test('buildNotesMarkdown adds a title, attendees, recording, and keeps the body once', () => {
  const parsed = {
    meeting: 'Corporate Operations',
    date: '2026-07-20',
    attendees: ['Jon Horn', 'East Side Athletic Club'],
    recordingUrl: 'https://x/rec.mp4',
    notes: '**Attendees:** Jon Horn, East Side Athletic Club\n### Overview\n\nTeam met.',
  }
  const md = buildNotesMarkdown(parsed)
  assert.match(md, /^# Corporate Operations — Monday, July 20, 2026/)
  assert.match(md, /\*\*Attendees:\*\* Jon Horn, Annette \(East Side Athletic Club\)/)
  assert.match(md, /\*\*Recording:\*\* https:\/\/x\/rec\.mp4/)
  assert.match(md, /### Overview/)
  // The raw "**Attendees:**" line from the body is stripped, so it appears once.
  assert.strictEqual((md.match(/\*\*Attendees:\*\*/g) || []).length, 1)
})
