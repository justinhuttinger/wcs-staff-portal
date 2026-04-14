/**
 * Alert system for ABC sync errors.
 * Sends webhook to GHL which triggers an SMS workflow.
 */

const ALERT_WEBHOOK_URL = process.env.ALERT_WEBHOOK_URL || 'https://services.leadconnectorhq.com/hooks/uflpfHNpByAnaBLkQzu3/webhook-trigger/3692f5a8-2bc2-48ab-afd3-dfb5a93f85ba';

/**
 * Send an alert via GHL webhook. Silently fails if webhook is down.
 */
async function sendAlert(message) {
  try {
    await fetch(ALERT_WEBHOOK_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message }),
      signal: AbortSignal.timeout(10000),
    });
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
 * Alert for partial errors during a sync run.
 */
async function alertSyncErrors(runSummary) {
  const { locationErrors, totalErrors } = runSummary;
  if (totalErrors === 0) return;

  const lines = [`ABC Sync: ${totalErrors} error(s)`];
  for (const [location, count] of Object.entries(locationErrors)) {
    lines.push(`${location}: ${count} errors`);
  }
  lines.push('Check admin dashboard for details.');

  await sendAlert(lines.join('. '));
}

module.exports = { sendAlert, alertSyncFailed, alertSyncErrors };
