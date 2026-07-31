/**
 * /facility-schedule — Courts and Pool schedules (admin only).
 *
 * Unlike Group X these do not come from ABC. We own the events outright, so
 * Supabase is the source of truth and there is no external calendar to keep in
 * step. That also means no instructor requirement: a lap swim or open gym slot
 * legitimately has nobody assigned.
 */
const { Router } = require('express')
const { supabaseAdmin } = require('../services/supabase')
const { CLUBS, isKnownClubNumber } = require('../lib/groupXClubs')
const { FACILITIES, isKnownFacility } = require('../lib/facilities')
const { DATE_RE, buildLocalTimestamp } = require('../lib/abcTime')
const { expandSeries, MAX_OCCURRENCES } = require('../lib/groupXSeries')
const { publicCacheKeysForDates } = require('../lib/groupXPublic')
const memoryCache = require('../services/memoryCache')
const authenticate = require('../middleware/auth')
const { requireRole } = require('../middleware/role')

const router = Router()
router.use(authenticate)
router.use(requireRole('admin'))

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
  return { clubNumber, facility }
}

function cleanTitle(v) {
  const t = String(v || '').trim().replace(/\s+/g, ' ')
  return t.slice(0, MAX_TITLE)
}

router.get('/facilities', (req, res) => res.json({ facilities: FACILITIES, clubs: CLUBS }))

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
router.post('/events', async (req, res) => {
  const b = req.body || {}
  if (!isKnownClubNumber(b.club_number)) {
    return res.status(400).json({ error: 'valid club_number is required in body' })
  }
  if (!isKnownFacility(b.facility)) {
    return res.status(400).json({ error: 'valid facility is required in body' })
  }
  const title = cleanTitle(b.title)
  if (!title) return res.status(400).json({ error: 'give the event a name' })

  const duration = parseInt(b.duration_minutes, 10)
  if (!duration || duration <= 0 || duration > 24 * 60) {
    return res.status(400).json({ error: 'duration_minutes must be between 1 and 1440' })
  }

  let stamp
  try {
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
router.delete('/events/:id', async (req, res) => {
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
router.post('/series/preview', (req, res) => {
  try {
    const occurrences = expandSeries(req.body || {})
    res.json({ count: occurrences.length, occurrences, max: MAX_OCCURRENCES })
  } catch (err) {
    res.status(400).json({ error: err.message })
  }
})

// POST /facility-schedule/series — repeating slot.
//
// Unlike the Group X series this writes to our own table, so the whole fan-out
// is a single insert. There is no partial-failure case to report.
router.post('/series', async (req, res) => {
  const b = req.body || {}
  if (!isKnownClubNumber(b.club_number)) {
    return res.status(400).json({ error: 'valid club_number is required in body' })
  }
  if (!isKnownFacility(b.facility)) {
    return res.status(400).json({ error: 'valid facility is required in body' })
  }
  const title = cleanTitle(b.title)
  if (!title) return res.status(400).json({ error: 'give the event a name' })

  const duration = parseInt(b.duration_minutes, 10)
  if (!duration || duration <= 0 || duration > 24 * 60) {
    return res.status(400).json({ error: 'duration_minutes must be between 1 and 1440' })
  }

  let occurrences
  try {
    occurrences = expandSeries(b)
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
        ends_on: b.ends_on,
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
    res.status(201).json({ series_id: series.id, created: rows.length })
  } catch (err) { fail(res, err, 'POST /series') }
})

// DELETE /facility-schedule/series/:id?club_number=&facility=&from=YYYY-MM-DD
// Cancels the series' remaining occurrences from a date forward.
router.delete('/series/:id', async (req, res) => {
  const scope = requireScope(req, res); if (!scope) return
  const from = DATE_RE.test(req.query.from || '') ? req.query.from : new Date().toISOString().slice(0, 10)

  try {
    const { data, error } = await supabaseAdmin
      .from('facility_events')
      .update({ canceled_at: new Date().toISOString(), canceled_by: req.user?.email || 'unknown' })
      .eq('series_id', req.params.id)
      .eq('club_number', scope.clubNumber)
      .is('canceled_at', null)
      .gte('starts_at_local', `${from} 00:00:00`)
      .select('starts_at_local')
    if (error) throw new Error(error.message)

    await supabaseAdmin
      .from('facility_series')
      .update({ canceled_at: new Date().toISOString(), canceled_by: req.user?.email || 'unknown' })
      .eq('id', req.params.id)

    invalidateBoard(scope.clubNumber, scope.facility, (data || []).map(r => String(r.starts_at_local).slice(0, 10)))
    res.json({ canceled: (data || []).length })
  } catch (err) { fail(res, err, 'DELETE /series') }
})

module.exports = router
