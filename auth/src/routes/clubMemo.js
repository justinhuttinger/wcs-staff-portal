// GET /club-memo?club=30935  (launcher key)
//
// The WCS ABC Club Home card: a club's live memo, read-only, no staff sign-in.
// Same access as the WCS ABC calendar: the PC knows its club, not who is at it.

const { Router } = require('express')
const { supabaseAdmin } = require('../services/supabase')
const { clubByNumber } = require('../config/clubs')
const { loadEditions, loadNotes } = require('../services/memoData')
const { composeMemo } = require('../lib/memoRules')

const router = Router()

function requireLauncherKey(req, res, next) {
  const key = process.env.LAUNCHER_KEY
  if (key && req.headers['x-launcher-key'] !== key) {
    return res.status(401).json({ error: 'Invalid launcher key' })
  }
  next()
}

router.get('/', requireLauncherKey, async (req, res) => {
  try {
    const club = clubByNumber(String(req.query.club || ''))
    if (!club) return res.status(400).json({ error: 'Unknown club' })

    const { data: enabled, error: enabledErr } = await supabaseAdmin
      .from('memo_clubs').select('enabled').eq('club_slug', club.slug).maybeSingle()
    if (enabledErr) throw enabledErr
    if (!enabled?.enabled) return res.json({ memo: null })

    const live = composeMemo(await loadEditions(), await loadNotes([club.slug]))
    res.json({
      memo: live && {
        month: live.month,
        club_name: club.name,
        main_items: live.main_items,
        club_items: live.club_items,
      },
    })
  } catch (err) {
    console.error('[ClubMemo] error:', err.message)
    res.status(500).json({ error: 'Could not load the memo' })
  }
})

module.exports = router
