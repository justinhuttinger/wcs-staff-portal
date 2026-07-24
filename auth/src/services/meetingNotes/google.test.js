// auth/src/services/meetingNotes/google.test.js
// Pure-helper tests only (no network). The Drive/Docs/Calendar calls need a
// live owner token and are verified after the OAuth reconnect.
const test = require('node:test')
const assert = require('node:assert')
const { buildMultipartBody, pacificDayBounds, attendeeEmails } = require('./googleHelpers')
const { addDays } = require('./dates')

test('attendeeEmails: dedupes, drops resources and declines, keeps the rest', () => {
  const event = { attendees: [
    { email: 'Jon@wcs.com' },
    { email: 'jon@wcs.com' }, // dup (case-insensitive)
    { email: 'room-a@resource.calendar.google.com', resource: true }, // resource
    { email: 'skip@wcs.com', responseStatus: 'declined' }, // declined
    { email: 'paige@wcs.com', responseStatus: 'accepted' },
    { displayName: 'no email' }, // no email
  ] }
  assert.deepStrictEqual(attendeeEmails(event), ['Jon@wcs.com', 'paige@wcs.com'])
})

test('attendeeEmails: no attendees -> empty (doc stays owner-only)', () => {
  assert.deepStrictEqual(attendeeEmails({}), [])
  assert.deepStrictEqual(attendeeEmails(null), [])
})

test('buildMultipartBody wraps metadata + html in a related body', () => {
  const meta = { name: 'X', mimeType: 'application/vnd.google-apps.document' }
  const body = buildMultipartBody(meta, '<h1>Hi</h1>', 'BOUND')
  assert.match(body, /--BOUND/)
  assert.match(body, /Content-Type: application\/json/)
  assert.match(body, /"mimeType":"application\/vnd\.google-apps\.document"/)
  assert.match(body, /Content-Type: text\/html/)
  assert.match(body, /<h1>Hi<\/h1>/)
  assert.match(body, /--BOUND--/)
})

test('pacificDayBounds brackets the calendar day in Pacific offset', () => {
  assert.deepStrictEqual(pacificDayBounds('2026-07-20'), {
    timeMin: '2026-07-20T00:00:00-07:00',
    timeMax: '2026-07-20T23:59:59-07:00',
  })
})

test('addDays computes next weekly meeting date', () => {
  assert.strictEqual(addDays('2026-07-20', 7), '2026-07-27')
  assert.strictEqual(addDays('2026-12-29', 7), '2027-01-05')
})
