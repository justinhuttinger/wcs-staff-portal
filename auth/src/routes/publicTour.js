const { Router } = require('express')
const { supabaseAdmin } = require('../services/supabase')
const { clubNumberForLocationName } = require('../config/clubMap')
const { buildTourWebhookPayload } = require('../lib/tourWebhook')
const { getLocationBySlug } = require('../config/ghlLocations')
const { ghlFetch } = require('../services/ghlClient')
const { readReferral, writeReferral } = require('../lib/vipReferral')
const { resolveGhlContactId } = require('../lib/resolveGhlContact')
const { searchMembersByName } = require('../lib/memberLookup')
const { resolveAbcId } = require('../lib/resolveAbcId')
const { resolveEmployeeId, employeeIdMap, normalize: normalizeName } = require('../lib/resolveEmployeeId')
const { pushConfigured } = require('../lib/tourPush')

const router = Router()

// The tour-member list must match what staff see on the Day One booking page:
// the GHL "Day One Booking Team Member" dropdown options. Those are kept in sync
// from the LIVE ABC per-club roster by ghl-sync (employeeSync), so they include
// multi-club people (e.g. owners) that the deduped abc_employees table drops.
// We read the GHL field options directly and fall back to the table on failure.
const DAY_ONE_FIELD_KEY = 'contact.day_one_booking_team_member'
const employeeCache = {} // slug -> { names: string[], at: number }
const EMP_TTL = 30 * 60 * 1000

function optionLabel(o) {
  if (typeof o === 'string') return o
  return (o && (o.label || o.value || o.name || o.option)) || ''
}

// Read the location's GHL "Day One Booking Team Member" options. Returns an array
// of names, or null if this location has no GHL config (caller then falls back).
async function rosterFromGHL(locationName) {
  const slug = (locationName || '').trim().toLowerCase()
  const cached = employeeCache[slug]
  if (cached && (Date.now() - cached.at) < EMP_TTL) return cached.names
  const loc = getLocationBySlug(slug)
  if (!loc) return null
  const data = await ghlFetch(`/locations/${loc.id}/customFields`, loc.apiKey)
  const fields = data.customFields || []
  const field = fields.find(f =>
    f.fieldKey === DAY_ONE_FIELD_KEY ||
    (f.name || '').toLowerCase() === 'day one booking team member')
  const names = (field?.picklistOptions || field?.options || []).map(optionLabel).filter(Boolean)
  employeeCache[slug] = { names, at: Date.now() }
  return names
}

// Fallback: active ABC employees for the location's club from our synced table.
async function rosterFromTable(locationName) {
  const club = clubNumberForLocationName(locationName)
  if (!club) return []
  const { data } = await supabaseAdmin
    .from('abc_employees')
    .select('full_name, first_name, last_name')
    .eq('club_number', club)
    .ilike('status', 'active')
  return (data || [])
    .map(e => e.full_name || [e.first_name, e.last_name].filter(Boolean).join(' '))
    .filter(Boolean)
}

// NOTE: this router is intentionally NOT behind the authenticate middleware.
// Access is gated entirely by the unguessable per-location public_token.

const SELECT_COLS =
  'id, received_at, ghl_contact_id, contact_name, contact_email, contact_phone, ' +
  'photo_base64, location_id, status, outcome, notes, tour_member, completed_at, raw'

// The kiosk stamps abc_member_id into `raw` when it creates or attaches a
// profile. Surface just that field: `raw` is the entire inbound webhook body and
// has no business going to a login-free page.
function withAbcId(row) {
  const { raw, ...rest } = row || {}
  return { ...rest, abc_member_id: (raw && (raw.abc_member_id || raw.abcMemberId)) || null }
}

// 'Custom Pass' also writes a pass to ABC (see the trial-days route); it is a
// real outcome as far as saving and the outbound webhook are concerned.
const ALLOWED_OUTCOMES = ['Membership Sale', 'Started Trial', 'Started VIP Pass', 'Only Tour', 'Custom Pass']

// Resolve a token -> active config row (+ location). Returns null if not found.
async function resolveToken(token) {
  if (!token) return null
  const { data: cfg } = await supabaseAdmin
    .from('tour_location_config')
    .select('location_id, day_one_base_url, webhook_url, active')
    .eq('public_token', token)
    .maybeSingle()
  if (!cfg || !cfg.active) return null
  const { data: loc } = await supabaseAdmin
    .from('locations')
    .select('id, name')
    .eq('id', cfg.location_id)
    .maybeSingle()
  if (!loc) return null
  return { cfg, location: loc }
}

