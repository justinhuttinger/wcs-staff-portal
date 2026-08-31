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
const clubFeatures = require('../lib/clubFeatures')
const { markNewClasses } = require('../lib/groupXNewClasses')
const { supabaseAdmin } = require('../services/supabase')
const { currentPacificDate, mondayOf, buildDays, windowEnd, publicCacheKey } = require('../lib/groupXPublic')
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

async function loadWeek(club, start) {
  return cache.wrapSWR(publicCacheKey(club.clubNumber, start), FRESH_MS, STALE_MS, async () => {
    const last = windowEnd(start)
    const [classes, typeFlags, eventFlags, classTypes] = await Promise.all([
      abc.listClasses(club.clubNumber, start, last),
      supabaseAdmin
        .from('group_x_new_classes')
        .select('event_type_id, class_name, show_until')
        .eq('club_number', club.clubNumber),
      supabaseAdmin
        .from('group_x_new_class_events')
        .select('abc_event_id, class_name, show_until')
        .eq('club_number', club.clubNumber),
      // Descriptions live on the event TYPE, not the event, so they are joined
      // on here. listClassTypes is cached for an hour, so this is nearly free.
      abc.listClassTypes(club.clubNumber).catch(err => {
        // A missing description must never take the board down.
        console.warn('[publicGroupX] class descriptions unavailable:', err.message)
        return []
      }),
    ])
    // A badge failure must never take the board down. Worst case members see
    // the schedule without the NEW pill, which beats a blank TV.
    if (typeFlags.error) console.warn('[publicGroupX] class badges unavailable:', typeFlags.error.message)
    if (eventFlags.error) console.warn('[publicGroupX] session badges unavailable:', eventFlags.error.message)
    const descriptions = new Map((classTypes || []).map(t => [t.event_type_id, t.description]))
    const withDescriptions = classes.map(c => ({
      ...c,
      description: descriptions.get(c.event_type_id) || null,
    }))
    const flagged = markNewClasses(withDescriptions, typeFlags.data || [], eventFlags.data || [])
    return { club: club.name, club_slug: club.slug, ...buildDays(start, flagged) }
  })
}

function resolve(req) {
  const club = clubBySlug(req.query.club)
  if (!club) return null
  // The window starts on the requested day, or today in club-local Pacific.
  // `week` is still accepted so any existing bookmark keeps working.
  const requested = req.query.start || req.query.week
  const start = DATE_RE.test(requested || '') ? requested : currentPacificDate()
  return { club, start }
}

router.get('/schedule', async (req, res) => {
  const r = resolve(req)
  if (!r) return res.status(404).json({ error: 'unknown club' })
  try {
    // A club that does not run Group X has no Group X schedule. 404 rather
    // than an empty week, which reads as "nothing on" instead of "not here".
    if (!await clubFeatures.isEnabled(r.club.clubNumber, clubFeatures.GROUP_X)) {
      return res.status(404).json({ error: 'unknown club' })
    }
    res.set('Cache-Control', 'public, max-age=300')
    res.json(await loadWeek(r.club, r.start))
  } catch (err) {
    console.error('[publicGroupX] /schedule failed:', err.message)
    res.status(503).json({ error: 'schedule temporarily unavailable' })
  }
})

router.get('/board', async (req, res) => {
  const r = resolve(req)
  if (r && !await clubFeatures.isEnabled(r.club.clubNumber, clubFeatures.GROUP_X).catch(() => true)) {
    return res.status(404).type('html').send('<!doctype html><meta charset="utf-8"><title>Unknown club</title><body style="font-family:system-ui;padding:2rem">This club does not run Group X.</body>')
  }
  if (!r) {
    return res.status(404).type('html').send('<!doctype html><meta charset="utf-8"><title>Unknown club</title><body style="font-family:system-ui;padding:2rem">Unknown club.</body>')
  }
  res.set('Cache-Control', 'public, max-age=300')
  // ?safe=N (0-10) widens the overscan inset for a TV that crops harder than
  // the 3% default.
  const safePercent = req.query.safe !== undefined ? parseFloat(req.query.safe) : undefined
  // Only an EXPLICIT start pins the window. resolve() falls back to today for
  // the feed, but handing that back to the page would freeze a wall TV on the
  // day it was switched on instead of letting it roll over at local midnight.
  const asked = req.query.start || req.query.week
  let startDate = DATE_RE.test(asked || '') ? asked : null
  // A printed sheet is a Monday-to-Sunday grid. The board's window normally
  // rolls from today, which is right on a wall and wrong on paper: a sheet run
  // off on a Wednesday would start with Wednesday and wrap into next week, so
  // the columns would not line up with any other sheet in the building.
  // Snapped here rather than trusted from the caller, because the board can be
  // printed straight from its own URL with no portal in front of it.
  if (req.query.print === '1') startDate = mondayOf(startDate || currentPacificDate())
  res.type('html').send(renderBoardHtml({
    clubSlug: r.club.slug,
    clubName: r.club.name,
    safePercent,
    // ?embed=1 strips the board's own title block, status line and overscan
    // padding, for the iframe on westcoaststrength.com. See renderBoardHtml.
    embed: req.query.embed === '1',
    startDate,
    // ?print=1 renders the board and prints itself. The portal's Print button
    // opens this, so the printed sheet IS the board rather than a copy of it.
    autoPrint: req.query.print === '1',
  }))
})

module.exports = router
