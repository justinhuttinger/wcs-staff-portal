/**
 * /group-x — Group X class scheduler.
 *
 * Permission model (all three keys live in permission_catalog under Tools, so
 * Admin -> Roles drives them):
 *   groupX                — see the schedule and the attendance log. Everyone.
 *   groupX:schedule-edit  — add/cancel classes, run series, badge new classes.
 *   groupX:attendance     — record a headcount.
 * Admins always pass, so the Admin Panel keeps working whatever the grid says.
 * Reading is deliberately open to every tile holder: the schedule is a printed
 * lobby handout, not sensitive data.
 *
 * Clubs are narrowed to the caller's assigned locations by allowedClubsFor().
 * That check is on the server on purpose — club_number comes off the request.
 *
 * ABC is the source of truth for what is scheduled. Supabase (group_x_series,
 * group_x_class_attendance) owns only the recurring-series definition and the
 * post-class headcount.
 *
 * Attendance is staff-entered rather than read from ABC: of 37 Salem class
 * events in July 2026, 31 had zero members attached and the rest had one, all
 * marked "Did Not Attend". Nobody books classes through ABC.
 */
const { Router } = require('express')
const abc = require('../services/abcGroupX')
const { isKnownClubNumber } = require('../lib/groupXClubs')
const { buildLocalTimestamp, DATE_RE } = require('../lib/abcTime')
const { expandSeries, MAX_OCCURRENCES, matchesSeries, seriesWindow, findSeriesForEvent } = require('../lib/groupXSeries')
const { OPEN_ENDED_HORIZON_DAYS } = require('../lib/scheduleTimes')
const { padDate, toIsoDate } = require('../lib/abcTime')
const { supabaseAdmin } = require('../services/supabase')
const { publicCacheKeysForDates } = require('../lib/groupXPublic')
const { aggregate } = require('../lib/groupXReport')
const { markNewClasses } = require('../lib/groupXNewClasses')
const { recordSeriesEvents, resolveLinkedSeriesId } = require('../lib/groupXSeriesLink')
const { moveClassRefs } = require('../lib/groupXClassRefs')
const { applyClassEdit } = require('../lib/applyClassEdit')
const { seriesBelongsToClub, selectSeriesTargets, pairOccurrences } = require('../lib/groupXSeriesEdit')
const memoryCache = require('../services/memoryCache')
const authenticate = require('../middleware/auth')
const { requireRole, roleLevel } = require('../middleware/role')
const { requireTile } = require('../middleware/tile')
const { allowedClubsFor } = require('../lib/groupXScope')
const clubFeatures = require('../lib/clubFeatures')

const router = Router()
router.use(authenticate)

// Gate on a permission key, with admins always allowed through. The Admin Panel
// hosts the same views, and an admin unticking a Group X box in the roles grid
// should not lock the admin out of the screen they manage it from.
function requirePerm(permKey) {
  const tileGate = requireTile(permKey)
  return (req, res, next) => {
    if (roleLevel(req.staff?.role) >= roleLevel('admin')) return next()
    return tileGate(req, res, next)
  }
}

router.use(requirePerm('groupX'))

// Resolve the caller's clubs once per request. Every handler below reads
// req.gxClubs rather than the full CLUBS list.
router.use(async (req, res, next) => {
  try {
    // Two narrowings, and both matter. allowedClubsFor answers "may this person
    // see it"; clubsWith answers "does this club run it at all". A club with
    // Group X switched off should not appear even for an admin who can see
    // every club.
    const mine = await allowedClubsFor(req.staff)
    const map = await clubFeatures.loadMap()
    req.gxClubs = clubFeatures.clubsWith(map, mine, clubFeatures.GROUP_X)
    next()
  } catch (err) {
    console.error('[groupX] club scope failed:', err.message)
    res.status(500).json({ error: 'could not resolve club access' })
  }
})

const requireEdit = requirePerm('groupX:schedule-edit')
const requireAttendance = requirePerm('groupX:attendance')

// True when the caller is assigned to this club. Unknown club numbers are
// rejected the same way as unassigned ones — the caller learns nothing about
// which numbers are real.
function canUseClub(req, clubNumber) {
  return (req.gxClubs || []).some(c => c.clubNumber === String(clubNumber))
}

// Resolves and validates club_number off the query string. Returns null and
// sends the 400/403 itself, so handlers can `if (!club) return`.
function requireClub(req, res) {
  const clubNumber = String(req.query.club_number || '')
  if (!clubNumber) {
    res.status(400).json({ error: 'club_number is required' })
    return null
  }
  if (!isKnownClubNumber(clubNumber)) {
    res.status(400).json({ error: 'unknown club_number' })
    return null
  }
  if (!canUseClub(req, clubNumber)) {
    res.status(403).json({ error: 'no access to that club' })
    return null
  }
  return clubNumber
}

// Same check for the handlers that take club_number in the body.
function requireBodyClub(req, res, clubNumber) {
  if (!isKnownClubNumber(clubNumber)) {
    res.status(400).json({ error: 'valid club_number is required in body' })
    return false
  }
  if (!canUseClub(req, clubNumber)) {
    res.status(403).json({ error: 'no access to that club' })
    return false
  }
  return true
}

// The public board serves each club-week from a stale-while-revalidate cache,
// so a class created or cancelled here would otherwise take up to the full
// stale window to appear on the TVs. Clear the affected weeks on every write
// and the board picks the change up on its next poll.
function invalidatePublicBoard(clubNumber, dates) {
  for (const key of publicCacheKeysForDates(String(clubNumber), dates)) {
    memoryCache.del(key)
  }
}

