/**
 * /public/action-links — UNAUTHENTICATED read of one club's Day One + VIP
 * links, as set in Admin -> Action Links (app_config dayone_url_<slug> /
 * vip_url_<slug>).
 *
 * Read by portal/public/welcome.html, the post-signup popup the launcher opens
 * over ABC. The WCS ABC app has no portal sign-in, so the popup can't use the
 * authenticated /config/app-settings. Club slug is an allowlist and only
 * these two keys are exposed; both are links staff already open in a browser.
 */
const { Router } = require('express')
const { supabaseAdmin } = require('../services/supabase')

const router = Router()

const CLUBS = new Set(['salem', 'keizer', 'eugene', 'springfield', 'clackamas', 'milwaukie', 'medford'])
const TTL_MS = 60 * 1000
const cache = new Map() // slug -> { at, body }

const httpsOrNull = v => (typeof v === 'string' && /^https:\/\//i.test(v.trim()) ? v.trim() : null)

// GET /public/action-links/:club -> { dayone: url|null, vip: url|null }
router.get('/:club', async (req, res) => {
  const slug = String(req.params.club || '').toLowerCase()
  if (!CLUBS.has(slug)) return res.status(404).json({ error: 'Unknown club' })

  const hit = cache.get(slug)
  if (hit && Date.now() - hit.at < TTL_MS) return res.json(hit.body)

  try {
    const { data, error } = await supabaseAdmin
      .from('app_config')
      .select('key, value')
      .in('key', [`dayone_url_${slug}`, `vip_url_${slug}`])
    if (error) throw error
    const byKey = Object.fromEntries((data || []).map(r => [r.key, r.value]))
    const body = {
      dayone: httpsOrNull(byKey[`dayone_url_${slug}`]),
      vip: httpsOrNull(byKey[`vip_url_${slug}`]),
    }
    cache.set(slug, { at: Date.now(), body })
    res.set('Cache-Control', 'public, max-age=60')
    res.json(body)
  } catch (err) {
    res.status(500).json({ error: 'Failed to load links' })
  }
})

module.exports = router