// GET /public/tour/:token -> location name, day one link, ready + completed queues
router.get('/:token', async (req, res) => {
  try {
    const ctx = await resolveToken(req.params.token)
    if (!ctx) return res.status(404).json({ error: 'not found' })

    // Only the live queue. Completed tours are deleted on outcome-save (the
    // outbound webhook is the record on the way out), so there is no completed list.
    const { data: ready } = await supabaseAdmin
      .from('tour_intakes')
      .select(SELECT_COLS)
      .eq('location_id', ctx.location.id)
      .eq('status', 'ready')
      .order('received_at', { ascending: false })
      .limit(200)

    res.json({
      location_name: ctx.location.name,
      day_one_base_url: ctx.cfg.day_one_base_url || null,
      vapid_public_key: process.env.VAPID_PUBLIC_KEY || null,
      // Whether the server can actually SEND. The public key alone is enough for
      // an iPad to subscribe and show alerts as on, so without this the app
      // reports notifications working while nothing can ever deliver one.
      push_configured: pushConfigured(),
      ready: (ready || []).map(withAbcId),
    })
  } catch (err) {
    console.error('[public-tour] list failed:', err.message)
    res.status(500).json({ error: 'internal error' })
  }
})

// GET /public/tour/:token/employees -> the location's Day One booking team member
// list (matches the GHL field), A-Z. Falls back to the ABC employees table.
router.get('/:token/employees', async (req, res) => {
  try {
    const ctx = await resolveToken(req.params.token)
    if (!ctx) return res.status(404).json({ error: 'not found' })

    let names = null
    try {
      names = await rosterFromGHL(ctx.location.name)
    } catch (err) {
      console.error('[public-tour] GHL roster failed, falling back to table:', err.message)
    }
    if (!names || names.length === 0) {
      names = await rosterFromTable(ctx.location.name)
    }

    // The id was the array position, which identifies nothing and changes the
    // moment somebody joins or leaves. Carry the ABC employee id where the name
    // resolves to exactly one person, so the picker has something stable to send
    // and to show. Falls back to the name, which is what it always was.
    const club = clubNumberForLocationName(ctx.location.name)
    // One read for the whole roster, not one per name.
    let ids = new Map()
    try {
      if (club) ids = await employeeIdMap(club)
    } catch (err) {
      // A picker of names still works; only the id is lost.
      console.error('[public-tour] employee id map failed:', err.message)
    }

    const employees = [...new Set(names)]
      .filter(Boolean)
      .sort((a, b) => a.localeCompare(b))
      .map(name => ({ id: ids.get(normalizeName(name)) || name, name }))
    res.json({ employees })
  } catch (err) {
    console.error('[public-tour] employees failed:', err.message)
    res.status(500).json({ error: 'internal error' })
  }
})

