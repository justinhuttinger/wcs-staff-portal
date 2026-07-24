// auth/src/services/meetingNotes/config.js
// Registry of the recurring meetings this job processes, plus service-wide
// settings. Only meetings listed here (and enabled) are turned into Google
// Docs / prep notes — the notetaker records many one-off docs we ignore.
'use strict'

// `key` MUST equal the ClickUp doc's meeting name exactly (the part before
// " - MM/DD/YYYY"). `calendarQuery` is the substring matched against Google
// Calendar event titles to find the meeting's event on a given date; it
// defaults to `key`. `cadenceDays` is how far ahead "next meeting" is (7 for
// weekly) — used to locate next week's event for prep notes.
const MEETINGS = [
  { key: 'Corporate Operations', calendarQuery: 'Corporate Operations', cadenceDays: 7, enabled: true },
  { key: 'Corporate L10', calendarQuery: 'Corporate L10', cadenceDays: 7, enabled: true },
  { key: 'Marketing', calendarQuery: 'Marketing', cadenceDays: 7, enabled: true },
  { key: 'Paige / JC / Justin Check In', calendarQuery: 'Paige', cadenceDays: 7, enabled: true },
  { key: 'Jon & Justin', calendarQuery: 'Jon & Justin', cadenceDays: 7, enabled: false },
]

const getMeeting = (name) => MEETINGS.find((m) => m.key === name)
const enabledMeetings = () => MEETINGS.filter((m) => m.enabled)

module.exports = {
  MEETINGS,
  getMeeting,
  enabledMeetings,

  // The staff member whose Google account owns the Docs and whose calendar the
  // events live on. Resolved to a staff.id at runtime by email.
  GOOGLE_OWNER_EMAIL: process.env.MEETING_NOTES_GOOGLE_EMAIL || 'justin@wcstrength.com',

  // Which Google Calendar to search for meeting events.
  CALENDAR_ID: process.env.MEETING_NOTES_CALENDAR_ID || 'primary',

  // Optional Drive folder to place generated Docs in (else My Drive root).
  DRIVE_FOLDER_ID: process.env.MEETING_NOTES_DRIVE_FOLDER_ID || null,

  // Cron: hourly poll; it only acts on docs it hasn't processed yet, so a
  // meeting's Doc is picked up within the hour of the notetaker publishing it.
  CRON: process.env.MEETING_NOTES_CRON || '15 * * * *',
  TZ: 'America/Los_Angeles',
  ENABLED_ENV: 'MEETING_NOTES_ENABLED',

  // How many recent ClickUp docs to scan each poll (newest first).
  SCAN_PAGES: 3,
}
