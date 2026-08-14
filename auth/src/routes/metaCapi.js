const { Router } = require('express')
const crypto = require('crypto')

const router = Router()

// Fail closed: an unset secret must reject, not accept anonymous CAPI events
// that would be forged with the server's Meta access token.
function verifyWebhookSecret(req, res, next) {
  const secret = process.env.GHL_WEBHOOK_SECRET
  if (!secret) {
    console.error('[metaCapi] GHL_WEBHOOK_SECRET not configured')
    return res.status(503).json({ error: 'webhook not configured' })
  }
  const provided = req.headers['x-webhook-secret'] || req.query.secret
  if (provided !== secret) {
    return res.status(401).json({ error: 'Invalid webhook secret' })
  }
  next()
}

function hashData(value) {
  if (!value) return null
  return crypto.createHash('sha256')
    .update(String(value).trim().toLowerCase())
    .digest('hex')
}

// POST /webhooks/meta-lead — proxy GHL workflow events to Meta Conversions API
router.post('/meta-lead', verifyWebhookSecret, async (req, res) => {
  try {
    const {
      firstName,
      lastName,
      email,
      phone,
      city,
      state,
      zip,
      country,
      externalId,
      eventId,
      eventName,
      eventSourceUrl,
      contentName,
      leadEventSource,
      pixelId,
      actionSource,
      value,
      currency,
      clientIpAddress,
      clientUserAgent,
      fbc,
      fbp,
      fbclid,
    } = req.body

    // If fbc isn't provided directly, derive it from fbclid using Meta's spec:
    // fbc = fb.{subdomainIndex}.{creationTimeMs}.{fbclid}
    // Subdomain index 1 = top-level domain (most common). Timestamp = now as a
    // safe fallback when the original click time isn't preserved by GHL.
    let resolvedFbc = fbc
    if (!resolvedFbc && fbclid) {
      resolvedFbc = `fb.1.${Date.now()}.${fbclid}`
    }

    const userData = {}
    if (email)      userData.em          = [hashData(email)]
    if (phone)      userData.ph          = [hashData(phone)]
    if (firstName)  userData.fn          = [hashData(firstName)]
    if (lastName)   userData.ln          = [hashData(lastName)]
    if (city)       userData.ct          = [hashData(city)]
    if (state)      userData.st          = [hashData(state)]
    if (zip)        userData.zp          = [hashData(zip)]
    if (country)    userData.country     = [hashData(country)]
    if (externalId) userData.external_id = [hashData(externalId)]
    if (clientIpAddress) userData.client_ip_address = clientIpAddress
    if (clientUserAgent) userData.client_user_agent = clientUserAgent
    if (resolvedFbc) userData.fbc        = resolvedFbc
    if (fbp)        userData.fbp         = fbp

    const customData = {}
    if (contentName)      customData.content_name      = contentName
    if (leadEventSource)  customData.lead_event_source = leadEventSource
    if (value)            customData.value             = parseFloat(value)
    if (currency)         customData.currency          = currency

    const eventData = {
      event_name:    eventName || 'Lead',
      event_time:    Math.floor(Date.now() / 1000),
      event_id:      eventId,
      action_source: actionSource || 'website',
      user_data:     userData,
      custom_data:   customData,
    }
    if (eventSourceUrl) eventData.event_source_url = eventSourceUrl

    const payload = {
      data: [eventData],
      access_token: process.env.META_ACCESS_TOKEN,
    }

    const targetPixel = pixelId || process.env.META_PIXEL_ID
    const response = await fetch(
      `https://graph.facebook.com/v18.0/${targetPixel}/events`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      }
    )

    const data = await response.json()
    console.log('[meta-capi] response:', data)
    if (!response.ok) {
      return res.status(502).json({ ok: false, meta: data })
    }
    res.json({ ok: true })
  } catch (err) {
    console.error('[meta-capi] error:', err)
    res.status(500).json({ ok: false, error: err.message })
  }
})

/* ---------------------------------------------------------------------
 * POST /meta/lead — Gravity Forms submissions on westcoaststrength.com.
 *
 * The WordPress theme posts the entry here with PII RAW and hashes nothing,
 * so normalization + SHA-256 live in exactly one place (this file). Two
 * hashing implementations drift and silently destroy match quality.
 *
 * Deduplicated against a browser-side pixel fire of the same event: both
 * halves carry the same event_id (a cookie written at form render) and the
 * same content_name. Meta keeps the first event it receives and discards the
 * second along with its parameters, so the two halves must agree.
 * ------------------------------------------------------------------- */

// Standard events only. A typo'd custom name is accepted by Meta and then
// optimizes for nothing, which is worse than a 400 here.
const ALLOWED_EVENT_NAMES = ['Lead', 'Schedule', 'Contact', 'CompleteRegistration']

const CANONICAL_LOCATIONS = [
  'Salem', 'Keizer', 'Eugene', 'Springfield', 'Clackamas', 'Milwaukie', 'Medford',
]

// Fail closed, like verifyWebhookSecret above. Constant-time compare so the
// secret can't be recovered by timing the 401.
function verifyFormSecret(req, res, next) {
  const secret = process.env.WP_META_LEAD_SECRET
  if (!secret) {
    console.error('[meta-lead] WP_META_LEAD_SECRET not configured')
    return res.status(503).json({ error: 'endpoint not configured' })
  }
  const provided = String(req.headers['x-wcs-form-secret'] || '')
  const a = Buffer.from(provided)
  const b = Buffer.from(secret)
  // timingSafeEqual throws on a length mismatch, so compare lengths first —
  // length is not the secret.
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) {
    return res.status(401).json({ error: 'Invalid secret' })
  }
  next()
}

