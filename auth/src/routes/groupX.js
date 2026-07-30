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

module.exports = router
