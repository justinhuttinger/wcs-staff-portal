/**
 * /public/childcare/:token — UNAUTHENTICATED childcare check-in for one club.
 *
 * One unguessable token per club (childcare_checkin_links, migration 244), the
 * same model as the Group X attendance links. Whoever has the link can see who
 * is in the room today, check children in and check them out. Nothing else.
 *
 * Every field is typed by the desk. There is no ABC lookup and no parent or
 * child record: each visit stands alone.
 *
 * A second, read-only link per club (view_token) is served by `viewRouter`,
 * mounted at /public/childcare-view/:token: who is in the room now, no
 * phones, no actions.
 */
const { Router } = require('express')
const { CLUBS } = require('../lib/groupXClubs')
const { supabaseAdmin } = require('../services/supabase')
const { tourDayStart } = require('../lib/tourDay')
const { parseCheckin, parseCheckout } = require('../lib/childcareCheckin')

const router = Router()

const VISIT_COLS = 'id, child_first_name, child_last_name, child_age_months, ' +
  'parent_first_name, parent_last_name, parent_phone, membership_kind, ' +
  'alt_pickup_name, checked_in_at, checked_out_at, checked_out_by, checked_out_by_name'

// The view link shows only what someone glancing at the room needs.
const VIEW_COLS = 'id, child_first_name, child_last_name, child_age_months, ' +
  'parent_first_name, parent_last_name, membership_kind, checked_in_at'

async function resolveToken(token, column = 'public_token') {
  if (!token) return null
  const { data, error } = await supabaseAdmin
    .from('childcare_checkin_links')
    .select('club_number, active')
    .eq(column, token)
    .maybeSingle()
  if (error) throw new Error(error.message)
  if (!data || !data.active) return null
  return CLUBS.find(c => c.clubNumber === String(data.club_number)) || null
}

// A child left checked in when the day ended was picked up at a time nobody
// recorded. Close it as auto_closed (pickup time unknown) so the next morning's
// board starts empty. Swept on read, throttled, like the tour queue.
const SWEEP_EVERY_MS = 60_000
const lastSweep = new Map()

async function closeYesterday(clubNumber, dayStart) {
  const now = Date.now()
  if (now - (lastSweep.get(clubNumber) || 0) < SWEEP_EVERY_MS) return
  lastSweep.set(clubNumber, now)
  const { error } = await supabaseAdmin
    .from('childcare_visits')
    .update({ auto_closed: true })
    .eq('club_number', clubNumber)
    .is('checked_out_at', null)
    .eq('auto_closed', false)
    .lt('checked_in_at', dayStart)
  if (error) console.error('[public-childcare] sweep failed:', error.message)
}

function fail(res, err, where) {
  console.error(`[public-childcare] ${where} failed:`, err.message)
  res.status(500).json({ error: 'Something went wrong, try again' })
}

// GET -> club name, children in the room now, and today's check-outs.
router.get('/:token', async (req, res) => {
  try {
    const club = await resolveToken(req.params.token)
    if (!club) return res.status(404).json({ error: 'This childcare link is not valid' })

    const dayStart = tourDayStart().toISOString()
    await closeYesterday(club.clubNumber, dayStart)

    const { data, error } = await supabaseAdmin
      .from('childcare_visits')
      .select(VISIT_COLS)
      .eq('club_number', club.clubNumber)
      .eq('auto_closed', false)
      .gte('checked_in_at', dayStart)
      .order('checked_in_at', { ascending: true })
    if (error) throw new Error(error.message)

    const visits = data || []
    res.set('Cache-Control', 'no-store')
    res.json({
      club: club.name,
      in_room: visits.filter(v => !v.checked_out_at),
      checked_out: visits.filter(v => v.checked_out_at)
        .sort((a, b) => String(b.checked_out_at).localeCompare(String(a.checked_out_at))),
    })
  } catch (err) { fail(res, err, 'GET') }
})

router.post('/:token/checkin', async (req, res) => {
  try {
    const club = await resolveToken(req.params.token)
    if (!club) return res.status(404).json({ error: 'This childcare link is not valid' })

    const parsed = parseCheckin(req.body, club.clubNumber)
    if (parsed.error) return res.status(400).json({ error: parsed.error })

    const { data, error } = await supabaseAdmin
      .from('childcare_visits')
      .insert(parsed.rows)
      .select(VISIT_COLS)
    if (error) throw new Error(error.message)
    res.status(201).json({ visits: data || [] })
  } catch (err) { fail(res, err, 'check-in') }
})

router.post('/:token/visits/:id/checkout', async (req, res) => {
  try {
    const club = await resolveToken(req.params.token)
    if (!club) return res.status(404).json({ error: 'This childcare link is not valid' })

    // Scoped to this club and still open, so one club's link cannot touch
    // another club's visits or rewrite a finished one.
    const { data: visit, error: readErr } = await supabaseAdmin
      .from('childcare_visits')
      .select('id, parent_first_name, parent_last_name, alt_pickup_name')
      .eq('id', req.params.id)
      .eq('club_number', club.clubNumber)
      .is('checked_out_at', null)
      .eq('auto_closed', false)
      .maybeSingle()
    if (readErr) {
      // A malformed uuid is a bad request, not an outage.
      if (/uuid/i.test(readErr.message)) return res.status(404).json({ error: 'That child is not checked in' })
      throw new Error(readErr.message)
    }
    if (!visit) return res.status(404).json({ error: 'That child is not checked in' })

    const parsed = parseCheckout(req.body, visit)
    if (parsed.error) return res.status(400).json({ error: parsed.error })

    const { error } = await supabaseAdmin
      .from('childcare_visits')
      .update({ ...parsed.update, checked_out_at: new Date().toISOString() })
      .eq('id', visit.id)
      .is('checked_out_at', null)
    if (error) throw new Error(error.message)
    res.json({ ok: true })
  } catch (err) { fail(res, err, 'check-out') }
})

// Read-only: children in the room now. Runs the same end-of-day sweep so a
// view left open overnight does not keep showing yesterday's children.
const viewRouter = Router()

viewRouter.get('/:token', async (req, res) => {
  try {
    const club = await resolveToken(req.params.token, 'view_token')
    if (!club) return res.status(404).json({ error: 'This childcare link is not valid' })

    const dayStart = tourDayStart().toISOString()
    await closeYesterday(club.clubNumber, dayStart)

    const { data, error } = await supabaseAdmin
      .from('childcare_visits')
      .select(VIEW_COLS)
      .eq('club_number', club.clubNumber)
      .is('checked_out_at', null)
      .eq('auto_closed', false)
      .gte('checked_in_at', dayStart)
      .order('checked_in_at', { ascending: true })
    if (error) throw new Error(error.message)

    res.set('Cache-Control', 'no-store')
    res.json({ club: club.name, view_only: true, in_room: data || [], checked_out: [] })
  } catch (err) { fail(res, err, 'view GET') }
})

module.exports = router
module.exports.viewRouter = viewRouter
