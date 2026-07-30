/**
 * /group-x — Group X class scheduler (admin only).
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
const { CLUBS, isKnownClubNumber } = require('../lib/groupXClubs')
const { buildLocalTimestamp, DATE_RE } = require('../lib/abcTime')
const { expandSeries, MAX_OCCURRENCES } = require('../lib/groupXSeries')
const { supabaseAdmin } = require('../services/supabase')
const { publicCacheKeysForDates } = require('../lib/groupXPublic')
const { aggregate } = require('../lib/groupXReport')
const { markNewClasses } = require('../lib/groupXNewClasses')
const memoryCache = require('../services/memoryCache')
const authenticate = require('../middleware/auth')
const { requireRole } = require('../middleware/role')

const router = Router()
router.use(authenticate)
router.use(requireRole('admin'))

// Resolves and validates club_number off the query string. Returns null and
// sends the 400 itself when invalid, so handlers can `if (!club) return`.
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
  return clubNumber
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

router.get('/clubs', (req, res) => res.json({ clubs: CLUBS }))

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

    const nowIso = new Date().toISOString()
    res.json({
      classes: flagged.map(c => {
        const a = byId.get(c.event_id) || null
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
router.put('/classes/:eventId/attendance', async (req, res) => {
  const b = req.body || {}
  if (!isKnownClubNumber(b.club_number)) {
    return res.status(400).json({ error: 'valid club_number is required in body' })
  }
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
router.post('/classes', async (req, res) => {
  const b = req.body || {}
  if (!isKnownClubNumber(b.club_number)) {
    return res.status(400).json({ error: 'valid club_number is required in body' })
  }
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

// DELETE /group-x/classes/:eventId?club_number= — cancel one class in ABC.
router.delete('/classes/:eventId', async (req, res) => {
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
router.post('/series/preview', (req, res) => {
  try {
    const occurrences = expandSeries(req.body || {})
    res.json({ count: occurrences.length, occurrences, max: MAX_OCCURRENCES })
  } catch (err) {
    res.status(400).json({ error: err.message })
  }
})

// POST /group-x/series — create the series and fan out one ABC event per date.
router.post('/series', async (req, res) => {
  const b = req.body || {}
  if (!isKnownClubNumber(b.club_number)) {
    return res.status(400).json({ error: 'valid club_number is required in body' })
  }
  if (!b.event_type_id || !b.employee_id || !b.class_name || !b.instructor_name) {
    return res.status(400).json({ error: 'event_type_id, employee_id, class_name and instructor_name are required' })
  }

  let occurrences
  try {
    occurrences = expandSeries(b)
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
      ends_on: b.ends_on,
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

// DELETE /group-x/series/:id?club_number=&from=YYYY-MM-DD
// Cancels this series' occurrences on/after `from` (default today). We do not
// store per-occurrence event ids (a partially-created series would have gaps),
// so occurrences are matched in ABC on event type + employee + local start time.
router.delete('/series/:id', async (req, res) => {
  const from = DATE_RE.test(req.query.from || '') ? req.query.from : new Date().toISOString().slice(0, 10)

  const { data: series, error: selErr } = await supabaseAdmin
    .from('group_x_series')
    .select('*')
    .eq('id', req.params.id)
    .single()
  if (selErr || !series) return res.status(404).json({ error: 'series not found' })

  try {
    const windowStart = from > series.starts_on ? from : series.starts_on
    if (windowStart > series.ends_on) {
      await supabaseAdmin
        .from('group_x_series')
        .update({ canceled_at: new Date().toISOString(), canceled_by: req.user?.email || 'unknown' })
        .eq('id', series.id)
      return res.json({ canceled: 0, failed: 0, results: [] })
    }

    const existing = await abc.listClasses(series.club_number, windowStart, series.ends_on)
    const wall = String(series.start_time).slice(0, 5)
    const targets = existing.filter(e =>
      e.event_type_id === series.event_type_id &&
      e.employee_id === series.employee_id &&
      String(e.event_timestamp_local || '').slice(11, 16) === wall
    )

    const results = []
    for (const t of targets) {
      const r = await abc.cancelClass(series.club_number, t.event_id)
      results.push({ event_id: t.event_id, date: String(t.event_timestamp_local).slice(0, 10), ok: r.ok, error: r.error })
    }

    await supabaseAdmin
      .from('group_x_series')
      .update({ canceled_at: new Date().toISOString(), canceled_by: req.user?.email || 'unknown' })
      .eq('id', series.id)

    const canceled = results.filter(r => r.ok).length
    invalidatePublicBoard(series.club_number, results.filter(r => r.ok).map(r => r.date))
    res.json({ canceled, failed: results.length - canceled, results })
  } catch (err) { fail(res, err, 'DELETE /series') }
})

// GET /group-x/report?club_number=&start=&end=
// Which classes are worth keeping. club_number=all aggregates every club.
router.get('/report', async (req, res) => {
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

router.put('/new-classes', async (req, res) => {
  const b = req.body || {}
  if (!isKnownClubNumber(b.club_number)) {
    return res.status(400).json({ error: 'valid club_number is required in body' })
  }
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
router.put('/new-classes/events', async (req, res) => {
  const b = req.body || {}
  if (!isKnownClubNumber(b.club_number)) {
    return res.status(400).json({ error: 'valid club_number is required in body' })
  }
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
router.delete('/new-classes/events/:eventId', async (req, res) => {
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

router.delete('/new-classes/:eventTypeId', async (req, res) => {
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
