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
}

function pushConfigured() {
  return configured
}

// Send a notification to all of a location's iPads that a tour just arrived.
// Fire-and-forget from the caller; prunes subscriptions the browser has dropped.
async function sendTourArrival(locationId, intake) {
  if (!configured || !locationId) return
  const { data: subs, error } = await supabaseAdmin
    .from('tour_push_subscriptions')
    .select('id, endpoint, p256dh, auth')
    .eq('location_id', locationId)
  if (error) {
    console.error('[tour-push] load subscriptions failed:', error.message)
    return
  }
  if (!subs || !subs.length) return

  const name = (intake && intake.contact_name) || 'Someone'
  const payload = JSON.stringify({
    title: 'New tour checked in',
    body: `${name} is waiting for a tour.`,
    tag: 'tour-arrival',
    intake_id: intake && intake.id,
  })

  const dead = []
  await Promise.all(subs.map(async (s) => {
    const subscription = { endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } }
    try {
      await webpush.sendNotification(subscription, payload)
    } catch (err) {
      // 404/410 = subscription expired/unsubscribed; drop it.
      if (err.statusCode === 404 || err.statusCode === 410) {
        dead.push(s.id)
      } else {
        console.error('[tour-push] send failed:', err.statusCode, err.body || err.message)
      }
    }
  }))

  if (dead.length) {
    await supabaseAdmin.from('tour_push_subscriptions').delete().in('id', dead)
  }
}

module.exports = { sendTourArrival, pushConfigured }
