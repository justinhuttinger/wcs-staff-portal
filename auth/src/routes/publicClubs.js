/**
 * /public/clubs — UNAUTHENTICATED read of the club list, for the portal, the
 * launcher and the satellite apps (wcs-save, wcs-member, forms, games, ...), so
 * a club added in Admin -> Clubs reaches them without a code change.
 *
 * Only non-secret fields. Credentials live in club_secrets and never leave the
 * auth API. Served from the list loaded at boot (config/clubs), which is why an
 * Admin -> Clubs save restarts this service.
 *
 * GET /public/clubs            -> { clubs: [...active clubs, house order] }
 * GET /public/clubs?all=1      -> includes inactive clubs (with active:false)
 */
const { Router } = require('express')
const { ALL_CLUBS, CLUBS, clubSource } = require('../config/clubs')

const router = Router()

const PUBLIC_FIELDS = ['slug', 'name', 'clubNumber', 'state', 'timezone', 'abcUrl', 'background', 'tradingName', 'active']

function publicClub(c) {
  const out = {}
  for (const k of PUBLIC_FIELDS) if (c[k] !== undefined) out[k] = c[k]
  return out
}

router.get('/', (req, res) => {
  const list = req.query.all === '1' ? ALL_CLUBS : CLUBS
  res.set('Cache-Control', 'public, max-age=60')
  res.json({ source: clubSource(), clubs: list.map(publicClub) })
})

module.exports = router
module.exports.publicClub = publicClub