// A "new class" badge applies to every occurrence, so a change to it affects
// every cached week rather than one. Clear a rolling window around today, which
// covers everything a board or website embed can actually be showing.
function invalidateAllWeeksFor(clubNumber) {
  const dates = []
  const d = new Date()
  d.setUTCDate(d.getUTCDate() - 28)
  for (let i = 0; i < 26; i++) {
    dates.push(d.toISOString().slice(0, 10))
    d.setUTCDate(d.getUTCDate() + 7)
  }
  invalidatePublicBoard(clubNumber, dates)
}

// Flags individual ABC events as new until a date. Used by the create paths
// (tick "mark as new" and every class it creates is badged) and by the toggle
// on an existing class.
async function flagEventsAsNew(clubNumber, events, showUntil, email) {
  const rows = events
    .filter(e => e && e.event_id)
    .map(e => ({
      club_number: String(clubNumber),
      abc_event_id: e.event_id,
      class_name: e.class_name || 'Class',
      show_until: showUntil,
      created_by: email || 'unknown',
      created_at: new Date().toISOString(),
    }))
  if (rows.length === 0) return
  const { error } = await supabaseAdmin
    .from('group_x_new_class_events')
    .upsert(rows, { onConflict: 'club_number,abc_event_id' })
  if (error) throw new Error(error.message)
}

function fail(res, err, where) {
  console.error(`[groupX] ${where} failed:`, err.message)
  res.status(500).json({ error: err.message })
}

// Only the caller's own clubs. The UI builds its club pills straight off this,
// so scoping here scopes the whole screen.
router.get('/clubs', (req, res) => res.json({ clubs: req.gxClubs }))

// POST /group-x/refresh-staff?club_number=
// Instructors and class types are cached for an hour. Onboarding a new
// instructor in ABC should not mean waiting that out.
router.post('/refresh-staff', (req, res) => {
  const club = requireClub(req, res); if (!club) return
  memoryCache.del(`gx:instructors:${club}`)
  memoryCache.del(`gx:types:${club}`)
  res.json({ ok: true })
})

router.get('/class-types', async (req, res) => {
  const club = requireClub(req, res); if (!club) return
  try {
    res.json({ class_types: await abc.listClassTypes(club) })
  } catch (err) { fail(res, err, '/class-types') }
})

router.get('/instructors', async (req, res) => {
  const club = requireClub(req, res); if (!club) return
  try {
    res.json({ instructors: await abc.listInstructors(club) })
  } catch (err) { fail(res, err, '/instructors') }
})

router.get('/classes', async (req, res) => {
  const club = requireClub(req, res); if (!club) return
  const { start, end } = req.query
  if (!DATE_RE.test(start || '') || !DATE_RE.test(end || '')) {
    return res.status(400).json({ error: 'start and end must be YYYY-MM-DD' })
  }
  if (end < start) {
    return res.status(400).json({ error: 'end must not be before start' })
  }
  try {
    const classes = await abc.listClasses(club, start, end)

    // Join the staff-entered headcounts. ABC is the source of truth for what
    // was scheduled; Supabase owns only how it went.
    const ids = classes.map(c => c.event_id)
    let byId = new Map()
    if (ids.length) {
      const { data, error } = await supabaseAdmin
        .from('group_x_class_attendance')
        .select('abc_event_id, headcount, notes, recorded_by, recorded_at')
        .eq('club_number', club)
        .in('abc_event_id', ids)
      if (error) throw new Error(error.message)
      byId = new Map((data || []).map(r => [r.abc_event_id, r]))
    }

    const [typeFlags, eventFlags] = await Promise.all([
      supabaseAdmin.from('group_x_new_classes')
        .select('event_type_id, class_name, show_until').eq('club_number', club),
      supabaseAdmin.from('group_x_new_class_events')
        .select('abc_event_id, class_name, show_until').eq('club_number', club),
    ])
    const flagged = markNewClasses(classes, typeFlags.data || [], eventFlags.data || [])

    // Which classes belong to a repeating series. Two sources, in order of
    // trust: the link table for classes created since migration 182, and a
    // shape match for everything older.
    const [linkRes, seriesRes] = await Promise.all([
      ids.length
        ? supabaseAdmin.from('group_x_series_events')
            .select('abc_event_id, series_id').eq('club_number', club).in('abc_event_id', ids)
        : Promise.resolve({ data: [] }),
      supabaseAdmin.from('group_x_series')
        .select('*').eq('club_number', club).is('canceled_at', null),
    ])
    // Both queries degrade to "no link data" instead of throwing: migration
    // 182 is applied by hand AFTER this merges, so during the deploy-to-apply
    // window the tables do not exist yet, and a 500 for the whole calendar
    // would be a worse outcome than briefly running with linking disabled.
    // Logging keeps that silent degradation visible in the server logs.
    if (linkRes.error) console.error('[groupX] could not read group_x_series_events, links disabled:', linkRes.error.message)
    if (seriesRes.error) console.error('[groupX] could not read group_x_series, series inference disabled:', seriesRes.error.message)
    const linkById = new Map((linkRes.data || []).map(r => [r.abc_event_id, r.series_id]))
    const liveSeries = seriesRes.data || []
    const liveSeriesIds = new Set(liveSeries.map(s => s.id))

    const nowIso = new Date().toISOString()
    res.json({
      classes: flagged.map(c => {
        const a = byId.get(c.event_id) || null
        // Only a link to a still-live series is trustworthy -- a cancelled
        // series' link row is never cleaned up, so a stale one falls through
        // to inference (already restricted to live series) instead of being
        // returned as-is.
        const linked = resolveLinkedSeriesId(linkById.get(c.event_id) || null, liveSeriesIds)
        // Only infer when there is no recorded link. An ambiguous shape --
        // two live series the class could equally belong to -- returns
        // nothing, so the UI degrades to a single-occurrence edit rather than
        // rewriting the wrong series.
        const guess = linked ? null : findSeriesForEvent(c, liveSeries)
        return {
          ...c,
          headcount: a ? a.headcount : null,
          notes: a ? a.notes : null,
          recorded_by: a ? a.recorded_by : null,
          recorded_at: a ? a.recorded_at : null,
          // Already happened and nobody logged a number. Drives the
          // needs-attendance strip. An unbooked placeholder slot is not a real
          // class, so it is never chased for a headcount.
          needs_attendance: !a && !c.unbooked && !!c.event_timestamp && c.event_timestamp < nowIso,
          series_id: linked || guess?.series?.id || null,
          series_source: linked ? 'linked' : (guess?.series ? 'inferred' : null),
        }
      }),
    })
  } catch (err) { fail(res, err, '/classes') }
})

