// GET /member-alerts/:memberId  (launcher key)
//
// Staff-typed ABC member alerts, with the full note, for the WCS ABC check-in
// cue (abc-scraper.js). The check-in card shows only the short message; the
// launcher asks here when a new check-in carries an alert it doesn't
// recognise as a system alert. See lib/memberMessageAlerts.js.
//
// Same device trust as /telephony/pending. Only Member Message Alerts are
// returned (no balances, contact details or other alerts), and a caller needs
// the member's 32-hex ABC id, which only the check-in card on an ABC screen
// provides.

const { Router } = require('express')
const { supabaseAdmin } = require('../services/supabase')
const { abcConfigured, abcGet } = require('../lib/abcSearch')
const { memberMessageAlerts } = require('../lib/memberMessageAlerts')

const router = Router()

function requireLauncherKey(req, res, next) {
  const key = process.env.LAUNCHER_KEY
  if (key && req.headers['x-launcher-key'] !== key) {
    return res.status(401).json({ error: 'Invalid launcher key' })
  }
  next()
}

// A check-in fires this once; a short cache absorbs re-scans and double taps.
const CACHE_MS = 60 * 1000
const cache = new Map() // memberId -> { at, body }

router.get('/:memberId', requireLauncherKey, async (req, res) => {
  const memberId = String(req.params.memberId || '').toLowerCase()
  if (!/^[0-9a-f]{32}$/.test(memberId)) return res.status(400).json({ error: 'Bad member id' })
  if (!abcConfigured()) return res.status(503).json({ error: 'ABC not configured' })

  const hit = cache.get(memberId)
  if (hit && Date.now() - hit.at < CACHE_MS) return res.json(hit.body)

  try {
    // ABC is per club: use the member's home club from our sync, falling back
    // to the club the check-in happened at.
    const { data } = await supabaseAdmin
      .from('abc_members').select('club_number').eq('member_id', memberId).limit(1).maybeSingle()
    const club = (data && data.club_number) || String(req.query.club || '').replace(/\D/g, '')
    if (!club) return res.json({ alerts: [] })

    const json = await abcGet(`/${club}/members/${memberId}`)
    const member = (json && Array.isArray(json.members) && json.members[0]) || json
    const body = { alerts: memberMessageAlerts(member) }
    cache.set(memberId, { at: Date.now(), body })
    if (cache.size > 500) cache.delete(cache.keys().next().value)
    res.json(body)
  } catch (err) {
    console.error('[member-alerts]', err.message, err.body || '')
    res.status(502).json({ error: 'ABC lookup failed' })
  }
})

module.exports = router
