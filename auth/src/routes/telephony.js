// Incoming-call banner for WCS ABC (proof of concept).
//
//  - POST /telephony/ghl-call  (GHL webhook secret) -- a GHL workflow fires on
//    an inbound call with { id, name, email, phone, club } where club is the
//    ABC club number ("30935"). We look the caller up in abc_members and queue
//    the result for that club.
//  - GET /telephony/phone-ring?club=30935&phone=<caller>&key=<secret> -- the
//    desk phone's own "incoming call" action URL. It fires the moment the
//    phone rings, well before GHL's workflow does, so this is what puts the
//    banner up. It knows nothing but the number; when GHL's webhook for the
//    same call turns up later it only adds the GHL contact (for enquiries).
//    Grandstream phones cut a long action URL short (the key arrived as its
//    first 8 characters), so there is a short form of the same thing:
//    GET /telephony/ring?c=30935&p=<caller>&k=<secret>
//  - GET /telephony/pending?club=30935&after=<id>  (launcher key) -- WCS ABC
//    polls this every few seconds and shows a banner for anything new.
//  - POST /telephony/enquiry  (launcher key) -- the banner's telephony enquiry
//    form: name + email onto the caller's GHL contact, tagged. A call the
//    desk phone reported has no GHL contact yet, so the save finds the contact
//    by the caller's number, or creates one (Justin, 2026-10-01). Only for a
//    call this club received in the last hour (see recentCall), so this can't
//    be used to edit arbitrary GHL contacts.
//
// The queue is in memory; see lib/incomingCalls.js for why that's OK for now.

const { Router } = require('express')
const { supabaseAdmin } = require('../services/supabase')
const { clubByNumber, envFor } = require('../config/clubs')
const { ghlFetch } = require('../services/ghlClient')
const { last10, callerNumber, createCallQueue, summarizeMatches, cleanEnquiry } = require('../lib/incomingCalls')

const ENQUIRY_TAG = 'telephony enquiry'

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