// PUT /group-x/classes/:eventId/attendance — record how many people came.
//
// Staff-entered rather than read from ABC: of 37 Salem class events in July
// 2026, 31 had zero members attached and the rest had one, all marked "Did Not
// Attend". Nobody books classes through ABC, so its attendance data is unusable.
router.put('/classes/:eventId/attendance', requireAttendance, async (req, res) => {
  const b = req.body || {}
  if (!requireBodyClub(req, res, b.club_number)) return
  const headcount = parseInt(b.headcount, 10)
  if (!Number.isInteger(headcount) || headcount < 0) {
    return res.status(400).json({ error: 'headcount must be a whole number, zero or more' })
  }
  if (headcount > 500) {
    return res.status(400).json({ error: 'headcount looks wrong, check the number' })
  }
  if (!b.event_timestamp || !b.event_timestamp_local || !b.event_type_id || !b.class_name) {
    return res.status(400).json({ error: 'event_timestamp, event_timestamp_local, event_type_id and class_name are required' })
  }

  // Whole row. A partial upsert fails NOT NULL columns even when the row
  // already exists, which has broken syncs in this codebase before.
  const row = {
    club_number: String(b.club_number),
    abc_event_id: req.params.eventId,
    series_id: b.series_id || null,
    event_timestamp: b.event_timestamp,
    event_timestamp_local: b.event_timestamp_local,
    event_type_id: b.event_type_id,
    class_name: b.class_name,
    employee_id: b.employee_id || null,
    instructor_name: b.instructor_name || null,
    max_attendees: b.max_attendees ?? null,
    headcount,
    notes: b.notes || null,
    recorded_by: req.user?.email || 'unknown',
    recorded_at: new Date().toISOString(),
  }

  try {
    const { error } = await supabaseAdmin
      .from('group_x_class_attendance')
      .upsert(row, { onConflict: 'club_number,abc_event_id' })
    if (error) throw new Error(error.message)
    res.json({ ok: true })
  } catch (err) { fail(res, err, 'PUT /attendance') }
})

// POST /group-x/classes — create one class on the ABC calendar.
// Duration is deliberately not accepted: ABC takes it from the event type and
// silently ignores a duration in the payload (asked for 30, stored 60).
router.post('/classes', requireEdit, async (req, res) => {
  const b = req.body || {}
  if (!requireBodyClub(req, res, b.club_number)) return
  if (!b.event_type_id || !b.employee_id) {
    return res.status(400).json({ error: 'event_type_id and employee_id are required' })
  }
  let stamp
  try {
    stamp = buildLocalTimestamp(b.date, b.time)
  } catch (err) {
    return res.status(400).json({ error: err.message })
  }

  try {
    const result = await abc.createClass(String(b.club_number), {
      event_type_id: b.event_type_id,
      employee_id: b.employee_id,
      event_timestamp_local: stamp,
      training_level_id: b.training_level_id || null,
    })
    // ABC rejected it. Surface ABC's own message rather than a generic 500 —
    // its validation codes (API-CAL-EVT-*) are the useful part.
    if (!result.ok) return res.status(502).json({ error: result.error, abc_status: result.http })

    // Badging is best-effort: the class exists in ABC either way, and failing
    // the whole request over a missing badge would be worse than a missing
    // badge. Report it instead of hiding it.
    let badge_error = null
    if (b.mark_new && DATE_RE.test(b.new_until || '')) {
      try {
        await flagEventsAsNew(b.club_number, [{ event_id: result.event_id, class_name: b.class_name }], b.new_until, req.user?.email)
      } catch (err) {
        console.error('[groupX] could not badge new class:', err.message)
        badge_error = err.message
      }
    }

    invalidatePublicBoard(b.club_number, [b.date])
    res.status(201).json({ event_id: result.event_id, badge_error })
  } catch (err) { fail(res, err, 'POST /classes') }
})