// PATCH /public/tour/:token/intake/:id -> save outcome, complete, fire webhook
router.patch('/:token/intake/:id', async (req, res) => {
  try {
    const ctx = await resolveToken(req.params.token)
    if (!ctx) return res.status(404).json({ error: 'not found' })

    const {
      tour_member, outcome, notes, status, referring_member_id, referring_member_name,
      // Set by the app when the outcome granted a pass. The length is chosen in
      // the UI (or fixed per outcome), so the server cannot derive it.
      pass_days,
      // VIP referral, captured when the outcome is a VIP pass. All optional:
      // staff answer what the member actually knows.
      referred_by_full_name, referred_by_abc_id, vip_team_member,
    } = req.body || {}
    const cancelled = status === 'cancelled'
    if (!cancelled && !ALLOWED_OUTCOMES.includes(outcome)) {
      return res.status(400).json({ error: 'invalid outcome' })
    }

    // Confirm the intake belongs to this token's location before mutating.
    const { data: existing } = await supabaseAdmin
      .from('tour_intakes')
      .select(SELECT_COLS)
      .eq('id', req.params.id)
      .maybeSingle()
    if (!existing || existing.location_id !== ctx.location.id) {
      return res.status(404).json({ error: 'not found' })
    }

    // Stamp the referral onto the GHL contact before the row goes. Only
    // non-empty values are written, so leaving a question blank never clears
    // something already on the record.
    //
    // The card may carry no contact id at all: a kiosk check-in announces the
    // arrival before anything has mapped the person to a GHL contact, so every
    // kiosk card has ghl_contact_id null. Look it up by email or phone -- by the
    // time staff complete the tour the contact exists.
    let contactId = existing.ghl_contact_id || null
    let abcId = withAbcId(existing).abc_member_id
    let memberStatus = null
    const hasAnswers = !!(referred_by_full_name || referred_by_abc_id || vip_team_member)
    const loc = getLocationBySlug((ctx.location.name || '').trim().toLowerCase())
    const clubNumber = clubNumberForLocationName(ctx.location.name)

    // Resolve BOTH ids on every completion, not only when a referral needs
    // somewhere to land.
    //
    // These two columns are the whole reason a tour row is worth keeping: without
    // the ABC id a tour cannot be followed through to a membership, and without
    // the GHL contact nothing downstream has anybody to act on. A tour recorded
    // with neither is a tally.
    //
    // Neither arrives on its own. A GHL-survey card never carries an ABC id --
    // the card is written ~20 seconds before the ABC record exists. A kiosk card
    // never carries a GHL contact id, and only gets its ABC id if the member
    // finishes the waiver before staff press save, which is a race staff have no
    // idea they are running. Resolving here removes the ordering question
    // entirely: by the time a tour is being completed, both records exist.
    if (!cancelled) {
      if (!contactId && loc) {
        contactId = await resolveGhlContactId({
          locationId: loc.id, apiKey: loc.apiKey,
          email: existing.contact_email, phone: existing.contact_phone,
        })
        if (contactId) {
          console.log(`[public-tour] resolved GHL contact ${contactId} for ${existing.id}`)
        }
      }
      if (!abcId && clubNumber) {
        const found = await resolveAbcId(clubNumber, {
          phone: existing.contact_phone, email: existing.contact_email,
        })
        if (found) {
          abcId = found.id
          memberStatus = found.status || null
          console.log(`[public-tour] resolved ABC ${found.type} ${found.id} for ${existing.id}`)
        } else {
          // Not an error -- a walk-in with neither record yet is a real tour --
          // but it is the row that will read N/A in every conversion report, so
          // say so rather than leaving it to be discovered in a dashboard.
          console.warn(
            `[public-tour] no ABC record for ${existing.id} ` +
            `(email=${existing.contact_email || 'none'} phone=${existing.contact_phone || 'none'})`
          )
        }
      }
    }

    // The kiosk stamps its match straight into `raw`, so the resolver above never
    // runs for a kiosk card and the status would be missed on exactly the cards
    // most likely to be an existing member.
    if (!cancelled && abcId && memberStatus === null && clubNumber) {
      const { data } = await supabaseAdmin
        .from('abc_members')
        .select('member_status')
        .eq('member_id', abcId)
        .eq('club_number', String(clubNumber))
        .maybeSingle()
      memberStatus = (data && data.member_status) || null
    }

    if (!cancelled && memberStatus && /^active$/i.test(memberStatus)) {
      // Recorded, not refused. Staff are standing with somebody and blocking the
      // save would push them to work around it; the report can exclude the row.
      console.warn(
        `[public-tour] tour completed for an ACTIVE member: ${existing.id} abc=${abcId}`
      )
    }

    if (!cancelled && hasAnswers) {
      // Every one of these was previously a silent return. Staff had answered
      // the questions and nothing anywhere said why the answers stopped.
      if (!loc) {
        console.error(`[public-tour] referral skipped: no GHL config for ${ctx.location.name}`)
      } else if (!contactId) {
        console.error(
          `[public-tour] referral skipped: no GHL contact for ${existing.id} ` +
          `(email=${existing.contact_email || 'none'} phone=${existing.contact_phone || 'none'})`
        )
      } else {
        const r = await writeReferral(
          { locationId: loc.id, apiKey: loc.apiKey, contactId },
          {
            fullName: referred_by_full_name,
            abcId: referred_by_abc_id,
            teamMember: vip_team_member,
          }
        )
        if (!r.ok) console.error('[public-tour] referral write failed:', r.error)
        else if (r.written.length) {
          console.log(`[public-tour] referral written ${r.written.join(', ')} for ${existing.id}`)
        } else {
          console.error(`[public-tour] referral resolved no fields for ${existing.id}`)
        }
      }
    }

    // Fire the outbound per-location webhook with the final outcome (it carries
    // everything downstream needs), THEN delete the row. The iPad is a transient
    // queue: completed tours are not retained and there is no Completed tab.
    if (ctx.cfg.webhook_url && !cancelled) {
      const payload = buildTourWebhookPayload(ctx.location, {
        ...existing,
        // The resolved one when the card carried none, so a kiosk check-in
        // reaches the workflow with a contact to act on rather than a null.
        ghl_contact_id: contactId,
        tour_member: tour_member || null,
        outcome,
        notes: notes || null,
        referring_member_id: referring_member_id || null,
        referring_member_name: referring_member_name || null,
        pass_days: pass_days ?? null,
        referred_by_full_name: referred_by_full_name || null,
        referred_by_abc_id: referred_by_abc_id || null,
        vip_team_member: vip_team_member || null,
        completed_at: new Date().toISOString(),
      })
      // The outbound body is not observable from our side once it reaches GHL,
      // so log the fields that decide a workflow. Without this, "it came through
      // null" cannot be traced to the app, this route, or a stale bundle.
      console.log(
        `[public-tour] completed ${ctx.location.name} intake=${existing.id} ` +
        `outcome=${JSON.stringify(outcome)} pass_days=${JSON.stringify(payload.pass_days)}`
      )
      fetch(ctx.cfg.webhook_url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      }).catch(e => console.error('[public-tour] webhook post failed:', e.message))
    }

    // Completed tours USED TO BE DELETED here, on the reasoning that the iPad is
    // a transient queue and the outbound webhook is the record on the way out.
    // That quietly meant no tour has ever been recorded: the Analytics reports
    // read tour_intakes and every row was gone seconds after it was written.
    //
    // The row is kept and marked completed instead. The queue already filters on
    // status = 'ready', so nothing changes at the desk.
    //
    // A cancel still deletes: somebody who walked out before being seen is not a
    // tour, and keeping the card would leave the queue growing with people who
    // were never toured.
    if (cancelled) {
      const { error } = await supabaseAdmin
        .from('tour_intakes')
        .delete()
        .eq('id', req.params.id)
      if (error) {
        console.error('[public-tour] delete failed:', error.message)
        return res.status(500).json({ error: 'failed to save' })
      }
      return res.json({ success: true })
    }

    // The columns reporting needs, which only this route is in a position to
    // fill in: which club, who gave the tour, and how long a pass they handed
    // out. club_number comes from the location rather than the request -- the
    // token already fixes which club this is, and taking it from the body would
    // let a card be filed under a gym it never happened at.
    const { error } = await supabaseAdmin
      .from('tour_intakes')
      .update({
        status: 'completed',
        outcome,
        notes: notes || null,
        tour_member: tour_member || null,
        given_by_name: tour_member || null,
        // The stable half of "who gave the tour". A name survives neither two
        // staff sharing one nor one staffer changing theirs.
        given_by_employee_id: await resolveEmployeeId(clubNumber, tour_member),
        club_number: clubNumber,
        pass_days: pass_days ?? null,
        ghl_contact_id: contactId,
        // Whatever the kiosk stamped into `raw`, or what we just resolved. It
        // is the only field that lets a tour be joined to membership.
        abc_member_id: abcId,
        // Whether this was already a member, kept whole rather than as a boolean:
        // a CANCELLED member being toured is a win-back and still counts.
        member_status_at_tour: memberStatus,
        completed_at: new Date().toISOString(),
      })
      .eq('id', req.params.id)
    if (error) {
      console.error('[public-tour] complete failed:', error.message)
      return res.status(500).json({ error: 'failed to save' })
    }

    res.json({ success: true })
  } catch (err) {
    console.error('[public-tour] patch error:', err.message)
    res.status(500).json({ error: 'internal error' })
  }
})

