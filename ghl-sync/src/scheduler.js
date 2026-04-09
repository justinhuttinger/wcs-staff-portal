const cron = require('node-cron');
const { fullSync } = require('./sync/fullSync');
const { deltaSync } = require('./sync/deltaSync');
function startScheduler() {
  const intervalMinutes = process.env.SYNC_INTERVAL_MINUTES || 10;
  const fullSyncHour = process.env.FULL_SYNC_HOUR || 3; // PST
  // Convert PST to UTC: PST + 8 = UTC (or +7 during PDT)
  const fullSyncHourUTC = (parseInt(fullSyncHour) + 8) % 24;

  // Delta sync every N minutes
  cron.schedule(`*/${intervalMinutes} * * * *`, async () => {
    console.log('[Scheduler] Starting delta sync...');
    try {
      await deltaSync();
    } catch (err) {
      console.error('[Scheduler] Delta sync failed:', err.message);
    }
  });

  // Full re-sync daily
  cron.schedule(`0 ${fullSyncHourUTC} * * *`, () => {
    console.log('[Scheduler] Starting daily full sync...');
    fullSync().catch(err => console.error('[Scheduler] Full sync failed:', err.message));
  });

  console.log(`[Scheduler] Delta sync every ${intervalMinutes}m, full sync daily at ${fullSyncHour}:00 PST (${fullSyncHourUTC}:00 UTC)`);
}

module.exports = { startScheduler };