// PUT /group-x/classes/:eventId — change one class.
//
// ABC has no event-update endpoint (PUT /events/{id} is a 405 for every body
// shape), so this is a create followed by a cancel, and the event id changes.
// The ordering that makes that safe -- and the past-date guard -- live in
// applyClassEdit, which is unit-tested with fakes; this handler is a thin
// wrapper that supplies the real ABC calls and maps the result onto HTTP.
router.put('/classes/:eventId', requireEdit, async (req, res) => {
  const b = req.body || {}
  if (!requireBodyClub(req, res, b.club_number)) return
  if (!b.event_type_id || !b.employee_id) {
    return res.status(400).json({ error: 'event_type_id and employee_id are required' })
  }

  // Validate the date's shape before comparing it to "today". Comparing an
  // unvalidated string first would let a malformed date slip past the
  // past-date guard and only get caught two checks later -- same 400 either
  // way, but a fragile order to depend on.
  let stamp
  try {
    stamp = buildLocalTimestamp(b.date, b.time)
  } catch (err) {
    return res.status(400).json({ error: err.message })
  }

  const club = String(b.club_number)
  const oldId = req.params.eventId
  const isPast = b.date < toIsoDate(new Date())
  const affectedDates = [b.date, b.old_date || b.date]

  try {
    const result = await applyClassEdit(
      { createClass: abc.createClass, cancelClass: abc.cancelClass, moveRefs: moveClassRefs },
      {
        clubNumber: club,
        oldEventId: oldId,
        eventTypeId: b.event_type_id,
        employeeId: b.employee_id,
        eventTimestampLocal: stamp,
        trainingLevelId: b.training_level_id,
        date: b.date,
        className: b.class_name,
        isPast,
      },
    )

    if (result.kind === 'past') {
      // Past classes are not editable. A past class is never deleted, so a
      // logged headcount can never be lost to a rebuild.
      return res.status(400).json({ error: 'that class has already happened and cannot be changed' })
    }

    if (result.kind === 'create_failed') {
      // ABC rejected it. Surface its own message rather than a generic 500 —
      // its validation codes (API-CAL-EVT-*) are the useful part. Nothing has
      // changed yet: the original class is untouched.
      return res.status(502).json({ error: result.error, abc_status: result.http })
    }

    if (result.kind === 'cancel_failed') {
      // The new class exists in ABC and is live right now, so the board must
      // pick it up even though the request is reporting an error — otherwise
      // staff are told to go fix a duplicate that the TV in the room doesn't
      // show yet.
      invalidatePublicBoard(club, affectedDates)
      return res.status(502).json({
        error: `The new class was created, but the old one could not be removed: ${result.error}. Cancel it by hand on the calendar.`,
        event_id: result.eventId,
        abc_status: result.http,
      })
    }

    // Both weeks: the new date, and — when the edit moved the class across a
    // week boundary — the old date, so that board does not keep serving the
    // class at its stale time for up to the full cache window.
    invalidatePublicBoard(club, affectedDates)
    res.json({ event_id: result.eventId, ...result.moved })
  } catch (err) { fail(res, err, 'PUT /classes') }
})

// DELETE /group-x/classes/:eventId?club_number= — cancel one class in ABC.
router.delete('/classes/:eventId', requireEdit, async (req, res) => {
  const club = requireClub(req, res); if (!club) return
  try {
    const result = await abc.cancelClass(club, req.params.eventId)
    if (!result.ok) return res.status(502).json({ error: result.error, abc_status: result.http })
    // `date` is optional; without it we cannot know which week to clear, so the
    // caller should send it. The board still self-corrects within the stale
    // window either way.
    if (req.query.date) invalidatePublicBoard(club, [req.query.date])
    res.json({ ok: true })
  } catch (err) { fail(res, err, 'DELETE /classes') }
})

// ---------------------------------------------------------------------------
// Recurring series.
//
// Each occurrence is a real write to a live club calendar, so the flow is
// deliberately two-step: /series/preview is a dry run that returns the exact
// date list, and the UI requires confirmation before /series fans out.
// ---------------------------------------------------------------------------

// POST /group-x/series/preview — dry run, no writes anywhere.
router.post('/series/preview', requireEdit, (req, res) => {
  const b = req.body || {}
  const openEnded = !b.ends_on
  try {
    const through = openEnded ? padDate(b.starts_on, OPEN_ENDED_HORIZON_DAYS) : b.ends_on
    const occurrences = expandSeries({ ...b, ends_on: through })
    res.json({
      count: occurrences.length,
      occurrences,
      max: MAX_OCCURRENCES,
      open_ended: openEnded,
      // With no end date this is only what gets created now; the nightly job
      // keeps extending it. Say so rather than implying the series stops here.
      materialized_through: through,
    })
  } catch (err) {
    res.status(400).json({ error: err.message })
  }
})

