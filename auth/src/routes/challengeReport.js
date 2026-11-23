const { Router } = require('express')
const authenticate = require('../middleware/auth')
const { requireRole, requireReportAccess } = require('../middleware/role')
const { supabaseAdmin } = require('../services/supabase')
const { wrapSWR, del: cacheDel } = require('../services/memoryCache')
const { ghlFetch } = require('../services/ghlClient')
const { LOCATIONS } = require('../config/ghlLocations')
const { resolveScopedSlugs } = require('../services/locationScope')
const { isChallengePurchase, pageReachedBeforeStart, toRow, summarize } = require('../lib/challengeReport')

// ---------------------------------------------------------------------------
// /reports/challenge — who bought a Transformation Challenge entry.
//
// Source: GHL Payments -> Transactions, per club. The challenge tiers are GHL
// payment links (Kick Start $25 / Challenger $57 / All In $97), so every entry
// is a transaction named after its link. Read live (cached a few minutes)
// rather than synced: the volume is tiny and it is only on during the season.
// Phone numbers are not on a transaction; they come from ghl_contacts_v2.
//
// Seasonal: challenge_report_settings (migration 263). Admin turns it on and
// off and sets the season dates; while off, nothing is returned.
// ---------------------------------------------------------------------------

const router = Router()
router.use(authenticate)

const FRESH_MS = 5 * 60 * 1000
const STALE_MS = 30 * 60 * 1000
const PAGE = 100
const MAX_PAGES = 20
const isDate = v => /^\d{4}-\d{2}-\d{2}$/.test(String(v || ''))

async function loadSettings() {
  const { data, error } = await supabaseAdmin
    .from('challenge_report_settings')
    .select('enabled, season_start, season_end, name_match, updated_at')
    .eq('id', 1)
    .maybeSingle()
  if (error) throw error
  return data || { enabled: false, season_start: null, season_end: null, name_match: 'Transformation Challenge' }
}

// Every in-season challenge transaction at one club, newest first.
async function clubPurchases(loc, season) {
  const out = []
  for (let page = 0; page < MAX_PAGES; page++) {
    const data = await ghlFetch('/payments/transactions', loc.apiKey, {
      params: { altId: loc.id, altType: 'location', limit: PAGE, offset: page * PAGE },
    })
    const rows = data.data || []
    out.push(...rows.filter(t => isChallengePurchase(t, season)))
    if (rows.length < PAGE || pageReachedBeforeStart(rows, season.season_start)) break
  }
  return out
}

// Phone + name for the buyers, from the synced contacts. A buyer created in the
// last few minutes may not be synced yet; those few are read from GHL directly.
async function loadContacts(purchases) {
  const ids = [...new Set(purchases.map(p => p.txn.contactId).filter(Boolean))]
  const byId = new Map()
  for (let i = 0; i < ids.length; i += 200) {
    const { data, error } = await supabaseAdmin
      .from('ghl_contacts_v2')
      .select('id, first_name, last_name, email, phone')
      .in('id', ids.slice(i, i + 200))
    if (error) throw error
    for (const c of data || []) byId.set(c.id, c)
  }
  const missing = purchases.filter(p => p.txn.contactId && !byId.has(p.txn.contactId)).slice(0, 25)
  await Promise.all(missing.map(async p => {
    try {
      const { contact } = await ghlFetch(`/contacts/${p.txn.contactId}`, p.loc.apiKey)
      if (contact) byId.set(p.txn.contactId, contact)
    } catch { /* deleted contact: keep the name and email from the payment */ }
  }))
  return byId
}

async function buildRows(season) {
  const perClub = await Promise.all(LOCATIONS.map(async loc => {
    try {
      const txns = await clubPurchases(loc, season)
      return { loc, txns, error: null }
    } catch (err) {
      console.warn(`[challengeReport] ${loc.slug}: ${err.message}`)
      return { loc, txns: [], error: err.message }
    }
  }))
  const purchases = perClub.flatMap(c => c.txns.map(txn => ({ txn, loc: c.loc })))
  const contacts = await loadContacts(purchases)
  const rows = purchases
    .map(p => toRow(p.txn, { slug: p.loc.slug, name: p.loc.name }, contacts.get(p.txn.contactId)))
    .sort((a, b) => String(b.purchased_at).localeCompare(String(a.purchased_at)))
  const failedClubs = perClub.filter(c => c.error).map(c => c.loc.name)
  return { rows, failedClubs, fetchedAt: new Date().toISOString() }
}

function cacheKey(s) {
  return `challenge-report:${s.season_start}:${s.season_end || ''}:${s.name_match}`
}

// GET /reports/challenge/settings — any signed-in user. The Reporting list asks
// this to decide whether to show the report at all.
router.get('/settings', async (req, res) => {
  try {
    res.json({ settings: await loadSettings() })
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

// PUT /reports/challenge/settings — admin. { enabled, season_start, season_end, name_match }
router.put('/settings', requireRole('admin'), async (req, res) => {
  try {
    const current = await loadSettings()
    const b = req.body || {}
    const next = {
      id: 1,
      enabled: typeof b.enabled === 'boolean' ? b.enabled : !!current.enabled,
      season_start: b.season_start !== undefined ? b.season_start : current.season_start,
      season_end: b.season_end !== undefined ? (b.season_end || null) : current.season_end,
      name_match: b.name_match !== undefined ? String(b.name_match).trim() : current.name_match,
      updated_at: new Date().toISOString(),
      updated_by: req.staff.id,
    }
    if (!isDate(next.season_start)) return res.status(400).json({ error: 'Season start must be a date' })
    if (next.season_end && !isDate(next.season_end)) return res.status(400).json({ error: 'Season end must be a date' })
    if (next.season_end && next.season_end < next.season_start) return res.status(400).json({ error: 'Season end is before the start' })
    if (!next.name_match) return res.status(400).json({ error: 'Product name match is required' })
    const { data, error } = await supabaseAdmin
      .from('challenge_report_settings')
      .upsert(next, { onConflict: 'id' })
      .select('enabled, season_start, season_end, name_match, updated_at')
      .single()
    if (error) throw error
    cacheDel(cacheKey(current))
    res.json({ settings: data })
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

// GET /reports/challenge?location_slug=all|<slug>[,<slug>]&refresh=1
// Managers get their own clubs; all-location roles get every club.
router.get('/', requireReportAccess('manager', ['challenge']), async (req, res) => {
  try {
    const settings = await loadSettings()
    if (!settings.enabled) return res.json({ enabled: false, settings, rows: [], summary: summarize([]) })

    const scope = await resolveScopedSlugs(req)
    const key = cacheKey(settings)
    if (req.query.refresh === '1') cacheDel(key)
    const all = await wrapSWR(key, FRESH_MS, STALE_MS, () => buildRows(settings))

    const allowed = scope.all ? null : new Set(scope.slugs)
    const rows = allowed ? all.rows.filter(r => allowed.has(r.club_slug)) : all.rows
    // The clubs this viewer may pick between, so a club with no entries yet
    // still has a pill (it reads 0) rather than vanishing.
    const clubs = LOCATIONS
      .filter(l => !allowed || allowed.has(l.slug))
      .map(l => ({ slug: l.slug, name: l.name }))
    res.json({
      enabled: true,
      settings,
      rows,
      clubs,
      summary: summarize(rows),
      failed_clubs: all.failedClubs,
      fetched_at: all.fetchedAt,
    })
  } catch (err) {
    res.status(err.status || 500).json({ error: err.message })
  }
})

module.exports = router
