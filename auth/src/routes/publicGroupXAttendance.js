/**
 * /public/group-x-attendance/:token — UNAUTHENTICATED Group X headcount logging.
 *
 * One unguessable token per club (group_x_attendance_links, migration 203), the
 * same model as the Tour Check-In links: whoever has the link can see that
 * club's recently finished classes and type in how many came. Nothing else.
 *
 * The caller only ever sends a number and an optional note. Class details (name, time, instructor,
 * capacity) are re-read from ABC server-side, so an anonymous caller cannot
 * write a row for a class that does not exist, belongs to another club, or has
 * not happened yet.
 *
 * Mounted at its own path, NOT under /public/group-x: that prefix has a
 * GET-only `origin: *` CORS mounted ahead of the global one, which would answer
 * this route's PUT preflight without allowing PUT.
 */
const { Router } = require('express')
const abc = require('../services/abcGroupX')
const { CLUBS } = require('../lib/groupXClubs')
const clubFeatures = require('../lib/clubFeatures')
const { supabaseAdmin } = require('../services/supabase')
const { currentPacificDate } = require('../lib/groupXPublic')
const { parseHeadcount, parseNotes, attendanceRow, isoMinusDays } = require('../lib/groupXAttendance')

const router = Router()

// Matches the staff Attendance queue: long enough to catch up after a missed
// shift, short enough that the list gets cleared.
const LOOKBACK_DAYS = 7
const RECORDED_BY = 'Attendance link'

async function resolveToken(token) {
  if (!token) return null
  const { data, error } = await supabaseAdmin
    .from('group_x_attendance_links')
    .select('club_number, active')
    .eq('public_token', token)
    .maybeSingle()
  if (error) throw new Error(error.message)
  if (!data || !data.active) return null
  const club = CLUBS.find(c => c.clubNumber === String(data.club_number))
  if (!club) return null
  if (!await clubFeatures.isEnabled(club.clubNumber, clubFeatures.GROUP_X)) return null
  return club
}

// Finished classes in the lookback window, with any headcount already logged.
async function recentClasses(club) {
  const end = currentPacificDate()
  const start = isoMinusDays(end, LOOKBACK_DAYS)
  const classes = await abc.listClasses(club.clubNumber, start, end)
  const nowIso = new Date().toISOString()
  const finished = classes.filter(c => !c.unbooked && c.event_timestamp && c.event_timestamp < nowIso)

  let byId = new Map()
  if (finished.length) {
    const { data, error } = await supabaseAdmin
      .from('group_x_class_attendance')
      .select('abc_event_id, headcount, notes, recorded_at')
      .eq('club_number', club.clubNumber)
      .in('abc_event_id', finished.map(c => c.event_id))
    if (error) throw new Error(error.message)
    byId = new Map((data || []).map(r => [r.abc_event_id, r]))
  }

  return finished.map(c => {
    const a = byId.get(c.event_id)
    return {
      ...c,
      headcount: a ? a.headcount : null,
      notes: a ? a.notes : null,
      recorded_at: a ? a.recorded_at : null,
      needs_attendance: !a,
    }
  })
}

function fail(res, err, where) {
  console.error(`[publicGroupXAttendance] ${where} failed:`, err.message)
  res.status(503).json({ error: 'Could not reach the class schedule, try again in a minute' })
}

router.get('/:token', async (req, res) => {
  try {
    const club = await resolveToken(req.params.token)
    if (!club) return res.status(404).json({ error: 'This attendance link is not valid' })
    res.set('Cache-Control', 'no-store')
    res.json({ club: club.name, lookback_days: LOOKBACK_DAYS, classes: await recentClasses(club) })
  } catch (err) { fail(res, err, 'GET') }
})

router.put('/:token/classes/:eventId', async (req, res) => {
  const parsed = parseHeadcount((req.body || {}).headcount)
  if (parsed.error) return res.status(400).json({ error: parsed.error })
  const note = parseNotes((req.body || {}).notes)
  if (note.error) return res.status(400).json({ error: note.error })
  try {
    const club = await resolveToken(req.params.token)
    if (!club) return res.status(404).json({ error: 'This attendance link is not valid' })

    const cls = (await recentClasses(club)).find(c => c.event_id === req.params.eventId)
    if (!cls) {
      return res.status(404).json({ error: 'That class is not in the last week of finished classes' })
    }

    const { error } = await supabaseAdmin
      .from('group_x_class_attendance')
      .upsert(
        attendanceRow({
          clubNumber: club.clubNumber,
          eventId: cls.event_id,
          cls,
          headcount: parsed.headcount,
          notes: note.notes,
          recordedBy: RECORDED_BY,
        }),
        { onConflict: 'club_number,abc_event_id' }
      )
    if (error) throw new Error(error.message)
    res.json({ ok: true })
  } catch (err) { fail(res, err, 'PUT') }
})

module.exports = router