// POST /public/tour/:token/subscribe -> register this iPad's Web Push subscription
// for the token's location. Idempotent on endpoint (re-subscribing updates keys
// and can move a device to a new location).
// POST /public/tour/:token/intake/:id/trial-days  { days }
//
// Give a returning prospect more trial days from the front-desk queue. Proxied
// through here rather than called from the browser so the location token still
// gates it, and so the prospects service's URL and secret stay server-side.
//
// PROSPECTS ONLY. ABC gives us no writable agreement route for real members, so
// a member comes back as not_a_prospect and staff handle it at the desk.
router.post('/:token/intake/:id/trial-days', async (req, res) => {
  try {
    const ctx = await resolveToken(req.params.token)
    if (!ctx) return res.status(404).json({ error: 'not found' })

    const days = Number((req.body || {}).days)
    if (!Number.isInteger(days) || days < 1 || days > 90) {
      return res.status(400).json({ error: 'Enter between 1 and 90 days.' })
    }

    const { data: intake } = await supabaseAdmin
      .from('tour_intakes')
      .select('id, location_id, raw, contact_phone, contact_email')
      .eq('id', req.params.id)
      .maybeSingle()
    if (!intake || intake.location_id !== ctx.location.id) {
      return res.status(404).json({ error: 'not found' })
    }

    const clubNumber = clubNumberForLocationName(ctx.location.name)
    if (!clubNumber) return res.status(400).json({ error: 'no club mapped for this location' })

    // The kiosk stamps an id when it raises the card. A GHL-survey card never
    // does -- the survey fires this webhook and the ABC create at the same
    // moment, so the card is written before the record exists. Staff tap this
    // minutes later, by which point it does, so look them up instead of
    // refusing.
    let prospectId =
      (intake.raw && (intake.raw.abc_member_id || intake.raw.abcMemberId)) || null

    if (!prospectId) {
      const found = await resolveAbcId(clubNumber, {
        phone: intake.contact_phone,
        email: intake.contact_email,
      })
      prospectId = found && found.id
    }

    if (!prospectId) {
      return res.status(400).json({
        error: 'Could not find them in ABC by phone or email, so there is nothing to extend.',
      })
    }

    const base = (process.env.PROSPECTS_API_URL || 'https://prospects-documents.onrender.com')
      .replace(/\/$/, '')
    const slug = ctx.location.name.trim().toLowerCase()

    const r = await fetch(base + '/api/kiosk/extend-trial', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ location: slug, prospectId, days }),
    })
    const data = await r.json().catch(() => ({}))

    if (!r.ok) {
      return res.status(502).json({ error: data.error || 'Could not update ABC.' })
    }

    res.json(data)
  } catch (err) {
    console.error('[public-tour] trial-days failed:', err.message)
    res.status(500).json({ error: 'internal error' })
  }
})

