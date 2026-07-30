/**
 * /public/group-x — UNAUTHENTICATED class board feed.
 *
 * Consumed by the WCS website (iframe) and by the in-gym TVs. Seven TVs polling
 * live would hammer ABC, so every read goes through a stale-while-revalidate
 * cache: fresh for 5 minutes, then served stale while it refreshes in the
 * background, and still served for an hour after that if ABC is down. A stale
 * schedule beats a blank TV.
 *
 * The club slug is an allowlist, not a passthrough: an unknown slug 404s rather
 * than letting an anonymous caller proxy an arbitrary club number through our
 * ABC credentials.
 */
const { Router } = require('express')
const abc = require('../services/abcGroupX')
const cache = require('../services/memoryCache')
const { clubBySlug } = require('../lib/groupXClubs')
const { markNewClasses } = require('../lib/groupXNewClasses')
const { supabaseAdmin } = require('../services/supabase')
const { mondayOf, currentPacificDate, buildWeek, publicCacheKey } = require('../lib/groupXPublic')
const { renderBoardHtml } = require('../templates/groupXBoard')

const router = Router()

// The board polls every 5 minutes. Keeping the fresh window shorter than that
// means each poll gets genuinely fresh data instead of a stale-serve, so a
// class edited directly in ABC (which our own cache invalidation cannot see)
// shows up on the next poll rather than the one after. At most one ABC call
// per club-week per 2 minutes, which is nothing.
const FRESH_MS = 2 * 60 * 1000
// Long tail purely as a failure cushion: if ABC is down we keep serving the
// last good week for an hour rather than blanking the TVs.
const STALE_MS = 60 * 60 * 1000
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/

async function loadWeek(club, monday) {
  return cache.wrapSWR(publicCacheKey(club.clubNumber, monday), FRESH_MS, STALE_MS, async () => {
    const sunday = buildWeek(monday, []).week_end
    const [classes, typeFlags, eventFlags] = await Promise.all([
      abc.listClasses(club.clubNumber, monday, sunday),
      supabaseAdmin
        .from('group_x_new_classes')
        .select('event_type_id, class_name, show_until')
        .eq('club_number', club.clubNumber),
      supabaseAdmin
        .from('group_x_new_class_events')
        .select('abc_event_id, class_name, show_until')
        .eq('club_number', club.clubNumber),
    ])
    // A badge failure must never take the board down. Worst case members see
    // the schedule without the NEW pill, which beats a blank TV.
    if (typeFlags.error) console.warn('[publicGroupX] class badges unavailable:', typeFlags.error.message)
    if (eventFlags.error) console.warn('[publicGroupX] session badges unavailable:', eventFlags.error.message)
    const flagged = markNewClasses(classes, typeFlags.data || [], eventFlags.data || [])
    return { club: club.name, club_slug: club.slug, ...buildWeek(monday, flagged) }
  })
}

function resolve(req) {
  const club = clubBySlug(req.query.club)
  if (!club) return null
  const week = DATE_RE.test(req.query.week || '') ? req.query.week : currentPacificDate()
  return { club, monday: mondayOf(week) }
}

router.get('/schedule', async (req, res) => {
  const r = resolve(req)
  if (!r) return res.status(404).json({ error: 'unknown club' })
  try {
    res.set('Cache-Control', 'public, max-age=300')
    res.json(await loadWeek(r.club, r.monday))
  } catch (err) {
    console.error('[publicGroupX] /schedule failed:', err.message)
    res.status(503).json({ error: 'schedule temporarily unavailable' })
  }
})

router.get('/board', (req, res) => {
  const r = resolve(req)
  if (!r) {
    return res.status(404).type('html').send('<!doctype html><meta charset="utf-8"><title>Unknown club</title><body style="font-family:system-ui;padding:2rem">Unknown club.</body>')
  }
  res.set('Cache-Control', 'public, max-age=300')
  // ?safe=N (0-10) widens the overscan inset for a TV that crops harder than
  // the 3% default.
  const safePercent = req.query.safe !== undefined ? parseFloat(req.query.safe) : undefined
  res.type('html').send(renderBoardHtml({
    clubSlug: r.club.slug,
    clubName: r.club.name,
    safePercent,
  }))
})

module.exports = router
