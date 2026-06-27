const express = require('express')
const { Router } = require('express')
const { supabaseAdmin } = require('../services/supabase')
const { syncCancelReasonToGhl } = require('../services/click2saveGhlSync')
const { parseWebsiteFormBody } = require('../services/websiteFormParser')
const { slugForOrigin } = require('../config/surveyOrigins')

const router = Router()

// Webhook secret verification middleware
function verifyWebhookSecret(req, res, next) {
  const secret = process.env.GHL_WEBHOOK_SECRET
  if (!secret) return next() // no secret configured, allow (backward compat)
  const provided = req.headers['x-webhook-secret'] || req.query.secret
  if (provided !== secret) {
    return res.status(401).json({ error: 'Invalid webhook secret' })
  }
  next()
}

// Click2Save events use their own optional shared secret so they don't have
// to share a key with the GHL webhooks.
function verifyClick2SaveSecret(req, res, next) {
  const secret = process.env.CLICK2SAVE_WEBHOOK_SECRET
  if (!secret) return next()
  const provided = req.headers['x-webhook-secret'] || req.query.secret
  if (provided !== secret) {
    return res.status(401).json({ error: 'Invalid webhook secret' })
  }
  next()
}

// POST /webhooks/ghl-appointment — GHL fires this when a day-one is booked
router.post('/ghl-appointment', verifyWebhookSecret, async (req, res) => {
  const { staff_email, contact_name, appointment_id, appointment_type, appointment_time, contact_id, form_id } = req.body

  if (!staff_email || !contact_name || !appointment_id) {
    return res.status(400).json({ error: 'Missing required fields' })
  }

  try {
    // Look up staff by email to get their ID and location
    const { data: staff } = await supabaseAdmin
      .from('staff')
      .select('id')
      .eq('email', staff_email)
      .single()

    // Get staff's primary location
    let locationId = null
    if (staff) {
      const { data: staffLoc } = await supabaseAdmin
        .from('staff_locations')
        .select('location_id')
        .eq('staff_id', staff.id)
        .eq('is_primary', true)
        .single()
      if (staffLoc) locationId = staffLoc.location_id
    }

    // Build GHL form URL
    const formUrl = form_id ? 'https://link.westcoaststrength.com/widget/form/' + form_id : null

    const { data, error } = await supabaseAdmin
      .from('appointments')
      .upsert({
        ghl_appointment_id: appointment_id,
        staff_id: staff?.id || null,
        staff_email,
        contact_name,
        contact_id: contact_id || null,
        appointment_type: appointment_type || 'DAYONE',
        appointment_time: appointment_time || null,
        form_url: formUrl,
        status: 'pending',
        location_id: locationId,
      }, { onConflict: 'ghl_appointment_id' })
      .select()
      .single()

    if (error) {
      console.error('Webhook error:', error.message)
      return res.status(500).json({ error: 'Failed to create appointment' })
    }

    res.json({ success: true, appointment_id: data.id })
  } catch (err) {
    console.error('Webhook error:', err.message)
    res.status(500).json({ error: 'Internal error' })
  }
})

// POST /webhooks/ghl-form-complete — GHL fires this when the form is submitted
router.post('/ghl-form-complete', verifyWebhookSecret, async (req, res) => {
  const { appointment_id, contact_id, sale_result } = req.body

  if (!appointment_id) {
    return res.status(400).json({ error: 'appointment_id is required' })
  }

  try {
    const { error } = await supabaseAdmin
      .from('appointments')
      .update({
        status: 'completed',
        sale_result: sale_result || null,
        completed_at: new Date().toISOString(),
      })
      .eq('ghl_appointment_id', appointment_id)

    if (error) {
      return res.status(500).json({ error: 'Failed to update appointment' })
    }

    res.json({ success: true })
  } catch (err) {
    res.status(500).json({ error: 'Internal error' })
  }
})