// GET /public/tour/:token/intake/:id/referral
//
// What the contact already says about who sent them. Fetched when staff open a
// card rather than with the queue: it is one GHL call per person and only the
// VIP outcome needs it.
router.get('/:token/intake/:id/referral', async (req, res) => {
  try {
    const ctx = await resolveToken(req.params.token)
    if (!ctx) return res.status(404).json({ error: 'not found' })

    const { data: intake } = await supabaseAdmin
      .from('tour_intakes')
      .select('id, location_id, ghl_contact_id, contact_email, contact_phone')
      .eq('id', req.params.id)
      .maybeSingle()
    if (!intake || intake.location_id !== ctx.location.id) {
      return res.status(404).json({ error: 'not found' })
    }

    const loc = getLocationBySlug((ctx.location.name || '').trim().toLowerCase())
    if (!loc) {
      return res.json({ fullName: '', abcId: '', teamMember: '', known: false })
    }

    // Kiosk cards carry no contact id, so without this the prompts would come up
    // blank even for somebody whose referrer GHL already knows.
    const contactId = intake.ghl_contact_id || await resolveGhlContactId({
      locationId: loc.id, apiKey: loc.apiKey,
      email: intake.contact_email, phone: intake.contact_phone,
    })
    if (!contactId) {
      // No contact to read. Not an error: staff simply get the blank prompts.
      return res.json({ fullName: '', abcId: '', teamMember: '', known: false })
    }

    const referral = await readReferral({
      locationId: loc.id, apiKey: loc.apiKey, contactId,
    })
    res.json({ ...referral, known: true })
  } catch (err) {
    console.error('[public-tour] referral read failed:', err.message)
    // Degrade to the prompts rather than blocking the tour on a GHL hiccup.
    res.json({ fullName: '', abcId: '', teamMember: '', known: false })
  }
})

