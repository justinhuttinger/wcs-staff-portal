/**
 * /public/facility — UNAUTHENTICATED courts / pool board feed.
 *
 * Same shape and same rendering as the Group X board, but sourced from our own
 * facility_events rather than ABC, and with no instructor requirement.
 *
 * Club slug and facility slug are both allowlists: this endpoint takes no
 * authentication, so neither may reach a query as free text.
 */
const { Router } = require('express')
const cache = require('../services/memoryCache')
const { supabaseAdmin } = require('../services/supabase')
const { clubBySlug } = require('../lib/groupXClubs')
const { facilityBySlug } = require('../lib/facilities')
const { currentPacificDate, buildDays, windowEnd, publicCacheKey } = require('../lib/groupXPublic')
const { renderBoardHtml } = require('../templates/groupXBoard')

const router = Router()

// These events are ours, so a read is a cheap Supabase query rather than an
// ABC round trip. Still cached so seven TVs polling do not each hit the DB.
const FRESH_MS = 2 * 60 * 1000
const STALE_MS = 60 * 60 * 1000
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/

// Facility events are shaped into the same fields the shared board renderer
// expects, so one template serves Group X, courts and pool.
function toBoardShape(row) {
  return {
    event_id: row.id,
    event_type_id: row.facility,
    class_name: row.title,
    instructor_name: row.staff_name || null,
    event_timestamp_local: row.starts_at_local,
    duration_minutes: row.duration_minutes,
    status: 'Pending',
  }
}

async function loadWindow(club, facility, start) {
  const key = publicCacheKey(`${club.clubNumber}:${facility.slug}`, start)
  return cache.wrapSWR(key, FRESH_MS, STALE_MS, async () => {
    const last = windowEnd(start)
    const { data, error } = await supabaseAdmin
      .from('facility_events')
      .select('id, facility, title, staff_name, starts_at_local, duration_minutes')
      .eq('club_number', club.clubNumber)
      .eq('facility', facility.slug)
      .is('canceled_at', null)
      .gte('starts_at_local', `${start} 00:00:00`)
      .lte('starts_at_local', `${last} 23:59:59`)
      .order('starts_at_local', { ascending: true })
      .limit(2000)
    if (error) throw new Error(error.message)

    return {
      club: club.name,
      club_slug: club.slug,
      facility: facility.slug,
      facility_label: facility.label,
      // requireInstructor false: a lap swim slot has nobody assigned and that
      // is not a reason to hide it.
      ...buildDays(start, (data || []).map(toBoardShape), { requireInstructor: false, includeEndTime: true }),
    }
  })
}

function resolve(req) {
  const club = clubBySlug(req.query.club)
  const facility = facilityBySlug(req.query.facility)
  if (!club || !facility) return null
  const requested = req.query.start
  const start = DATE_RE.test(requested || '') ? requested : currentPacificDate()
  return { club, facility, start }
}

router.get('/schedule', async (req, res) => {
  const r = resolve(req)
  if (!r) return res.status(404).json({ error: 'unknown club or facility' })
  try {
    res.set('Cache-Control', 'public, max-age=300')
    res.json(await loadWindow(r.club, r.facility, r.start))
  } catch (err) {
    console.error('[publicFacility] /schedule failed:', err.message)
    res.status(503).json({ error: 'schedule temporarily unavailable' })
  }
})

router.get('/board', (req, res) => {
  const r = resolve(req)
  if (!r) {
    return res.status(404).type('html').send('<!doctype html><meta charset="utf-8"><title>Not found</title><body style="font-family:system-ui;padding:2rem">Unknown club or facility.</body>')
  }
  res.set('Cache-Control', 'public, max-age=300')
  const safePercent = req.query.safe !== undefined ? parseFloat(req.query.safe) : undefined
  res.type('html').send(renderBoardHtml({
    clubSlug: r.club.slug,
    clubName: r.club.name,
    safePercent,
    boardTitle: r.facility.title,
    eyebrowLabel: r.facility.label,
    scheduleUrl: `/public/facility/schedule?facility=${encodeURIComponent(r.facility.slug)}`,
  }))
})

module.exports = router
