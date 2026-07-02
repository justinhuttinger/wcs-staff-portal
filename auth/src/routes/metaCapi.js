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

module.exports = router
