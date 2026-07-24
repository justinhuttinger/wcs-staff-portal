// auth/src/services/meetingNotes/index.js
// Orchestrates: poll ClickUp for new dated meeting Docs of configured meetings,
// and for each one publish a notes Google Doc (attached to that day's calendar
// event) plus AI prep notes for next week's meeting (attached to next week's
// event). Idempotent via meeting_notes_runs. Mirrors the blogAutomation shape.
'use strict'

const cron = require('node-cron')
const cu = require('./clickup')
const { parseDoc, splitSections, getSection } = require('./parse')
const { getMeeting, enabledMeetings, CALENDAR_ID, DRIVE_FOLDER_ID, DRIVE_FOLDER_NAME, CRON, TZ, ENABLED_ENV, SCAN_PAGES, MAX_AGE_DAYS } = require('./config')
const { buildNotesMarkdown, longDate } = require('./format')
const { markdownToHtml, htmlDocument } = require('./markdown')
const { generatePrepNotes } = require('./prep')
const { condenseTakeaways } = require('./summarize')
const { addDays, todayPacific } = require('./dates')
const google = require('./google')
const jobs = require('./jobs')
const { sendAlert } = require('../blogAutomation/alerts')

// Resolve (and cache for the process) the Drive folder the Docs go in. An
// explicit id wins; otherwise find-or-create the named folder. Non-fatal: on
// failure, return null so Docs still publish (to My Drive root).
let _folderIdCache = null
async function resolveFolderId(accessToken) {
  if (DRIVE_FOLDER_ID) return DRIVE_FOLDER_ID
  if (_folderIdCache) return _folderIdCache
  try {
    _folderIdCache = await google.ensureFolder({ accessToken, name: DRIVE_FOLDER_NAME })
  } catch (e) {
    console.warn('[MeetingNotes] folder resolve failed, using My Drive root:', e.message)
    return null
  }
  return _folderIdCache
}

// Look up a meeting's event, non-fatally. Calendar problems (an outage, a not-
// yet-enabled API) return null instead of throwing, so Doc creation still
// proceeds — a throw here would only orphan Docs on the retry.
async function findEventSafe({ accessToken, dateYmd, query, label }) {
  try {
    return await google.findEventOnDate({ accessToken, calendarId: CALENDAR_ID, dateYmd, query })
  } catch (e) {
    console.warn(`[MeetingNotes] ${label} event lookup failed (non-fatal):`, e.message)
    return null
  }
}

// Attach a Doc to an event, non-fatally. Returns the event id on success, else
// null. A failed attach must not fail the whole meeting (the Doc already
// exists; failing would orphan it and re-create a duplicate on retry).
async function attachSafe(event, doc, label, accessToken) {
  if (!event) return null
  try {
    await google.attachDocToEvent({ accessToken, calendarId: CALENDAR_ID, eventId: event.id, doc, label })
    return event.id
  } catch (e) {
    console.warn(`[MeetingNotes] ${label} attach failed (non-fatal):`, e.message)
    return null
  }
}

// Process one already-parsed meeting doc end to end. Never throws; records the
// run. `accessToken` is the owner's Google token; `folderId` is the Drive
// folder the Docs go in (may be null).
async function processDoc(parsed, docId, accessToken, folderId = null) {
  const meeting = getMeeting(parsed.meeting)
  if (!meeting) return { status: 'skipped', reason: 'meeting not in registry' }

  try {
    // 1. Notes Google Doc. Find the meeting's calendar event first so the Doc
    //    is shared only with that meeting's invitees. Calendar is best-effort:
    //    an outage must never block Doc creation (it would only orphan Docs on
    //    the retry), so a lookup failure just means no invitees / no attach.
    const notesEvent = await findEventSafe({
      accessToken, dateYmd: parsed.date, query: meeting.calendarQuery, label: 'notes',
    })
    // Condense the notetaker's granular Key Takeaways (non-fatal: on failure,
    // fall back to the verbatim takeaways so the notes Doc still publishes).
    let condensedTakeaways = null
    try {
      const secs = splitSections(parsed.notes)
      condensedTakeaways = await condenseTakeaways({
        meeting: parsed.meeting,
        overview: getSection(secs, 'Overview'),
        takeaways: getSection(secs, 'Key Takeaways'),
      })
    } catch (e) { console.warn('[MeetingNotes] takeaway condense failed:', e.message) }

    const notesMd = buildNotesMarkdown(parsed, { condensedTakeaways })
    const notesTitle = `${parsed.meeting} - ${longDate(parsed.date)} - Notes`
    const notesDoc = await google.createDocFromHtml({
      accessToken, title: notesTitle, folderId,
      html: htmlDocument(notesTitle, markdownToHtml(notesMd)),
    })
    notesDoc.title = notesTitle
    await google.shareDocWithEmails({
      accessToken, fileId: notesDoc.id, emails: google.attendeeEmails(notesEvent),
    })

    const notesEventId = await attachSafe(notesEvent, notesDoc, 'Meeting notes', accessToken)

    // 2. Prep notes for next week's meeting, shared with and attached to next
    //    week's event (its invitees, which may differ from this week's).
    const nextDate = addDays(parsed.date, meeting.cadenceDays)
    const prepEvent = await findEventSafe({
      accessToken, dateYmd: nextDate, query: meeting.calendarQuery, label: 'prep',
    })
    const prepMd = await generatePrepNotes({
      meeting: parsed.meeting, date: parsed.date, nextDate,
      attendees: parsed.attendees, notes: parsed.notes, transcript: parsed.transcript,
    })
    const prepTitle = `${parsed.meeting} - ${longDate(nextDate)} - Prep Notes`
    const prepDoc = await google.createDocFromHtml({
      accessToken, title: prepTitle, folderId,
      html: htmlDocument(prepTitle, markdownToHtml(prepMd)),
    })
    prepDoc.title = prepTitle
    // Fall back to this week's invitees if next week's event has none yet.
    const prepEmails = google.attendeeEmails(prepEvent)
    await google.shareDocWithEmails({
      accessToken, fileId: prepDoc.id,
      emails: prepEmails.length ? prepEmails : google.attendeeEmails(notesEvent),
    })

    const prepEventId = await attachSafe(prepEvent, prepDoc, 'Prep notes', accessToken)

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
//
// Run-lock: node-cron does not prevent overlap, and a manual run can coincide
// with a cron tick. Without the lock both would see the same not-yet-recorded
// docs and double-create. A second concurrent call returns immediately.
let _running = false
async function runOnce(opts = {}) {
  if (_running) {
    console.warn('[MeetingNotes] run already in progress — skipping this call')
    return { processed: 0, skipped: 'already running' }
  }
  _running = true
  try {
    return await runOnceInner(opts)
  } finally {
    _running = false
  }
}

async function runOnceInner({ meeting = null, limit = null } = {}) {
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
  const folderId = await resolveFolderId(accessToken)

  const results = []
  for (const d of todo) {
    const content = await cu.getDocContent(d.id).catch((e) => { console.warn('[MeetingNotes] content fetch failed', d.id, e.message); return '' })
    const parsed = content ? parseDoc({ name: d.name, content }) : null
    if (!parsed) { results.push({ doc: d.id, status: 'skipped', reason: 'unparseable' }); continue }
    results.push({ doc: d.id, ...(await processDoc(parsed, d.id, accessToken, folderId)) })
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
