// auth/src/services/meetingNotes/googleHelpers.js
// Pure helpers for the Google REST calls, with no supabase/token dependency so
// they can be unit-tested without env. Imported by google.js.
'use strict'

// multipart/related body for a Drive upload that converts HTML to a Doc.
function buildMultipartBody(metadata, html, boundary) {
  return [
    `--${boundary}`,
    'Content-Type: application/json; charset=UTF-8', '',
    JSON.stringify(metadata), '',
    `--${boundary}`,
    'Content-Type: text/html; charset=UTF-8', '',
    html, '',
    `--${boundary}--`, '',
  ].join('\r\n')
}

// RFC3339 bounds for a Pacific calendar day. Offset defaults to PDT (-07:00);
// a one-hour slop at the day edge never spans two meetings.
function pacificDayBounds(dateYmd, offset = '-07:00') {
  return { timeMin: `${dateYmd}T00:00:00${offset}`, timeMax: `${dateYmd}T23:59:59${offset}` }
}

// Deterministic small hash (avoids Math.random, which throws in some sandboxes).
function hashString(s) {
  let h = 0
  for (let i = 0; i < String(s).length; i++) { h = (h * 31 + String(s).charCodeAt(i)) | 0 }
  return h
}

// Emails of real human invitees on a calendar event: skip resource rooms and
// anyone who declined. Deduped, lowercased. The owner always keeps access
// separately (they own the file), so they need not be in here.
function attendeeEmails(event) {
  const out = []
  const seen = new Set()
  for (const a of (event && event.attendees) || []) {
    if (!a || !a.email || a.resource) continue
    if (a.responseStatus === 'declined') continue
    const email = a.email.toLowerCase()
    if (!seen.has(email)) { seen.add(email); out.push(a.email) }
  }
  return out
}

module.exports = { buildMultipartBody, pacificDayBounds, hashString, attendeeEmails }
