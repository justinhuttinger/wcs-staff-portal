/**
 * /facility-schedule — Courts and Pool schedules.
 *
 * Permission model, deliberately identical to Group X (see routes/groupX.js):
 *   facility                — see the schedules. Everyone.
 *   facility:schedule-edit  — add and cancel slots, run recurring series.
 * Admins always pass, so the Admin Panel keeps working whatever the grid says.
 *
 * Clubs are narrowed to the caller's assigned locations on the SERVER, because
 * club_number comes straight off the request.
 *
 * Unlike Group X these do not come from ABC. We own the events outright, so
 * Supabase is the source of truth and there is no external calendar to keep in
 * step. That also means no instructor requirement: a lap swim or open gym slot
 * legitimately has nobody assigned.
 */
const { Router } = require('express')
const { supabaseAdmin } = require('../services/supabase')
const { isKnownClubNumber } = require('../lib/groupXClubs')
const { FACILITIES, isKnownFacility } = require('../lib/facilities')
const clubFeatures = require('../lib/clubFeatures')
const { DATE_RE, buildLocalTimestamp } = require('../lib/abcTime')
const { expandSeries, MAX_OCCURRENCES } = require('../lib/groupXSeries')
const { durationBetween, OPEN_ENDED_HORIZON_DAYS } = require('../lib/scheduleTimes')
const { padDate, toIsoDate } = require('../lib/abcTime')
const { publicCacheKeysForDates } = require('../lib/groupXPublic')
const memoryCache = require('../services/memoryCache')
const authenticate = require('../middleware/auth')
const { roleLevel } = require('../middleware/role')
const { requireTile } = require('../middleware/tile')
const { allowedClubsFor } = require('../lib/groupXScope')

const router = Router()
router.use(authenticate)

// Gate on a permission key, with admins always allowed through. Mirrors
// requirePerm in routes/groupX.js: an admin unticking a box in the roles grid
// should not lock the admin out of the screen they manage it from.
function requirePerm(permKey) {
  const tileGate = requireTile(permKey)
  return (req, res, next) => {
    if (roleLevel(req.staff?.role) >= roleLevel('admin')) return next()
    return tileGate(req, res, next)
  }
}

router.use(requirePerm('facility'))

// The caller's clubs, resolved once per request. Facilities are club-scoped
// exactly as Group X classes are, so this is the same helper.
router.use(async (req, res, next) => {
  try {
    req.fxClubs = await allowedClubsFor(req.staff)
    next()
  } catch (err) {
    console.error('[facility] club scope failed:', err.message)
    res.status(500).json({ error: 'could not resolve club access' })
  }
})

const requireEdit = requirePerm('facility:schedule-edit')

function canUseClub(req, clubNumber) {
  return (req.fxClubs || []).some(c => c.clubNumber === String(clubNumber))
}

const MAX_TITLE = 80

// Facility boards are cached per club-facility-window, so a write has to clear
// every window the affected dates could appear in.
function invalidateBoard(clubNumber, facility, dates) {
  for (const key of publicCacheKeysForDates(`${clubNumber}:${facility}`, dates)) {
    memoryCache.del(key)
  }
}

function fail(res, err, where) {
  console.error(`[facility] ${where} failed:`, err.message)
  res.status(500).json({ error: err.message })
}

// Validates club + facility off the query string, sending its own 400.
function requireScope(req, res) {
  const clubNumber = String(req.query.club_number || '')
  const facility = String(req.query.facility || '')
  if (!isKnownClubNumber(clubNumber)) {
    res.status(400).json({ error: 'valid club_number is required' })
    return null
  }
  if (!isKnownFacility(facility)) {
    res.status(400).json({ error: 'facility must be one of: ' + FACILITIES.map(f => f.slug).join(', ') })
    return null
  }
  if (!canUseClub(req, clubNumber)) {
    res.status(403).json({ error: 'no access to that club' })
    return null
  }
  return { clubNumber, facility }
}

function cleanTitle(v) {
  const t = String(v || '').trim().replace(/\s+/g, ' ')
  return t.slice(0, MAX_TITLE)
}

