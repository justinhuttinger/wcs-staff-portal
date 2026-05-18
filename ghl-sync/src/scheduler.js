const cron = require('node-cron');
const { fullSync } = require('./sync/fullSync');
const { deltaSync } = require('./sync/deltaSync');
const { crossLocCleanup } = require('./sync/crossLocCleanup');
const { abcSync } = require('./abc/abcSync');
const { alertSyncFailed } = require('./alerts');

function startScheduler() {
  const intervalMinutes = process.env.SYNC_INTERVAL_MINUTES || 10;
  const fullSyncHour = process.env.FULL_SYNC_HOUR || 3; // PST
  // Convert PST to UTC: PST + 8 = UTC (or +7 during PDT)
  const fullSyncHourUTC = (parseInt(fullSyncHour) + 8) % 24;

  const abcIntervalMinutes = process.env.ABC_SYNC_INTERVAL_MINUTES || 30;

  // Delta sync every N minutes. Cross-location lead cleanup piggybacks
  // on the delta cycle — it needs the freshly synced contact data to
  // detect new drift (people who just got the `sale` tag at a sister
  // club). Failures on either step are logged but never bring the cron
  // down.
  cron.schedule(`*/${intervalMinutes} * * * *`, async () => {
    console.log('[Scheduler] Starting delta sync...');
    let deltaOk = false;
    try {
      await deltaSync();
      deltaOk = true;
    } catch (err) {
      console.error('[Scheduler] Delta sync failed:', err.message);
    }
    if (deltaOk) {
      try {
        await crossLocCleanup();
      } catch (err) {
        console.error('[Scheduler] Cross-loc cleanup failed:', err.message);
      }
    }
  });

  // Full re-sync daily
  cron.schedule(`0 ${fullSyncHourUTC} * * *`, () => {
    console.log('[Scheduler] Starting daily full sync...');
    fullSync().catch(err => console.error('[Scheduler] Full sync failed:', err.message));
  });

  // ABC sync every N minutes (default 30)
  cron.schedule(`*/${abcIntervalMinutes} * * * *`, async () => {
    console.log('[Scheduler] Starting ABC sync...');
    try {
      await abcSync();
    } catch (err) {
      console.error('[Scheduler] ABC sync failed:', err.message);
      await alertSyncFailed(err).catch(() => {});
    }
  });

  console.log(`[Scheduler] Delta sync every ${intervalMinutes}m, full sync daily at ${fullSyncHour}:00 PST (${fullSyncHourUTC}:00 UTC)`);
  console.log(`[Scheduler] ABC sync every ${abcIntervalMinutes}m (DRY_RUN=${process.env.DRY_RUN || 'true'})`);
}

module.exports = { startScheduler };
