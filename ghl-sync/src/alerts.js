/**
 * SMS alert system for ABC sync errors.
 * Sends text messages via Twilio when syncs fail or have errors.
 */

const TWILIO_SID = process.env.TWILIO_ACCOUNT_SID;
const TWILIO_TOKEN = process.env.TWILIO_AUTH_TOKEN;
const TWILIO_FROM = process.env.TWILIO_PHONE_NUMBER;
const ALERT_PHONE = process.env.ALERT_PHONE_NUMBER || '+14259549854';

let twilioClient = null;

function getTwilio() {
  if (!twilioClient && TWILIO_SID && TWILIO_TOKEN) {
    twilioClient = require('twilio')(TWILIO_SID, TWILIO_TOKEN);
  }
  return twilioClient;
}

/**
 * Send an SMS alert. Silently fails if Twilio isn't configured.
 */
async function sendAlert(message) {
  const client = getTwilio();
  if (!client || !TWILIO_FROM) {
    console.warn('[Alert] Twilio not configured — skipping SMS alert');
    console.warn('[Alert] Message:', message);
    return;
  }

  try {
    await client.messages.create({
      body: message,
      from: TWILIO_FROM,
      to: ALERT_PHONE,
    });
    console.log(`[Alert] SMS sent to ${ALERT_PHONE}`);
  } catch (err) {
    console.error('[Alert] Failed to send SMS:', err.message);
  }
}

/**
 * Send alert for a complete sync failure (service-level crash).
 */
async function alertSyncFailed(error) {
  await sendAlert(`⚠️ ABC Sync FAILED\n${error.message || error}\nCheck Render logs.`);
}

/**
 * Send alert for partial errors during a sync run.
 */
async function alertSyncErrors(runSummary) {
  const { locationErrors, totalErrors } = runSummary;
  if (totalErrors === 0) return;

  const lines = [`⚠️ ABC Sync: ${totalErrors} error(s)`];
  for (const [location, count] of Object.entries(locationErrors)) {
    lines.push(`${location}: ${count} errors`);
  }
  lines.push('Check admin dashboard for details.');

  await sendAlert(lines.join('\n'));
}

module.exports = { sendAlert, alertSyncFailed, alertSyncErrors };