// Only the caller's own clubs, each carrying the facilities it actually has.
// The view builds its club pills and its facility pills straight off this, so
// scoping here scopes the whole screen.
router.get('/facilities', async (req, res) => {
  try {
    const map = await clubFeatures.loadMap()
    res.json({
      facilities: FACILITIES,
      clubs: (req.fxClubs || []).map(c => ({
        ...c,
        facilities: clubFeatures.facilitiesFor(map, c.clubNumber, FACILITIES).map(f => f.slug),
      })),
    })
  } catch (err) { fail(res, err, '/facilities') }
})

// GET /facility-schedule/events?club_number=&facility=&start=&end=
router.get('/events', async (req, res) => {
  const scope = requireScope(req, res); if (!scope) return
  const { start, end } = req.query
  if (!DATE_RE.test(start || '') || !DATE_RE.test(end || '')) {
    return res.status(400).json({ error: 'start and end must be YYYY-MM-DD' })
  }
  if (end < start) return res.status(400).json({ error: 'end must not be before start' })

  try {
    const { data, error } = await supabaseAdmin
      .from('facility_events')
      .select('*')
      .eq('club_number', scope.clubNumber)
      .eq('facility', scope.facility)
      .is('canceled_at', null)
      // starts_at_local is a naive local string, so a lexical range is exactly
      // a date range. No timezone conversion, and no sliding at midnight.
      .gte('starts_at_local', `${start} 00:00:00`)
      .lte('starts_at_local', `${end} 23:59:59`)
      .order('starts_at_local', { ascending: true })
      .limit(2000)
    if (error) throw new Error(error.message)
    res.json({ events: data || [] })
  } catch (err) { fail(res, err, 'GET /events') }
})

// POST /facility-schedule/events — one event.
router.post('/events', requireEdit, async (req, res) => {
  const b = req.body || {}
  if (!isKnownClubNumber(b.club_number) || !canUseClub(req, b.club_number)) {
    return res.status(400).json({ error: 'valid club_number is required in body' })
  }
  if (!isKnownFacility(b.facility)) {
    return res.status(400).json({ error: 'valid facility is required in body' })
  }
  const title = cleanTitle(b.title)
  if (!title) return res.status(400).json({ error: 'give the event a name' })

  // Staff pick a start and an end; duration is derived. Older callers that
  // still send duration_minutes keep working.
  let duration
  let stamp
  try {
    duration = b.end_time
      ? durationBetween(b.time, b.end_time)
      : parseInt(b.duration_minutes, 10)
    if (!duration || duration <= 0 || duration > 24 * 60) {
      return res.status(400).json({ error: 'give the event an end time after its start time' })
    }
    stamp = buildLocalTimestamp(b.date, b.time)
  } catch (err) {
    return res.status(400).json({ error: err.message })
  }

  try {
    const { data, error } = await supabaseAdmin
      .from('facility_events')
      .insert({
        club_number: String(b.club_number),
        facility: String(b.facility),
        title,
        staff_name: b.staff_name ? String(b.staff_name).trim() : null,
        starts_at_local: stamp,
        duration_minutes: duration,
        created_by: req.user?.email || 'unknown',
      })
      .select('id')
      .single()
    if (error) throw new Error(error.message)
    invalidateBoard(b.club_number, b.facility, [b.date])
    res.status(201).json({ id: data.id })
  } catch (err) { fail(res, err, 'POST /events') }
})

// DELETE /facility-schedule/events/:id?club_number=&facility=
// Soft delete: keeps the row so a cancelled slot can be audited later.
router.delete('/events/:id', requireEdit, async (req, res) => {
  const scope = requireScope(req, res); if (!scope) return
  try {
    const { data, error } = await supabaseAdmin
      .from('facility_events')
      .update({ canceled_at: new Date().toISOString(), canceled_by: req.user?.email || 'unknown' })
      .eq('id', req.params.id)
      .eq('club_number', scope.clubNumber)
      .select('starts_at_local')
      .single()
    if (error) throw new Error(error.message)
    invalidateBoard(scope.clubNumber, scope.facility, [String(data?.starts_at_local || '').slice(0, 10)])
    res.json({ ok: true })
  } catch (err) { fail(res, err, 'DELETE /events') }
})

// POST /facility-schedule/series/preview — dry run, no writes.
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
      // With no end date this is only what gets written now; the nightly job
      // keeps extending it. Say so rather than implying the series stops here.
      materialized_through: through,
    })
  } catch (err) {
    res.status(400).json({ error: err.message })
  }
})

