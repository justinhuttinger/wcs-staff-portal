/**
 * /reports/training — Operandio training, per club and per person.
 *
 * Backed by operandio_training_staff / operandio_training_assignments
 * (populated by services/operandioTrainingSync from the Operandio GraphQL API).
 *
 * NOT DATE-RANGED, and the report says so. "Is this person caught up" is a
 * question about right now, not about a window: an assignment that went overdue
 * in August is still overdue today and still needs doing. The filters that do
 * apply are club, course and status.
 *
 * READS BOTH TABLES WHOLE. 133 staff and 48 assignments at the time of writing
 * -- the entire dataset is smaller than one page of the compliance report, so
 * rolling up in JS is both simpler and faster than four aggregate queries. If
 * training adoption grows by two orders of magnitude this becomes SQL; at that
 * point the roll-up lives in lib/trainingStatus already and only its caller
 * changes.
 */

const { Router } = require('express')
const authenticate = require('../middleware/auth')
const { requireReportAccess, requireRole } = require('../middleware/role')
const { supabaseAdmin } = require('../services/supabase')
const { resolveScopedSlugs } = require('../services/locationScope')
const { fetchAll } = require('../lib/supabaseFetchAll')
const { rollUp, STATUSES } = require('../lib/trainingStatus')

const router = Router()
router.use(authenticate)

/**
 * Staff and assignments, already narrowed to what this caller may see and to
 * whatever the query string asked for.
 *
 * Club scoping is applied to PEOPLE, not to assignments: an assignment has no
 * club of its own, it belongs to whoever it was given to. A manager therefore
 * sees their own staff's training and nobody else's, which is the same rule
 * every other report follows.
 */
async function load(req, overrides = {}) {
  // Overrides rather than a cloned req: Express exposes `query` as a
  // prototype getter, so spreading the request quietly drops it.
  const q = { ...req.query, ...overrides }
  const scope = await resolveScopedSlugs(req)

  const staff = await fetchAll(
    supabaseAdmin.from('operandio_training_staff').select('*').order('full_name')
  )
  const assignments = await fetchAll(
    supabaseAdmin.from('operandio_training_assignments').select('*')
  )

  // Requested clubs, intersected with what the caller is allowed.
  const asked = String(q.location_slug || 'all').toLowerCase()
  let allowed = scope.slugs || null           // null = every club
  if (asked !== 'all') {
    const wanted = asked.split(',').map(s => s.trim()).filter(Boolean)
    allowed = allowed ? allowed.filter(s => wanted.includes(s)) : wanted
  }

  let people = staff
  if (allowed) {
    const set = new Set(allowed)
    people = staff.filter(p => (p.location_slugs || []).some(s => set.has(s)))
  }

  // Operandio's own user status. A deactivated employee's unfinished training
  // is not a live problem and would otherwise sit in the overdue column
  // permanently; `include_inactive=1` brings them back for an audit.
  if (q.include_inactive !== '1') {
    people = people.filter(p => !p.user_status || p.user_status === 'active')
  }

  const ids = new Set(people.map(p => p.user_id))
  let rows = assignments.filter(a => ids.has(a.user_id))

  const course = String(q.course_id || '').trim()
  if (course && course !== 'all') rows = rows.filter(a => a.course_id === course)

  const status = String(q.status || '').trim()
  if (status && status !== 'all' && STATUSES.includes(status)) {
    rows = rows.filter(a => a.status === status)
  }

  // Retired courses stay out by default: a course somebody archived is not work
  // anybody is expected to do, and the one live course would otherwise be
  // buried under eight dead ones.
  if (q.include_retired !== '1') {
    rows = rows.filter(a => !a.course_inactive)
  }

  return { people, rows, allowedSlugs: allowed }
}

