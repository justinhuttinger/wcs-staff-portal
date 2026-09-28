// Incoming-call banner for WCS ABC (proof of concept).
//
//  - POST /telephony/ghl-call  (GHL webhook secret) -- a GHL workflow fires on
//    an inbound call with { id, name, email, phone, club } where club is the
//    ABC club number ("30935"). We look the caller up in abc_members and queue
//    the result for that club.
//  - GET /telephony/pending?club=30935&after=<id>  (launcher key) -- WCS ABC
//    polls this every few seconds and shows a banner for anything new.
//
// The queue is in memory; see lib/incomingCalls.js for why that's OK for now.

const { Router } = require('express')
const { supabaseAdmin } = require('../services/supabase')
const { clubByNumber } = require('../config/clubs')
const { last10, createCallQueue, summarizeMatches } = require('../lib/incomingCalls')

const router = Router()
const queue = createCallQueue()

const str = (v, max = 200) => (typeof v === 'string' ? v.trim().slice(0, max) : '')

// Same secret as the other GHL workflow webhooks. Fail closed when unset.
function verifyWebhookSecret(req, res, next) {
  const secret = process.env.GHL_WEBHOOK_SECRET
  if (!secret) return res.status(503).json({ error: 'webhook not configured' })
  const provided = req.headers['x-webhook-secret'] || req.query.secret
  if (provided !== secret) return res.status(401).json({ error: 'Invalid webhook secret' })
  next()
}

// Same device auth as /print/poll and /launcher/heartbeat: enforced when
// LAUNCHER_KEY is set on the API.
function requireLauncherKey(req, res, next) {
  const key = process.env.LAUNCHER_KEY
  if (key && req.headers['x-launcher-key'] !== key) {
    return res.status(401).json({ error: 'Invalid launcher key' })
  }
  next()
}

const MEMBER_COLS = 'member_id, club_number, first_name, last_name, email, primary_phone, mobile_phone, ' +
  'barcode, member_status, is_past_due, membership_type'

// Any club: a Salem member calling Keizer is still a member.
async function findMembers(phone10, email) {
  let rows = []
  if (phone10) {
    // PostgREST can't strip punctuation and ABC stores "(503) 555-1212", so a
    // loose pattern first, then an exact re-check on the digits.
    const pat = `%${phone10.slice(0, 3)}%${phone10.slice(3, 6)}%${phone10.slice(6)}%`
    const { data, error } = await supabaseAdmin
      .from('abc_members')
      .select(MEMBER_COLS)
      .or(`primary_phone.ilike.${pat},mobile_phone.ilike.${pat}`)
      .limit(25)
    if (error) throw error
    rows = (data || []).filter(m => last10(m.primary_phone) === phone10 || last10(m.mobile_phone) === phone10)
  }
  if (!rows.length && email && email.includes('@')) {
    const { data, error } = await supabaseAdmin
      .from('abc_members').select(MEMBER_COLS).ilike('email', email).limit(10)
    if (error) throw error
    rows = data || []
  }
  return rows
}

async function findPt(members) {
  const ids = [...new Set(members.map(m => m.member_id))]
  if (!ids.length) return []
  const { data, error } = await supabaseAdmin
    .from('abc_recurring_pt_services')
    .select('club_number, member_id, trainer_name')
    .in('member_id', ids)
  if (error) throw error
  return data || []
}

router.post('/ghl-call', verifyWebhookSecret, async (req, res) => {
  const b = req.body || {}
  const club = str(b.club, 20).replace(/^0+/, '')
  if (!club) return res.status(400).json({ error: 'club required' })
  const phone = str(b.phone, 40)
  const email = str(b.email, 200).toLowerCase()

  let matches = []
  let lookupError = null
  try {
    const members = await findMembers(last10(phone), email)
    matches = summarizeMatches(members, await findPt(members), club)
  } catch (err) {
    // Still show the banner, just without member info.
    lookupError = err.message || String(err)
    console.error('[telephony] lookup failed:', lookupError)
  }

  const clubName = n => clubByNumber(n)?.name || n
  const entry = queue.push(club, {
    ghlContactId: str(b.id, 100) || null,
    name: str(b.name, 200),
    email,
    phone,
    clubName: clubName(club),
    matches: matches.slice(0, 5).map(m => ({ ...m, clubName: clubName(m.clubNumber) })),
    lookupError: !!lookupError,
  })
  console.log(`[telephony] call #${entry.id} club=${club} matches=${matches.length}`)
  res.json({ ok: true, id: entry.id, matches: matches.length })
})

router.get('/pending', requireLauncherKey, (req, res) => {
  const club = str(req.query.club, 20).replace(/^0+/, '')
  if (!club) return res.status(400).json({ error: 'club required' })
  const after = Number(req.query.after) || 0
  res.json({ calls: queue.since(club, after), latestId: queue.latestId() })
})

module.exports = router
