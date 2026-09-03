// Web Push for the member app (wcs-member). Separate from tourPush.js on
// purpose: a push subscription is cryptographically bound to the
// applicationServerKey the browser subscribed with, so the member app's
// subscriptions can ONLY be sent with the member app's VAPID pair. Reusing
// VAPID_PRIVATE_KEY here would fail on every send with no useful error.
const webpush = require('web-push')
const { supabaseAdmin } = require('../services/supabase')

const PUBLIC_KEY = process.env.MEMBERAPP_VAPID_PUBLIC_KEY
const PRIVATE_KEY = process.env.MEMBERAPP_VAPID_PRIVATE_KEY
const SUBJECT = process.env.MEMBERAPP_VAPID_SUBJECT || 'mailto:support@wcstrength.com'

let configured = false
if (PUBLIC_KEY && PRIVATE_KEY) {
  try {
    webpush.setVapidDetails(SUBJECT, PUBLIC_KEY, PRIVATE_KEY)
    configured = true
  } catch (err) {
    console.error('[memberapp-push] VAPID config failed:', err.message)
  }
} else {
  // Named precisely, because half a pair is the worst case: the public key
  // alone lets a phone subscribe and report notifications as ON while nothing
  // can ever be delivered.
  console.error(
    '[memberapp-push] DISABLED — no member notification will ever be sent. Missing: ' +
    [!PUBLIC_KEY && 'MEMBERAPP_VAPID_PUBLIC_KEY', !PRIVATE_KEY && 'MEMBERAPP_VAPID_PRIVATE_KEY']
      .filter(Boolean).join(' and ')
  )
}

function pushConfigured() {
  return configured
}

/**
 * Resolve a broadcast audience to the (member_id, club_number) pairs it covers.
 * Returns null for "everyone", which the caller treats as no filter.
 */
async function resolveAudience(broadcast) {
  const { audience, club_number: club, tier, member_id: memberId } = broadcast

  if (audience === 'member') {
    if (!memberId) return []
    return [{ member_id: memberId, club_number: club || null }]
  }

  if (audience === 'tier') {
    // Only members staff have explicitly set carry a row, and 'basic' is the
    // default for everyone else, so a basic-tier broadcast means "everyone who
    // is not training" rather than "everyone with a basic row".
    if (tier === 'training') {
      const { data } = await supabaseAdmin
        .from('memberapp_members')
        .select('member_id, club_number')
        .eq('tier', 'training')
      return data || []
    }
    const { data: training } = await supabaseAdmin
      .from('memberapp_members')
      .select('member_id')
      .eq('tier', 'training')
    return { excludeMemberIds: (training || []).map(r => r.member_id) }
  }

  return null // all, or club (handled as a column filter below)
}

/**
 * Every subscribed device for an audience.
 */
async function subscriptionsFor(broadcast) {
  let query = supabaseAdmin
    .from('memberapp_push_subscriptions')
    .select('id, member_id, club_number, endpoint, p256dh, auth')

  if (broadcast.audience === 'club' && broadcast.club_number) {
    query = query.eq('club_number', broadcast.club_number)
  }

  const resolved = await resolveAudience(broadcast)

  if (Array.isArray(resolved)) {
    if (resolved.length === 0) return []
    query = query.in('member_id', resolved.map(r => r.member_id))
  }

  const { data, error } = await query
  if (error) throw new Error(`subscription lookup failed: ${error.message}`)
  let subs = data || []

  if (resolved && resolved.excludeMemberIds) {
    const skip = new Set(resolved.excludeMemberIds)
    subs = subs.filter(s => !skip.has(s.member_id))
  }
  return subs
}

/**
 * Send one notification to one stored subscription.
 * Returns 'sent' | 'gone' | 'failed'; 'gone' means the row was pruned.
 */
async function sendToSubscription(sub, payload) {
  try {
    await webpush.sendNotification(
      { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } },
      JSON.stringify(payload)
    )
    return 'sent'
  } catch (err) {
    // 404/410 mean the browser threw the subscription away. Prune it so the
    // table does not fill with endpoints that can never receive again.
    if (err.statusCode === 404 || err.statusCode === 410) {
      await supabaseAdmin.from('memberapp_push_subscriptions').delete().eq('id', sub.id)
      return 'gone'
    }
    console.error('[memberapp-push] send failed', err.statusCode, err.body || err.message)
    return 'failed'
  }
}

/**
 * Push to one member's devices and write the message to their in-app inbox.
 * The inbox row is written even when push is unconfigured or fails, so a
 * member with notifications off still sees it in the app.
 */
async function notifyMember({ memberId, clubNumber, title, body, url }) {
  await supabaseAdmin.from('memberapp_notifications').insert({
    member_id: memberId, club_number: clubNumber, title, body: body || null, url: url || null,
  })

  if (!configured) {
    console.warn('[memberapp-push] inbox written, push skipped: VAPID not configured')
    return { sent: 0, failed: 0 }
  }

  const { data: subs } = await supabaseAdmin
    .from('memberapp_push_subscriptions')
    .select('id, endpoint, p256dh, auth')
    .eq('member_id', memberId)
    .eq('club_number', clubNumber)

  let sent = 0
  let failed = 0
  for (const sub of subs || []) {
    const result = await sendToSubscription(sub, { title, body: body || '', url: url || '/' })
    if (result === 'sent') sent += 1
    else if (result === 'failed') failed += 1
  }
  return { sent, failed }
}

module.exports = {
  pushConfigured,
  resolveAudience,
  subscriptionsFor,
  sendToSubscription,
  notifyMember,
}
