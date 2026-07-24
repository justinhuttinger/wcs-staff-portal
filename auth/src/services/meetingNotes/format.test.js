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

const FULL_NOTES = [
  '**Attendees:** Jon Horn, East Side Athletic Club',
  '### Overview', '', 'Team met.', '',
  '### Key Takeaways', '', '- verbatim point one', '- verbatim point two', '',
  '### Next Steps', '', '- [ ] Jon: send checklist', '',
  '### Key Topics', '', '*   a very long unstructured wall of topic detail that runs on',
].join('\n')

test('buildNotesMarkdown: title, attendees, recording, and Key Topics dropped', () => {
  const parsed = {
    meeting: 'Corporate Operations', date: '2026-07-20',
    attendees: ['Jon Horn', 'East Side Athletic Club'],
    recordingUrl: 'https://x/rec.mp4', notes: FULL_NOTES,
  }
  const md = buildNotesMarkdown(parsed)
  assert.match(md, /^## Corporate Operations\n/)
  assert.match(md, /\nMonday, July 20, 2026\n/)
  assert.ok(!md.includes('—'), 'no em-dashes')
  assert.match(md, /\*\*Attendees:\*\* Jon Horn, Annette \(East Side Athletic Club\)/)
  assert.match(md, /### Overview/)
  assert.match(md, /### Next Steps/)
  assert.ok(!md.includes('Key Topics'), 'Key Topics section is dropped')
  assert.ok(!md.includes('unstructured wall'), 'Key Topics content is dropped')
  assert.strictEqual((md.match(/\*\*Attendees:\*\*/g) || []).length, 1)
})

test('buildNotesMarkdown: condensed takeaways replace the verbatim ones', () => {
  const parsed = { meeting: 'M', date: '2026-07-20', attendees: [], recordingUrl: null, notes: FULL_NOTES }
  const md = buildNotesMarkdown(parsed, { condensedTakeaways: '- condensed A\n- condensed B' })
  assert.match(md, /### Key Takeaways\n\n- condensed A\n- condensed B/)
  assert.ok(!md.includes('verbatim point one'), 'verbatim takeaways replaced')
})

test('buildNotesMarkdown: falls back to verbatim takeaways when none condensed', () => {
  const parsed = { meeting: 'M', date: '2026-07-20', attendees: [], recordingUrl: null, notes: FULL_NOTES }
  const md = buildNotesMarkdown(parsed)
  assert.match(md, /- verbatim point one/)
})
