// auth/src/services/meetingNotes/google.js
// Google Drive/Docs/Calendar operations for the meeting-notes job, as raw REST
// with a bearer access token (same style as services/googleSheets.js). The
// token belongs to the meeting-notes owner (config.GOOGLE_OWNER_EMAIL), resolved
// via the existing per-staff token service. Requires the token to carry the
// documents + calendar.events scopes (see the meeting-notes connect flow).
'use strict'

const { supabaseAdmin } = require('../supabase')
const { getStaffGoogleAccessToken } = require('../googleUserToken')
const { GOOGLE_OWNER_EMAIL } = require('./config')
const { buildMultipartBody, pacificDayBounds, hashString, attendeeEmails } = require('./googleHelpers')

const DRIVE = 'https://www.googleapis.com/drive/v3'
const DRIVE_UPLOAD = 'https://www.googleapis.com/upload/drive/v3'
const CAL = 'https://www.googleapis.com/calendar/v3'

async function googleJson(url, accessToken, init = {}) {
  const res = await fetch(url, {
    ...init,
    headers: { Authorization: 'Bearer ' + accessToken, ...(init.headers || {}) },
  })
  const text = await res.text()
  let body
  try { body = text ? JSON.parse(text) : {} } catch { body = { _raw: text } }
  if (!res.ok) throw new Error(`Google ${res.status}: ${body.error?.message || body._raw || 'error'}`)
  return body
}

// --- token ----------------------------------------------------------------

async function getOwnerAccessToken() {
  const { data, error } = await supabaseAdmin
    .from('staff').select('id').eq('email', GOOGLE_OWNER_EMAIL).maybeSingle()
  if (error) throw error
  if (!data) throw new Error(`no staff row for ${GOOGLE_OWNER_EMAIL}`)
  const { accessToken } = await getStaffGoogleAccessToken(data.id)
  return accessToken
}

// --- Drive: create a Google Doc from HTML ---------------------------------

// Uploads `html` as a converted Google Doc. Returns { id, url }. Owner keeps
// full access automatically; call shareDocWithEmails to grant the invitees.
async function createDocFromHtml({ accessToken, title, html, folderId = null }) {
  const metadata = {
    name: title,
    mimeType: 'application/vnd.google-apps.document',
    ...(folderId ? { parents: [folderId] } : {}),
  }
  const boundary = 'mtgnotes' + Math.abs(hashString(title + html.length)).toString(36)
  const body = buildMultipartBody(metadata, html, boundary)
  const created = await googleJson(
    `${DRIVE_UPLOAD}/files?uploadType=multipart&fields=id,webViewLink`,
    accessToken,
    { method: 'POST', headers: { 'Content-Type': `multipart/related; boundary=${boundary}` }, body },
  )
  return { id: created.id, url: created.webViewLink || `https://docs.google.com/document/d/${created.id}/edit` }
}

// Grant reader access to specific people (the meeting's invitees). Each grant
// is independent and soft-fails so one bad address doesn't block the rest. No
// notification email is sent. Returns the emails successfully shared.
async function shareDocWithEmails({ accessToken, fileId, emails = [] }) {
  const shared = []
  for (const email of emails) {
    if (!email) continue
    try {
      await googleJson(`${DRIVE}/files/${fileId}/permissions?sendNotificationEmail=false`, accessToken, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ role: 'reader', type: 'user', emailAddress: email }),
      })
      shared.push(email)
    } catch (e) { console.warn(`[meetingNotes] share to ${email} failed:`, e.message) }
  }
  return shared
}

// --- Calendar: find a meeting's event on a date, attach a Doc -------------

// Best-matching event on `dateYmd` whose summary contains `query`. Returns the
// event object or null.
async function findEventOnDate({ accessToken, calendarId, dateYmd, query }) {
  const { timeMin, timeMax } = pacificDayBounds(dateYmd)
  const qs = new URLSearchParams({
    timeMin, timeMax, singleEvents: 'true', orderBy: 'startTime', maxResults: '50',
  })
  if (query) qs.set('q', query)
  const body = await googleJson(
    `${CAL}/calendars/${encodeURIComponent(calendarId)}/events?${qs.toString()}`, accessToken)
  const events = body.items || []
  const q = (query || '').toLowerCase()
  return events.find((e) => (e.summary || '').toLowerCase().includes(q)) || events[0] || null
}

// Attach the Doc to a calendar event: adds a Drive attachment and appends a
// labelled link to the event description. Non-destructive to existing content.
async function attachDocToEvent({ accessToken, calendarId, eventId, doc, label = 'Notes' }) {
  const existing = await googleJson(
    `${CAL}/calendars/${encodeURIComponent(calendarId)}/events/${eventId}`, accessToken)
  const attachments = (existing.attachments || []).filter((a) => a.fileId !== doc.id)
  attachments.push({
    fileUrl: doc.url, fileId: doc.id, title: doc.title || label,
    mimeType: 'application/vnd.google-apps.document',
  })
  const descLine = `${label}: ${doc.url}`
  const description = (existing.description || '').includes(doc.url)
    ? existing.description
    : `${existing.description ? existing.description + '\n' : ''}${descLine}`
  return googleJson(
    `${CAL}/calendars/${encodeURIComponent(calendarId)}/events/${eventId}?supportsAttachments=true`,
    accessToken,
    { method: 'PATCH', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ attachments, description }) },
  )
}

module.exports = {
  getOwnerAccessToken, createDocFromHtml, shareDocWithEmails,
  findEventOnDate, attachDocToEvent, attendeeEmails,
}
