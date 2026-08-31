// POST { message } to a GHL webhook that triggers an SMS workflow.
//
// This lived inside blogAutomation/, which was fine while the blog was the only
// caller. It is the portal's one SMS alert path, so it belongs here; the blog's
// module now delegates to it rather than carrying a second copy of the URL and
// the cooldown.
//
// Identical messages inside the cooldown are dropped. That matters for anything
// on a schedule: a fault that persists would otherwise text somebody on every
// run until it was fixed.
const ALERT_WEBHOOK_URL = process.env.ALERT_WEBHOOK_URL
  || 'https://services.leadconnectorhq.com/hooks/uflpfHNpByAnaBLkQzu3/webhook-trigger/3692f5a8-2bc2-48ab-afd3-dfb5a93f85ba'
const ALERT_COOLDOWN_MS = (parseInt(process.env.ALERT_COOLDOWN_MINUTES, 10) || 360) * 60 * 1000

const lastSentAt = new Map()

async function sendAlert(message) {
  const now = Date.now()
  const prev = lastSentAt.get(message)
  if (prev && now - prev < ALERT_COOLDOWN_MS) {
    console.log('[Alert] suppressed (dupe):', message)
    return { sent: false, reason: 'cooldown' }
  }
  try {
    await fetch(ALERT_WEBHOOK_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message }),
      signal: AbortSignal.timeout(10000),
    })
    lastSentAt.set(message, now)
    console.log('[Alert] webhook sent')
    return { sent: true }
  } catch (err) {
    // An alert that cannot be delivered must not take down the job that raised
    // it. The caller's log is the durable record.
    console.error('[Alert] failed:', err.message)
    return { sent: false, reason: err.message }
  }
}

module.exports = { sendAlert }