// POST /webhooks/click2save — forwarded from prospects---documents service
// after Click2Save signature/timestamp/payload validation. Persists each
// event to click2save_events for retention/save reporting. Idempotent on
// requestId.
router.post('/click2save', verifyClick2SaveSecret, async (req, res) => {
  const event = req.body
  if (!event || typeof event !== 'object') {
    return res.status(400).json({ error: 'invalid body' })
  }
  if (!event.requestId || !event.requestType) {
    return res.status(400).json({ error: 'missing requestId or requestType' })
  }

  try {
    const { error } = await supabaseAdmin
      .from('click2save_events')
      .upsert({
        request_id: event.requestId,
        request_type: event.requestType,
        occurred_at: event.occurredAt || null,
        producer: event.producer || null,
        club_code: event.data?.clubCode || null,
        member_id: event.data?.member?.memberId || null,
        member_email: event.data?.member?.email || null,
        member_barcode: event.data?.member?.barcode || null,
        agreement_id: event.data?.member?.agreementId || null,
        result_status: event.data?.result?.status || null,
        event_data: event,
      }, { onConflict: 'request_id' })

    if (error) {
      console.error('click2save webhook persist error:', error.message)
      return res.status(500).json({ error: 'failed to persist event' })
    }

    // Fire-and-forget downstream side effect: upsert GHL "Cancel Reason"
    // custom field on the contact for CANCEL events. Never blocks the 200.
    syncCancelReasonToGhl(event)

    res.json({ success: true, requestId: event.requestId })
  } catch (err) {
    console.error('click2save webhook error:', err.message)
    res.status(500).json({ error: 'internal error' })
  }
})

// POST /webhooks/website-form — public website forms POST here directly.
// HTML <form> can't set custom headers, so the shared secret travels as a
// query-string param. Content-Type is application/x-www-form-urlencoded
// (default for HTML forms), which is why this route mounts its own
// urlencoded body parser instead of using the app-wide express.json().
router.post(
  '/website-form',
  express.urlencoded({ extended: true, limit: '64kb' }),
  async (req, res) => {
    const secret = process.env.WEBSITE_FORM_WEBHOOK_SECRET
    if (!secret) {
      console.error('[website-form] WEBSITE_FORM_WEBHOOK_SECRET not configured')
      return res.status(503).json({ error: 'webhook not configured' })
    }
    if (req.query.secret !== secret) {
      return res.status(401).json({ error: 'invalid secret' })
    }

    const body = req.body
    if (!body || typeof body !== 'object' || Object.keys(body).length === 0) {
      return res.status(400).json({ error: 'empty body' })
    }

    const parsed = parseWebsiteFormBody(body)
    if (!parsed) {
      return res.status(400).json({ error: 'unparseable body' })
    }

    try {
      const { data, error } = await supabaseAdmin
        .from('website_submissions')
        .insert({
          form_id: parsed.form_id,
          form_name: parsed.form_name,
          location: parsed.location,
          first_name: parsed.first_name,
          last_name: parsed.last_name,
          email: parsed.email,
          phone: parsed.phone,
          message: parsed.message,
          opt_in: parsed.opt_in,
          raw: parsed.raw,
        })
        .select('id')
        .single()

      if (error) {
        console.error('[website-form] persist failed form_id=' + (parsed.form_id || '(none)') + ':', error.message)
        return res.status(500).json({ error: 'persist failed' })
      }

      res.json({ success: true, id: data.id })
    } catch (err) {
      console.error('[website-form] error form_id=' + (parsed.form_id || '(none)') + ':', err.message)
      res.status(500).json({ error: 'internal error' })
    }
  }
)

// --- Tour intake (front-desk gym-tour queue) ----------------------------
//
// A Go High Level form fires this when a prospect arrives for a gym tour. GHL
// sends the SAME flat payload it sends to prospects-documents/ABC, so this is
// just an additional webhook target on the existing workflow — contact_id at
// the top level, the GHL location as `location.id`, and form/contact fields as
// top-level keys by label. We resolve the location, capture name/email/phone
// (from the payload, falling back to a GHL contact lookup) plus an optional
// base64 profile photo, and insert a `ready` row the iPad queue polls for.
//
// NOTE: the higher-limit JSON body parser for this path is registered in
// index.js (the base64 photo can exceed the global 100kb json limit).

// Pull the first non-empty value across a list of candidate keys.
function pickKey(body, keys) {
  for (const k of keys) {
    const v = body[k]
    if (v !== undefined && v !== null && String(v).trim() !== '') return String(v).trim()
  }
  return ''
}