// POST /facility-schedule/series — repeating slot.
//
// Unlike the Group X series this writes to our own table, so the whole fan-out
// is a single insert. There is no partial-failure case to report.
router.post('/series', requireEdit, async (req, res) => {
  const b = req.body || {}
  if (!isKnownClubNumber(b.club_number) || !canUseClub(req, b.club_number)) {
    return res.status(400).json({ error: 'valid club_number is required in body' })
  }
  if (!isKnownFacility(b.facility)) {
    return res.status(400).json({ error: 'valid facility is required in body' })
  }
  const title = cleanTitle(b.title)
  if (!title) return res.status(400).json({ error: 'give the event a name' })

  let duration
  try {
    duration = b.end_time
      ? durationBetween(b.start_time, b.end_time)
      : parseInt(b.duration_minutes, 10)
    if (!duration || duration <= 0 || duration > 24 * 60) {
      return res.status(400).json({ error: 'give the event an end time after its start time' })
    }
  } catch (err) {
    return res.status(400).json({ error: err.message })
  }

  // No end date means an open-ended series: we cannot insert infinite rows, so
  // occurrences are written out to a rolling horizon and topped up nightly.
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
    return res.status(400).json({ error: 'those days and dates produce no events' })
  }

  try {
    const { data: series, error: sErr } = await supabaseAdmin
      .from('facility_series')
      .insert({
        club_number: String(b.club_number),
        facility: String(b.facility),
        title,
        staff_name: b.staff_name ? String(b.staff_name).trim() : null,
        weekdays: b.weekdays,
        start_time: b.start_time,
        duration_minutes: duration,
        starts_on: b.starts_on,
        ends_on: openEnded ? null : b.ends_on,
        materialized_through: materializeThrough,
        created_by: req.user?.email || 'unknown',
      })
      .select('id')
      .single()
    if (sErr) throw new Error(sErr.message)

    const rows = occurrences.map(o => ({
      club_number: String(b.club_number),
      facility: String(b.facility),
      title,
      staff_name: b.staff_name ? String(b.staff_name).trim() : null,
      starts_at_local: o.timestamp_local,
      duration_minutes: duration,
      series_id: series.id,
      created_by: req.user?.email || 'unknown',
    }))
    const { error: eErr } = await supabaseAdmin.from('facility_events').insert(rows)
    if (eErr) throw new Error(eErr.message)

    invalidateBoard(b.club_number, b.facility, occurrences.map(o => o.date))
    res.status(201).json({ series_id: series.id, created: rows.length, open_ended: openEnded })
  } catch (err) { fail(res, err, 'POST /series') }
})

// DELETE /facility-schedule/series/:id?club_number=&facility=&through=YYYY-MM-DD
//
// Ends the series ON `through`: occurrences after that date are cancelled and
// everything up to and including it is kept. Without `through` the whole
// remaining series goes from today.
//
// This is the shape staff actually want. "Remove everything from today" throws
// away classes people are already turning up to; "we know it stops in two
// weeks" is the normal case.
router.delete('/series/:id', requireEdit, async (req, res) => {
  const scope = requireScope(req, res); if (!scope) return
  const today = toIsoDate(new Date())
  const through = DATE_RE.test(req.query.through || '') ? req.query.through : null
  // Cancel strictly AFTER the keep-through date. With no date, cancel from
  // today forward.
  const cancelFrom = through ? padDate(through, 1) : today

  try {
    const { data, error } = await supabaseAdmin
      .from('facility_events')
      .update({ canceled_at: new Date().toISOString(), canceled_by: req.user?.email || 'unknown' })
      .eq('series_id', req.params.id)
      .eq('club_number', scope.clubNumber)
      .is('canceled_at', null)
      .gte('starts_at_local', `${cancelFrom} 00:00:00`)
      .select('starts_at_local')
    if (error) throw new Error(error.message)

    // Ending on a date closes the series there so the nightly top-up stops
    // extending it; with no date the series is cancelled outright.
    const patch = through
      ? { ends_on: through, materialized_through: through }
      : { canceled_at: new Date().toISOString(), canceled_by: req.user?.email || 'unknown' }
    await supabaseAdmin.from('facility_series').update(patch).eq('id', req.params.id)

    invalidateBoard(scope.clubNumber, scope.facility, (data || []).map(r => String(r.starts_at_local).slice(0, 10)))
    res.json({ canceled: (data || []).length, ends_on: through })
  } catch (err) { fail(res, err, 'DELETE /series') }
})

module.exports = router