// POST /group-x/series — create the series and fan out one ABC event per date.
router.post('/series', requireEdit, async (req, res) => {
  const b = req.body || {}
  if (!requireBodyClub(req, res, b.club_number)) return
  if (!b.event_type_id || !b.employee_id || !b.class_name || !b.instructor_name) {
    return res.status(400).json({ error: 'event_type_id, employee_id, class_name and instructor_name are required' })
  }

  // No end date means open-ended: classes are created in ABC out to a rolling
  // horizon and topped up nightly, since infinite events are not a thing.
  const openEnded = !b.ends_on
  const materializeThrough = openEnded
    ? padDate(b.starts_on, OPEN_ENDED_HORIZON_DAYS)
    : b.ends_on

  let occurrences
  try {
    occurrences = expandSeries({ ...b, ends_on: materializeThrough })
  } catch (err) {
    return res.status(400).json({ error: err.message })
  }
  if (occurrences.length === 0) {
    return res.status(400).json({ error: 'that weekday and date range produce no classes' })
  }

  // Insert the series row FIRST. If the fan-out dies halfway, the series still
  // exists and its occurrences are still discoverable in ABC by date.
  const { data: series, error: insErr } = await supabaseAdmin
    .from('group_x_series')
    .insert({
      club_number: String(b.club_number),
      event_type_id: b.event_type_id,
      class_name: b.class_name,
      employee_id: b.employee_id,
      instructor_name: b.instructor_name,
      weekdays: b.weekdays,
      start_time: b.start_time,
      duration_minutes: parseInt(b.duration_minutes, 10) || 60,
      training_level_id: b.training_level_id || null,
      starts_on: b.starts_on,
      ends_on: openEnded ? null : b.ends_on,
      materialized_through: materializeThrough,
      created_by: req.user?.email || 'unknown',
    })
    .select('id')
    .single()
  if (insErr) return fail(res, new Error(insErr.message), 'POST /series insert')

  // Sequential, not parallel. ABC is a rate-limited production API and an
  // ordered failure list is far easier to act on.
  const results = []
  for (const occ of occurrences) {
    const r = await abc.createClass(String(b.club_number), {
      event_type_id: b.event_type_id,
      employee_id: b.employee_id,
      event_timestamp_local: occ.timestamp_local,
      training_level_id: b.training_level_id || null,
    })
    results.push({ date: occ.date, ok: r.ok, event_id: r.event_id, error: r.error })
  }

  const created = results.filter(r => r.ok).length

  // Record which ABC classes this series produced. POST /series has had these
  // ids in hand since it was written and dropped them; "change every class
  // from here on" is what needs them.
  const link_error = await recordSeriesEvents(b.club_number, series.id, results)

  // A new day of an existing class is normally added as a series, so the badge
  // has to apply to every occurrence it created, not just the first.
  let badge_error = null
  if (b.mark_new && DATE_RE.test(b.new_until || '')) {
    try {
      await flagEventsAsNew(
        b.club_number,
        results.filter(r => r.ok).map(r => ({ event_id: r.event_id, class_name: b.class_name })),
        b.new_until,
        req.user?.email,
      )
    } catch (err) {
      console.error('[groupX] could not badge new series:', err.message)
      badge_error = err.message
    }
  }

  // A series spans many weeks, so clear every week it touched or the board
  // keeps serving the old schedule for those weeks.
  invalidatePublicBoard(b.club_number, results.filter(r => r.ok).map(r => r.date))
  // Partial failure is reported as partial failure. Never as success.
  res.status(201).json({
    series_id: series.id,
    created,
    failed: results.length - created,
    occurrences: results,
    badge_error,
    link_error,
    open_ended: openEnded,
  })
})

// GET /group-x/series?club_number= — active series for the club.
router.get('/series', async (req, res) => {
  const club = requireClub(req, res); if (!club) return
  try {
    const { data, error } = await supabaseAdmin
      .from('group_x_series')
      .select('*')
      .eq('club_number', club)
      .is('canceled_at', null)
      .order('created_at', { ascending: false })
      .limit(200)
    if (error) throw new Error(error.message)
    res.json({ series: data || [] })
  } catch (err) { fail(res, err, 'GET /series') }
})

// ---------------------------------------------------------------------------
// Series-forward edit: rewrite every occurrence of a series from one date
// onward. ABC has no event-update endpoint, so exactly like PUT
// /classes/:eventId this is create-then-cancel per occurrence, just fanned
// out. Same two-step shape as /series/preview + /series: a dry run that
// returns the exact plan, and a confirmed write that reports partial failure
// as partial failure, never as success.
// ---------------------------------------------------------------------------

// Loads the series and refuses anything that is not, right now, this
// caller's own live series at the club they claim. Supabase here is
// service-role with no RLS, so this check IS the access control -- loading a
// series by id alone and building rows from the request body is a
// cross-tenant write (the mistake already shipped once on the Courts & Pool
// side: someone holding another club's series UUID could move that club's
// schedule into their own).
//
// A club mismatch and a caller who is not assigned to that club both come
// back as the same 404 "series not found". Answering 403 for the mismatch
// case would confirm the series id is real, just not theirs -- exactly the
// confirmation a cross-tenant probe is looking for.
async function loadOwnedSeries(req, res, seriesId, claimedClub) {
  const { data: series, error } = await supabaseAdmin
    .from('group_x_series')
    .select('*')
    .eq('id', seriesId)
    .single()
  if (error || !series || !seriesBelongsToClub(series, claimedClub) || !canUseClub(req, series.club_number)) {
    res.status(404).json({ error: 'series not found' })
    return null
  }
  return series
}

function requireSeriesEditBody(b) {
  if (!Array.isArray(b.weekdays) || b.weekdays.length === 0) return 'pick at least one day of the week'
  if (!b.event_type_id || !b.employee_id || !b.class_name || !b.start_time) {
    return 'event_type_id, employee_id, class_name and start_time are required'
  }
  return null
}

// How far the new schedule is expanded. Closed-ended series keep their own
// end date; an open-ended one (ends_on NULL) gets the same rolling horizon
// POST /series gives a brand-new open-ended series.
function seriesEditThrough(series, fromDate) {
  return series.ends_on || padDate(fromDate, OPEN_ENDED_HORIZON_DAYS)
}

// Never edit a past occurrence, even if the caller passes a past date in the
// URL -- the same guard applyClassEdit enforces per single class, applied
// here before anything is looked up.
function clampToToday(date) {
  const today = toIsoDate(new Date())
  return date < today ? today : date
}

