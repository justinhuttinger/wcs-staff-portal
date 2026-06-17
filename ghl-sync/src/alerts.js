/**
 * Alert system for ABC sync errors.
 * Sends webhook to GHL which triggers an SMS workflow.
 *
 * Alerts are gated so a persistent error doesn't text every 30-minute cycle:
 *  - the caller (abcSync) only fires on a state change (errors appear / clear)
 *    plus one daily reminder while a problem persists, and
 *  - sendAlert itself drops an IDENTICAL message seen again inside a cooldown
 *    window, a safety net against any caller (e.g. a crash looping each cycle).
 */

const ALERT_WEBHOOK_URL = process.env.ALERT_WEBHOOK_URL || 'https://services.leadconnectorhq.com/hooks/uflpfHNpByAnaBLkQzu3/webhook-trigger/3692f5a8-2bc2-48ab-afd3-dfb5a93f85ba';

// Don't resend the exact same message more than once per this window.
const ALERT_COOLDOWN_MS = (parseInt(process.env.ALERT_COOLDOWN_MINUTES, 10) || 360) * 60 * 1000;
const lastSentAt = new Map(); // message -> epoch ms

/**
 * Send an alert via GHL webhook. Silently fails if webhook is down. Identical
 * messages inside the cooldown window are skipped so we can't spam.
 */
async function sendAlert(message) {
  const now = Date.now();
  const prev = lastSentAt.get(message);
  if (prev && now - prev < ALERT_COOLDOWN_MS) {
    console.log('[Alert] Suppressed (duplicate within cooldown):', message);
    return;
  }
  try {
    await fetch(ALERT_WEBHOOK_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message }),
      signal: AbortSignal.timeout(10000),
    });
    lastSentAt.set(message, now);
    console.log('[Alert] Webhook sent');
  } catch (err) {
    console.error('[Alert] Failed to send webhook:', err.message);
  }
}

/**
 * Alert for a complete sync failure (service-level crash).
 */
async function alertSyncFailed(error) {
  await sendAlert(`ABC Sync FAILED: ${error.message || error}. Check Render logs.`);
}

/**
 * Alert for errors during a sync run. `reminder` softens the wording for the
 * once-a-day "still failing" nudge so it reads differently from the first hit.
 */
async function alertSyncErrors(runSummary) {
  const { locationErrors, totalErrors, reminder } = runSummary;
  if (totalErrors === 0) return;

  const lines = [reminder
    ? `ABC Sync still failing: ${totalErrors} error(s) (daily reminder)`
    : `ABC Sync: ${totalErrors} new error(s)`];
  for (const [location, count] of Object.entries(locationErrors || {})) {
    lines.push(`${location}: ${count} errors`);
  }
  lines.push('Check admin dashboard for details.');

  await sendAlert(lines.join('. '));
}

/**
 * One-shot "all clear" once errors stop, so a resolved issue is confirmed.
 */
async function alertSyncRecovered() {
  await sendAlert('ABC Sync recovered: latest run completed with no errors.');
}

module.exports = { sendAlert, alertSyncFailed, alertSyncErrors, alertSyncRecovered };
