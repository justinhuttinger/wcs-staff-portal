// Delivers scheduled member-app broadcasts. Runs every minute; a broadcast
// with no scheduled_for is due immediately.
const cron = require('node-cron')
const { supabaseAdmin } = require('../services/supabase')
const { subscriptionsFor, sendToSubscription, pushConfigured } = require('../lib/memberAppPush')

/**
 * Claim a broadcast by flipping scheduled -> sending, conditional on it still
 * being 'scheduled'. Two dynos running this cron cannot both win the update, so
 * a broadcast is never delivered twice.
 */
async function claim(id) {
  const { data, error } = await supabaseAdmin
    .from('memberapp_broadcasts')
    .update({ status: 'sending' })
    .eq('id', id)
    .eq('status', 'scheduled')
    .select('id')
  if (error) throw new Error(error.message)
  return (data || []).length === 1
}

/**
 * Write the broadcast into every targeted member's inbox, so it survives a
 * phone with notifications off or a failed push.
 */
async function writeInbox(broadcast, subs) {
  const seen = new Set()
  const rows = []
  for (const s of subs) {
    const key = `${s.member_id}|${s.club_number}`
    if (seen.has(key)) continue
    seen.add(key)
    rows.push({
      member_id: s.member_id,
      club_number: s.club_number,
      title: broadcast.title,
      body: broadcast.body || null,
      url: broadcast.url || null,
    })
  }
  if (rows.length === 0) return 0
  const { error } = await supabaseAdmin.from('memberapp_notifications').insert(rows)
  if (error) throw new Error(`inbox insert failed: ${error.message}`)
  return rows.length
}

async function deliver(broadcast) {
  const subs = await subscriptionsFor(broadcast)
  await writeInbox(broadcast, subs)

  const payload = {
    title: broadcast.title,
    body: broadcast.body || '',
    url: broadcast.url || '/',
  }

  let sent = 0
  let failed = 0
  for (const sub of subs) {
    const result = await sendToSubscription(sub, payload)
    if (result === 'sent') sent += 1
    else if (result === 'failed') failed += 1
  }
  return { sent, failed, devices: subs.length }
}

async function runDueBroadcasts(now = new Date()) {
  const { data: due, error } = await supabaseAdmin
    .from('memberapp_broadcasts')
    .select('*')
    .eq('status', 'scheduled')
    .or(`scheduled_for.is.null,scheduled_for.lte.${now.toISOString()}`)
    .order('created_at', { ascending: true })
    .limit(20)

  if (error) {
    console.error('[memberapp-broadcast] lookup failed:', error.message)
    return { processed: 0 }
  }
  if (!due || due.length === 0) return { processed: 0 }

  let processed = 0
  for (const broadcast of due) {
    if (!(await claim(broadcast.id))) continue // another worker took it
    try {
      const { sent, failed, devices } = await deliver(broadcast)
      await supabaseAdmin.from('memberapp_broadcasts').update({
        status: 'sent',
        sent_at: new Date().toISOString(),
        sent_count: sent,
        failed_count: failed,
        // A broadcast that reached nobody is recorded as sent with a reason
        // rather than left looking successful.
        error: devices === 0 ? 'No subscribed devices matched this audience.' : null,
      }).eq('id', broadcast.id)
      processed += 1
      console.log(`[memberapp-broadcast] "${broadcast.title}" -> ${sent}/${devices} device(s)`)
    } catch (err) {
      await supabaseAdmin.from('memberapp_broadcasts').update({
        status: 'failed', error: err.message,
      }).eq('id', broadcast.id)
      console.error('[memberapp-broadcast] failed:', err.message)
    }
  }
  return { processed }
}

function startMemberAppBroadcastCron() {
  if (!pushConfigured()) {
    console.warn('[memberapp-broadcast] cron running, but push is unconfigured — inbox only')
  }
  cron.schedule('* * * * *', () => {
    runDueBroadcasts().catch(err =>
      console.error('[memberapp-broadcast] cron error:', err.message))
  })
  console.log('[memberapp-broadcast] cron started (every minute)')
}

module.exports = { startMemberAppBroadcastCron, runDueBroadcasts, claim, deliver }
