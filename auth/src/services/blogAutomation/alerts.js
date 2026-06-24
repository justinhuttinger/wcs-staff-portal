// auth/src/services/blogAutomation/alerts.js
// Ported from ghl-sync/src/alerts.js - POST {message} to a GHL webhook that
// triggers an SMS workflow. Identical messages within the cooldown are dropped.
const ALERT_WEBHOOK_URL = process.env.ALERT_WEBHOOK_URL
  || 'https://services.leadconnectorhq.com/hooks/uflpfHNpByAnaBLkQzu3/webhook-trigger/3692f5a8-2bc2-48ab-afd3-dfb5a93f85ba'
const ALERT_COOLDOWN_MS = (parseInt(process.env.ALERT_COOLDOWN_MINUTES, 10) || 360) * 60 * 1000
const lastSentAt = new Map()

async function sendAlert(message) {
  const now = Date.now()
  const prev = lastSentAt.get(message)
  if (prev && now - prev < ALERT_COOLDOWN_MS) { console.log('[BlogAlert] suppressed (dupe):', message); return }
  try {
    await fetch(ALERT_WEBHOOK_URL, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message }), signal: AbortSignal.timeout(10000),
    })
    lastSentAt.set(message, now)
    console.log('[BlogAlert] webhook sent')
  } catch (err) { console.error('[BlogAlert] failed:', err.message) }
}

const blogAlert = (message) => sendAlert(`Blog generator: ${message}`)

module.exports = { sendAlert, blogAlert }