// The classes this edit replaces, from `fromDate` onward -- shared by
// preview and apply so they can never compute a different answer. That
// exact split (preview reading a param apply didn't require) is what shipped
// a preview route stuck at 400 on the Courts & Pool side.
async function findSeriesTargets(series, fromDate) {
  const { data: linkedRows, error: linkErr } = await supabaseAdmin
    .from('group_x_series_events')
    .select('abc_event_id, event_date')
    .eq('series_id', series.id)
    .gte('event_date', fromDate)
  if (linkErr) throw new Error(linkErr.message)

  const { end: seriesEnd } = seriesWindow(series)
  let abcEvents = []
  if (seriesEnd && fromDate <= seriesEnd) {
    abcEvents = await abc.listClasses(series.club_number, fromDate, seriesEnd)
  }
  return selectSeriesTargets({ series, fromDate, linkedRows: linkedRows || [], abcEvents })
}

// POST /group-x/series/:id/edit-preview/:date — dry run, no writes anywhere.
router.post('/series/:id/edit-preview/:date', requireEdit, async (req, res) => {
  const b = req.body || {}
  if (!DATE_RE.test(req.params.date || '')) {
    return res.status(400).json({ error: 'date must be YYYY-MM-DD' })
  }
  const badBody = requireSeriesEditBody(b)
  if (badBody) return res.status(400).json({ error: badBody })

  const series = await loadOwnedSeries(req, res, req.params.id, b.club_number)
  if (!series) return

  const fromDate = clampToToday(req.params.date)
  const through = seriesEditThrough(series, fromDate)

  let occurrences = []
  try {
    if (!(through < fromDate)) {
      occurrences = expandSeries({ weekdays: b.weekdays, start_time: b.start_time, starts_on: fromDate, ends_on: through })
    }
  } catch (err) {
    return res.status(400).json({ error: err.message })
  }

  try {
    const targets = await findSeriesTargets(series, fromDate)
    res.json({ count: occurrences.length, occurrences, replacing: targets.length })
  } catch (err) { fail(res, err, 'POST /series/edit-preview') }
})

// PUT /group-x/series/:id/from/:date — apply the new shape from that date on.
//
// Targets and new occurrences are reconciled by date (pairOccurrences): a
// date on both sides is one occurrence's edit -- create the replacement,
// cancel the original, reusing applyClassEdit's ordering and its bookkeeping
// move exactly as PUT /classes/:eventId does. A date only among the new
// occurrences is a plain create (a weekday added); a date only among the old
// targets is a plain cancel (a weekday removed). Sequential throughout: ABC
// is a rate-limited production API, same as POST /series.
router.put('/series/:id/from/:date', requireEdit, async (req, res) => {
  const b = req.body || {}
  if (!DATE_RE.test(req.params.date || '')) {
    return res.status(400).json({ error: 'date must be YYYY-MM-DD' })
  }
  const badBody = requireSeriesEditBody(b)
  if (badBody) return res.status(400).json({ error: badBody })

  const series = await loadOwnedSeries(req, res, req.params.id, b.club_number)
  if (!series) return

  const fromDate = clampToToday(req.params.date)
  const through = seriesEditThrough(series, fromDate)
  const club = String(series.club_number)

  let occurrences = []
  try {
    if (!(through < fromDate)) {
      occurrences = expandSeries({ weekdays: b.weekdays, start_time: b.start_time, starts_on: fromDate, ends_on: through })
    }
  } catch (err) {
    return res.status(400).json({ error: err.message })
  }

  try {
    const targets = await findSeriesTargets(series, fromDate)
    const { paired, createOnly, cancelOnly } = pairOccurrences(targets, occurrences)

    const results = []        // POST /series-shaped per-occurrence outcomes
    const createdLinkRows = [] // feeds recordSeriesEvents for the new occurrences

    // Matched by date: the only case with an obvious old class to inherit
    // badges/links/attendance from, so it is the only path that runs
    // moveRefs. Everything else is a bare create or a bare cancel.
    for (const { old: oldTarget, occ } of paired) {
      const r = await applyClassEdit(
        { createClass: abc.createClass, cancelClass: abc.cancelClass, moveRefs: moveClassRefs },
        {
          clubNumber: club,
          oldEventId: oldTarget.event_id,
          eventTypeId: b.event_type_id,
          employeeId: b.employee_id,
          eventTimestampLocal: occ.timestamp_local,
          trainingLevelId: b.training_level_id,
          date: occ.date,
          className: b.class_name,
          // Every occurrence here is >= fromDate, which was already clamped
          // to today, so nothing reaching applyClassEdit is ever past.
          isPast: false,
        },
      )
      if (r.kind === 'create_failed') {
        results.push({ date: occ.date, ok: false, event_id: null, error: r.error })
      } else if (r.kind === 'cancel_failed') {
        // The new class is live in ABC even though this occurrence reports
        // failure -- same tradeoff PUT /classes/:eventId makes.
        results.push({ date: occ.date, ok: false, event_id: r.eventId, error: `created but the old class could not be removed: ${r.error}` })
        createdLinkRows.push({ date: occ.date, ok: true, event_id: r.eventId })
      } else {
        results.push({ date: occ.date, ok: true, event_id: r.eventId, error: null })
        createdLinkRows.push({ date: occ.date, ok: true, event_id: r.eventId })
      }
    }

    // A weekday added to the series: a plain create, same call POST /series
    // makes per occurrence.
    for (const occ of createOnly) {
      const r = await abc.createClass(club, {
        event_type_id: b.event_type_id,
        employee_id: b.employee_id,
        event_timestamp_local: occ.timestamp_local,
        training_level_id: b.training_level_id || null,
      })
      results.push({ date: occ.date, ok: r.ok, event_id: r.event_id, error: r.error })
      if (r.ok) createdLinkRows.push({ date: occ.date, ok: true, event_id: r.event_id })
    }

    // A weekday removed from the series: a plain cancel, same call DELETE
    // /series makes per occurrence.
    const canceledEventIds = []
    for (const t of cancelOnly) {
      const r = await abc.cancelClass(club, t.event_id)
      results.push({ date: t.date, ok: r.ok, event_id: null, error: r.error })
      if (r.ok) canceledEventIds.push(t.event_id)
    }

    // Link the newly created occurrences to this series so a later edit
    // finds them the trusted way rather than falling back to inference.
    const link_error = await recordSeriesEvents(club, series.id, createdLinkRows)

    // Drop the stale link rows for cancel-only targets. The paired ones were
    // already re-pointed by moveRefs above -- deleting them here would strip
    // the badge/link/attendance rows that were just carried onto the new id.
    if (canceledEventIds.length) {
      const { error: delErr } = await supabaseAdmin
        .from('group_x_series_events')
        .delete()
        .eq('club_number', club)
        .in('abc_event_id', canceledEventIds)
      if (delErr) console.error('[groupX] could not drop stale series links:', delErr.message)
    }

    // Update the series row to the new shape so the nightly top-up (open-
    // ended series only) keeps extending it on the new schedule. instructor_
    // name falls back to the current value -- the column is NOT NULL and the
    // edit form does not always resend a display name for a bare
    // employee_id change.
    const { error: updErr } = await supabaseAdmin
      .from('group_x_series')
      .update({
        event_type_id: b.event_type_id,
        employee_id: b.employee_id,
        instructor_name: b.instructor_name || series.instructor_name,
        weekdays: b.weekdays,
        start_time: b.start_time,
        training_level_id: b.training_level_id || null,
        class_name: b.class_name,
        materialized_through: through,
      })
      .eq('id', series.id)
    if (updErr) console.error('[groupX] could not update series row:', updErr.message)

    const created = results.filter(r => r.ok).length

    // Union of OLD and NEW dates: a weekday change that only invalidated the
    // new dates would leave deleted classes on the in-gym TVs for up to the
    // full cache window.
    const allDates = new Set([...targets.map(t => t.date), ...occurrences.map(o => o.date)])
    invalidatePublicBoard(club, [...allDates])

    // Partial failure is reported as partial failure. Never as success.
    res.json({ created, failed: results.length - created, occurrences: results, link_error })
  } catch (err) { fail(res, err, 'PUT /series/from') }
})

