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
const authenticate = require('../middleware/auth')
const { requireRole } = require('../middleware/role')

const router = Router()
router.use(authenticate)
router.use(requireRole('admin'))

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/

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

module.exports = router
