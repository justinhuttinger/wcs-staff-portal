// auth/src/services/meetingNotes/index.js
// Orchestrates: poll ClickUp for new dated meeting Docs of configured meetings,
// and for each one publish a notes Google Doc (attached to that day's calendar
// event) plus AI prep notes for next week's meeting (attached to next week's
// event). Idempotent via meeting_notes_runs. Mirrors the blogAutomation shape.
'use strict'

const cron = require('node-cron')
const cu = require('./clickup')
const { parseDoc } = require('./parse')
const { getMeeting, enabledMeetings, CALENDAR_ID, DRIVE_FOLDER_ID, CRON, TZ, ENABLED_ENV, SCAN_PAGES, MAX_AGE_DAYS } = require('./config')
const { buildNotesMarkdown, longDate } = require('./format')
const { markdownToHtml, htmlDocument } = require('./markdown')
const { generatePrepNotes } = require('./prep')
const { addDays, todayPacific } = require('./dates')
const google = require('./google')
const jobs = require('./jobs')
const { sendAlert } = require('../blogAutomation/alerts')

// Process one already-parsed meeting doc end to end. Never throws; records the
// run. `accessToken` is the owner's Google token (fetched once per poll).
async function processDoc(parsed, docId, accessToken) {
  const meeting = getMeeting(parsed.meeting)
  if (!meeting) return { status: 'skipped', reason: 'meeting not in registry' }

  try {
    // 1. Notes Google Doc, attached to this meeting's calendar event.
    const notesMd = buildNotesMarkdown(parsed)
    const notesTitle = `${parsed.meeting} - ${longDate(parsed.date)} - Notes`
    const notesDoc = await google.createDocFromHtml({
      accessToken, title: notesTitle, folderId: DRIVE_FOLDER_ID, anyoneWithLink: true,
      html: htmlDocument(notesTitle, markdownToHtml(notesMd)),
    })
    notesDoc.title = notesTitle

    let notesEventId = null
    const notesEvent = await google.findEventOnDate({
      accessToken, calendarId: CALENDAR_ID, dateYmd: parsed.date, query: meeting.calendarQuery,
    })
    if (notesEvent) {
      await google.attachDocToEvent({
        accessToken, calendarId: CALENDAR_ID, eventId: notesEvent.id, doc: notesDoc, label: 'Meeting notes',
      })
      notesEventId = notesEvent.id
    }

    // 2. Prep notes for next week's meeting, attached to next week's event.
    const nextDate = addDays(parsed.date, meeting.cadenceDays)
    const prepMd = await generatePrepNotes({
      meeting: parsed.meeting, date: parsed.date, nextDate,
      attendees: parsed.attendees, notes: parsed.notes, transcript: parsed.transcript,
    })
    const prepTitle = `${parsed.meeting} - ${longDate(nextDate)} - Prep Notes`
    const prepDoc = await google.createDocFromHtml({
      accessToken, title: prepTitle, folderId: DRIVE_FOLDER_ID, anyoneWithLink: true,
      html: htmlDocument(prepTitle, markdownToHtml(prepMd)),
    })
    prepDoc.title = prepTitle

    let prepEventId = null
    const prepEvent = await google.findEventOnDate({
      accessToken, calendarId: CALENDAR_ID, dateYmd: nextDate, query: meeting.calendarQuery,
    })
    if (prepEvent) {
      await google.attachDocToEvent({
        accessToken, calendarId: CALENDAR_ID, eventId: prepEvent.id, doc: prepDoc, label: 'Prep notes',
      })
      prepEventId = prepEvent.id
    }

    await jobs.markDone(docId, {
      meeting: parsed.meeting, meeting_date: parsed.date,
      notes_doc_id: notesDoc.id, notes_doc_url: notesDoc.url, notes_event_id: notesEventId,
      prep_doc_id: prepDoc.id, prep_doc_url: prepDoc.url, prep_event_id: prepEventId,
    })
    console.log(`[MeetingNotes] processed "${parsed.meeting}" ${parsed.date}`
      + ` notes=${notesDoc.id}${notesEventId ? '' : ' (no event)'} prep=${prepDoc.id}${prepEventId ? '' : ' (no event)'}`)
    return { status: 'done', notesDoc, prepDoc, notesEventId, prepEventId }
  } catch (err) {
    console.error(`[MeetingNotes] "${parsed.meeting}" ${parsed.date} failed:`, err.message)
    await jobs.markFailed(docId, parsed.meeting, parsed.date, err.message).catch(() => {})
    await sendAlert(`Meeting notes FAILED for ${parsed.meeting} ${parsed.date}: ${err.message}`).catch(() => {})
    return { status: 'failed', reason: err.message }
  }
}

// One poll: find unprocessed dated Docs for enabled meetings and process them.
// Options (all optional): `meeting` restricts to one meeting key; `limit` caps
// how many docs are processed (newest first) — pass 1 for a single-meeting test.
async function runOnce({ meeting = null, limit = null } = {}) {
  const enabledKeys = new Set(enabledMeetings().map((m) => m.key))
  if (enabledKeys.size === 0) return { processed: 0 }

  const cutoff = addDays(todayPacific(), -MAX_AGE_DAYS)
  const metaDocs = await cu.listMeetingDocs({ maxPages: SCAN_PAGES })
  let candidates = metaDocs
    .filter((d) => enabledKeys.has(d.meeting))
    .filter((d) => d.date >= cutoff) // never process stale meetings
  if (meeting) candidates = candidates.filter((d) => d.meeting === meeting)
  if (candidates.length === 0) return { processed: 0 }

  const done = await jobs.doneDocIds()
  let todo = candidates.filter((d) => !done.has(d.id)) // already newest-first
  if (limit != null) todo = todo.slice(0, Math.max(0, limit))
  if (todo.length === 0) return { processed: 0 }

  const accessToken = await google.getOwnerAccessToken()

  const results = []
  for (const d of todo) {
    const content = await cu.getDocContent(d.id).catch((e) => { console.warn('[MeetingNotes] content fetch failed', d.id, e.message); return '' })
    const parsed = content ? parseDoc({ name: d.name, content }) : null
    if (!parsed) { results.push({ doc: d.id, status: 'skipped', reason: 'unparseable' }); continue }
    results.push({ doc: d.id, ...(await processDoc(parsed, d.id, accessToken)) })
  }
  console.log('[MeetingNotes] poll complete:', results.map((r) => `${r.doc}:${r.status}`).join(' '))
  return { processed: results.filter((r) => r.status === 'done').length, results }
}

function start() {
  if (process.env[ENABLED_ENV] !== 'true') {
    console.log(`[MeetingNotes] disabled (set ${ENABLED_ENV}=true to enable poll)`)
    return
  }
  cron.schedule(CRON, () => {
    runOnce().catch((e) => console.error('[MeetingNotes] poll failed:', e.message))
  }, { timezone: TZ })
  console.log('[MeetingNotes] poll cron registered')
}

module.exports = { runOnce, processDoc, start }
