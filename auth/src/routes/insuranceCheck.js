// Insurance check page: book.westcoaststrength.com/insurance/<slug>.
//
// Front desk staff open it from WCS ABC's "Insurance Verification" button,
// check the member's eligibility on the insurer's own site, then sign them up
// in ABC. The page is just the club's programs as buttons; nothing is stored
// about the member. Replaces the GHL funnel pages at
// strengthcoastwest.com/insurance/<slug>, which were missing for newer clubs.
//
// Which programs each club shows is edited in portal Admin -> Insurance
// Programs (admin only), via the /api/admin routes below.
const { Router } = require('express')
const path = require('path')
const fs = require('fs')
const rateLimit = require('express-rate-limit')
const { CLUBS } = require('../config/clubs')
const { supabaseAdmin } = require('../services/supabase')
const authenticate = require('../middleware/auth')
const { requireRole } = require('../middleware/role')
const { PROGRAMS, CONFIG_PREFIX, parseStored, toStored } = require('../config/insurancePrograms')

const router = Router()

const readLimiter = rateLimit({
  windowMs: 60 * 1000, max: 60, standardHeaders: true, legacyHeaders: false,
  message: { error: 'Too many requests, please wait a moment' },
})

function clubBySlug(slug) {
  return CLUBS.find(c => c.slug === String(slug || '').toLowerCase()) || null
}

// One short cache for all clubs' settings: the page is opened often and the
// admin wants changes to show "within about a minute".
const TTL_MS = 60 * 1000
let cache = null // { at, bySlug }

async function loadSettings({ fresh = false } = {}) {
  if (!fresh && cache && Date.now() - cache.at < TTL_MS) return cache.bySlug
  const { data, error } = await supabaseAdmin
    .from('app_config').select('key, value').like('key', CONFIG_PREFIX + '%')
  if (error) throw error
  const bySlug = {}
  for (const row of data || []) bySlug[row.key.slice(CONFIG_PREFIX.length)] = row.value
  cache = { at: Date.now(), bySlug }
  return bySlug
}

async function programsFor(slug, opts) {
  const stored = await loadSettings(opts)
  const keys = parseStored(Object.prototype.hasOwnProperty.call(stored, slug) ? stored[slug] : null, slug)
  return PROGRAMS.filter(p => keys.includes(p.key))
}

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

const PAGE_PATH = path.join(__dirname, '..', 'public', 'insuranceCheck.html')
let template = null

function renderPage(req, res, club) {
  try {
    if (!template || process.env.NODE_ENV !== 'production') template = fs.readFileSync(PAGE_PATH, 'utf8')
    res.type('html').send(template
      .split('{{WIDGET_BASE}}').join(req.baseUrl || '/insurance')
      .split('{{WIDGET_LOCATION}}').join(club ? club.slug : ''))
  } catch (e) {
    console.error('[InsuranceCheck] page render failed:', e.message)
    res.status(500).send('Page unavailable')
  }
}

router.get('/', (req, res) => renderPage(req, res, null))

router.get('/logo.png', (req, res) => {
  res.sendFile(path.join(__dirname, '..', 'assets', 'logo.png'))
})

// ---------------------------------------------------------------------------
// API
// ---------------------------------------------------------------------------

router.get('/api/locations', readLimiter, (req, res) => {
  res.json({ locations: CLUBS.map(c => ({ slug: c.slug, name: c.name })) })
})

router.get('/api/programs', readLimiter, async (req, res) => {
  const club = clubBySlug(req.query.club)
  if (!club) return res.status(400).json({ error: 'Unknown club' })
  try {
    const programs = await programsFor(club.slug)
    res.set('Cache-Control', 'public, max-age=60')
    res.json({ club: { slug: club.slug, name: club.name }, programs })
  } catch (e) {
    console.error('[InsuranceCheck] programs failed:', e.message)
    res.status(500).json({ error: 'Could not load programs' })
  }
})

// Admin: every club's programs (defaults applied), for the portal grid.
router.get('/api/admin', authenticate, requireRole('admin'), async (req, res) => {
  try {
    const stored = await loadSettings({ fresh: true })
    res.json({
      programs: PROGRAMS.map(({ key, name }) => ({ key, name })),
      clubs: CLUBS.map(c => ({
        slug: c.slug,
        name: c.name,
        programs: parseStored(Object.prototype.hasOwnProperty.call(stored, c.slug) ? stored[c.slug] : null, c.slug),
      })),
    })
  } catch (e) {
    console.error('[InsuranceCheck] admin read failed:', e.message)
    res.status(500).json({ error: e.message })
  }
})

// Admin: save. Body { clubs: { <slug>: [programKey, ...] } }. Every listed club
// gets a row (an empty list stores '' = none), unknown clubs/keys are refused
// or dropped.
router.put('/api/admin', authenticate, requireRole('admin'), async (req, res) => {
  const input = req.body && req.body.clubs
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    return res.status(400).json({ error: 'clubs object required' })
  }
  const unknown = Object.keys(input).filter(slug => !clubBySlug(slug))
  if (unknown.length) return res.status(400).json({ error: `Unknown club: ${unknown.join(', ')}` })
  try {
    const now = new Date().toISOString()
    const rows = Object.entries(input).map(([slug, keys]) => ({
      key: CONFIG_PREFIX + slug.toLowerCase(), value: toStored(keys), updated_at: now,
    }))
    if (rows.length) {
      const { error } = await supabaseAdmin.from('app_config').upsert(rows, { onConflict: 'key' })
      if (error) throw error
    }
    cache = null
    res.json({ ok: true })
  } catch (e) {
    console.error('[InsuranceCheck] admin save failed:', e.message)
    res.status(500).json({ error: e.message })
  }
})

// Per-club page. Registered last so it never shadows /api/* or /logo.png.
router.get('/:club', (req, res, next) => {
  const club = clubBySlug(req.params.club)
  if (!club) return next()
  renderPage(req, res, club)
})

module.exports = router
