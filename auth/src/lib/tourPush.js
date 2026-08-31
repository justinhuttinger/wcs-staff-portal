// Web Push for the iPad Tour Check-In app. Sends a "new tour" notification to
// every push subscription registered for a location. No-ops cleanly when VAPID
// keys aren't configured, so the rest of the tour flow never depends on it.
const webpush = require('web-push')
const { supabaseAdmin } = require('../services/supabase')

const PUBLIC_KEY = process.env.VAPID_PUBLIC_KEY
const PRIVATE_KEY = process.env.VAPID_PRIVATE_KEY
const SUBJECT = process.env.VAPID_SUBJECT || 'mailto:support@wcstrength.com'

let configured = false
if (PUBLIC_KEY && PRIVATE_KEY) {
  try {
    webpush.setVapidDetails(SUBJECT, PUBLIC_KEY, PRIVATE_KEY)
    configured = true
  } catch (err) {
    console.error('[tour-push] VAPID config failed:', err.message)
  }
} else {
  // Said once at boot, and named precisely, because half a key pair is the
  // worst case: the public key alone is enough for an iPad to subscribe and
  // report alerts as ON, so staff are told notifications work while nothing can
  // ever send one.
  console.error(
    '[tour-push] DISABLED — no notification will ever be sent. Missing: ' +
    [!PUBLIC_KEY && 'VAPID_PUBLIC_KEY', !PRIVATE_KEY && 'VAPID_PRIVATE_KEY']
      .filter(Boolean).join(' and ')
  )
}

function pushConfigured() {
  return configured
}

// Send a notification to all of a location's iPads that a tour just arrived.
// Fire-and-forget from the caller; prunes subscriptions the browser has dropped.
async function sendTourArrival(locationId, intake) {
  // Every exit from this function used to be silent, which is exactly why a
  // dead push setup survived two months and 19 arrivals without a trace.
  if (!configured) {
    console.warn('[tour-push] skipped: VAPID not configured')
    return
  }
  if (!locationId) return
  const { data: subs, error } = await supabaseAdmin
    .from('tour_push_subscriptions')
    .select('id, endpoint, p256dh, auth')
    .eq('location_id', locationId)
  if (error) {
    console.error('[tour-push] load subscriptions failed:', error.message)
    return
  }
  if (!subs || !subs.length) {
    console.log(`[tour-push] no devices subscribed for location ${locationId}`)
    return
  }

  // The service worker needs the location's tour URL to open on notification
  // tap — without it the only URL it knows is '/', the portal login page.
  let url = null
  const { data: cfg } = await supabaseAdmin
    .from('tour_location_config')
    .select('public_token')
    .eq('location_id', locationId)
    .maybeSingle()
  if (cfg && cfg.public_token) url = `/tour.html?token=${cfg.public_token}`

  const name = (intake && intake.contact_name) || 'Someone'
  const payload = JSON.stringify({
    title: 'New tour checked in',
    body: `${name} is waiting for a tour.`,
    // Per-intake tag so two near-simultaneous arrivals both surface (don't collapse).
    tag: intake && intake.id ? `tour-${intake.id}` : 'tour-arrival',
    intake_id: intake && intake.id,
    url,
  })

  const dead = []
  let sent = 0
  await Promise.all(subs.map(async (s) => {
    const subscription = { endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } }
    try {
      await webpush.sendNotification(subscription, payload)
      sent += 1
    } catch (err) {
      // 404/410 = subscription expired/unsubscribed; drop it.
      if (err.statusCode === 404 || err.statusCode === 410) {
        dead.push(s.id)
      } else {
        console.error('[tour-push] send failed:', err.statusCode, err.body || err.message)
      }
    }
  }))

  // A success line, not only failures: "nothing in the log" has to mean
  // "nothing ran", or it tells you nothing at all.
  console.log(
    `[tour-push] location ${locationId}: sent ${sent}/${subs.length}` +
    (dead.length ? `, pruned ${dead.length} expired` : '')
  )

  if (dead.length) {
    await supabaseAdmin.from('tour_push_subscriptions').delete().in('id', dead)
  }
}

module.exports = { sendTourArrival, pushConfigured }