// GET /public/tour/:token/intake/:id/abc-status
//
// Whether this card is somebody who already trains here, answered when staff
// OPEN the card rather than when they save it. A warning after the fact is no
// use -- by then the tour is recorded and the number is already wrong.
//
// Deliberately not part of the queue list: that would be one ABC lookup per card
// on a 2-second poll, to answer a question that only matters for the one card
// somebody is actually looking at.
router.get('/:token/intake/:id/abc-status', async (req, res) => {
  const unknown = { type: null, status: null, isActiveMember: false }
  try {
    const ctx = await resolveToken(req.params.token)
    if (!ctx) return res.status(404).json({ error: 'not found' })

    const { data: intake } = await supabaseAdmin
      .from('tour_intakes')
      .select('id, location_id, contact_email, contact_phone, raw')
      .eq('id', req.params.id)
      .maybeSingle()
    if (!intake || intake.location_id !== ctx.location.id) {
      return res.status(404).json({ error: 'not found' })
    }

    const clubNumber = clubNumberForLocationName(ctx.location.name)
    if (!clubNumber) return res.json(unknown)

    let id = withAbcId(intake).abc_member_id
    let type = id ? 'member' : null
    let status = null

    if (!id) {
      const found = await resolveAbcId(clubNumber, {
        phone: intake.contact_phone, email: intake.contact_email,
      })
      if (!found) return res.json(unknown)
      id = found.id
      type = found.type
      status = found.status || null
    }

    if (type === 'member' && status === null) {
      const { data } = await supabaseAdmin
        .from('abc_members')
        .select('member_status')
        .eq('member_id', id)
        .eq('club_number', String(clubNumber))
        .maybeSingle()
      status = (data && data.member_status) || null
      if (!data) type = 'prospect'
    }

    res.json({ type, status, isActiveMember: !!status && /^active$/i.test(status) })
  } catch (err) {
    console.error('[public-tour] abc-status failed:', err.message)
    // Never block a check-in on this: an unknown answer shows no banner.
    res.json(unknown)
  }
})

// GET /public/tour/:token/member-search?q=
//
// Backs the "who referred you" picker. Uses our synced abc_members rather than
// ABC, which ignores every name filter it is given.
router.get('/:token/member-search', async (req, res) => {
  try {
    const ctx = await resolveToken(req.params.token)
    if (!ctx) return res.status(404).json({ error: 'not found' })

    const clubNumber = clubNumberForLocationName(ctx.location.name)
    if (!clubNumber) return res.json({ members: [] })

    const members = await searchMembersByName(clubNumber, req.query.q)
    res.json({ members })
  } catch (err) {
    console.error('[public-tour] member search failed:', err.message)
    res.json({ members: [] })
  }
})

router.post('/:token/subscribe', async (req, res) => {
  try {
    const ctx = await resolveToken(req.params.token)
    if (!ctx) return res.status(404).json({ error: 'not found' })

    const sub = (req.body && req.body.subscription) || req.body || {}
    const endpoint = sub.endpoint
    const p256dh = sub.keys && sub.keys.p256dh
    const auth = sub.keys && sub.keys.auth
    if (!endpoint || !p256dh || !auth) {
      return res.status(400).json({ error: 'invalid subscription' })
    }

    const { error } = await supabaseAdmin
      .from('tour_push_subscriptions')
      .upsert({
        location_id: ctx.location.id,
        endpoint,
        p256dh,
        auth,
        last_seen: new Date().toISOString(),
      }, { onConflict: 'endpoint' })
    if (error) {
      console.error('[public-tour] subscribe failed:', error.message)
      return res.status(500).json({ error: 'failed to subscribe' })
    }
    res.json({ success: true })
  } catch (err) {
    console.error('[public-tour] subscribe error:', err.message)
    res.status(500).json({ error: 'internal error' })
  }
})

// ---------------------------------------------------------------------------
// PROTOTYPE: ABC contact lookup — LIVE ABC API search (members + prospects).
// Token-gated like the rest of /public/tour. Needs ABC_APP_ID / ABC_APP_KEY in
// the auth env. NOTE: prototype — exposes ABC contact PII to anyone with the
// (unguessable) tour token; a production version should tighten scope/auth.
// ---------------------------------------------------------------------------
const { abcConfigured, searchAbc } = require('../lib/abcSearch')
const { NAME_TO_CLUB } = require('../config/clubMap')

// GET /public/tour/:token/abc-search?firstName=&lastName=&email=&club=
// Live ABC search across members + prospects. Defaults to the token's location
// club; pass club=<number> for one club or club=all for every club.
router.get('/:token/abc-search', async (req, res) => {
  try {
    const ctx = await resolveToken(req.params.token)
    if (!ctx) return res.status(404).json({ error: 'not found' })
    if (!abcConfigured()) {
      return res.status(503).json({ error: 'ABC not configured (set ABC_APP_ID / ABC_APP_KEY on the auth service)' })
    }

    const q = {
      firstName: (req.query.firstName || '').toString().trim(),
      lastName: (req.query.lastName || '').toString().trim(),
      email: (req.query.email || '').toString().trim(),
    }
    if (!q.firstName && !q.lastName && !q.email) return res.json({ results: [], errors: [] })

    const reqClub = (req.query.club || '').toString().trim()
    let clubs
    if (reqClub === 'all') clubs = [...new Set(Object.values(NAME_TO_CLUB))]
    else if (reqClub) clubs = [reqClub]
    else { const c = clubNumberForLocationName(ctx.location.name); clubs = c ? [c] : [] }
    if (!clubs.length) return res.status(400).json({ error: 'no club mapped for this location' })

    const { results, errors } = await searchAbc(clubs, q)
    res.json({ results, errors })
  } catch (err) {
    console.error('[public-tour] abc-search error:', err.message)
    res.status(500).json({ error: 'internal error' })
  }
})