// Normalize a profile photo into a data URL. GHL may send a bare base64 string
// or an already-formed data URL; anything that isn't base64-ish is dropped.
function normalizePhoto(raw) {
  const v = (raw || '').trim()
  if (!v) return null
  if (v.startsWith('data:image/')) return v
  // Bare base64 (no data-URL prefix) — assume jpeg, the GHL default.
  if (/^[A-Za-z0-9+/=\s]+$/.test(v) && v.length > 100) {
    return 'data:image/jpeg;base64,' + v.replace(/\s+/g, '')
  }
  return null
}

function normEmail(e) { return (e || '').trim().toLowerCase() || null }
function normPhone(p) { const d = (p || '').replace(/\D/g, ''); return d || null }

// Resolve our locations row. The GHL "Survey Submitted" webhook carries
// location.id; the early browser prefire/photo carry only the survey page Origin
// (https://wcssalem.app -> slug 'salem' -> locations.name 'Salem').
async function resolveLocationRow(body, req) {
  const ghlLocationId = body?.location?.id || pickKey(body || {}, ['location_id', 'locationId'])
  if (ghlLocationId) {
    const { data } = await supabaseAdmin
      .from('locations').select('id, name, ghl_api_key')
      .eq('ghl_location_id', ghlLocationId).maybeSingle()
    if (data) return data
  }
  const slug = slugForOrigin(req.headers.origin || req.headers.referer)
  if (slug) {
    const { data } = await supabaseAdmin
      .from('locations').select('id, name, ghl_api_key')
      .ilike('name', slug).maybeSingle()
    if (data) return data
  }
  return null
}

// Find the open (ready) intake for this person within 24h, by normalized email
// then digits-only phone. This merges the early browser prefire, the early photo,
// and the later GHL submit into ONE row instead of duplicating. Email is the
// reliable key (present at the survey step that fires these); phone is the
// fallback. We pull the (small, transient) live queue and match in JS so the
// comparison normalizes BOTH sides — the stored phone is raw/formatted and the
// stored email may be mixed-case, so a DB-side .eq/.ilike would miss or, with an
// address containing _/% , wrong-match.
async function findOpenIntake(email, phone) {
  if (!email && !phone) return null
  const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString()
  const { data } = await supabaseAdmin
    .from('tour_intakes')
    .select('id, photo_base64, location_id, contact_email, contact_phone')
    .eq('status', 'ready').gte('received_at', since)
    .order('received_at', { ascending: false }).limit(200)
  if (!data || !data.length) return null
  if (email) {
    const m = data.find(r => normEmail(r.contact_email) === email)
    if (m) return m
  }
  if (phone) {
    const m = data.find(r => normPhone(r.contact_phone) === phone)
    if (m) return m
  }
  return null
}