// DELETE /group-x/series/:id?club_number=&from=YYYY-MM-DD
// Cancels this series' occurrences on/after `from` (default today). We do not
// store per-occurrence event ids (a partially-created series would have gaps),
// so occurrences are matched in ABC on event type + employee + local start time.
// DELETE /group-x/series/:id?through=YYYY-MM-DD
//
// Ends the series ON `through`: classes after that date are cancelled and
// everything up to and including it is kept. Without `through` the whole
// remaining series goes from today.
//
// "Remove everything from today" threw away classes people are already turning
// up to; "we know it stops in two weeks" is the normal case.
router.delete('/series/:id', requireEdit, async (req, res) => {
  const through = DATE_RE.test(req.query.through || '') ? req.query.through : null
  const from = through
    ? padDate(through, 1)
    : (DATE_RE.test(req.query.from || '') ? req.query.from : toIsoDate(new Date()))

  const { data: series, error: selErr } = await supabaseAdmin
    .from('group_x_series')
    .select('*')
    .eq('id', req.params.id)
    .single()
  if (selErr || !series) return res.status(404).json({ error: 'series not found' })

  try {
    // An open-ended series has ends_on NULL (migration 099); how far it has
    // actually been written to ABC is materialized_through. Using ends_on
    // directly made this whole block a no-op for open-ended series — the
    // comparison below was false against null, and listClasses then returned []
    // without calling ABC, so the series was marked cancelled while every class
    // it had created stayed on the calendar forever. Real occurrence: 4 orphaned
    // Power Hour classes at Medford, 2026-08-28.
    const { end: seriesEnd } = seriesWindow(series)
    const windowStart = from > series.starts_on ? from : series.starts_on
    if (!seriesEnd || windowStart > seriesEnd) {
      await supabaseAdmin
        .from('group_x_series')
        .update({ canceled_at: new Date().toISOString(), canceled_by: req.user?.email || 'unknown' })
        .eq('id', series.id)
      return res.json({ canceled: 0, failed: 0, results: [] })
    }

    const existing = await abc.listClasses(series.club_number, windowStart, seriesEnd)
    const targets = existing.filter(e => matchesSeries(e, series))

    const results = []
    for (const t of targets) {
      const r = await abc.cancelClass(series.club_number, t.event_id)
      results.push({ event_id: t.event_id, date: String(t.event_timestamp_local).slice(0, 10), ok: r.ok, error: r.error })
    }

    // Ending on a date closes the series there so the nightly top-up stops
    // extending it; with no date the series is cancelled outright.
    const patch = through
      ? { ends_on: through, materialized_through: through }
      : { canceled_at: new Date().toISOString(), canceled_by: req.user?.email || 'unknown' }
    await supabaseAdmin.from('group_x_series').update(patch).eq('id', series.id)

    const canceled = results.filter(r => r.ok).length
    invalidatePublicBoard(series.club_number, results.filter(r => r.ok).map(r => r.date))
    res.json({ canceled, failed: results.length - canceled, results, ends_on: through })
  } catch (err) { fail(res, err, 'DELETE /series') }
})

