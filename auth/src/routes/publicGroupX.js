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
const { mondayOf, currentPacificDate, buildWeek } = require('../lib/groupXPublic')
const { renderBoardHtml } = require('../templates/groupXBoard')

const router = Router()

const FRESH_MS = 5 * 60 * 1000
const STALE_MS = 60 * 60 * 1000
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/

async function loadWeek(club, monday) {
  return cache.wrapSWR(`gx:public:${club.clubNumber}:${monday}`, FRESH_MS, STALE_MS, async () => {
    const sunday = buildWeek(monday, []).week_end
    const classes = await abc.listClasses(club.clubNumber, monday, sunday)
    return { club: club.name, club_slug: club.slug, ...buildWeek(monday, classes) }
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
  res.type('html').send(renderBoardHtml({ clubSlug: r.club.slug, clubName: r.club.name }))
})

module.exports = router
