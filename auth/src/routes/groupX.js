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
    res.json({ classes: await abc.listClasses(club, start, end) })
  } catch (err) { fail(res, err, '/classes') }
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
    res.status(201).json({ event_id: result.event_id })
  } catch (err) { fail(res, err, 'POST /classes') }
})

// DELETE /group-x/classes/:eventId?club_number= — cancel one class in ABC.
router.delete('/classes/:eventId', async (req, res) => {
  const club = requireClub(req, res); if (!club) return
  try {
    const result = await abc.cancelClass(club, req.params.eventId)
    if (!result.ok) return res.status(502).json({ error: result.error, abc_status: result.http })
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
  // Partial failure is reported as partial failure. Never as success.
  res.status(201).json({
    series_id: series.id,
    created,
    failed: results.length - created,
    occurrences: results,
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
    res.json({ canceled, failed: results.length - canceled, results })
  } catch (err) { fail(res, err, 'DELETE /series') }
})

module.exports = router