// GET /summary — the headline, plus one row per club.
router.get('/summary', requireReportAccess('manager', ['training']), async (req, res) => {
  try {
    const { people, rows } = await load(req)

    // A person at several clubs counts at each of them. They can be chased by
    // any of those managers, and hiding them from six of the seven would be
    // worse than counting them twice in a company-wide total nobody reads as a
    // headcount.
    const clubs = new Map()
    for (const p of people) {
      for (const slug of (p.location_slugs || [])) {
        if (!clubs.has(slug)) clubs.set(slug, { people: [], ids: new Set() })
        clubs.get(slug).people.push(p)
        clubs.get(slug).ids.add(p.user_id)
      }
    }

    const byLocation = [...clubs.entries()]
      .map(([slug, c]) => ({
        location_slug: slug,
        ...rollUp(rows.filter(a => c.ids.has(a.user_id)), c.people),
      }))
      .sort((a, b) => a.location_slug.localeCompare(b.location_slug))

    const { data: state } = await supabaseAdmin
      .from('operandio_training_sync_state').select('*').eq('id', 'singleton').maybeSingle()

    res.json({
      totals: rollUp(rows, people),
      by_location: byLocation,
      synced_at: state?.last_success_at || null,
      sync_error: state?.last_error || null,
    })
  } catch (err) {
    if (err.status) return res.status(err.status).json({ error: err.message })
    console.error('[reports/training] /summary error:', err.message)
    res.status(500).json({ error: 'Failed to build training summary' })
  }
})

// GET /people — one row per person, with their assignments nested.
router.get('/people', requireReportAccess('manager', ['training']), async (req, res) => {
  try {
    const { people, rows } = await load(req)
    const byUser = new Map()
    for (const a of rows) {
      if (!byUser.has(a.user_id)) byUser.set(a.user_id, [])
      byUser.get(a.user_id).push(a)
    }

    const out = people.map(p => {
      const mine = (byUser.get(p.user_id) || []).slice().sort((a, b) => {
        // Worst first: what someone needs to do before what they have done.
        const rank = s => (s === 'overdue' ? 0 : s === 'in_progress' ? 1 : s === 'not_started' ? 2 : 3)
        return rank(a.status) - rank(b.status)
          || String(a.due_at || '').localeCompare(String(b.due_at || ''))
      })
      const overdue = mine.filter(a => a.status === 'overdue').length
      return {
        user_id: p.user_id,
        full_name: p.full_name,
        email: p.email,
        locations: p.location_slugs || [],
        assignments: mine,
        counts: {
          total: mine.length,
          complete: mine.filter(a => a.status === 'complete').length,
          overdue,
          in_progress: mine.filter(a => a.status === 'in_progress').length,
          not_started: mine.filter(a => a.status === 'not_started').length,
        },
        // Three states, not two. Somebody with nothing assigned has not passed
        // anything and has not failed anything.
        state: mine.length === 0 ? 'unassigned' : overdue > 0 ? 'behind' : 'caught_up',
      }
    })

    // The people who need chasing, then the people with nothing assigned (the
    // other kind of problem), then everyone who is fine.
    const rank = s => (s === 'behind' ? 0 : s === 'unassigned' ? 1 : 2)
    out.sort((a, b) => rank(a.state) - rank(b.state)
      || b.counts.overdue - a.counts.overdue
      || String(a.full_name).localeCompare(String(b.full_name)))

    res.json({ people: out })
  } catch (err) {
    if (err.status) return res.status(err.status).json({ error: err.message })
    console.error('[reports/training] /people error:', err.message)
    res.status(500).json({ error: 'Failed to build training people list' })
  }
})

// GET /courses — the filter list, with how each course is going.
router.get('/courses', requireReportAccess('manager', ['training']), async (req, res) => {
  try {
    const { people, rows } = await load(req, { course_id: 'all', status: 'all' })
    const courses = await fetchAll(
      supabaseAdmin.from('operandio_training_courses').select('*').order('name')
    )
    const assigned = new Map()
    for (const a of rows) {
      if (!assigned.has(a.course_id)) assigned.set(a.course_id, [])
      assigned.get(a.course_id).push(a)
    }
    res.json({
      courses: courses.map(c => {
        const mine = assigned.get(c.id) || []
        return {
          id: c.id,
          name: c.name,
          type: c.type,
          inactive: c.inactive,
          ...rollUp(mine, people.filter(p => mine.some(a => a.user_id === p.user_id))),
        }
      }),
    })
  } catch (err) {
    if (err.status) return res.status(err.status).json({ error: err.message })
    console.error('[reports/training] /courses error:', err.message)
    res.status(500).json({ error: 'Failed to build training course list' })
  }
})

// POST /sync — run the sweep now. Admin only; the cron owns the normal cadence.
router.post('/sync', requireRole('admin'), async (req, res) => {
  try {
    const result = await require('../services/operandioTrainingSync').runSync()
    res.json(result)
  } catch (err) {
    console.error('[reports/training] /sync error:', err.message)
    res.status(500).json({ error: err.message })
  }
})

module.exports = router