/**
 * Meta wants US numbers as E.164 without the leading plus: 15035551234.
 * Poorly normalized input isn't rejected — it just fails to match, which
 * shows up as a low Event Match Quality score and nothing else.
 */
function normalizePhone(value) {
  let digits = String(value || '').replace(/\D/g, '')
  if (!digits) return null
  // Bare 10-digit US number: add the country code. 11 digits starting with 1
  // is already E.164. Anything else is left as-is — it may be international.
  if (digits.length === 10) digits = '1' + digits
  return digits
}

function normalizeEmail(value) {
  const email = String(value || '').trim().toLowerCase()
  return email || null
}

function normalizeName(value) {
  // Strip punctuation and whitespace the way Meta's own normalization does,
  // so "O'Brien" and "OBrien" hash alike.
  const name = String(value || '').trim().toLowerCase().replace(/[^a-zÀ-ɏ ]/g, '').trim()
  return name || null
}

function sha256(value) {
  return crypto.createHash('sha256').update(String(value)).digest('hex')
}

router.post('/lead', verifyFormSecret, async (req, res) => {
  const {
    event_name,
    event_id,
    event_time,
    location,
    email,
    phone,
    first_name,
    last_name,
    fbp,
    fbc,
    client_ip_address,
    client_user_agent,
    event_source_url,
    form_id,
    entry_id,
  } = req.body || {}

  const tag = `entry=${entry_id ?? '?'} form=${form_id ?? '?'} event_id=${event_id ?? '?'}`

  // --- Validation. Reject garbage here rather than forwarding it to Meta. ---
  if (!ALLOWED_EVENT_NAMES.includes(event_name)) {
    return res.status(400).json({ error: 'invalid event_name' })
  }
  if (!event_id || typeof event_id !== 'string') {
    return res.status(400).json({ error: 'event_id required' })
  }
  const eventTime = Number(event_time)
  const nowSec = Math.floor(Date.now() / 1000)
  // Meta's own window is 7 days; a future timestamp means a clock problem
  // upstream and the event would be dropped anyway.
  if (!Number.isFinite(eventTime) || eventTime > nowSec + 60 || eventTime < nowSec - 7 * 86400) {
    return res.status(400).json({ error: 'event_time missing or outside the last 7 days' })
  }
  if (!email && !phone && !fbp && !fbc) {
    return res.status(400).json({ error: 'no matchable user data' })
  }

  // Location arrives already canonical — WordPress resolves it, including the
  // per-form value map for multi-location forms. Anything unrecognized (or
  // absent, which is the deliberate unmapped path) drops content_category
  // rather than passing free text through to Meta.
  const resolvedLocation = CANONICAL_LOCATIONS.includes(location) ? location : null
  if (location && !resolvedLocation) {
    console.warn(`[meta-lead] ${tag} — unrecognized location "${location}"; sending without content_category`)
  }

  // --- user_data. em/ph/fn/ln hashed; the rest passed through. ---
  const userData = {}
  const normEmail = normalizeEmail(email)
  const normPhone = normalizePhone(phone)
  const normFirst = normalizeName(first_name)
  const normLast = normalizeName(last_name)
  if (normEmail) userData.em = [sha256(normEmail)]
  if (normPhone) userData.ph = [sha256(normPhone)]
  if (normFirst) userData.fn = [sha256(normFirst)]
  if (normLast) userData.ln = [sha256(normLast)]
  if (fbp) userData.fbp = fbp
  if (fbc) userData.fbc = fbc
  // Only ever the visitor's, never this server's request metadata — sending
  // the API host's identity is worse than omitting the fields entirely.
  if (client_ip_address) userData.client_ip_address = client_ip_address
  if (client_user_agent) userData.client_user_agent = client_user_agent

  const customData = {
    content_name: 'MemberLead' + (resolvedLocation || ''),
  }
  if (resolvedLocation) customData.content_category = resolvedLocation
  // No value, no currency. A lead has no revenue attached and value: 0 teaches
  // the optimizer the lead is worthless.

  const eventData = {
    event_name,
    event_id,
    event_time: eventTime,
    action_source: 'website',
    user_data: userData,
    custom_data: customData,
  }
  if (event_source_url) eventData.event_source_url = event_source_url

  const payload = {
    data: [eventData],
    access_token: process.env.META_ACCESS_TOKEN,
  }
  // Set only while testing against the Events Manager test stream. Must be
  // unset in production or the events never reach the real dataset.
  if (process.env.META_TEST_EVENT_CODE) {
    payload.test_event_code = process.env.META_TEST_EVENT_CODE
  }

  // 202 now, Meta after. The caller (a form submission) must never wait on
  // this round trip, and there is nothing it could do with a failure anyway.
  res.status(202).json({ ok: true })

  try {
    const response = await fetch(
      `https://graph.facebook.com/v18.0/${process.env.META_PIXEL_ID}/events`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      }
    )
    const data = await response.json()
    if (!response.ok || data.error) {
      // No retry: the existing module has no queue and this phase isn't the
      // place to build one. Log it well enough to trace back to the entry.
      console.error(`[meta-lead] ${tag} — Meta rejected:`, JSON.stringify(data))
      return
    }
    console.log(
      `[meta-lead] ${tag} location=${resolvedLocation || '(none)'} ` +
      `events_received=${data.events_received} fbtrace_id=${data.fbtrace_id}` +
      (data.messages && data.messages.length ? ` warnings=${JSON.stringify(data.messages)}` : '')
    )
  } catch (err) {
    console.error(`[meta-lead] ${tag} — request failed:`, err.message)
  }
})

module.exports = router