// POST /webhooks/tour-intake — early browser prefire AND the GHL "Survey
// Submitted" webhook both hit this. We upsert by email->phone so the prospect
// lands in the iPad queue the moment the survey prefires (speed-to-lead), and the
// later GHL submit merges into the same row rather than creating a duplicate.
router.post('/tour-intake', verifyWebhookSecret, async (req, res) => {
  const body = req.body
  if (!body || typeof body !== 'object') {
    return res.status(400).json({ error: 'invalid body' })
  }

  const contactId = pickKey(body, ['contact_id', 'contactId']) || body.contact?.id || ''
  const locationRow = await resolveLocationRow(body, req)

  // Name / email / phone come straight off the flat payload when present.
  // Fall back to a GHL contact lookup (GHL submit path).
  const first = pickKey(body, ['first_name', 'firstName', 'First Name', 'contact.first_name'])
  const last = pickKey(body, ['last_name', 'lastName', 'Last Name', 'contact.last_name'])
  let name = pickKey(body, ['full_name', 'fullName', 'name', 'Full Name', 'contact.full_name']) ||
    [first, last].filter(Boolean).join(' ').trim()
  let email = pickKey(body, ['email', 'Email', 'contact.email'])
  let phone = pickKey(body, ['phone', 'Phone', 'contact.phone'])

  if ((!name || !email || !phone) && contactId && locationRow?.ghl_api_key) {
    try {
      const cRes = await fetch('https://services.leadconnectorhq.com/contacts/' + contactId, {
        headers: { 'Authorization': 'Bearer ' + locationRow.ghl_api_key, 'Version': '2021-04-15' },
      })
      if (cRes.ok) {
        const cData = await cRes.json()
        const c = cData.contact || cData
        const ghlName = [c.firstName, c.lastName].filter(Boolean).join(' ').trim()
        name = name || ghlName || c.name || ''
        email = email || c.email || ''
        phone = phone || c.phone || ''
      }
    } catch (err) {
      // Non-fatal — fall through with whatever the payload gave us.
      console.error('[tour-intake] GHL contact fetch failed:', err.message)
    }
  }

  const photo = normalizePhoto(
    pickKey(body, ['Member Profile Photo', 'photo_base64', 'photo', 'Photo', 'Profile Photo', 'profile_photo', 'image', 'Image'])
  )

  try {
    const existing = await findOpenIntake(normEmail(email), normPhone(phone))

    if (existing) {
      // Merge into the open row. Never disturb status/outcome/tour_member/notes
      // (a staffer may already be working it) and never overwrite a non-empty photo.
      const patch = {}
      if (name) patch.contact_name = name
      if (email) patch.contact_email = email
      if (phone) patch.contact_phone = phone
      if (contactId) patch.ghl_contact_id = contactId
      if (!existing.location_id && locationRow?.id) patch.location_id = locationRow.id
      if (photo && !existing.photo_base64) patch.photo_base64 = photo
      if (Object.keys(patch).length) {
        await supabaseAdmin.from('tour_intakes').update(patch).eq('id', existing.id)
      }
      return res.json({ success: true, id: existing.id, merged: true })
    }

    // New prospect -> create the live queue row immediately (speed-to-lead).
    // TODO: kick off speed-to-lead first-touch here (Twilio first text / GHL
    // workflow) so outreach starts the instant the survey prefires.
    const { data, error } = await supabaseAdmin
      .from('tour_intakes')
      .insert({
        ghl_contact_id: contactId || null,
        contact_name: name || null,
        contact_email: email || null,
        contact_phone: phone || null,
        photo_base64: photo,
        location_id: locationRow?.id || null,
        status: 'ready',
        raw: body,
      })
      .select('id')
      .single()

    if (error) {
      console.error('[tour-intake] persist failed:', error.message)
      return res.status(500).json({ error: 'failed to persist intake' })
    }

    res.json({ success: true, id: data.id })
  } catch (err) {
    console.error('[tour-intake] error:', err.message)
    res.status(500).json({ error: 'internal error' })
  }
})

// POST /webhooks/tour-intake-photo — the survey page sends the base64 profile
// photo early (separately from the text prefire). Attach it to the open intake
// (matched by email->phone); if the photo beats the text, create a minimal row so
// the later text/submit merges into it. Stored as a data URL in photo_base64.
router.post('/tour-intake-photo', verifyWebhookSecret, async (req, res) => {
  const body = req.body
  if (!body || typeof body !== 'object') {
    return res.status(400).json({ error: 'invalid body' })
  }

  const email = pickKey(body, ['email', 'Email', 'contact.email'])
  const phone = pickKey(body, ['phone', 'Phone', 'contact.phone'])
  const photo = normalizePhoto(
    pickKey(body, ['photo_base64', 'photo', 'Member Profile Photo', 'Photo', 'image', 'Image'])
  )
  if (!photo) return res.status(400).json({ error: 'no photo' })

  try {
    const existing = await findOpenIntake(normEmail(email), normPhone(phone))
    if (existing) {
      if (!existing.photo_base64) {
        await supabaseAdmin.from('tour_intakes').update({ photo_base64: photo }).eq('id', existing.id)
      }
      return res.json({ success: true, id: existing.id })
    }

    // Photo arrived before the text prefire — create a minimal row so the later
    // text/submit reconciles into it by email.
    const locationRow = await resolveLocationRow(body, req)
    const { data, error } = await supabaseAdmin
      .from('tour_intakes')
      .insert({
        contact_email: email || null,
        contact_phone: phone || null,
        photo_base64: photo,
        location_id: locationRow?.id || null,
        status: 'ready',
        raw: { source: 'tour-intake-photo' },
      })
      .select('id')
      .single()

    if (error) {
      console.error('[tour-intake-photo] persist failed:', error.message)
      return res.status(500).json({ error: 'failed to persist photo' })
    }
    res.json({ success: true, id: data.id })
  } catch (err) {
    console.error('[tour-intake-photo] error:', err.message)
    res.status(500).json({ error: 'internal error' })
  }
})

module.exports = router