// GET /group-x/report?club_number=&start=&end=
// Which classes are worth keeping. club_number=all aggregates every club.
//
// Admin only, and so not club-scoped: this is the cross-club "which classes do
// we keep" view that lives in the Admin Panel. The home-board Attendance tile
// deliberately does not offer it.
router.get('/report', requireRole('admin'), async (req, res) => {
  const clubParam = String(req.query.club_number || '')
  const isAll = clubParam === 'all'
  if (!isAll && !isKnownClubNumber(clubParam)) {
    return res.status(400).json({ error: 'club_number must be a known club or "all"' })
  }
  const { start, end } = req.query
  if (!DATE_RE.test(start || '') || !DATE_RE.test(end || '')) {
    return res.status(400).json({ error: 'start and end must be YYYY-MM-DD' })
  }
  if (end < start) {
    return res.status(400).json({ error: 'end must not be before start' })
  }

  try {
    // Filter on the club-local timestamp so a range means the same local days
    // at every club, rather than sliding with UTC.
    let q = supabaseAdmin
      .from('group_x_class_attendance')
      .select('club_number, class_name, instructor_name, event_timestamp_local, headcount, max_attendees')
      .gte('event_timestamp_local', `${start} 00:00:00`)
      .lte('event_timestamp_local', `${end} 23:59:59`)
      .limit(20000)
    if (!isAll) q = q.eq('club_number', clubParam)

    const { data, error } = await q
    if (error) throw new Error(error.message)
    res.json({ club_number: clubParam, start, end, ...aggregate(data || []) })
  } catch (err) { fail(res, err, '/report') }
})

// ---------------------------------------------------------------------------
// "New class" badges.
//
// Flags a class OFFERING as new at one club until a date, which the public
// board renders. Keyed on class type rather than a single session so a
// recurring class is badged everywhere without ticking a box per occurrence,
// and so it expires by itself.
// ---------------------------------------------------------------------------

router.get('/new-classes', async (req, res) => {
  const club = requireClub(req, res); if (!club) return
  try {
    const { data, error } = await supabaseAdmin
      .from('group_x_new_classes')
      .select('*')
      .eq('club_number', club)
      .order('show_until', { ascending: false })
    if (error) throw new Error(error.message)
    const today = new Date().toISOString().slice(0, 10)
    res.json({
      new_classes: (data || []).map(f => ({ ...f, active: today <= f.show_until })),
    })
  } catch (err) { fail(res, err, 'GET /new-classes') }
})

router.put('/new-classes', requireEdit, async (req, res) => {
  const b = req.body || {}
  if (!requireBodyClub(req, res, b.club_number)) return
  if (!b.event_type_id || !b.class_name) {
    return res.status(400).json({ error: 'event_type_id and class_name are required' })
  }
  if (!DATE_RE.test(b.show_until || '')) {
    return res.status(400).json({ error: 'show_until must be YYYY-MM-DD' })
  }

  // Whole row: a partial upsert fails NOT NULL columns even on an existing row.
  const row = {
    club_number: String(b.club_number),
    event_type_id: b.event_type_id,
    class_name: b.class_name,
    show_until: b.show_until,
    created_by: req.user?.email || 'unknown',
    created_at: new Date().toISOString(),
  }

  try {
    const { error } = await supabaseAdmin
      .from('group_x_new_classes')
      .upsert(row, { onConflict: 'club_number,event_type_id' })
    if (error) throw new Error(error.message)
    // The board caches whole weeks, so a badge change has to clear them or it
    // will not show up until the cache turns over.
    invalidateAllWeeksFor(b.club_number)
    res.json({ ok: true })
  } catch (err) { fail(res, err, 'PUT /new-classes') }
})

// PUT /group-x/new-classes/events — badge one existing session as new.
router.put('/new-classes/events', requireEdit, async (req, res) => {
  const b = req.body || {}
  if (!requireBodyClub(req, res, b.club_number)) return
  if (!b.abc_event_id) return res.status(400).json({ error: 'abc_event_id is required' })
  if (!DATE_RE.test(b.show_until || '')) {
    return res.status(400).json({ error: 'show_until must be YYYY-MM-DD' })
  }
  try {
    await flagEventsAsNew(
      b.club_number,
      [{ event_id: b.abc_event_id, class_name: b.class_name }],
      b.show_until,
      req.user?.email,
    )
    invalidateAllWeeksFor(b.club_number)
    res.json({ ok: true })
  } catch (err) { fail(res, err, 'PUT /new-classes/events') }
})

// DELETE /group-x/new-classes/events/:eventId?club_number=
router.delete('/new-classes/events/:eventId', requireEdit, async (req, res) => {
  const club = requireClub(req, res); if (!club) return
  try {
    const { error } = await supabaseAdmin
      .from('group_x_new_class_events')
      .delete()
      .eq('club_number', club)
      .eq('abc_event_id', req.params.eventId)
    if (error) throw new Error(error.message)
    invalidateAllWeeksFor(club)
    res.json({ ok: true })
  } catch (err) { fail(res, err, 'DELETE /new-classes/events') }
})

router.delete('/new-classes/:eventTypeId', requireEdit, async (req, res) => {
  const club = requireClub(req, res); if (!club) return
  try {
    const { error } = await supabaseAdmin
      .from('group_x_new_classes')
      .delete()
      .eq('club_number', club)
      .eq('event_type_id', req.params.eventTypeId)
    if (error) throw new Error(error.message)
    invalidateAllWeeksFor(club)
    res.json({ ok: true })
  } catch (err) { fail(res, err, 'DELETE /new-classes') }
})

module.exports = router