// GET /public/tour/:token/abc-search-test -> a self-contained test page (same
// origin as the search endpoint, so no CORS). Open it in a browser to try it.
router.get('/:token/abc-search-test', async (req, res) => {
  const ctx = await resolveToken(req.params.token)
  if (!ctx) return res.status(404).send('not found')
  const tokenJson = JSON.stringify(req.params.token)
  const locClub = JSON.stringify(clubNumberForLocationName(ctx.location.name) || '')
  const locName = JSON.stringify(ctx.location.name || '')
  const clubsJson = JSON.stringify(NAME_TO_CLUB)
  res.set('Content-Type', 'text/html; charset=utf-8')
  res.send(`<!doctype html>
<html lang="en"><head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>ABC Contact Lookup (test)</title>
<style>
  * { box-sizing: border-box; }
  body { margin:0; font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif; background:#f3f4f6; color:#111827; }
  .wrap { max-width:760px; margin:0 auto; padding:20px; }
  h1 { font-size:20px; margin:0 0 4px; }
  .sub { color:#6b7280; font-size:13px; margin:0 0 16px; }
  .fields { display:grid; grid-template-columns:1fr 1fr; gap:10px; }
  input, select { width:100%; padding:12px 14px; font-size:16px; border:1px solid #d1d5db; border-radius:10px; outline:none; background:#fff; }
  input:focus, select:focus { border-color:#dc2626; }
  .full { grid-column:1 / -1; }
  button { grid-column:1 / -1; padding:13px; font-size:16px; font-weight:600; color:#fff; background:#dc2626; border:0; border-radius:10px; }
  button:disabled { opacity:.6; }
  .status { color:#6b7280; font-size:13px; margin:14px 2px; }
  .err { color:#b91c1c; font-size:12px; margin:6px 2px; }
  .card { background:#fff; border:1px solid #e5e7eb; border-radius:14px; padding:14px 16px; margin-top:12px; box-shadow:0 1px 2px rgba(0,0,0,.04); }
  .row1 { display:flex; align-items:center; justify-content:space-between; gap:10px; }
  .name { font-size:17px; font-weight:600; }
  .badges { display:flex; gap:6px; flex-wrap:wrap; }
  .b { font-size:11px; font-weight:600; padding:3px 9px; border-radius:999px; border:1px solid; }
  .b.green { background:#ecfdf5; color:#047857; border-color:#a7f3d0; }
  .b.blue { background:#eff6ff; color:#1d4ed8; border-color:#bfdbfe; }
  .b.gray { background:#f3f4f6; color:#374151; border-color:#e5e7eb; }
  .meta { color:#374151; font-size:13px; margin-top:8px; display:grid; grid-template-columns:1fr 1fr; gap:4px 16px; }
  .meta b { color:#6b7280; font-weight:500; }
</style></head><body>
<div class="wrap">
  <h1>ABC Contact Lookup <span style="color:#dc2626">(test)</span></h1>
  <p class="sub">Live ABC search — members <b>and</b> prospects. Fill any field(s) and Search.</p>
  <div class="fields">
    <input id="firstName" placeholder="First name" autocomplete="off" />
    <input id="lastName" placeholder="Last name" autocomplete="off" />
    <input id="email" class="full" placeholder="Email" autocomplete="off" autocapitalize="off" />
    <select id="club" class="full"></select>
    <button id="go">Search ABC</button>
  </div>
  <div class="status" id="status">Enter a name or email, then Search.</div>
  <div id="errors"></div>
  <div id="results"></div>
</div>
<script>
  var TOKEN = ${tokenJson};
  var LOC_CLUB = ${locClub};
  var LOC_NAME = ${locName};
  var CLUBS = ${clubsJson};
  var clubToName = {}; for (var k in CLUBS) clubToName[CLUBS[k]] = k.charAt(0).toUpperCase()+k.slice(1);
  var statusEl = document.getElementById('status');
  var errEl = document.getElementById('errors');
  var resultsEl = document.getElementById('results');
  var goEl = document.getElementById('go');

  // Build the club dropdown: this location first, then each club, then All clubs.
  (function(){
    var sel = document.getElementById('club'), opts = '';
    if (LOC_CLUB) opts += '<option value="'+LOC_CLUB+'">'+ (clubToName[LOC_CLUB]||LOC_NAME) +' (this location)</option>';
    for (var k in CLUBS){ if (CLUBS[k]===LOC_CLUB) continue; opts += '<option value="'+CLUBS[k]+'">'+ (k.charAt(0).toUpperCase()+k.slice(1)) +'</option>'; }
    opts += '<option value="all">All clubs (slower)</option>';
    sel.innerHTML = opts;
  })();

  function esc(s){ return (s==null?'':String(s)).replace(/[&<>"]/g, function(c){ return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]; }); }
  function d(s){ return s ? String(s).slice(0,10) : '-'; }
  function card(m){
    var name = esc((m.firstName||'') + ' ' + (m.lastName||'')).trim() || 'Unknown';
    var typeB = '<span class="b ' + (m.type==='member'?'green':'blue') + '">' + (m.type==='member'?'Member':'Prospect') + '</span>';
    var statB = m.status ? '<span class="b gray">' + esc(m.status) + '</span>' : '';
    var h = '<div class="card"><div class="row1"><div class="name">' + name + '</div><div class="badges">' + typeB + statB + '</div></div>';
    h += '<div class="meta">';
    h += '<div><b>Club</b> ' + esc(clubToName[m.club] || m.club) + '</div>';
    h += '<div><b>Email</b> ' + esc(m.email || '-') + '</div>';
    h += '<div><b>Phone</b> ' + esc(m.phone || '-') + '</div>';
    if (m.type === 'member') {
      h += '<div><b>Membership</b> ' + esc(m.membershipType || '-') + '</div>';
      h += '<div><b>Barcode</b> ' + esc(m.barcode || '-') + '</div>';
      h += '<div><b>Last check-in</b> ' + d(m.lastCheckIn) + '</div>';
    } else {
      h += '<div><b>Created</b> ' + d(m.createTimestamp) + '</div>';
    }
    if (m.salesPerson) h += '<div><b>Sales</b> ' + esc(m.salesPerson) + '</div>';
    h += '</div></div>';
    return h;
  }
  function run(){
    var fn = document.getElementById('firstName').value.trim();
    var ln = document.getElementById('lastName').value.trim();
    var em = document.getElementById('email').value.trim();
    var club = document.getElementById('club').value;
    if (!fn && !ln && !em){ statusEl.textContent = 'Enter a name or email, then Search.'; return; }
    goEl.disabled = true; errEl.innerHTML = ''; resultsEl.innerHTML = '';
    statusEl.textContent = 'Searching ABC' + (club==='all' ? ' (all clubs)…' : '…');
    var url = '/public/tour/' + encodeURIComponent(TOKEN) + '/abc-search?firstName=' + encodeURIComponent(fn) +
      '&lastName=' + encodeURIComponent(ln) + '&email=' + encodeURIComponent(em) + '&club=' + encodeURIComponent(club);
    fetch(url).then(function(r){ return r.json(); }).then(function(j){
      goEl.disabled = false;
      if (j && j.error){ statusEl.textContent = j.error; return; }
      var rs = (j && j.results) || [];
      rs.sort(function(a,b){ return (a.type===b.type)?0:(a.type==='member'?-1:1); });
      statusEl.textContent = rs.length ? (rs.length + ' result' + (rs.length===1?'':'s')) : 'No matches.';
      if (j && j.errors && j.errors.length) errEl.innerHTML = '<div class="err">Some sources errored: ' + esc(j.errors.join(' · ')) + '</div>';
      resultsEl.innerHTML = rs.map(card).join('');
    }).catch(function(){ goEl.disabled = false; statusEl.textContent = 'Search failed.'; });
  }
  goEl.addEventListener('click', run);
  ['firstName','lastName','email'].forEach(function(id){
    document.getElementById(id).addEventListener('keydown', function(e){ if (e.key==='Enter') run(); });
  });
  document.getElementById('firstName').focus();
</script>
</body></html>`)
})

module.exports = router