// Desk phones can only do a plain GET, so their secret rides in the URL and
// sits in every handset's config. It gets its own value so a phone never
// holds the GHL webhook secret. Fail closed when unset.
function verifyPhoneKey(req, res, next) {
  const secret = process.env.PHONE_ACTION_SECRET
  if (!secret) return res.status(503).json({ error: 'phone action URL not configured' })
  if ((req.query.key || req.query.k) !== secret) return res.status(401).json({ error: 'Invalid key' })
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

// Look the caller up and queue a banner for the club, unless this call is
// already queued (see findByPhone), in which case the existing entry comes
// back with created: false.
async function queueCall(club, { phone, email = '', name = '', ghlContactId = null }) {
  const phone10 = last10(phone)
  let existing = queue.findByPhone(club, phone10)
  if (existing) return { entry: existing, created: false }

  let matches = []
  let lookupError = null
  try {
    const members = await findMembers(phone10, email)
    matches = summarizeMatches(members, await findPt(members), club)
  } catch (err) {
    // Still show the banner, just without member info.
    lookupError = err.message || String(err)
    console.error('[telephony] lookup failed:', lookupError)
  }

  // Every handset in a ring group reports at once, so another report of this
  // call may have been queued while we were looking the caller up.
  existing = queue.findByPhone(club, phone10)
  if (existing) return { entry: existing, created: false }

  const clubName = n => clubByNumber(n)?.name || n
  const entry = queue.push(club, {
    ghlContactId,
    name,
    email,
    phone,
    clubName: clubName(club),
    matches: matches.slice(0, 5).map(m => ({ ...m, clubName: clubName(m.clubNumber) })),
    lookupError: !!lookupError,
  })
  return { entry, created: true }
}

router.post('/ghl-call', verifyWebhookSecret, async (req, res) => {
  const b = req.body || {}
  const club = str(b.club, 20).replace(/^0+/, '')
  if (!club) return res.status(400).json({ error: 'club required' })
  const call = {
    ghlContactId: str(b.id, 100) || null,
    name: str(b.name, 200),
    email: str(b.email, 200).toLowerCase(),
    phone: str(b.phone, 40),
  }
  const { entry, created } = await queueCall(club, call)
  if (!created) {
    // The phone already put this banner up. Give it the GHL contact so the
    // enquiry form can save.
    for (const k of ['ghlContactId', 'name', 'email']) if (!entry[k] && call[k]) entry[k] = call[k]
  }
  console.log(`[telephony] call #${entry.id} club=${club} matches=${entry.matches.length}${created ? '' : ' (already queued)'}`)
  res.json({ ok: true, id: entry.id, matches: entry.matches.length, duplicate: !created })
})

// Always 200 for a call we choose to ignore, so the phone doesn't log errors
// for every extension-to-extension call.
router.get(['/phone-ring', '/ring'], verifyPhoneKey, async (req, res) => {
  const club = str(req.query.club || req.query.c, 20).replace(/^0+/, '')
  if (!clubByNumber(club)) return res.status(400).json({ error: 'unknown club' })
  const phone10 = callerNumber(str(req.query.phone || req.query.p, 200))
  if (!phone10) return res.json({ ok: true, ignored: 'not an outside number' })
  const { entry, created } = await queueCall(club, { phone: `+1${phone10}` })
  if (created) console.log(`[telephony] ring #${entry.id} club=${club} matches=${entry.matches.length}`)
  res.json({ ok: true, id: entry.id, duplicate: !created })
})

router.get('/pending', requireLauncherKey, (req, res) => {
  const club = str(req.query.club, 20).replace(/^0+/, '')
  if (!club) return res.status(400).json({ error: 'club required' })
  const after = Number(req.query.after) || 0
  res.json({ calls: queue.since(club, after), latestId: queue.latestId() })
})

router.post('/enquiry', requireLauncherKey, async (req, res) => {
  const b = req.body || {}
  const club = str(b.club, 20).replace(/^0+/, '')
  const call = club ? queue.recentCall(club, b.callId) : null
  if (!call) return res.status(404).json({ error: "Couldn't find this call (calls can be saved for an hour). Log it in GHL instead." })
  if (!call.ghlContactId && !last10(call.phone)) return res.status(400).json({ error: 'This call has no number to save against' })
  const { value, error } = cleanEnquiry(b)
  if (error) return res.status(400).json({ error })

  const clubRec = clubByNumber(club)
  const apiKey = clubRec && envFor(clubRec, 'GHL_API_KEY_')
  const locationId = clubRec && envFor(clubRec, 'GHL_LOCATION_')
  if (!apiKey || !locationId) return res.status(503).json({ error: 'GHL is not set up for this club' })

  try {
    const update = { firstName: value.firstName, lastName: value.lastName }
    if (value.email) update.email = value.email
    if (call.ghlContactId) {
      await ghlFetch(`/contacts/${encodeURIComponent(call.ghlContactId)}`, apiKey, { method: 'PUT', body: update })
    } else {
      // upsert matches the club's existing contact on phone / email and only
      // creates one when there is none. Tags go on separately below: sent
      // here they would replace an existing contact's tags.
      const upserted = await ghlFetch('/contacts/upsert', apiKey, {
        method: 'POST', body: { locationId, phone: `+1${last10(call.phone)}`, ...update },
      })
      const id = upserted?.contact?.id
      if (!id) throw new Error('Contact upsert returned no id')
      call.ghlContactId = id
      console.log(`[telephony] call #${call.id} ${upserted.new ? 'created' : 'matched'} GHL contact ${id}`)
    }
    const contactPath = `/contacts/${encodeURIComponent(call.ghlContactId)}`
    await ghlFetch(`${contactPath}/tags`, apiKey, { method: 'POST', body: { tags: [ENQUIRY_TAG] } })
    console.log(`[telephony] enquiry saved call #${call.id} club=${club} by=${str(b.staffName, 80) || '?'}`)
    res.json({ ok: true, ...value })
  } catch (err) {
    const msg = String(err.message || err)
    console.error('[telephony] enquiry save failed:', msg)
    // GHL's duplicate-contact rule rejects an email another contact already has.
    const dup = /duplicat|already exist/i.test(msg)
    res.status(502).json({ error: dup ? 'Another GHL contact already has that email' : 'Could not save to GHL' })
  }
})

module.exports = router
